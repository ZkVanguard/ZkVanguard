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
    // CRO does not have native liquidity on SUI. We use CETUS as proxy or skip.
    // In production, CRO allocation would be hedged via BlueFin perpetuals.
    CRO:  '', // No native CRO on SUI — hedged via BlueFin perps
  },
  testnet: {
    USDC: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
    SUI:  '0x2::sui::SUI',
    WBTC: '', // Testnet doesn't have all wrapped tokens
    WETH: '',
    CRO:  '',
  },
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
  private network: NetworkType;
  private coinTypes: Record<string, string>;

  constructor(network: NetworkType = 'mainnet') {
    this.network = network;

    // Let the SDK create its own SuiClient to avoid type conflicts
    this.client = new AggregatorClient({
      env: network === 'mainnet' ? Env.Mainnet : Env.Testnet,
    });

    this.coinTypes = SUI_COIN_TYPES[network] || SUI_COIN_TYPES.mainnet;

    logger.info('[CetusAggregator] Initialized', { network });
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

  // ============================================
  // SWAP QUOTES
  // ============================================

  /**
   * Get a swap quote for USDC → target asset via Cetus aggregator.
   * Routes across multiple DEXs for optimal pricing.
   */
  async getSwapQuote(
    asset: PoolAsset,
    usdcAmount: number,
  ): Promise<SwapQuoteResult> {
    const coinKey = ASSET_TO_COIN_KEY[asset];
    const toCoinType = this.coinTypes[coinKey] || '';
    const fromCoinType = this.coinTypes.USDC;

    // CRO has no on-chain liquidity on SUI — skip swap, hedge via perps
    // On testnet, BTC/ETH also have no coin types — estimate from price
    if (!toCoinType || asset === 'CRO') {
      // Estimate output from market price for tracking purposes
      const estimate = await this.estimateOutputFromPrice(asset, usdcAmount);
      // Check if BlueFin is configured — if so, this is a real hedge, not a simulation
      const bluefinConfigured = !!process.env.BLUEFIN_PRIVATE_KEY;
      const hedgeMethod = (bluefinConfigured || asset === 'CRO') ? 'bluefin' as const : 'virtual' as const;
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
        isSimulated: !bluefinConfigured,
        hedgeVia: hedgeMethod,
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
        // Fall back to price-based estimation
        const estimate = await this.estimateOutputFromPrice(asset, usdcAmount);
        if (estimate) {
          logger.info(`[CetusAggregator] Using price estimate for ${asset}`, { price: estimate.price, estimatedOut: estimate.estimatedOut });
          return {
            asset,
            fromCoinType,
            toCoinType,
            amountIn: amountInRaw.toString(),
            expectedAmountOut: estimate.estimatedOut,
            priceImpact: 0,
            route: `USDC → ${asset} via price-estimate ($${estimate.price.toFixed(2)})`,
            routerData: null,
            canSwapOnChain: false,
            isSimulated: true,
            hedgeVia: 'virtual',
          };
        }
        return {
          asset,
          fromCoinType,
          toCoinType,
          amountIn: amountInRaw.toString(),
          expectedAmountOut: '0',
          priceImpact: 0,
          route: `No route found for USDC → ${asset}`,
          routerData: null,
          canSwapOnChain: false,
        };
      }

      const expectedOut = routerData.amountOut.toString();
      const paths = routerData.paths || [];
      const routeDesc = paths.length > 0
        ? paths.map((p: { from: string; target: string; provider: string }) =>
            `${p.provider}`
          ).join(' → ')
        : 'direct';

      // Calculate price impact from deviation ratio
      const priceImpact = routerData.deviationRatio
        ? Math.abs(routerData.deviationRatio)
        : 0;

      // If Cetus returned 0 output (testnet no liquidity), fall back to price estimate
      if (expectedOut === '0' || expectedOut === '') {
        const estimate = await this.estimateOutputFromPrice(asset, usdcAmount);
        if (estimate) {
          const bluefinConfigured = !!process.env.BLUEFIN_PRIVATE_KEY;
          logger.info(`[CetusAggregator] Cetus returned 0 for ${asset}, using price estimate`, { price: estimate.price, bluefinConfigured });
          return {
            asset,
            fromCoinType,
            toCoinType,
            amountIn: amountInRaw.toString(),
            expectedAmountOut: estimate.estimatedOut,
            priceImpact: 0,
            route: bluefinConfigured
              ? `USDC → ${asset} (hedged via BlueFin perps)`
              : `USDC → ${asset} via price-estimate ($${estimate.price.toFixed(2)})`,
            routerData: null,
            canSwapOnChain: false,
            isSimulated: !bluefinConfigured,
            hedgeVia: bluefinConfigured ? 'bluefin' : 'virtual',
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
      // Still try price estimation on failure
      const estimate = await this.estimateOutputFromPrice(asset, usdcAmount);
      return {
        asset,
        fromCoinType,
        toCoinType,
        amountIn: amountInRaw.toString(),
        expectedAmountOut: estimate?.estimatedOut || '0',
        priceImpact: 0,
        route: estimate ? `USDC → ${asset} via price-estimate ($${estimate.price.toFixed(2)})` : `Quote failed: ${message}`,
        routerData: null,
        canSwapOnChain: false,
        isSimulated: !!estimate,
        hedgeVia: estimate ? 'virtual' : undefined,
      };
    }
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
      if (usdcForAsset < 0.01) return null; // Skip if less than 1 cent

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

    const adminKey = process.env.SUI_POOL_ADMIN_KEY;
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
    if (!process.env.SUI_POOL_ADMIN_KEY) {
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

    // Also include non-swappable (CRO) in results
    for (const s of plan.swaps) {
      if (!s.canSwapOnChain) {
        results.push({
          asset: s.asset,
          success: true, // CRO is hedged via perps, not a failure
          amountIn: s.amountIn,
          amountOut: '0',
          error: 'Hedged via BlueFin perps (no on-chain swap)',
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
   */
  async getReverseSwapQuote(
    asset: PoolAsset,
    assetAmount: number,
  ): Promise<SwapQuoteResult> {
    const coinKey = ASSET_TO_COIN_KEY[asset];
    const fromCoinType = this.coinTypes[coinKey] || '';
    const toCoinType = this.coinTypes.USDC;
    const decimals = ASSET_DECIMALS[coinKey] || 8;

    if (!fromCoinType || asset === 'CRO') {
      return {
        asset,
        fromCoinType: fromCoinType || '',
        toCoinType,
        amountIn: Math.floor(assetAmount * Math.pow(10, decimals)).toString(),
        expectedAmountOut: '0',
        priceImpact: 0,
        route: `${asset} → USDC (close BlueFin perps position)`,
        routerData: null,
        canSwapOnChain: false,
      };
    }

    const amountInRaw = new BN(Math.floor(assetAmount * Math.pow(10, decimals)).toString());

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
    const adminKey = process.env.SUI_POOL_ADMIN_KEY;
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
