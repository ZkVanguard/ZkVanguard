/**
 * Cetus Aggregator Service — Multi-DEX Swap Routing for SUI
 * 
 * Uses @cetusprotocol/aggregator-sdk to route USDC swaps across
 * multiple DEXs (Cetus, DeepBook, Turbos, BlueFin, FlowX, Aftermath, etc.)
 * for optimal pricing when rebalancing the 4-asset SUI community pool.
 * 
 * Pool Assets: BTC (wBTC), ETH (wETH), SUI, CRO
 * Deposit Token: USDC on SUI
 * 
 * This service is used by:
 * - QStash cron (/api/cron/sui-community-pool) for AI-driven rebalancing
 * - API routes for swap quotes
 * 
 * @see https://github.com/CetusProtocol/aggregator
 * @see https://cetus-1.gitbook.io/cetus-developer-docs/developer/cetus-plus-aggregator
 */

import { logger } from '@/lib/utils/logger';
import { AggregatorClient, Env, type FindRouterParams, type RouterDataV3 } from '@cetusprotocol/aggregator-sdk';
import BN from 'bn.js';

// Dynamic imports for SUI SDK (avoids type conflicts at module level)
async function getSuiSdk() {
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
  const { Transaction } = await import('@mysten/sui/transactions');
  const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
  return { Ed25519Keypair, Transaction, SuiClient, getFullnodeUrl };
}

// ============================================
// COIN TYPE CONSTANTS (SUI mainnet)
// ============================================

/** Canonical on-chain coin types for the 4 pool assets + USDC */
export const SUI_COIN_TYPES: Record<string, Record<string, string>> = {
  mainnet: {
    USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    SUI:  '0x2::sui::SUI',
    WBTC: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
    WETH: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
    // CRO does not have native liquidity on SUI — hedged via BlueFin perpetuals.
    CRO:  '',
  },
  testnet: {
    USDC: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
    SUI:  '0x2::sui::SUI',
    // Testnet has no wrapped BTC/ETH/CRO tokens — all hedged via BlueFin perps
    WBTC: '',
    WETH: '',
    CRO:  '',
  },
};

/**
 * Mainnet coin types for price discovery via Cetus aggregator.
 * The Cetus aggregator API (api-sui.cetus.zone/router_v3) only indexes MAINNET pools.
 * On testnet, we use these mainnet types to get real DEX quotes for price discovery,
 * then execute positions via BlueFin perps hedging.
 */
const MAINNET_COIN_TYPES: Record<string, string> = {
  USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  SUI:  '0x2::sui::SUI',
  WBTC: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
  WETH: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
  CRO:  '', // No CRO on SUI at all
};

/** Decimal precision for each asset */
export const ASSET_DECIMALS: Record<string, number> = {
  USDC: 6,
  SUI:  9,
  WBTC: 8,
  WETH: 8,
  CRO:  8,
  BTC:  8,
  ETH:  8,
};

/** Map pool asset names to coin type keys */
const ASSET_TO_COIN_KEY: Record<string, string> = {
  BTC: 'WBTC',
  ETH: 'WETH',
  SUI: 'SUI',
  CRO: 'CRO', // No on-chain swap — hedged via perps
};

// ============================================
// TYPES
// ============================================

export type NetworkType = 'mainnet' | 'testnet';
export type PoolAsset = 'BTC' | 'ETH' | 'SUI' | 'CRO';

export interface SwapQuoteResult {
  asset: PoolAsset;
  fromCoinType: string;
  toCoinType: string;
  amountIn: string;        // Raw amount (USDC, 6 decimals)
  expectedAmountOut: string; // Raw amount in target asset decimals
  priceImpact: number;
  route: string;
  routerData: RouterDataV3 | null;
  canSwapOnChain: boolean;  // false for CRO (hedged via perps)
  isSimulated?: boolean;    // true when using price-based estimate (testnet)
  hedgeVia?: 'bluefin' | 'virtual'; // how non-swappable assets are handled
}

export interface RebalanceSwapPlan {
  totalUsdcToSwap: number;
  swaps: SwapQuoteResult[];
  timestamp: number;
}

export interface SwapExecutionResult {
  asset: PoolAsset;
  success: boolean;
  txDigest?: string;
  amountIn: string;
  amountOut?: string;
  error?: string;
}

// ============================================
// SAFETY CONSTANTS
// ============================================

/** Maximum USDC value per single swap transaction */
const MAX_SWAP_SIZE_USD: Record<NetworkType, number> = {
  mainnet: 50_000,   // $50k max per swap on mainnet
  testnet: 100_000,  // Higher on testnet for testing
};

