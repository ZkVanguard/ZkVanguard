/**
 * Hedera DEX Service — SaucerSwap V2 Integration
 *
 * Routes USDC swaps through SaucerSwap (Hedera's primary DEX, Uniswap V2 fork)
 * to convert deposits into the 4-asset allocation: BTC (WBTC), ETH (WETH), SUI (wrapped), CRO.
 *
 * SaucerSwap V2 Router: Standard Uniswap V2 compatible interface (getAmountsOut, swapExactTokensForTokens).
 * Docs: https://docs.saucerswap.finance/
 *
 * @see lib/services/BluefinAggregatorService.ts (SUI equivalent)
 */

import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';

// ============================================
// TYPES
// ============================================

export type HederaNetwork = 'mainnet' | 'testnet';
export type PoolAsset = 'BTC' | 'ETH' | 'SUI' | 'CRO';

export interface HederaSwapQuote {
  asset: PoolAsset;
  amountInUsdc: bigint;
  expectedOut: bigint;
  minAmountOut: bigint;
  path: string[];
  canSwap: boolean;
  error?: string;
}

export interface HederaSwapResult {
  asset: PoolAsset;
  success: boolean;
  txHash?: string;
  amountIn: string;
  amountOut?: string;
  error?: string;
}

export interface HederaRebalancePlan {
  totalUsdc: bigint;
  quotes: HederaSwapQuote[];
  timestamp: number;
}

// ============================================
// CONSTANTS
// ============================================

/**
 * SaucerSwap V2 Router — Uniswap V2 compatible
 * Hedera Mainnet: 0x00000000000000000000000000000000004d6b74 (contractId 0.0.5073268)
 * Testnet: Different address — configure via env
 */
const SAUCERSWAP_ROUTER: Record<HederaNetwork, string> = {
  mainnet: process.env.HEDERA_SAUCERSWAP_ROUTER || '0x00000000000000000000000000000000004d6b74',
  testnet: process.env.HEDERA_TESTNET_SAUCERSWAP_ROUTER || '0x0000000000000000000000000000000000000000',
};

const SAUCERSWAP_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

/**
 * Token addresses on Hedera (EVM-compatible format).
 * WHBAR is used as intermediate routing token (like WETH on Ethereum).
 */
const HEDERA_TOKENS: Record<HederaNetwork, Record<string, string>> = {
  mainnet: {
    USDC:  process.env.HEDERA_USDC_ADDRESS   || '0x000000000000000000000000000000000006f89a', // USDC on Hedera
    WHBAR: process.env.HEDERA_WHBAR_ADDRESS   || '0x0000000000000000000000000000000000163b5a', // Wrapped HBAR
    WBTC:  process.env.HEDERA_WBTC_ADDRESS    || '0x0000000000000000000000000000000000000000', // WBTC — set when available
    WETH:  process.env.HEDERA_WETH_ADDRESS    || '0x0000000000000000000000000000000000000000', // WETH — set when available
    SUI:   '',  // No native SUI on Hedera — hedged via cross-chain
    CRO:   '',  // No native CRO on Hedera — hedged via cross-chain
  },
  testnet: {
    USDC:  process.env.HEDERA_TESTNET_USDC_ADDRESS  || '0x0000000000000000000000000000000000000000',
    WHBAR: process.env.HEDERA_TESTNET_WHBAR_ADDRESS  || '0x0000000000000000000000000000000000000000',
    WBTC:  '',
    WETH:  '',
    SUI:   '',
    CRO:   '',
  },
};

const ASSET_TOKEN_KEY: Record<PoolAsset, string> = {
  BTC: 'WBTC',
  ETH: 'WETH',
  SUI: 'SUI',
  CRO: 'CRO',
};

/** Maximum slippage (3% on mainnet, 5% on testnet) */
const MAX_SLIPPAGE_BPS: Record<HederaNetwork, bigint> = {
  mainnet: 300n,
  testnet: 500n,
};

/** Max single swap size in USDC (6 decimals) */
const MAX_SWAP_USDC: Record<HederaNetwork, bigint> = {
  mainnet: 50_000_000_000n, // $50k
  testnet: 100_000_000_000n,
};

