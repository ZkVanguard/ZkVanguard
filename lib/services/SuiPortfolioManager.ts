/**
 * SUI Portfolio Manager
 * 
 * Manages multi-asset portfolios on SUI Network using the deployed
 * RWA Manager Move contract + BlueFin for hedge execution.
 * Mirrors OnChainPortfolioManager for Cronos.
 * 
 * Features:
 * - Read portfolio state from rwa_manager.move
 * - Track positions with live prices
 * - AI risk scoring + hedge recommendations
 * - Hedge execution via BlueFin perps
 * - Portfolio rebalancing transaction builders
 * 
 * @see lib/services/OnChainPortfolioManager.ts (Cronos equivalent)
 * @see contracts/sui/sources/rwa_manager.move
 */

import { logger } from '@/lib/utils/logger';
import { BluefinService, BLUEFIN_PAIRS } from './BluefinService';
import { getMarketDataService } from './RealMarketDataService';

// ============================================
// DEPLOYED CONTRACTS
// ============================================

const SUI_PORTFOLIO_DEPLOYMENTS = {
  testnet: {
    packageId: '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a',
    rwaManagerState: '0x65638c3c5a5af66c33bf06f57230f8d9972d3a5507138974dce11b1e46e85c97',
    hedgeExecutorState: '0xb6432f1ecc1f55a1f3f3c8c09d110c4bda9ed6536bd9ea4c9cb5e739c41cb41e',
    rpcUrl: 'https://fullnode.testnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/testnet',
  },
  mainnet: {
    packageId: '',
    rwaManagerState: '',
    hedgeExecutorState: '',
    rpcUrl: 'https://fullnode.mainnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/mainnet',
  },
} as const;

// ============================================
// TYPES
// ============================================

export interface SuiAllocationConfig {
  symbol: string;
  percentage: number;         // 0-100
}

export interface SuiPosition {
  symbol: string;
  allocation: number;         // Target % of portfolio
  amount: number;             // Token amount
  entryPrice: number;
  currentPrice: number;
  valueUsd: number;
  pnl: number;
  pnlPercent: number;
  hedgeId?: string;           // Active hedge on this position
}

export interface SuiPortfolioSummary {
  ownerAddress: string;
  totalValueSui: bigint;      // In MIST
  totalValueUsd: number;
  positions: SuiPosition[];
  allocations: SuiAllocationConfig[];
  riskMetrics: SuiRiskMetrics;
  contracts: Record<string, string>;
  isOnChain: boolean;
  lastUpdated: Date;
}

export interface SuiRiskMetrics {
  overallRiskScore: number;   // 1-10
  volatility: number;
  maxDrawdown: number;
  concentrationRisk: number;
  hedgeRatio: number;         // % of portfolio hedged
  recommendations: string[];
}

// ============================================
// DEFAULT ALLOCATION
// ============================================

const DEFAULT_SUI_ALLOCATIONS: SuiAllocationConfig[] = [
  { symbol: 'BTC', percentage: 30 },
  { symbol: 'ETH', percentage: 25 },
  { symbol: 'SUI', percentage: 25 },
  { symbol: 'SOL', percentage: 10 },
  { symbol: 'USDC', percentage: 10 },
];

// ============================================
// LIVE PRICE FETCHING (Crypto.com Exchange API)
// ============================================

/** Cached live prices — refreshed each sync cycle */
const _livePriceCache: Record<string, { price: number; ts: number }> = {};
const PRICE_CACHE_TTL = 15_000; // 15 s

/**
 * Fetch a real-time price via RealMarketDataService (Crypto.com Exchange).
 * Falls back to 0 if the symbol is genuinely unavailable — never uses
 * hardcoded constants.
 */
async function fetchLivePrice(symbol: string): Promise<number> {
  const cached = _livePriceCache[symbol];
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL) return cached.price;

  try {
    const svc = getMarketDataService();
    const data = await svc.getTokenPrice(symbol);
    if (data.price > 0) {
      _livePriceCache[symbol] = { price: data.price, ts: Date.now() };
      return data.price;
    }
  } catch (e) {
    logger.warn(`[SuiPortfolio] Live price fetch failed for ${symbol}`, { error: e });
  }
  // If we have a stale cached price, use it rather than 0
  return cached?.price || 0;
}

/** Batch-fetch live prices for an array of symbols */
async function fetchLivePrices(symbols: string[]): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  await Promise.all(symbols.map(async (s) => {
    results[s] = await fetchLivePrice(s);
  }));
  return results;
}