/** Maximum slippage allowed (prevents sandwich attacks) */
const MAX_SLIPPAGE: Record<NetworkType, number> = {
  mainnet: 0.02,    // 2% max on mainnet
  testnet: 0.05,    // 5% on testnet (low liquidity)
};

/** Gas budget in MIST (1 SUI = 1e9 MIST) */
const GAS_BUDGET: Record<NetworkType, number> = {
  mainnet: 50_000_000,   // 0.05 SUI
  testnet: 50_000_000,   // 0.05 SUI
};

/** Minimum SUI balance required for gas (prevents wallet drain) */
const MIN_GAS_RESERVE_MIST = 100_000_000; // 0.1 SUI always kept in wallet

// ============================================
// CETUS AGGREGATOR SERVICE
// ============================================

export class CetusAggregatorService {
  private client: AggregatorClient;
  /** Mainnet client for price discovery (Cetus aggregator only indexes mainnet) */
  private priceClient: AggregatorClient;
  private network: NetworkType;
  private coinTypes: Record<string, string>;

  constructor(network: NetworkType = 'mainnet') {
    this.network = network;

    // Let the SDK create its own SuiClient to avoid type conflicts
    this.client = new AggregatorClient({
      env: network === 'mainnet' ? Env.Mainnet : Env.Testnet,
    });

    // Mainnet client for price discovery — Cetus aggregator API only indexes mainnet pools.
    // On testnet, we use this to get real DEX swap rates for accurate pricing.
    this.priceClient = network === 'mainnet'
      ? this.client
      : new AggregatorClient({ env: Env.Mainnet });

    this.coinTypes = SUI_COIN_TYPES[network] || SUI_COIN_TYPES.mainnet;

    logger.info('[CetusAggregator] Initialized', { network, hasPriceClient: this.priceClient !== this.client });
  }

  /**
   * Estimate expected output from market price when DEX has no liquidity.
   * Used on testnet or when Cetus returns 0.
   */
  private async estimateOutputFromPrice(
    asset: PoolAsset,
    usdcAmount: number,
  ): Promise<{ estimatedOut: string; price: number } | null> {
    try {
      // Dynamic import to avoid circular dependency
      const { getMarketDataService } = await import('@/lib/services/RealMarketDataService');
      const mds = getMarketDataService();
      const data = await mds.getTokenPrice(asset);
      if (!data.price || data.price <= 0) return null;

      const coinKey = ASSET_TO_COIN_KEY[asset];
      const decimals = ASSET_DECIMALS[coinKey] || ASSET_DECIMALS[asset] || 8;
      const assetAmount = usdcAmount / data.price;
      const rawAmount = Math.floor(assetAmount * Math.pow(10, decimals));
      
      return { estimatedOut: rawAmount.toString(), price: data.price };
    } catch {
      return null;
    }
  }

