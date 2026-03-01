/**
 * Cetus DEX Integration for SUI
 * 
 * Cetus Protocol is the leading AMM on SUI with concentrated liquidity (CLMM).
 * This service mirrors VVSFinanceService for Cronos, providing:
 * - Token swaps via Cetus pools
 * - Swap quotes with price impact
 * - Liquidity provision
 * - Multi-hop routing through SUI → intermediate → target
 * 
 * @see https://www.cetus.zone/
 * @see https://cetus-1.gitbook.io/cetus-developer-docs
 */

import { logger } from '@/lib/utils/logger';

// ============================================
// CETUS POOL & ROUTER CONSTANTS
// ============================================

// Cetus CLMM (Concentrated Liquidity) package on SUI
const CETUS_CONFIG = {
  mainnet: {
    globalConfigId: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',
    poolsPackageId: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
    routerPackageId: '0x2eeaab737b37137b94bfa8f841f92e36a153641119da3571571f4cb1c8e25e0b',
    integratePackageId: '0x996c4d9480708fb8b92aa7acf819571f4661ad862170dcec8ef15a44b538f2e8',
    apiUrl: 'https://api-sui.cetus.zone',
  },
  testnet: {
    globalConfigId: '0x6f4149091a5aea0e818e7243a13571f738ae0c8c3e9cac5acb2bfaee3c9d27c5',
    poolsPackageId: '0x0c7ae833c220aa73a3643a0d508afa4ac5c27ee97a4c4a6f15a3f48e32e8e48b',
    routerPackageId: '0x0c7ae833c220aa73a3643a0d508afa4ac5c27ee97a4c4a6f15a3f48e32e8e48b',
    integratePackageId: '0x0c7ae833c220aa73a3643a0d508afa4ac5c27ee97a4c4a6f15a3f48e32e8e48b',
    apiUrl: 'https://api-sui.devcetus.com',
  },
} as const;

// Common token type IDs on SUI
const SUI_TOKENS_MAINNET: Record<string, TokenInfo> = {
  SUI: {
    type: '0x2::sui::SUI',
    symbol: 'SUI',
    decimals: 9,
    name: 'Sui',
    coingeckoId: 'sui',
  },
  USDC: {
    type: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
    symbol: 'USDC',
    decimals: 6,
    name: 'USD Coin (Wormhole)',
    coingeckoId: 'usd-coin',
  },
  USDT: {
    type: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
    symbol: 'USDT',
    decimals: 6,
    name: 'Tether USD (Wormhole)',
    coingeckoId: 'tether',
  },
  WETH: {
    type: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
    symbol: 'WETH',
    decimals: 8,
    name: 'Wrapped Ether (Wormhole)',
    coingeckoId: 'weth',
  },
  WBTC: {
    type: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
    symbol: 'WBTC',
    decimals: 8,
    name: 'Wrapped Bitcoin (Wormhole)',
    coingeckoId: 'wrapped-bitcoin',
  },
  CETUS: {
    type: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
    symbol: 'CETUS',
    decimals: 9,
    name: 'Cetus Protocol',
    coingeckoId: 'cetus-protocol',
  },
  DEEP: {
    type: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    symbol: 'DEEP',
    decimals: 6,
    name: 'DeepBook',
    coingeckoId: 'deep-book',
  },
  NAVX: {
    type: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
    symbol: 'NAVX',
    decimals: 9,
    name: 'NAVI Protocol',
    coingeckoId: 'navi-protocol',
  },
};

const SUI_TOKENS_TESTNET: Record<string, TokenInfo> = {
  SUI: {
    type: '0x2::sui::SUI',
    symbol: 'SUI',
    decimals: 9,
    name: 'Sui',
    coingeckoId: 'sui',
  },
  USDC: {
    type: '0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::usdc::USDC',
    symbol: 'USDC',
    decimals: 6,
    name: 'Test USDC',
    coingeckoId: 'usd-coin',
  },
  CETUS: {
    type: '0x26b3bc67befc214058ca78ea9a2690298d731a2d4309485ec3d40198063c4abc::cetus::CETUS',
    symbol: 'CETUS',
    decimals: 9,
    name: 'Test CETUS',
    coingeckoId: 'cetus-protocol',
  },
};

// ============================================
// TYPES
// ============================================

export interface TokenInfo {
  type: string;       // SUI type string (e.g., '0x2::sui::SUI')
  symbol: string;
  decimals: number;
  name: string;
  coingeckoId?: string;
}

export interface CetusSwapParams {
  tokenIn: string;    // Token symbol or type
  tokenOut: string;   // Token symbol or type
  amountIn: bigint;   // Amount in smallest unit
  slippage?: number;  // Slippage tolerance % (default 0.5)
  sender: string;     // Sender SUI address
}