/** Minimum trade size in USDC */
const MIN_TRADE_USDC = 1_000_000n; // $1

// ============================================
// SERVICE
// ============================================

export class HederaDexService {
  private network: HederaNetwork;
  private tokens: Record<string, string>;

  constructor(network: HederaNetwork = 'testnet') {
    this.network = network;
    this.tokens = HEDERA_TOKENS[network];
  }

  /** Get RPC URL for this network */
  private getRpcUrl(): string {
    return this.network === 'mainnet'
      ? (process.env.HEDERA_MAINNET_RPC_URL || 'https://mainnet.hashio.io/api')
      : (process.env.HEDERA_TESTNET_RPC_URL || 'https://testnet.hashio.io/api');
  }

  /** Check if a token is available on Hedera (has a configured address) */
  canSwapOnChain(asset: PoolAsset): boolean {
    const key = ASSET_TOKEN_KEY[asset];
    const addr = this.tokens[key];
    return !!addr && addr !== '' && addr !== ethers.ZeroAddress;
  }

  /**
   * Get a swap quote from SaucerSwap for USDC → asset.
   * Routes through WHBAR if no direct USDC pair exists.
   */
  async getSwapQuote(asset: PoolAsset, usdcAmount: bigint): Promise<HederaSwapQuote> {
    const tokenKey = ASSET_TOKEN_KEY[asset];
    const tokenAddr = this.tokens[tokenKey];

    if (!tokenAddr || tokenAddr === '' || tokenAddr === ethers.ZeroAddress) {
      return {
        asset,
        amountInUsdc: usdcAmount,
        expectedOut: 0n,
        minAmountOut: 0n,
        path: [],
        canSwap: false,
        error: `${asset} (${tokenKey}) not available on Hedera ${this.network}`,
      };
    }

    if (usdcAmount > MAX_SWAP_USDC[this.network]) {
      return {
        asset,
        amountInUsdc: usdcAmount,
        expectedOut: 0n,
        minAmountOut: 0n,
        path: [],
        canSwap: false,
        error: `Swap size exceeds max $${Number(MAX_SWAP_USDC[this.network]) / 1e6}`,
      };
    }

    const routerAddr = SAUCERSWAP_ROUTER[this.network];
    if (routerAddr === ethers.ZeroAddress) {
      return {
        asset,
        amountInUsdc: usdcAmount,
        expectedOut: 0n,
        minAmountOut: 0n,
        path: [],
        canSwap: false,
        error: 'SaucerSwap router not configured for this network',
      };
    }

    try {
      const provider = new ethers.JsonRpcProvider(this.getRpcUrl());
      const router = new ethers.Contract(routerAddr, SAUCERSWAP_ROUTER_ABI, provider);

      // Try direct path first: USDC → Token
      let path = [this.tokens.USDC, tokenAddr];
      let amounts: bigint[];

      try {
        amounts = await router.getAmountsOut(usdcAmount, path);
      } catch {
        // Direct path failed — route through WHBAR
        if (this.tokens.WHBAR && this.tokens.WHBAR !== ethers.ZeroAddress) {
          path = [this.tokens.USDC, this.tokens.WHBAR, tokenAddr];
          amounts = await router.getAmountsOut(usdcAmount, path);
        } else {
          throw new Error('No route available (direct failed, no WHBAR)');
        }
      }

      const expectedOut = amounts[amounts.length - 1];
      const slippageBps = MAX_SLIPPAGE_BPS[this.network];
      const minAmountOut = (expectedOut * (10000n - slippageBps)) / 10000n;

      return {
        asset,
        amountInUsdc: usdcAmount,
        expectedOut,
        minAmountOut,
        path,
        canSwap: true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        asset,
        amountInUsdc: usdcAmount,
        expectedOut: 0n,
        minAmountOut: 0n,
        path: [],
        canSwap: false,
        error: msg,
      };
    }
  }