  /**
   * Get a real DEX swap quote from Cetus mainnet aggregator for price discovery.
   * Uses mainnet coin types to get accurate pricing from real liquidity pools,
   * even when running on testnet.
   */
  private async getMainnetPriceQuote(
    asset: PoolAsset,
    usdcAmount: number,
  ): Promise<{ estimatedOut: string; price: number; route: string } | null> {
    const coinKey = ASSET_TO_COIN_KEY[asset];
    const toCoinType = MAINNET_COIN_TYPES[coinKey] || '';
    const fromCoinType = MAINNET_COIN_TYPES.USDC;

    if (!toCoinType) return null;

    try {
      const amountInRaw = new BN(Math.floor(usdcAmount * 1e6).toString());
      const routerData = await this.priceClient.findRouters({
        from: fromCoinType,
        target: toCoinType,
        amount: amountInRaw,
        byAmountIn: true,
      });

      if (!routerData || routerData.amountOut.toString() === '0') return null;

      const expectedOut = routerData.amountOut.toString();
      const paths = routerData.paths || [];
      const routeDesc = paths.length > 0
        ? paths.map((p: { provider: string }) => p.provider).join(' → ')
        : 'Cetus';

      // Derive price from DEX output
      const decimals = ASSET_DECIMALS[coinKey] || ASSET_DECIMALS[asset] || 8;
      const assetAmount = Number(expectedOut) / Math.pow(10, decimals);
      const effectivePrice = assetAmount > 0 ? usdcAmount / assetAmount : 0;

      logger.info(`[CetusAggregator] Mainnet price quote for ${asset}`, {
        usdcAmount,
        expectedOut,
        effectivePrice: effectivePrice.toFixed(2),
        route: routeDesc,
      });

      return { estimatedOut: expectedOut, price: effectivePrice, route: routeDesc };
    } catch (err) {
      logger.debug(`[CetusAggregator] Mainnet price query failed for ${asset}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // ============================================
  // SWAP QUOTES
  // ============================================

  /**
   * Get a swap quote for USDC → target asset via Cetus aggregator.
   * 
   * On MAINNET: Routes across multiple DEXs for optimal pricing + on-chain execution.
   * On TESTNET: Uses mainnet Cetus aggregator for real DEX price discovery,
   *   then routes positions via BlueFin perps hedging (testnet has no DEX liquidity).
   *   This is NOT simulated — prices come from real mainnet DEX pools.
   */
  async getSwapQuote(
    asset: PoolAsset,
    usdcAmount: number,
  ): Promise<SwapQuoteResult> {
    const coinKey = ASSET_TO_COIN_KEY[asset];
    const toCoinType = this.coinTypes[coinKey] || '';
    const fromCoinType = this.coinTypes.USDC;

    // ── TESTNET MODE: Use mainnet Cetus for price discovery, BlueFin for execution ──
    if (this.network === 'testnet') {
      return this.getTestnetQuote(asset, usdcAmount, fromCoinType, toCoinType);
    }

    // ── MAINNET MODE: Real Cetus on-chain swaps ──

    // CRO has no on-chain liquidity on SUI — hedge via perps
    if (!toCoinType || asset === 'CRO') {
      const estimate = await this.estimateOutputFromPrice(asset, usdcAmount);
      return {
        asset,
        fromCoinType,
        toCoinType: toCoinType || '',
        amountIn: Math.floor(usdcAmount * 1e6).toString(),
        expectedAmountOut: estimate?.estimatedOut || '0',
        priceImpact: 0,
        route: `USDC → ${asset} (hedged via BlueFin perps)`,
        routerData: null,
        canSwapOnChain: false,
        isSimulated: false,
        hedgeVia: 'bluefin',
      };
    }

    const amountInRaw = new BN(Math.floor(usdcAmount * 1e6).toString());

    try {
      const routerData = await this.client.findRouters({
        from: fromCoinType,
        target: toCoinType,
        amount: amountInRaw,
        byAmountIn: true,
      });

      if (!routerData) {
        logger.warn(`[CetusAggregator] No route found for USDC → ${asset}`);
        const estimate = await this.estimateOutputFromPrice(asset, usdcAmount);
        return {
          asset,
          fromCoinType,
          toCoinType,
          amountIn: amountInRaw.toString(),
          expectedAmountOut: estimate?.estimatedOut || '0',
          priceImpact: 0,
          route: estimate
            ? `USDC → ${asset} (hedged via BlueFin perps)`
            : `No route found for USDC → ${asset}`,
          routerData: null,
          canSwapOnChain: false,
          isSimulated: false,
          hedgeVia: estimate ? 'bluefin' : undefined,
        };
      }

      const expectedOut = routerData.amountOut.toString();
      const paths = routerData.paths || [];
      const routeDesc = paths.length > 0
        ? paths.map((p: { from: string; target: string; provider: string }) =>
            `${p.provider}`
          ).join(' → ')
        : 'direct';

      const priceImpact = routerData.deviationRatio
        ? Math.abs(routerData.deviationRatio)
        : 0;

      // If Cetus returned 0 output, fall back to BlueFin hedging
      if (expectedOut === '0' || expectedOut === '') {
        const estimate = await this.estimateOutputFromPrice(asset, usdcAmount);
        if (estimate) {
          logger.info(`[CetusAggregator] Cetus returned 0 for ${asset}, hedging via BlueFin`, { price: estimate.price });
          return {
            asset,
            fromCoinType,
            toCoinType,
            amountIn: amountInRaw.toString(),
            expectedAmountOut: estimate.estimatedOut,
            priceImpact: 0,
            route: `USDC → ${asset} (hedged via BlueFin perps)`,
            routerData: null,
            canSwapOnChain: false,
            isSimulated: false,
            hedgeVia: 'bluefin',
          };
        }
      }

      logger.info(`[CetusAggregator] Quote USDC → ${asset}`, {
        amountIn: usdcAmount,
        expectedOut,
        route: routeDesc,
        priceImpact,
      });

      return {
        asset,
        fromCoinType,
        toCoinType,
        amountIn: amountInRaw.toString(),
        expectedAmountOut: expectedOut,
        priceImpact,
        route: `USDC → ${asset} via ${routeDesc}`,
        routerData,
        canSwapOnChain: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[CetusAggregator] Quote failed for USDC → ${asset}`, { error: message });
      const estimate = await this.estimateOutputFromPrice(asset, usdcAmount);
      return {
        asset,
        fromCoinType,
        toCoinType,
        amountIn: amountInRaw.toString(),
        expectedAmountOut: estimate?.estimatedOut || '0',
        priceImpact: 0,
        route: estimate
          ? `USDC → ${asset} (hedged via BlueFin perps)`
          : `Quote failed: ${message}`,
        routerData: null,
        canSwapOnChain: false,
        isSimulated: false,
        hedgeVia: estimate ? 'bluefin' : undefined,
      };
    }
  }