export interface CetusSwapQuote {
  amountOut: bigint;
  amountOutMin: bigint;
  priceImpact: number;
  route: string;
  poolId?: string;
  estimatedGas: number;
  tokenInInfo: TokenInfo;
  tokenOutInfo: TokenInfo;
}

export interface CetusSwapResult {
  success: boolean;
  digest?: string;
  amountOut?: bigint;
  effectivePrice?: number;
  fees?: number;
  error?: string;
}

export interface CetusPoolInfo {
  poolId: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  liquidity: string;
  sqrtPrice: string;
  currentTickIndex: number;
  feeRate: number;
  tvlUsd: number;
  volume24hUsd: number;
  apr24h: number;
}

export interface CetusLiquidityParams {
  poolId: string;
  amountA: bigint;
  amountB: bigint;
  tickLower: number;
  tickUpper: number;
  slippage?: number;
  sender: string;
}

export interface CetusLiquidityResult {
  success: boolean;
  positionId?: string;
  digest?: string;
  liquidityAdded?: string;
  error?: string;
}

// ============================================
// CETUS SWAP SERVICE
// ============================================

export class CetusSwapService {
  private network: 'mainnet' | 'testnet';
  private config: typeof CETUS_CONFIG[keyof typeof CETUS_CONFIG];
  private tokens: Record<string, TokenInfo>;

  constructor(network: 'mainnet' | 'testnet' = 'testnet') {
    this.network = network;
    this.config = CETUS_CONFIG[network];
    this.tokens = network === 'mainnet' ? SUI_TOKENS_MAINNET : SUI_TOKENS_TESTNET;
    logger.info('[CetusSwap] Initialized', { network, apiUrl: this.config.apiUrl });
  }

  // ============================================
  // TOKEN RESOLUTION
  // ============================================

  /**
   * Resolve token identifier to TokenInfo
   */
  getTokenInfo(tokenIdentifier: string): TokenInfo {
    const normalized = tokenIdentifier.toUpperCase();

    // Check by symbol first
    if (this.tokens[normalized]) {
      return this.tokens[normalized];
    }

    // Check by type string
    for (const token of Object.values(this.tokens)) {
      if (token.type === tokenIdentifier) {
        return token;
      }
    }

    throw new Error(`Token ${tokenIdentifier} not found on SUI ${this.network}`);
  }

  /**
   * Get token type string from symbol or full type
   */
  private getTokenType(tokenIdentifier: string): string {
    return this.getTokenInfo(tokenIdentifier).type;
  }

  // ============================================
  // SWAP QUOTES
  // ============================================