// ============================================
// SUI PORTFOLIO MANAGER
// ============================================

export class SuiPortfolioManager {
  private network: keyof typeof SUI_PORTFOLIO_DEPLOYMENTS;
  private config: (typeof SUI_PORTFOLIO_DEPLOYMENTS)[keyof typeof SUI_PORTFOLIO_DEPLOYMENTS];
  private allocations: SuiAllocationConfig[];
  private positions: Map<string, SuiPosition> = new Map();
  private ownerAddress: string = '';
  private initialized = false;
  private bluefin: BluefinService;

  constructor(
    network: keyof typeof SUI_PORTFOLIO_DEPLOYMENTS = 'testnet',
    allocations: SuiAllocationConfig[] = DEFAULT_SUI_ALLOCATIONS,
  ) {
    this.network = network;
    this.config = SUI_PORTFOLIO_DEPLOYMENTS[network];
    this.allocations = allocations;
    this.bluefin = BluefinService.getInstance();
    logger.info('[SuiPortfolio] Created', { network, allocations: allocations.map(a => a.symbol) });
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initialize the portfolio manager for a given SUI address
   */
  async initialize(ownerAddress: string): Promise<void> {
    if (this.initialized && this.ownerAddress === ownerAddress) return;

    this.ownerAddress = ownerAddress;
    logger.info('[SuiPortfolio] Initializing', { owner: ownerAddress.slice(0, 12) });

    // Fetch on-chain portfolio state
    await this.syncFromChain();

    // If no on-chain positions, create virtual allocation from SUI balance
    if (this.positions.size === 0) {
      await this.createVirtualPositions();
    }

    this.initialized = true;
    logger.info('[SuiPortfolio] Initialized', {
      positions: this.positions.size,
      totalUsd: this.getTotalValueUsd().toFixed(2),
    });
  }

  // ============================================
  // ON-CHAIN SYNC
  // ============================================

  /**
   * Sync portfolio state from SUI RPC (rwa_manager objects)
   */
  private async syncFromChain(): Promise<void> {
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getOwnedObjects',
          params: [
            this.ownerAddress,
            {
              filter: {
                StructType: `${this.config.packageId}::rwa_manager::Portfolio`,
              },
              options: { showContent: true },
            },
          ],
        }),
      });

      const data = await response.json();
      const objects = data.result?.data || [];

      for (const obj of objects) {
        const fields = (obj as { data?: { content?: { fields?: Record<string, unknown> } } })
          .data?.content?.fields;
        if (!fields) continue;

        // Parse allocations from on-chain data
        const allocations = fields.allocations;
        if (Array.isArray(allocations)) {
          // Collect symbols to batch-fetch live prices
          const symbols = allocations.map((a) => String((a as Record<string, unknown>).asset_type || 'SUI'));
          const prices = await fetchLivePrices(symbols);

          for (const alloc of allocations) {
            const a = alloc as Record<string, unknown>;
            const symbol = String(a.asset_type || 'SUI');
            const amount = Number(a.amount || '0') / 1e9;
            const price = prices[symbol] || 0;

            this.positions.set(symbol, {
              symbol,
              allocation: Number(a.percentage || 0),
              amount,
              entryPrice: price,
              currentPrice: price,
              valueUsd: amount * price,
              pnl: 0,
              pnlPercent: 0,
            });
          }
        }
      }
    } catch (e) {
      logger.error('[SuiPortfolio] Chain sync error', { error: e });
    }
  }

  /**
   * Create virtual positions from SUI balance + allocation targets
   */
  private async createVirtualPositions(): Promise<void> {
    try {
      // Fetch SUI balance
      const balResp = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getBalance',
          params: [this.ownerAddress, '0x2::sui::SUI'],
        }),
      });

      const balData = await balResp.json();
      const suiBalance = Number(BigInt(String(balData.result?.totalBalance || '0'))) / 1e9;

      // Fetch all required live prices in parallel
      const allSymbols = ['SUI', ...this.allocations.map(a => a.symbol)];
      const livePrices = await fetchLivePrices([...new Set(allSymbols)]);
      const suiPrice = livePrices['SUI'] || 0;
      const totalValueUsd = suiBalance * suiPrice;

      logger.info('[SuiPortfolio] SUI balance (live prices)', {
        sui: suiBalance.toFixed(4),
        usd: totalValueUsd.toFixed(2),
        suiPrice,
      });

      // Distribute across allocations
      for (const alloc of this.allocations) {
        const valueUsd = totalValueUsd * (alloc.percentage / 100);
        const price = livePrices[alloc.symbol] || 0;
        const amount = price > 0 ? valueUsd / price : 0;

        this.positions.set(alloc.symbol, {
          symbol: alloc.symbol,
          allocation: alloc.percentage,
          amount,
          entryPrice: price,
          currentPrice: price,
          valueUsd,
          pnl: 0,
          pnlPercent: 0,
        });
      }
    } catch (e) {
      logger.error('[SuiPortfolio] Virtual positions error', { error: e });
    }
  }

  // ============================================
  // PORTFOLIO QUERIES
  // ============================================

  /**
   * Get full portfolio summary
   */
  async getSummary(): Promise<SuiPortfolioSummary> {
    const positions = Array.from(this.positions.values());
    const totalUsd = this.getTotalValueUsd();

    return {
      ownerAddress: this.ownerAddress,
      totalValueSui: BigInt(Math.floor(totalUsd / ((_livePriceCache['SUI']?.price) || 1) * 1e9)),
      totalValueUsd: totalUsd,
      positions,
      allocations: this.allocations,
      riskMetrics: this.calculateRiskMetrics(),
      contracts: {
        packageId: this.config.packageId,
        rwaManagerState: this.config.rwaManagerState,
        hedgeExecutorState: this.config.hedgeExecutorState,
      },
      isOnChain: true,
      lastUpdated: new Date(),
    };
  }

  /**
   * Get total portfolio value in USD
   */
  getTotalValueUsd(): number {
    let total = 0;
    for (const pos of this.positions.values()) {
      total += pos.valueUsd;
    }
    return total;
  }

  /**
   * Get a single position
   */
  getPosition(symbol: string): SuiPosition | null {
    return this.positions.get(symbol) || null;
  }

  // ============================================
  // RISK METRICS
  // ============================================

  /**
   * Calculate portfolio risk metrics
   */
  private calculateRiskMetrics(): SuiRiskMetrics {
    const positions = Array.from(this.positions.values());
    const totalValue = this.getTotalValueUsd();

    // Concentration risk (max single position %)
    let maxPct = 0;
    for (const pos of positions) {
      const pct = totalValue > 0 ? (pos.valueUsd / totalValue) * 100 : 0;
      if (pct > maxPct) maxPct = pct;
    }

    // Hedge ratio
    const hedgedValue = positions
      .filter(p => p.hedgeId)
      .reduce((sum, p) => sum + p.valueUsd, 0);
    const hedgeRatio = totalValue > 0 ? (hedgedValue / totalValue) * 100 : 0;

    // Risk score
    let riskScore = 3;
    if (maxPct > 40) riskScore += 2;
    if (maxPct > 60) riskScore += 1;
    if (hedgeRatio < 10 && totalValue > 1000) riskScore += 2;
    riskScore = Math.min(riskScore, 10);

    // Recommendations
    const recommendations: string[] = [];
    if (maxPct > 40) {
      recommendations.push(`Top position is ${maxPct.toFixed(0)}% — consider diversifying`);
    }
    if (hedgeRatio < 10 && totalValue > 500) {
      recommendations.push('Low hedge ratio — consider protective shorts via BlueFin');
    }
    if (totalValue > 5000 && !positions.some(p => p.symbol === 'USDC' || p.symbol === 'USDT')) {
      recommendations.push('No stablecoin allocation — consider adding USDC');
    }

    return {
      overallRiskScore: riskScore,
      volatility: 0, // Would need historical data
      maxDrawdown: 0,
      concentrationRisk: maxPct,
      hedgeRatio,
      recommendations,
    };
  }

  // ============================================
  // PRICE UPDATES
  // ============================================

  /**
   * Update position prices from BlueFin or fallback
   */
  async updatePrices(): Promise<void> {
    for (const [symbol, pos] of this.positions) {
      try {
        const pair = BluefinService.assetToPair(symbol);
        if (pair) {
          const md = await this.bluefin.getMarketData(pair);
          if (md?.price) {
            const oldPrice = pos.currentPrice;
            pos.currentPrice = md.price;
            pos.valueUsd = pos.amount * md.price;
            pos.pnl = (md.price - pos.entryPrice) * pos.amount;
            pos.pnlPercent = pos.entryPrice > 0
              ? ((md.price - pos.entryPrice) / pos.entryPrice) * 100
              : 0;
            continue;
          }
        }
        // Use live price from Crypto.com
        const livePrice = await fetchLivePrice(symbol);
        if (livePrice > 0) {
          pos.currentPrice = livePrice;
          pos.valueUsd = pos.amount * livePrice;
          pos.pnl = (livePrice - pos.entryPrice) * pos.amount;
          pos.pnlPercent = pos.entryPrice > 0
            ? ((livePrice - pos.entryPrice) / pos.entryPrice) * 100
            : 0;
        }
      } catch {
        // Keep current price
      }
    }
  }

  // ============================================
  // TRANSACTION BUILDERS
  // ============================================

  /**
   * Build transaction to create a portfolio on-chain
   */
  buildCreatePortfolioTransaction(
    targetYield: number,
    riskTolerance: number,
    initialDeposit: bigint,
  ): {
    target: string;
    arguments: unknown[];
    coinAmount: bigint;
  } {
    return {
      target: `${this.config.packageId}::rwa_manager::create_portfolio`,
      arguments: [
        this.config.rwaManagerState,
        targetYield,
        riskTolerance,
        '0x6',
      ],
      coinAmount: initialDeposit,
    };
  }

  /**
   * Build transaction to deposit into portfolio
   */
  buildDepositTransaction(portfolioId: string, amount: bigint): {
    target: string;
    arguments: unknown[];
    coinAmount: bigint;
  } {
    return {
      target: `${this.config.packageId}::rwa_manager::deposit`,
      arguments: [
        this.config.rwaManagerState,
        portfolioId,
        '0x6',
      ],
      coinAmount: amount,
    };
  }

  /**
   * Build transaction to rebalance portfolio
   */
  buildRebalanceTransaction(
    portfolioId: string,
    newAllocations: number[],
    reasoning: string,
  ): {
    target: string;
    arguments: unknown[];
  } {
    return {
      target: `${this.config.packageId}::rwa_manager::rebalance`,
      arguments: [
        this.config.rwaManagerState,
        portfolioId,
        newAllocations,
        new TextEncoder().encode(reasoning),
        '0x6',
      ],
    };
  }

  // ============================================
  // HEDGE INTEGRATION (via BlueFin)
  // ============================================

  /**
   * Open a hedge for a specific position
   */
  async hedgePosition(
    symbol: string,
    side: 'LONG' | 'SHORT' = 'SHORT',
    hedgePercent: number = 50,
  ): Promise<{ success: boolean; hedgeId?: string; error?: string }> {
    const position = this.positions.get(symbol);
    if (!position) return { success: false, error: `No position for ${symbol}` };

    const pair = BluefinService.assetToPair(symbol);
    if (!pair) return { success: false, error: `${symbol} not available on BlueFin` };

    const pairConfig = Object.values(BLUEFIN_PAIRS).find(p => p.symbol === pair);
    if (!pairConfig) return { success: false, error: `Pair config not found: ${pair}` };

    const hedgeSize = position.amount * (hedgePercent / 100);

    try {
      const result = await this.bluefin.openHedge({
        symbol: pair,
        side,
        size: hedgeSize,
        leverage: 2,
      });

      if (result.success) {
        position.hedgeId = result.hedgeId;
        logger.info('[SuiPortfolio] Position hedged', {
          symbol,
          pair,
          hedgeId: result.hedgeId,
          size: hedgeSize,
        });
      }

      return { success: result.success, hedgeId: result.hedgeId, error: result.error };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[SuiPortfolio] Hedge error', { symbol, error: msg });
      return { success: false, error: msg };
    }
  }

  /**
   * Close hedge on a position
   */
  async closePositionHedge(symbol: string): Promise<{ success: boolean; error?: string }> {
    const position = this.positions.get(symbol);
    if (!position?.hedgeId) return { success: false, error: 'No active hedge' };

    const pair = BluefinService.assetToPair(symbol);
    if (!pair) return { success: false, error: `${symbol} not on BlueFin` };

    try {
      const result = await this.bluefin.closeHedge({ symbol: pair });
      if (result.success) {
        position.hedgeId = undefined;
      }
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Get deployment config for display
   */
  getDeploymentConfig() {
    return { ...this.config };
  }
}

// ============================================
// SINGLETON
// ============================================

let suiPortfolioInstance: SuiPortfolioManager | null = null;

export function getSuiPortfolioManager(
  network: keyof typeof SUI_PORTFOLIO_DEPLOYMENTS = 'testnet',
  allocations?: SuiAllocationConfig[],
): SuiPortfolioManager {
  if (!suiPortfolioInstance) {
    suiPortfolioInstance = new SuiPortfolioManager(network, allocations);
  }
  return suiPortfolioInstance;
}