  /**
   * Testnet quote: Uses mainnet Cetus aggregator for real DEX price discovery,
   * then marks positions for BlueFin perps hedging.
   * 
   * The Cetus aggregator API (api-sui.cetus.zone/router_v3) only indexes mainnet pools.
   * We query mainnet DEX routing for accurate pricing, then execute via BlueFin testnet.
   */
  private async getTestnetQuote(
    asset: PoolAsset,
    usdcAmount: number,
    fromCoinType: string,
    toCoinType: string,
  ): Promise<SwapQuoteResult> {
    // Try mainnet Cetus aggregator for real DEX pricing first
    const cetusQuote = await this.getMainnetPriceQuote(asset, usdcAmount);
    if (cetusQuote) {
      return {
        asset,
        fromCoinType,
        toCoinType: toCoinType || MAINNET_COIN_TYPES[ASSET_TO_COIN_KEY[asset]] || '',
        amountIn: Math.floor(usdcAmount * 1e6).toString(),
        expectedAmountOut: cetusQuote.estimatedOut,
        priceImpact: 0,
        route: `USDC → ${asset} via Cetus DEX (${cetusQuote.route}) → BlueFin hedge`,
        routerData: null,
        canSwapOnChain: false, // Testnet: execute via BlueFin, not on-chain swap
        isSimulated: false,    // NOT simulated — real DEX prices from mainnet
        hedgeVia: 'bluefin',
      };
    }

    // Fallback: use market price API if Cetus aggregator is unreachable
    const estimate = await this.estimateOutputFromPrice(asset, usdcAmount);
    if (estimate) {
      return {
        asset,
        fromCoinType,
        toCoinType: toCoinType || '',
        amountIn: Math.floor(usdcAmount * 1e6).toString(),
        expectedAmountOut: estimate.estimatedOut,
        priceImpact: 0,
        route: `USDC → ${asset} via market-price ($${estimate.price.toFixed(2)}) → BlueFin hedge`,
        routerData: null,
        canSwapOnChain: false,
        isSimulated: false, // BlueFin hedging is real, not simulated
        hedgeVia: 'bluefin',
      };
    }

    // Last resort: no price data available
    return {
      asset,
      fromCoinType,
      toCoinType: toCoinType || '',
      amountIn: Math.floor(usdcAmount * 1e6).toString(),
      expectedAmountOut: '0',
      priceImpact: 0,
      route: `USDC → ${asset} (no price data available)`,
      routerData: null,
      canSwapOnChain: false,
      isSimulated: true,
      hedgeVia: 'virtual',
    };
  }