  /**
   * Plan rebalance swaps for all 4 pool assets.
   */
  async planRebalanceSwaps(
    totalUsdc: bigint,
    allocations: Record<PoolAsset, number>,
  ): Promise<HederaRebalancePlan> {
    const assets: PoolAsset[] = ['BTC', 'ETH', 'SUI', 'CRO'];
    const quotes: HederaSwapQuote[] = [];

    const results = await Promise.allSettled(
      assets.map(async (asset) => {
        const pct = allocations[asset] || 0;
        if (pct <= 0) return null;
        const assetUsdc = (totalUsdc * BigInt(Math.round(pct * 100))) / 10000n;
        if (assetUsdc < MIN_TRADE_USDC) return null;
        return this.getSwapQuote(asset, assetUsdc);
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        quotes.push(r.value);
      }
    }

    return { totalUsdc, quotes, timestamp: Date.now() };
  }

  /**
   * Execute a single swap on SaucerSwap via admin wallet.
   */
  async executeSwap(
    quote: HederaSwapQuote,
    adminKey: string,
  ): Promise<HederaSwapResult> {
    if (!quote.canSwap) {
      return {
        asset: quote.asset,
        success: false,
        amountIn: quote.amountInUsdc.toString(),
        error: quote.error || 'Quote not executable',
      };
    }

    try {
      const provider = new ethers.JsonRpcProvider(this.getRpcUrl());
      const wallet = new ethers.Wallet(adminKey, provider);
      const routerAddr = SAUCERSWAP_ROUTER[this.network];

      // Approve USDC spend
      const usdcContract = new ethers.Contract(this.tokens.USDC, ERC20_ABI, wallet);
      const currentAllowance: bigint = await usdcContract.allowance(wallet.address, routerAddr);
      if (currentAllowance < quote.amountInUsdc) {
        const approveTx = await usdcContract.approve(routerAddr, quote.amountInUsdc);
        await approveTx.wait();
        logger.info(`[HederaDex] Approved ${ethers.formatUnits(quote.amountInUsdc, 6)} USDC for ${quote.asset}`);
      }

      // Execute swap
      const router = new ethers.Contract(routerAddr, SAUCERSWAP_ROUTER_ABI, wallet);
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min

      const tx = await router.swapExactTokensForTokens(
        quote.amountInUsdc,
        quote.minAmountOut,
        quote.path,
        wallet.address,
        deadline,
      );

      const receipt = await tx.wait();

      logger.info(`[HederaDex] Swap executed: USDC → ${quote.asset}`, {
        txHash: receipt.hash,
        amountIn: ethers.formatUnits(quote.amountInUsdc, 6),
      });

      return {
        asset: quote.asset,
        success: true,
        txHash: receipt.hash,
        amountIn: quote.amountInUsdc.toString(),
        amountOut: quote.expectedOut.toString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[HederaDex] Swap failed for ${quote.asset}`, { error: msg });
      return {
        asset: quote.asset,
        success: false,
        amountIn: quote.amountInUsdc.toString(),
        error: msg,
      };
    }
  }

  /**
   * Execute a full rebalance: swap USDC → each asset per the plan.
   * Sequential execution to avoid nonce issues.
   */
  async executeRebalance(
    plan: HederaRebalancePlan,
    adminKey: string,
  ): Promise<{
    results: HederaSwapResult[];
    executed: number;
    failed: number;
    skipped: number;
  }> {
    const results: HederaSwapResult[] = [];
    let executed = 0;
    let failed = 0;
    let skipped = 0;

    for (const quote of plan.quotes) {
      if (!quote.canSwap) {
        results.push({
          asset: quote.asset,
          success: false,
          amountIn: quote.amountInUsdc.toString(),
          error: quote.error || `${quote.asset} not available on Hedera`,
        });
        skipped++;
        continue;
      }

      const result = await this.executeSwap(quote, adminKey);
      results.push(result);

      if (result.success) {
        executed++;
        // Small delay between swaps for state propagation
        await new Promise(r => setTimeout(r, 1500));
      } else {
        failed++;
      }
    }

    return { results, executed, failed, skipped };
  }
}

// ============================================
// SINGLETON
// ============================================

let instance: HederaDexService | null = null;

export function getHederaDexService(network?: HederaNetwork): HederaDexService {
  const net = network || (process.env.HEDERA_NETWORK as HederaNetwork) || 'testnet';
  if (!instance || (instance as any).network !== net) {
    instance = new HederaDexService(net);
  }
  return instance;
}