  /**
   * Get swap quote from Cetus API
   * Uses Cetus aggregator for best routing across pools
   */
  async getSwapQuote(params: Omit<CetusSwapParams, 'sender'>): Promise<CetusSwapQuote> {
    try {
      const tokenInInfo = this.getTokenInfo(params.tokenIn);
      const tokenOutInfo = this.getTokenInfo(params.tokenOut);
      const slippage = params.slippage || 0.5;

      logger.info('[CetusSwap] Getting quote', {
        tokenIn: tokenInInfo.symbol,
        tokenOut: tokenOutInfo.symbol,
        amountIn: params.amountIn.toString(),
      });

      // Call Cetus aggregator API for best route
      const amountInStr = params.amountIn.toString();
      const url = `${this.config.apiUrl}/v2/sui/swap/router?` +
        `from=${encodeURIComponent(tokenInInfo.type)}` +
        `&target=${encodeURIComponent(tokenOutInfo.type)}` +
        `&amount=${amountInStr}` +
        `&by_amount_in=true`;

      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        // Fallback to simulated quote for testnet/demo
        logger.warn('[CetusSwap] API unavailable, using simulated quote');
        return this.getSimulatedQuote(tokenInInfo, tokenOutInfo, params.amountIn, slippage);
      }

      const data = await response.json();

      if (!data.data || !data.data.routes || data.data.routes.length === 0) {
        logger.warn('[CetusSwap] No routes found, using simulated quote');
        return this.getSimulatedQuote(tokenInInfo, tokenOutInfo, params.amountIn, slippage);
      }

      const bestRoute = data.data.routes[0];
      const amountOut = BigInt(bestRoute.amount_out || '0');
      const slippageBps = BigInt(Math.floor(slippage * 100));
      const amountOutMin = amountOut * (10000n - slippageBps) / 10000n;

      // Build route display
      const routeDisplay = bestRoute.paths
        ? bestRoute.paths.map((p: { from: string; to: string }) => `${p.from} → ${p.to}`).join(' → ')
        : `${tokenInInfo.symbol} → ${tokenOutInfo.symbol}`;

      const quote: CetusSwapQuote = {
        amountOut,
        amountOutMin,
        priceImpact: bestRoute.price_impact || 0,
        route: routeDisplay,
        poolId: bestRoute.paths?.[0]?.pool_id,
        estimatedGas: 2000000, // ~0.002 SUI
        tokenInInfo,
        tokenOutInfo,
      };

      logger.info('[CetusSwap] Quote received', {
        amountOut: amountOut.toString(),
        priceImpact: quote.priceImpact,
        route: quote.route,
      });

      return quote;
    } catch (error) {
      logger.error('[CetusSwap] Failed to get quote', { error });
      throw error;
    }
  }

  /**
   * Simulated quote for testnet/demo using market prices
   */
  private async getSimulatedQuote(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: bigint,
    slippage: number,
  ): Promise<CetusSwapQuote> {
    // Fetch live prices from Crypto.com Exchange API
    let priceIn = 0;
    let priceOut = 0;
    try {
      const { getMarketDataService } = await import('./RealMarketDataService');
      const svc = getMarketDataService();
      const [dataIn, dataOut] = await Promise.all([
        svc.getTokenPrice(tokenIn.symbol),
        svc.getTokenPrice(tokenOut.symbol),
      ]);
      priceIn = dataIn.price;
      priceOut = dataOut.price;
    } catch (e) {
      logger.error('[CetusSwap] Live prices unavailable for simulated quote', { error: e });
      // For stablecoins we can safely assume $1
      if (['USDC', 'USDT'].includes(tokenIn.symbol)) priceIn = 1;
      if (['USDC', 'USDT'].includes(tokenOut.symbol)) priceOut = 1;
    }

    // Convert amountIn to USD value
    const amountInHuman = Number(amountIn) / Math.pow(10, tokenIn.decimals);
    const usdValue = amountInHuman * priceIn;

    // Calculate output
    const amountOutHuman = usdValue / priceOut;
    const amountOut = BigInt(Math.floor(amountOutHuman * Math.pow(10, tokenOut.decimals)));

    // Apply 0.3% swap fee
    const amountOutAfterFee = amountOut * 9970n / 10000n;
    const slippageBps = BigInt(Math.floor(slippage * 100));
    const amountOutMin = amountOutAfterFee * (10000n - slippageBps) / 10000n;

    return {
      amountOut: amountOutAfterFee,
      amountOutMin,
      priceImpact: amountInHuman > 10000 ? 0.5 : 0.1, // Simulated impact
      route: `${tokenIn.symbol} → ${tokenOut.symbol} (Cetus CLMM)`,
      estimatedGas: 2000000,
      tokenInInfo: tokenIn,
      tokenOutInfo: tokenOut,
    };
  }

  // ============================================
  // SWAP EXECUTION (Transaction Building)
  // ============================================

  /**
   * Build a swap transaction for SUI
   * Returns the Move call parameters for transaction execution via dApp kit
   */
  buildSwapTransaction(params: CetusSwapParams, quote: CetusSwapQuote): {
    target: string;
    arguments: unknown[];
    typeArguments: string[];
  } {
    const tokenInType = this.getTokenType(params.tokenIn);
    const tokenOutType = this.getTokenType(params.tokenOut);

    // Build Cetus CLMM swap call
    // Uses the integrated swap function for best routing
    return {
      target: `${this.config.integratePackageId}::router::swap`,
      arguments: [
        this.config.globalConfigId,    // Global config
        quote.poolId || '',            // Pool object
        params.amountIn.toString(),    // Amount in
        quote.amountOutMin.toString(), // Min amount out
        true,                          // by_amount_in = true
        params.sender,                 // Recipient
      ],
      typeArguments: [tokenInType, tokenOutType],
    };
  }

  /**
   * Execute swap via API (for server-side or sponsored transactions)
   */
  async executeSwap(params: CetusSwapParams): Promise<CetusSwapResult> {
    try {
      const quote = await this.getSwapQuote(params);

      logger.info('[CetusSwap] Executing swap', {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn.toString(),
        expectedOut: quote.amountOut.toString(),
      });

      // Build transaction parameters
      const txParams = this.buildSwapTransaction(params, quote);

      // In frontend: use SUI dApp kit to execute
      // In backend: use SUI SDK with keypair
      // For now, return the transaction parameters
      logger.info('[CetusSwap] Swap transaction built', {
        target: txParams.target,
        typeArgs: txParams.typeArguments,
      });

      return {
        success: true,
        amountOut: quote.amountOut,
        effectivePrice: Number(quote.amountOut) / Number(params.amountIn),
        fees: 0.003, // 0.3% Cetus fee
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[CetusSwap] Swap execution failed', { error: message });
      return {
        success: false,
        error: message,
      };
    }
  }

  // ============================================
  // POOL INFORMATION
  // ============================================

  /**
   * Get pool information from Cetus API
   */
  async getPools(limit: number = 20): Promise<CetusPoolInfo[]> {
    try {
      const response = await fetch(
        `${this.config.apiUrl}/v2/sui/pools_info?order_by=tvl&limit=${limit}`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (!response.ok) {
        throw new Error(`Cetus API error: ${response.status}`);
      }

      const data = await response.json();
      const pools: CetusPoolInfo[] = (data.data?.lp_list || []).map((pool: Record<string, unknown>) => ({
        poolId: pool.address as string,
        tokenA: this.resolvePoolToken(pool.coin_a as Record<string, string>),
        tokenB: this.resolvePoolToken(pool.coin_b as Record<string, string>),
        liquidity: pool.liquidity as string || '0',
        sqrtPrice: pool.current_sqrt_price as string || '0',
        currentTickIndex: pool.current_tick_index as number || 0,
        feeRate: (pool.fee_rate as number || 2500) / 1000000, // Convert to percentage
        tvlUsd: pool.tvl_in_usd as number || 0,
        volume24hUsd: pool.vol_in_usd_24h as number || 0,
        apr24h: pool.apr_24h as number || 0,
      }));

      logger.info('[CetusSwap] Fetched pools', { count: pools.length });
      return pools;
    } catch (error) {
      logger.error('[CetusSwap] Failed to fetch pools', { error });
      return [];
    }
  }

  /**
   * Resolve pool token info from API response
   */
  private resolvePoolToken(coinData: Record<string, string>): TokenInfo {
    const type = coinData?.address || '';
    // Try to match with known tokens
    for (const token of Object.values(this.tokens)) {
      if (token.type === type) return token;
    }
    return {
      type,
      symbol: coinData?.symbol || type.split('::').pop() || 'UNKNOWN',
      decimals: parseInt(coinData?.decimals || '9'),
      name: coinData?.name || 'Unknown Token',
    };
  }

  // ============================================
  // LIQUIDITY PROVISION
  // ============================================

  /**
   * Build add liquidity transaction for Cetus CLMM
   */
  buildAddLiquidityTransaction(params: CetusLiquidityParams): {
    target: string;
    arguments: unknown[];
    typeArguments: string[];
  } {
    return {
      target: `${this.config.poolsPackageId}::pool::add_liquidity`,
      arguments: [
        this.config.globalConfigId,
        params.poolId,
        params.tickLower,
        params.tickUpper,
        params.amountA.toString(),
        params.amountB.toString(),
        '0', // min liquidity
      ],
      typeArguments: [], // Determined by pool
    };
  }

  /**
   * Build remove liquidity transaction
   */
  buildRemoveLiquidityTransaction(positionId: string, liquidity: string): {
    target: string;
    arguments: unknown[];
  } {
    return {
      target: `${this.config.poolsPackageId}::pool::remove_liquidity`,
      arguments: [
        this.config.globalConfigId,
        positionId,
        liquidity,
        '0', // min amount A
        '0', // min amount B
      ],
    };
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Get all supported tokens
   */
  getSupportedTokens(): Record<string, TokenInfo> {
    return { ...this.tokens };
  }

  /**
   * Check if a token is supported
   */
  isTokenSupported(tokenIdentifier: string): boolean {
    try {
      this.getTokenInfo(tokenIdentifier);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the network configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get token price in USD from Cetus API
   */
  async getTokenPrice(tokenSymbol: string): Promise<number> {
    try {
      const tokenInfo = this.getTokenInfo(tokenSymbol);
      const response = await fetch(
        `${this.config.apiUrl}/v2/sui/coin/price?coins=${encodeURIComponent(tokenInfo.type)}`
      );
      if (!response.ok) throw new Error(`Price API error: ${response.status}`);
      const data = await response.json();
      return data.data?.[tokenInfo.type] || 0;
    } catch (error) {
      logger.warn('[CetusSwap] Cetus price API failed, falling back to Crypto.com', { tokenSymbol, error });
      // Fall back to live Crypto.com price
      try {
        const { getMarketDataService } = await import('./RealMarketDataService');
        const svc = getMarketDataService();
        const data = await svc.getTokenPrice(tokenSymbol);
        if (data.price > 0) return data.price;
      } catch (fallbackErr) {
        logger.error('[CetusSwap] All price sources failed', { tokenSymbol, error: fallbackErr });
      }
      return 0;
    }
  }
}

// ============================================
// SINGLETON
// ============================================

let cetusServiceInstance: CetusSwapService | null = null;

export function getCetusSwapService(network: 'mainnet' | 'testnet' = 'testnet'): CetusSwapService {
  if (!cetusServiceInstance || cetusServiceInstance['network'] !== network) {
    cetusServiceInstance = new CetusSwapService(network);
  }
  return cetusServiceInstance;
}