  /**
   * Get swap quotes for all 4 assets based on allocation percentages.
   * This is used by the AI cron to plan rebalancing.
   * Includes both on-chain swappable and simulated (price-tracked) positions.
   */
  async planRebalanceSwaps(
    totalUsdcAvailable: number,
    allocations: Record<PoolAsset, number>,
  ): Promise<RebalanceSwapPlan> {
    const swaps: SwapQuoteResult[] = [];

    // Get quotes in parallel for each asset allocation
    const quotePromises = (Object.keys(allocations) as PoolAsset[]).map(async (asset) => {
      const pct = allocations[asset] || 0;
      if (pct <= 0) return null;

      const usdcForAsset = totalUsdcAvailable * (pct / 100);
      if (usdcForAsset < 0.50) return null; // Skip if less than $0.50 (gas costs would exceed value)

      return this.getSwapQuote(asset, usdcForAsset);
    });

    const results = await Promise.allSettled(quotePromises);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        swaps.push(r.value);
      }
    }

    return {
      totalUsdcToSwap: totalUsdcAvailable,
      swaps,
      timestamp: Date.now(),
    };
  }

  // ============================================
  // SWAP EXECUTION (builds Transaction for signing)
  // ============================================

  /**
   * Build a Transaction that swaps USDC → target asset via Cetus aggregator.
   * The caller must sign and execute the transaction.
   * 
   * Uses `fastRouterSwap` which automatically handles:
   * - Input coin creation (coinWithBalance)
   * - Multi-hop routing across DEXs
   * - Output coin merge/transfer
   */
  async buildSwapTransaction(
    quote: SwapQuoteResult,
    senderAddress: string,
    slippage: number = 0.01, // 1% default
  ): Promise<unknown | null> {
    if (!quote.routerData || !quote.canSwapOnChain) {
      logger.warn(`[CetusAggregator] Cannot build swap tx for ${quote.asset} — no route`);
      return null;
    }

    try {
      const { Transaction } = await import('@mysten/sui/transactions');
      const txb = new Transaction();
      txb.setSender(senderAddress);

      await this.client.fastRouterSwap({
        router: quote.routerData,
        txb: txb as any,
        slippage,
      });

      logger.info(`[CetusAggregator] Built swap tx: USDC → ${quote.asset}`, {
        amountIn: quote.amountIn,
        expectedOut: quote.expectedAmountOut,
      });

      return txb;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[CetusAggregator] Failed to build swap tx for ${quote.asset}`, { error: message });
      return null;
    }
  }

  /**
   * Build a single Transaction that executes all rebalance swaps atomically.
   * Each USDC → asset swap is added to the same PTB (Programmable Transaction Block).
   */
  async buildRebalanceTransaction(
    plan: RebalanceSwapPlan,
    senderAddress: string,
    slippage: number = 0.01,
  ): Promise<unknown | null> {
    const swappableQuotes = plan.swaps.filter(s => s.canSwapOnChain && s.routerData);
    if (swappableQuotes.length === 0) {
      logger.warn('[CetusAggregator] No on-chain swaps to execute in rebalance plan');
      return null;
    }

    try {
      const { Transaction } = await import('@mysten/sui/transactions');
      const txb = new Transaction();
      txb.setSender(senderAddress);

      for (const quote of swappableQuotes) {
        await this.client.fastRouterSwap({
          router: quote.routerData!,
          txb: txb as any,
          slippage,
        });
      }

      logger.info('[CetusAggregator] Built rebalance tx', {
        swapCount: swappableQuotes.length,
        assets: swappableQuotes.map(s => s.asset),
        totalUsdc: plan.totalUsdcToSwap,
      });

      return txb;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[CetusAggregator] Failed to build rebalance tx', { error: message });
      return null;
    }
  }

  // ============================================
  // SWAP EXECUTION — Sign + Submit On-Chain
  // ============================================

  /**
   * Execute a single swap: sign + submit using admin keypair.
   * Requires SUI_POOL_ADMIN_KEY env var (base64 or hex encoded private key).
   * 
   * Safety checks (mainnet):
   * - Max swap size per transaction
   * - Slippage bounds enforcement
   * - Gas reserve validation (prevents wallet drain)
   */
  async executeSwap(
    quote: SwapQuoteResult,
    slippage: number = 0.01,
  ): Promise<SwapExecutionResult> {
    if (!quote.routerData || !quote.canSwapOnChain) {
      return {
        asset: quote.asset,
        success: false,
        amountIn: quote.amountIn,
        error: `Cannot swap ${quote.asset} on-chain (no route or hedged via perps)`,
      };
    }

    const adminKey = process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY;
    if (!adminKey) {
      return {
        asset: quote.asset,
        success: false,
        amountIn: quote.amountIn,
        error: 'SUI_POOL_ADMIN_KEY not configured',
      };
    }

    // Safety: enforce slippage bounds
    const maxSlippage = MAX_SLIPPAGE[this.network];
    const safeSlippage = Math.min(slippage, maxSlippage);

    // Safety: enforce max swap size
    const swapUsdcAmount = Number(quote.amountIn) / 1e6;
    const maxSwap = MAX_SWAP_SIZE_USD[this.network];
    if (swapUsdcAmount > maxSwap) {
      return {
        asset: quote.asset,
        success: false,
        amountIn: quote.amountIn,
        error: `Swap size $${swapUsdcAmount.toFixed(2)} exceeds max $${maxSwap} on ${this.network}`,
      };
    }

    try {
      const { Ed25519Keypair, Transaction, SuiClient, getFullnodeUrl } = await getSuiSdk();

      // Derive keypair from env (supports base64 or hex)
      const keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(
            Buffer.from(adminKey.replace(/^0x/, ''), 'hex')
          );
      const senderAddress = keypair.getPublicKey().toSuiAddress();

      // Safety: check gas reserve before executing
      const rpcUrl = this.network === 'mainnet'
        ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
        : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
      const suiClient = new SuiClient({ url: rpcUrl });

      const balance = await suiClient.getBalance({ owner: senderAddress });
      const balanceMist = BigInt(balance.totalBalance);
      const gasBudget = GAS_BUDGET[this.network];
      if (balanceMist < BigInt(MIN_GAS_RESERVE_MIST) + BigInt(gasBudget)) {
        return {
          asset: quote.asset,
          success: false,
          amountIn: quote.amountIn,
          error: `Insufficient gas: ${Number(balanceMist) / 1e9} SUI available, need at least ${(MIN_GAS_RESERVE_MIST + gasBudget) / 1e9} SUI`,
        };
      }

      // Build unsigned PTB
      const txb = new Transaction();
      txb.setSender(senderAddress);
      txb.setGasBudget(gasBudget);

      await this.client.fastRouterSwap({
        router: quote.routerData,
        txb: txb as any,
        slippage: safeSlippage,
      });

      // Sign + execute
      const result = await suiClient.signAndExecuteTransaction({
        transaction: txb,
        signer: keypair,
        options: { showEffects: true, showEvents: true },
      });

      const success = result.effects?.status?.status === 'success';
      
      logger.info(`[CetusAggregator] Swap executed: USDC → ${quote.asset}`, {
        txDigest: result.digest,
        success,
        amountIn: quote.amountIn,
        expectedOut: quote.expectedAmountOut,
      });

      return {
        asset: quote.asset,
        success,
        txDigest: result.digest,
        amountIn: quote.amountIn,
        amountOut: quote.expectedAmountOut,
        error: success ? undefined : result.effects?.status?.error,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[CetusAggregator] Swap execution failed for ${quote.asset}`, { error: message });
      return {
        asset: quote.asset,
        success: false,
        amountIn: quote.amountIn,
        error: message,
      };
    }
  }

  /**
   * Execute a full rebalance: swap USDC → each asset according to plan.
   * Executes each swap as a separate transaction (atomic per-swap, not all-or-nothing).
   * 
   * Why separate txs instead of one PTB:
   * - If BTC swap fails, ETH/SUI swaps can still succeed
   * - Each swap can have different slippage
   * - Easier to debug per-asset
   */
  async executeRebalance(
    plan: RebalanceSwapPlan,
    slippage: number = 0.01,
  ): Promise<{
    success: boolean;
    results: SwapExecutionResult[];
    totalExecuted: number;
    totalFailed: number;
  }> {
    if (!process.env.SUI_POOL_ADMIN_KEY && !process.env.BLUEFIN_PRIVATE_KEY) {
      return {
        success: false,
        results: [{
          asset: 'BTC' as PoolAsset,
          success: false,
          amountIn: '0',
          error: 'SUI_POOL_ADMIN_KEY not configured — swaps disabled',
        }],
        totalExecuted: 0,
        totalFailed: 1,
      };
    }

    const swappable = plan.swaps.filter(s => s.canSwapOnChain && s.routerData);
    if (swappable.length === 0) {
      logger.info('[CetusAggregator] No on-chain swaps to execute');
      return { success: true, results: [], totalExecuted: 0, totalFailed: 0 };
    }

    logger.info('[CetusAggregator] Executing rebalance', {
      swapCount: swappable.length,
      assets: swappable.map(s => s.asset),
      totalUsdc: plan.totalUsdcToSwap,
    });

    const results: SwapExecutionResult[] = [];

    // Execute sequentially to avoid nonce issues
    for (const quote of swappable) {
      const result = await this.executeSwap(quote, slippage);
      results.push(result);

      // Small delay between swaps for state propagation
      if (result.success) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Also include non-swappable (hedged via perps) in results
    for (const s of plan.swaps) {
      if (!s.canSwapOnChain) {
        results.push({
          asset: s.asset,
          success: true, // Hedged via perps, not a failure
          amountIn: s.amountIn,
          amountOut: s.expectedAmountOut || '0',
          error: `Hedged via ${s.hedgeVia || 'BlueFin perps'} (no on-chain swap)`,
        });
      }
    }

    const totalExecuted = results.filter(r => r.success).length;
    const totalFailed = results.filter(r => !r.success).length;

    logger.info('[CetusAggregator] Rebalance complete', {
      totalExecuted,
      totalFailed,
      digests: results.filter(r => r.txDigest).map(r => `${r.asset}:${r.txDigest}`),
    });

    return {
      success: totalFailed === 0,
      results,
      totalExecuted,
      totalFailed,
    };
  }

  /**
   * Get a reverse swap quote: target asset → USDC.
   * Used for withdrawals (converting assets back to USDC).
   * On testnet: uses mainnet Cetus for price discovery.
   */
  async getReverseSwapQuote(
    asset: PoolAsset,
    assetAmount: number,
  ): Promise<SwapQuoteResult> {
    const coinKey = ASSET_TO_COIN_KEY[asset];
    const fromCoinType = this.coinTypes[coinKey] || '';
    const toCoinType = this.coinTypes.USDC;
    const decimals = ASSET_DECIMALS[coinKey] || 8;
    const amountInStr = Math.floor(assetAmount * Math.pow(10, decimals)).toString();

    // Testnet: use mainnet price discovery for reverse quotes too
    if (this.network === 'testnet') {
      const mainnetFrom = MAINNET_COIN_TYPES[coinKey] || '';
      const mainnetTo = MAINNET_COIN_TYPES.USDC;

      if (mainnetFrom) {
        try {
          const amountInRaw = new BN(amountInStr);
          const routerData = await this.priceClient.findRouters({
            from: mainnetFrom,
            target: mainnetTo,
            amount: amountInRaw,
            byAmountIn: true,
          });

          if (routerData && routerData.amountOut.toString() !== '0') {
            const paths = routerData.paths || [];
            const routeDesc = paths.length > 0
              ? paths.map((p: { provider: string }) => p.provider).join(' → ')
              : 'Cetus';
            return {
              asset,
              fromCoinType: fromCoinType || mainnetFrom,
              toCoinType: toCoinType || mainnetTo,
              amountIn: amountInStr,
              expectedAmountOut: routerData.amountOut.toString(),
              priceImpact: Math.abs(routerData.deviationRatio || 0),
              route: `${asset} → USDC via Cetus DEX (${routeDesc}) → close BlueFin hedge`,
              routerData: null, // Don't pass mainnet routerData for testnet execution
              canSwapOnChain: false,
              isSimulated: false,
              hedgeVia: 'bluefin',
            };
          }
        } catch (err) {
          logger.debug(`[CetusAggregator] Mainnet reverse price query failed for ${asset}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Fallback: estimate from market price using the actual asset
      try {
        const { getMarketDataService } = await import('@/lib/services/RealMarketDataService');
        const mds = getMarketDataService();
        const data = await mds.getTokenPrice(asset);
        if (data.price > 0) {
          const usdcOut = assetAmount * data.price;
          const usdcOutRaw = Math.floor(usdcOut * 1e6).toString();
          return {
            asset,
            fromCoinType: fromCoinType || '',
            toCoinType: toCoinType || '',
            amountIn: amountInStr,
            expectedAmountOut: usdcOutRaw,
            priceImpact: 0,
            route: `${asset} → USDC via market-price ($${data.price.toFixed(2)}) → close BlueFin hedge`,
            routerData: null,
            canSwapOnChain: false,
            isSimulated: false,
            hedgeVia: 'bluefin',
          };
        }
      } catch { /* continue to fallback */ }

      return {
        asset,
        fromCoinType: fromCoinType || '',
        toCoinType,
        amountIn: amountInStr,
        expectedAmountOut: '0',
        priceImpact: 0,
        route: `${asset} → USDC (close BlueFin perps position)`,
        routerData: null,
        canSwapOnChain: false,
      };
    }

    // Mainnet: CRO and assets without coin types use BlueFin perps hedging
    if (!fromCoinType || asset === 'CRO') {
      // Get market price for accurate expectedAmountOut
      try {
        const { getMarketDataService } = await import('@/lib/services/RealMarketDataService');
        const mds = getMarketDataService();
        const data = await mds.getTokenPrice(asset);
        if (data.price > 0) {
          const usdcOut = assetAmount * data.price;
          return {
            asset,
            fromCoinType: fromCoinType || '',
            toCoinType,
            amountIn: amountInStr,
            expectedAmountOut: Math.floor(usdcOut * 1e6).toString(),
            priceImpact: 0,
            route: `${asset} → USDC (close BlueFin perps position)`,
            routerData: null,
            canSwapOnChain: false,
            hedgeVia: 'bluefin',
          };
        }
      } catch { /* fall through */ }

      return {
        asset,
        fromCoinType: fromCoinType || '',
        toCoinType,
        amountIn: amountInStr,
        expectedAmountOut: '0',
        priceImpact: 0,
        route: `${asset} → USDC (close BlueFin perps position)`,
        routerData: null,
        canSwapOnChain: false,
        hedgeVia: 'bluefin',
      };
    }

    const amountInRaw = new BN(amountInStr);

    try {
      const routerData = await this.client.findRouters({
        from: fromCoinType,
        target: toCoinType,
        amount: amountInRaw,
        byAmountIn: true,
      });

      if (!routerData) {
        return {
          asset, fromCoinType, toCoinType,
          amountIn: amountInRaw.toString(),
          expectedAmountOut: '0', priceImpact: 0,
          route: `No route found for ${asset} → USDC`,
          routerData: null, canSwapOnChain: false,
        };
      }

      const paths = routerData.paths || [];
      const routeDesc = paths.length > 0
        ? paths.map((p: any) => p.provider).join(' → ')
        : 'direct';

      return {
        asset, fromCoinType, toCoinType,
        amountIn: amountInRaw.toString(),
        expectedAmountOut: routerData.amountOut.toString(),
        priceImpact: Math.abs(routerData.deviationRatio || 0),
        route: `${asset} → USDC via ${routeDesc}`,
        routerData, canSwapOnChain: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[CetusAggregator] Reverse quote failed for ${asset} → USDC`, { error: message });
      return {
        asset, fromCoinType, toCoinType,
        amountIn: amountInRaw.toString(),
        expectedAmountOut: '0', priceImpact: 0,
        route: `Reverse quote failed: ${message}`,
        routerData: null, canSwapOnChain: false,
      };
    }
  }

  /**
   * Check if the admin wallet is configured and has sufficient SUI for gas.
   */
  async checkAdminWallet(): Promise<{
    configured: boolean;
    address?: string;
    suiBalance?: string;
    hasGas: boolean;
  }> {
    const adminKey = process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY;
    if (!adminKey) {
      return { configured: false, hasGas: false };
    }

    try {
      const { Ed25519Keypair, SuiClient, getFullnodeUrl } = await getSuiSdk();

      const keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(
            Buffer.from(adminKey.replace(/^0x/, ''), 'hex')
          );
      const address = keypair.getPublicKey().toSuiAddress();

      const rpcUrl = this.network === 'mainnet'
        ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
        : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
      const suiClient = new SuiClient({ url: rpcUrl });

      const balance = await suiClient.getBalance({ owner: address });
      const suiBalance = (Number(balance.totalBalance) / 1e9).toFixed(4);
      const hasGas = Number(balance.totalBalance) > 10_000_000; // > 0.01 SUI

      return { configured: true, address, suiBalance, hasGas };
    } catch (err) {
      logger.error('[CetusAggregator] Admin wallet check failed', { error: err });
      return { configured: true, hasGas: false };
    }
  }

  // ============================================
  // UTILITY
  // ============================================

  /** Get the USDC coin type for the current network */
  getUsdcCoinType(): string {
    return this.coinTypes.USDC;
  }

  /** Get the on-chain coin type for a pool asset */
  getAssetCoinType(asset: PoolAsset): string {
    const key = ASSET_TO_COIN_KEY[asset];
    return this.coinTypes[key] || '';
  }

  /** Check if an asset can be swapped on-chain (vs. hedged via perps) */
  canSwapOnChain(asset: PoolAsset): boolean {
    if (asset === 'CRO') return false; // No CRO liquidity on SUI
    const type = this.getAssetCoinType(asset);
    return !!type;
  }

  /** Get the underlying AggregatorClient */
  getClient(): AggregatorClient {
    return this.client;
  }

  /** Get current network */
  getNetwork(): NetworkType {
    return this.network;
  }
}

// ============================================
// SINGLETON
// ============================================

let mainnetInstance: CetusAggregatorService | null = null;
let testnetInstance: CetusAggregatorService | null = null;

export function getCetusAggregatorService(
  network: NetworkType = 'mainnet'
): CetusAggregatorService {
  if (network === 'mainnet') {
    if (!mainnetInstance) {
      mainnetInstance = new CetusAggregatorService('mainnet');
    }
    return mainnetInstance;
  }

  if (!testnetInstance) {
    testnetInstance = new CetusAggregatorService('testnet');
  }
  return testnetInstance;
}
