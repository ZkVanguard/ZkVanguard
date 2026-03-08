/**
 * Centralized Hedge Manager
 * 
 * Optimized auto-hedging orchestrator that:
 * 1. Fetches ALL market data ONCE per cycle (single API call)
 * 2. Gathers ALL portfolio contexts in PARALLEL (on-chain + DB reads)
 * 3. Assesses risk using PURE COMPUTATION (no redundant I/O)
 * 4. Batches hedge recommendations across all portfolios
 * 5. Executes hedges with pre-validated snapshot prices
 * 6. Updates ALL hedge PnLs in a single batch
 * 
 * This replaces the per-portfolio serial fetch pattern in AutoHedgingService
 * where the same BTC/ETH/CRO/SUI prices were fetched N times per cycle.
 */

import { logger } from '@/lib/utils/logger';
import { getActiveHedges, createHedge, type Hedge } from '@/lib/db/hedges';
import { query } from '@/lib/db/postgres';
import { getAgentOrchestrator } from './agent-orchestrator';
import { ethers } from 'ethers';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { getMarketDataService, type ExtendedMarketData } from './RealMarketDataService';
import { getUnifiedPriceProvider } from './unified-price-provider';
import { getAutoHedgeConfigs } from '@/lib/storage/auto-hedge-storage';
import { COMMUNITY_POOL_PORTFOLIO_ID, isCommunityPoolPortfolio } from '@/lib/constants';
// calculatePoolNAV intentionally NOT imported — using snapshot prices directly to avoid redundant fetch
import type { AutoHedgeConfig, RiskAssessment, HedgeRecommendation } from './AutoHedgingService';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Single snapshot of all market data — fetched ONCE per cycle */
export interface MarketSnapshot {
  prices: Map<string, AssetPrice>;
  timestamp: number;
  source: string;
  fetchDurationMs: number;
}

export interface AssetPrice {
  price: number;
  bid: number;
  ask: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

/** Portfolio context with all data needed for risk assessment */
export interface PortfolioContext {
  portfolioId: number;
  walletAddress: string;
  config: AutoHedgeConfig;
  positions: Position[];
  activeHedges: ActiveHedge[];
  allocations: Record<string, number>;
  totalValue: number;
  isCommunityPool: boolean;
  // Community pool specific
  poolStats?: {
    totalShares: number;
    onChainNAV: number;
    marketNAV: number;
    sharePrice: number;
    peakSharePrice: number;
  };
}

export interface Position {
  symbol: string;
  value: number;
  change24h: number;
  balance: number;
}

export interface ActiveHedge {
  asset: string;
  side: string;
  size: number;
  notionalValue: number;
}

/** Result of a centralized assessment cycle */
export interface CycleResult {
  timestamp: number;
  durationMs: number;
  snapshot: MarketSnapshot;
  portfoliosAssessed: number;
  assessments: Map<number, RiskAssessment>;
  hedgesExecuted: number;
  hedgesFailed: number;
  pnlUpdated: number;
  pnlErrors: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const CENTRAL_CONFIG = {
  // All tracked symbols — fetched in ONE batch call
  TRACKED_SYMBOLS: ['BTC', 'ETH', 'CRO', 'SUI'] as const,
  
  // Risk thresholds
  MAX_PORTFOLIO_DRAWDOWN_PERCENT: 3,
  MAX_ASSET_CONCENTRATION_PERCENT: 40,
  MIN_HEDGE_SIZE_USD: 50,
  
  // Hedge parameters
  DEFAULT_LEVERAGE: 3,
  DEFAULT_STOP_LOSS_PERCENT: 10,
  DEFAULT_TAKE_PROFIT_PERCENT: 20,
  
  // Execution
  MIN_CONFIDENCE_FOR_EXECUTION: 0.7,
  
  // Cronos Testnet
  RPC_URL: 'https://evm-t3.cronos.org',
  CHAIN_ID: 338,
  COMMUNITY_POOL_ADDRESS: '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B',
};

// ═══════════════════════════════════════════════════════════════════════════════
// CENTRALIZED HEDGE MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

export class CentralizedHedgeManager {
  private static instance: CentralizedHedgeManager | null = null;
  private lastCycleResult: CycleResult | null = null;
  private lastSnapshot: MarketSnapshot | null = null;

  static getInstance(): CentralizedHedgeManager {
    if (!CentralizedHedgeManager.instance) {
      CentralizedHedgeManager.instance = new CentralizedHedgeManager();
    }
    return CentralizedHedgeManager.instance;
  }

  // ─── STEP 1: SINGLE MARKET DATA FETCH ──────────────────────────────────────

  /**
   * Fetch ALL market data in ONE call. This replaces:
   * - RealMarketDataService.getTokenPrice() per asset per portfolio
   * - UnifiedPriceProvider.fetchPricesFromREST()
   * - CommunityPoolService.fetchLivePrices()
   * 
   * Single API call → single MarketSnapshot used everywhere
   */
  async fetchMarketSnapshot(extraSymbols?: string[]): Promise<MarketSnapshot> {
    const start = Date.now();
    const symbols = [...new Set([...CENTRAL_CONFIG.TRACKED_SYMBOLS, ...(extraSymbols || [])])];

    const prices = new Map<string, AssetPrice>();

    try {
      // ONE batch call via market data service (which hits crypto.com get-tickers)
      const marketDataService = getMarketDataService();
      const extendedPrices = await marketDataService.getExtendedPrices(symbols);

      for (const [symbol, data] of extendedPrices.entries()) {
        prices.set(symbol, {
          price: data.price,
          bid: data.price * 0.9999, // Approximate from mid-price
          ask: data.price * 1.0001,
          change24h: data.change24h,
          high24h: data.high24h,
          low24h: data.low24h,
          volume24h: data.volume24h,
        });
      }

      // Also try enriching with unified price provider for more precise bid/ask
      try {
        const priceProvider = getUnifiedPriceProvider();
        for (const symbol of symbols) {
          const livePrice = priceProvider.getPrice(symbol);
          if (livePrice && prices.has(symbol)) {
            const existing = prices.get(symbol)!;
            prices.set(symbol, {
              ...existing,
              bid: livePrice.bid || existing.bid,
              ask: livePrice.ask || existing.ask,
              price: livePrice.price || existing.price,
            });
          }
        }
      } catch {
        // Unified price provider may not be initialized — fine, use market data
      }
    } catch (error) {
      logger.error('[CentralHedge] Market snapshot failed', { error });
      // Fallback: try individual prices
      const marketDataService = getMarketDataService();
      for (const symbol of symbols) {
        try {
          const priceData = await marketDataService.getTokenPrice(symbol);
          prices.set(symbol, {
            price: priceData.price,
            bid: priceData.price * 0.9999,
            ask: priceData.price * 1.0001,
            change24h: priceData.change24h,
            high24h: 0,
            low24h: 0,
            volume24h: priceData.volume24h,
          });
        } catch { /* skip */ }
      }
    }

    const snapshot: MarketSnapshot = {
      prices,
      timestamp: Date.now(),
      source: 'centralized-batch',
      fetchDurationMs: Date.now() - start,
    };

    this.lastSnapshot = snapshot;
    
    logger.info('[CentralHedge] Market snapshot fetched', {
      symbols: symbols.length,
      resolved: prices.size,
      durationMs: snapshot.fetchDurationMs,
      prices: Object.fromEntries(
        [...prices.entries()].map(([s, p]) => [s, `$${p.price.toFixed(2)}`])
      ),
    });

    return snapshot;
  }

  // ─── STEP 2: GATHER ALL PORTFOLIO CONTEXTS IN PARALLEL ─────────────────────

  /**
   * Gather portfolio data for ALL enabled portfolios simultaneously.
   * Uses the pre-fetched snapshot for prices — NO additional API calls.
   */
  async gatherAllPortfolioContexts(
    configs: Map<number, AutoHedgeConfig>,
    snapshot: MarketSnapshot
  ): Promise<PortfolioContext[]> {
    const tasks = Array.from(configs.entries())
      .filter(([, config]) => config.enabled)
      .map(([portfolioId, config]) => 
        this.gatherPortfolioContext(portfolioId, config, snapshot)
          .catch(error => {
            logger.error('[CentralHedge] Failed to gather context', { portfolioId, error });
            return null;
          })
      );

    // All portfolio data fetched in PARALLEL
    const results = await Promise.allSettled(tasks);

    return results
      .filter((r): r is PromiseFulfilledResult<PortfolioContext | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((ctx): ctx is PortfolioContext => ctx !== null);
  }

  /**
   * Gather context for a single portfolio.
   * Community pool: on-chain getPoolStats() + snapshot prices
   * User portfolio: on-chain RWAManager.portfolios() + getPortfolioAssets()
   * Both use snapshot prices — NO API price fetches.
   */
  private async gatherPortfolioContext(
    portfolioId: number,
    config: AutoHedgeConfig,
    snapshot: MarketSnapshot
  ): Promise<PortfolioContext> {
    if (isCommunityPoolPortfolio(portfolioId)) {
      return this.gatherCommunityPoolContext(config, snapshot);
    }
    return this.gatherUserPortfolioContext(portfolioId, config, snapshot);
  }

  /**
   * Community pool context using snapshot prices + on-chain pool stats.
   * Uses the pre-fetched snapshot directly — does NOT call calculatePoolNAV()
   * which would independently fetch prices and defeat centralized single-fetch.
   */
  private async gatherCommunityPoolContext(
    config: AutoHedgeConfig,
    snapshot: MarketSnapshot
  ): Promise<PortfolioContext> {
    // On-chain pool stats
    const provider = new ethers.JsonRpcProvider(CENTRAL_CONFIG.RPC_URL);
    const poolContract = new ethers.Contract(
      CENTRAL_CONFIG.COMMUNITY_POOL_ADDRESS,
      ['function getPoolStats() view returns (uint256, uint256, uint256, uint256, uint256[4])'],
      provider
    );
    const stats = await poolContract.getPoolStats();
    const totalShares = Number(ethers.formatUnits(stats[0], 18));
    const onChainNAV = Number(ethers.formatUnits(stats[1], 6));

    // Get pool state from DB for allocation amounts (no price fetch)
    let allocationsFromDB: Record<string, { amount: number; percentage: number }> = {};
    try {
      const { getPoolState } = await import('@/lib/db/community-pool');
      const poolState = await getPoolState();
      for (const [asset, alloc] of Object.entries(poolState.allocations)) {
        allocationsFromDB[asset] = { 
          amount: (alloc as { amount: number }).amount || 0, 
          percentage: (alloc as { percentage: number }).percentage || 0 
        };
      }
    } catch {
      // If DB unavailable, use equal allocation estimates from on-chain NAV
      const symbols = ['CRO', 'ETH', 'BTC', 'SUI'];
      const pct = 100 / symbols.length;
      for (const sym of symbols) {
        allocationsFromDB[sym] = { amount: 0, percentage: pct };
      }
    }

    // Build positions from DB amounts + SNAPSHOT prices (no redundant fetch)
    const positions: Position[] = [];
    const allocationPcts: Record<string, number> = {};
    let totalValue = 0;

    for (const [symbol, allocData] of Object.entries(allocationsFromDB)) {
      const snapshotPrice = snapshot.prices.get(symbol);
      if (!snapshotPrice) continue;

      if (allocData.amount > 0) {
        // DB has actual amounts — use them directly
        const valueUSD = allocData.amount * snapshotPrice.price;
        totalValue += valueUSD;
        positions.push({
          symbol,
          value: valueUSD,
          change24h: snapshotPrice.change24h,
          balance: allocData.amount,
        });
      } else if (allocData.percentage > 0 && onChainNAV > 0) {
        // DB has percentages but no amounts — estimate from on-chain NAV
        const valueUSD = onChainNAV * (allocData.percentage / 100);
        const estimatedBalance = valueUSD / snapshotPrice.price;
        totalValue += valueUSD;
        positions.push({
          symbol,
          value: valueUSD,
          change24h: snapshotPrice.change24h,
          balance: estimatedBalance,
        });
      }
    }

    // Calculate percentages from actual values
    for (const pos of positions) {
      allocationPcts[pos.symbol] = totalValue > 0 ? (pos.value / totalValue) * 100 : 0;
    }

    // If still no value but on-chain has NAV, use on-chain NAV directly
    if (totalValue === 0 && onChainNAV > 0) {
      totalValue = onChainNAV;
    }

    // Calculate share price from snapshot-derived NAV
    const sharePrice = totalShares > 0 ? totalValue / totalShares : 1.0;

    // Peak share price from NAV history
    let peakSharePrice = 1.0;
    try {
      const { getNavHistory } = await import('@/lib/db/community-pool');
      const navHistory = await getNavHistory(30);
      if (navHistory?.length) {
        peakSharePrice = Math.max(1.0, ...navHistory.map(h => h.share_price || 0), sharePrice);
      } else {
        peakSharePrice = Math.max(1.0, sharePrice);
      }
    } catch {
      peakSharePrice = Math.max(1.0, sharePrice);
    }

    // Active hedges from DB
    const activeHedges = await this.fetchActiveHedges(COMMUNITY_POOL_PORTFOLIO_ID);

    return {
      portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
      walletAddress: config.walletAddress,
      config,
      positions,
      activeHedges,
      allocations: allocationPcts,
      totalValue,
      isCommunityPool: true,
      poolStats: {
        totalShares,
        onChainNAV,
        marketNAV: totalValue,
        sharePrice,
        peakSharePrice,
      },
    };
  }

  /**
   * User portfolio context from on-chain RWAManager + snapshot prices
   */
  private async gatherUserPortfolioContext(
    portfolioId: number,
    config: AutoHedgeConfig,
    snapshot: MarketSnapshot
  ): Promise<PortfolioContext> {
    try {
      const provider = new ethers.JsonRpcProvider(CENTRAL_CONFIG.RPC_URL);
      const addresses = getContractAddresses(CENTRAL_CONFIG.CHAIN_ID);
      const rwaManager = new ethers.Contract(addresses.rwaManager, RWA_MANAGER_ABI, provider);

      // On-chain portfolio data
      const portfolioData = await rwaManager.portfolios(portfolioId);
      const [, , , , , isActive] = portfolioData;
      
      if (!isActive) {
        logger.warn('[CentralHedge] Portfolio inactive on-chain', { portfolioId });
        const activeHedges = await this.fetchActiveHedges(portfolioId);
        return {
          portfolioId, walletAddress: config.walletAddress, config,
          positions: [], activeHedges, allocations: {}, totalValue: 0,
          isCommunityPool: false,
        };
      }

      // Get assets from contract
      const assetAddresses = await rwaManager.getPortfolioAssets(portfolioId);

      let totalValue = 0;
      const positions: Position[] = [];

      for (const assetAddress of assetAddresses) {
        const allocation = await rwaManager.getAssetAllocation(portfolioId, assetAddress);
        const addr = assetAddress.toLowerCase();

        // MockUSDC = institutional portfolio with virtual allocations
        if (addr === '0x28217daddc55e3c4831b4a48a00ce04880786967') {
          const mockUsdcValue = Number(allocation) / 1e6;
          
          if (mockUsdcValue > 1000000) {
            totalValue = mockUsdcValue;
            const virtualAllocations = [
              { symbol: 'BTC', percentage: 35 },
              { symbol: 'ETH', percentage: 30 },
              { symbol: 'CRO', percentage: 20 },
              { symbol: 'SUI', percentage: 15 },
            ];
            
            // Use SNAPSHOT prices — zero additional API calls
            for (const alloc of virtualAllocations) {
              const snapshotPrice = snapshot.prices.get(alloc.symbol);
              if (snapshotPrice) {
                const value = mockUsdcValue * (alloc.percentage / 100);
                positions.push({
                  symbol: alloc.symbol,
                  value,
                  change24h: snapshotPrice.change24h,
                  balance: value / snapshotPrice.price,
                });
              }
            }
          }
        }
      }

      // Calculate allocations
      const allocations: Record<string, number> = {};
      positions.forEach(p => {
        allocations[p.symbol] = totalValue > 0 ? (p.value / totalValue) * 100 : 0;
      });

      const activeHedges = await this.fetchActiveHedges(portfolioId);

      return {
        portfolioId,
        walletAddress: config.walletAddress,
        config,
        positions,
        activeHedges,
        allocations,
        totalValue,
        isCommunityPool: false,
      };
    } catch (error) {
      logger.error('[CentralHedge] Failed to gather user portfolio context', { portfolioId, error });
      const activeHedges = await this.fetchActiveHedges(portfolioId);
      return {
        portfolioId, walletAddress: config.walletAddress, config,
        positions: [], activeHedges, allocations: {}, totalValue: 0,
        isCommunityPool: false,
      };
    }
  }

  /** Fetch active hedges for a portfolio (DB query) */
  private async fetchActiveHedges(portfolioId: number): Promise<ActiveHedge[]> {
    try {
      const result = await query(
        `SELECT asset, side, size, notional_value FROM hedges 
         WHERE portfolio_id = $1 AND status = 'active'`,
        [portfolioId]
      );
      return result.map(h => ({
        asset: String(h.asset || ''),
        side: String(h.side || ''),
        size: parseFloat(String(h.size)) || 0,
        notionalValue: parseFloat(String(h.notional_value)) || 0,
      }));
    } catch {
      return [];
    }
  }

  // ─── STEP 3: RISK ASSESSMENT — PURE COMPUTATION ────────────────────────────

  /**
   * Assess risk for a portfolio using pre-fetched context.
   * This is PURE COMPUTATION — no I/O, no API calls.
   * The same function works for both community pool and user portfolios.
   */
  assessPortfolioRisk(ctx: PortfolioContext, snapshot: MarketSnapshot): RiskAssessment {
    const { positions, totalValue, portfolioId, isCommunityPool, poolStats } = ctx;

    // Calculate drawdown
    let drawdownPercent: number;
    if (isCommunityPool && poolStats) {
      // Community pool: share-price-based drawdown (more accurate)
      drawdownPercent = poolStats.sharePrice < poolStats.peakSharePrice
        ? ((poolStats.peakSharePrice - poolStats.sharePrice) / poolStats.peakSharePrice) * 100
        : 0;
    } else {
      drawdownPercent = this.calculateDrawdown(positions, totalValue);
    }

    const volatility = this.calculateVolatility(positions);
    const concentrationRisk = this.calculateConcentrationRisk(positions, totalValue);

    // Risk score calculation — community pool uses tighter thresholds
    let riskScore = 1;
    if (isCommunityPool) {
      // Conservative: community pool is shared money
      if (drawdownPercent > 1) riskScore += 1;
      if (drawdownPercent > 3) riskScore += 2;
      if (drawdownPercent > 7) riskScore += 2;
      if (volatility > 2) riskScore += 1;
      if (volatility > 4) riskScore += 1;
      if (concentrationRisk > 35) riskScore += 2;
      if (concentrationRisk > 50) riskScore += 1;
    } else {
      // Standard user portfolio thresholds
      if (drawdownPercent > 2) riskScore += 1;
      if (drawdownPercent > 5) riskScore += 2;
      if (drawdownPercent > 10) riskScore += 2;
      if (volatility > 3) riskScore += 1;
      if (volatility > 5) riskScore += 1;
      if (concentrationRisk > 40) riskScore += 2;
      if (concentrationRisk > 60) riskScore += 1;
    }
    riskScore = Math.min(riskScore, 10);

    // Generate recommendations using pre-fetched data
    const recommendations = this.generateHedgeRecommendations(
      positions, totalValue, ctx.allocations, ctx.activeHedges,
      drawdownPercent, concentrationRisk
    );

    return {
      portfolioId,
      totalValue,
      drawdownPercent,
      volatility,
      riskScore,
      recommendations,
      timestamp: Date.now(),
    };
  }

  // ─── STEP 4: BATCH RECOMMENDATION GENERATION ──────────────────────────────

  private generateHedgeRecommendations(
    positions: Position[],
    totalValue: number,
    allocations: Record<string, number>,
    activeHedges: ActiveHedge[],
    drawdownPercent: number,
    concentrationRisk: number
  ): HedgeRecommendation[] {
    const recommendations: HedgeRecommendation[] = [];
    const hedgedAssets = new Set(activeHedges.map(h => h.asset));

    for (const pos of positions) {
      if (hedgedAssets.has(pos.symbol)) continue;
      if (pos.value < CENTRAL_CONFIG.MIN_HEDGE_SIZE_USD) continue;

      // Significant loss → hedge
      if (pos.change24h < -3) {
        recommendations.push({
          asset: pos.symbol,
          side: 'SHORT',
          reason: `${pos.symbol} down ${pos.change24h.toFixed(2)}% (24h) - protect against further losses`,
          suggestedSize: pos.value * Math.min(0.5, Math.abs(pos.change24h) / 10),
          leverage: CENTRAL_CONFIG.DEFAULT_LEVERAGE,
          confidence: Math.min(0.6 + Math.abs(pos.change24h) / 20, 0.95),
        });
      }

      // Over-concentrated → hedge
      const concentration = (pos.value / totalValue) * 100;
      if (concentration > CENTRAL_CONFIG.MAX_ASSET_CONCENTRATION_PERCENT) {
        recommendations.push({
          asset: pos.symbol,
          side: 'SHORT',
          reason: `${pos.symbol} concentration at ${concentration.toFixed(1)}% - reduce exposure`,
          suggestedSize: pos.value * ((concentration - 30) / 100),
          leverage: 2,
          confidence: 0.75,
        });
      }

      // High drawdown + volatile assets → hedge
      if (drawdownPercent > 5 && Math.abs(pos.change24h) > 5) {
        recommendations.push({
          asset: pos.symbol,
          side: 'SHORT',
          reason: `High portfolio drawdown (${drawdownPercent.toFixed(1)}%) + ${pos.symbol} volatility`,
          suggestedSize: pos.value * 0.25,
          leverage: CENTRAL_CONFIG.DEFAULT_LEVERAGE,
          confidence: 0.7,
        });
      }
    }

    return recommendations.sort((a, b) => b.confidence - a.confidence);
  }

  // ─── STEP 5: BATCH HEDGE EXECUTION ─────────────────────────────────────────

  /**
   * Execute hedges for a portfolio using snapshot prices.
   * No additional price fetches — uses the pre-validated snapshot.
   */
  async executeHedges(
    ctx: PortfolioContext,
    recommendations: HedgeRecommendation[],
    snapshot: MarketSnapshot
  ): Promise<{ executed: number; failed: number }> {
    let executed = 0;
    let executionFailed = 0;

    for (const rec of recommendations) {
      if (rec.confidence < CENTRAL_CONFIG.MIN_CONFIDENCE_FOR_EXECUTION) continue;
      
      // Validate asset is allowed
      if (ctx.config.allowedAssets.length > 0 && !ctx.config.allowedAssets.includes(rec.asset)) {
        continue;
      }

      // Use snapshot price for execution — no re-fetch
      const snapshotPrice = snapshot.prices.get(rec.asset);
      if (!snapshotPrice) {
        logger.warn('[CentralHedge] No snapshot price for hedge', { asset: rec.asset });
        executionFailed++;
        continue;
      }

      // Validate price is recent (< 60s)
      const priceAge = Date.now() - snapshot.timestamp;
      if (priceAge > 60_000) {
        logger.warn('[CentralHedge] Snapshot too stale for execution', { 
          asset: rec.asset, ageMs: priceAge 
        });
        executionFailed++;
        continue;
      }

      const leverage = Math.min(rec.leverage, ctx.config.maxLeverage);
      const effectivePrice = rec.side === 'SHORT' ? snapshotPrice.bid : snapshotPrice.ask;
      const market = `${rec.asset}-USD-PERP`;

      try {
        const orchestrator = getAgentOrchestrator();
        const result = await orchestrator.executeHedge({
          market,
          side: rec.side,
          leverage,
          notionalValue: rec.suggestedSize.toString(),
        });

        if (result.success) {
          const orderId = `auto-hedge-${ctx.portfolioId}-${Date.now()}`;
          await createHedge({
            orderId,
            portfolioId: ctx.portfolioId,
            walletAddress: ctx.walletAddress,
            asset: rec.asset,
            market,
            side: rec.side,
            size: rec.suggestedSize / 1000,
            notionalValue: rec.suggestedSize,
            leverage,
            entryPrice: effectivePrice,
            simulationMode: false,
            reason: `[AUTO-CENTRAL] ${rec.reason}`,
            metadata: {
              confidence: rec.confidence,
              snapshotSource: snapshot.source,
              snapshotTimestamp: snapshot.timestamp,
              priceAtExecution: {
                mid: snapshotPrice.price,
                bid: snapshotPrice.bid,
                ask: snapshotPrice.ask,
                effective: effectivePrice,
              },
            },
          });

          logger.info('[CentralHedge] Hedge executed', {
            portfolioId: ctx.portfolioId,
            asset: rec.asset,
            side: rec.side,
            size: rec.suggestedSize,
            price: effectivePrice,
          });
          executed++;
        } else {
          executionFailed++;
        }
      } catch (error) {
        logger.error('[CentralHedge] Hedge execution error', { error, asset: rec.asset });
        executionFailed++;
      }
    }

    return { executed, failed: executionFailed };
  }

  // ─── STEP 6: BATCH PNL UPDATE ─────────────────────────────────────────────

  /**
   * Update PnL for ALL active hedges using snapshot prices.
   * Single price lookup per unique asset, then batch DB updates.
   */
  async batchUpdatePnL(snapshot: MarketSnapshot): Promise<{ updated: number; errors: number }> {
    const activeHedges = await getActiveHedges();
    if (activeHedges.length === 0) return { updated: 0, errors: 0 };

    let updated = 0;
    let errors = 0;

    // Build batch update values
    const updates: Array<{ id: number; pnl: number; price: number }> = [];

    for (const hedge of activeHedges) {
      const baseAsset = hedge.asset.replace('-PERP', '').replace('-USD-PERP', '');
      const snapshotPrice = snapshot.prices.get(baseAsset) || snapshot.prices.get(hedge.asset);
      if (!snapshotPrice) continue;

      const entryPrice = Number(hedge.entry_price) || 0;
      if (entryPrice === 0) continue;

      const notionalValue = Number(hedge.notional_value);
      const leverage = Number(hedge.leverage) || 1;

      let pnlMultiplier: number;
      if (hedge.side === 'SHORT') {
        pnlMultiplier = (entryPrice - snapshotPrice.price) / entryPrice;
      } else {
        pnlMultiplier = (snapshotPrice.price - entryPrice) / entryPrice;
      }

      const unrealizedPnL = notionalValue * pnlMultiplier * leverage;
      if (!isFinite(unrealizedPnL)) continue;

      updates.push({ id: hedge.id, pnl: unrealizedPnL, price: snapshotPrice.price });
    }

    // Execute batch update (could be further optimized with UNNEST but keeping it safe)
    for (const u of updates) {
      try {
        await query(
          `UPDATE hedges SET current_pnl = $1, current_price = $2, price_updated_at = NOW() WHERE id = $3`,
          [u.pnl, u.price, u.id]
        );
        updated++;
      } catch (err) {
        errors++;
        logger.error(`[CentralHedge] PnL update failed for hedge ${u.id}`, { error: err });
      }
    }

    if (updated > 0) {
      logger.debug(`[CentralHedge] Batch PnL updated: ${updated} hedges, ${errors} errors`);
    }

    return { updated, errors };
  }

  // ─── MAIN ORCHESTRATION CYCLE ─────────────────────────────────────────────

  /**
   * Run one complete centralized assessment cycle:
   * 1. Fetch market snapshot ONCE
   * 2. Gather ALL portfolio contexts in PARALLEL
   * 3. Assess risk for each (pure computation)
   * 4. Execute hedges where needed
   * 5. Batch PnL update
   * 
   * This replaces the serial per-portfolio approach.
   */
  async runCycle(configs: Map<number, AutoHedgeConfig>): Promise<CycleResult> {
    const cycleStart = Date.now();

    logger.info('[CentralHedge] ═══ Starting centralized assessment cycle ═══', {
      portfolios: configs.size,
    });

    // ── 1. SINGLE MARKET FETCH ──
    const snapshot = await this.fetchMarketSnapshot();

    // ── 1b. SHARE SNAPSHOT WITH ALL AGENTS ──
    // Push the freshly-fetched snapshot to the orchestrator so every agent
    // (PriceMonitorAgent, HedgingAgent, etc.) can use centralized data
    // instead of fetching independently.
    try {
      const orchestrator = getAgentOrchestrator();
      orchestrator.shareMarketSnapshot(snapshot);
    } catch {
      // Orchestrator may not be initialized yet — non-critical
    }

    // ── 2. PARALLEL CONTEXT GATHERING ──
    const contexts = await this.gatherAllPortfolioContexts(configs, snapshot);

    logger.info('[CentralHedge] Portfolio contexts gathered', {
      requested: configs.size,
      gathered: contexts.length,
      communityPools: contexts.filter(c => c.isCommunityPool).length,
      userPortfolios: contexts.filter(c => !c.isCommunityPool).length,
    });

    // ── 3. ASSESS ALL RISKS (pure computation — no I/O) ──
    const assessments = new Map<number, RiskAssessment>();
    for (const ctx of contexts) {
      const assessment = this.assessPortfolioRisk(ctx, snapshot);
      assessments.set(ctx.portfolioId, assessment);

      logger.info('[CentralHedge] Risk assessed', {
        portfolioId: ctx.portfolioId,
        type: ctx.isCommunityPool ? 'community-pool' : 'user',
        totalValue: `$${assessment.totalValue.toFixed(2)}`,
        riskScore: assessment.riskScore,
        threshold: ctx.config.riskThreshold,
        recommendations: assessment.recommendations.length,
        needsHedging: assessment.riskScore >= ctx.config.riskThreshold,
      });
    }

    // ── 4. EXECUTE HEDGES WHERE NEEDED ──
    let totalExecuted = 0;
    let totalFailed = 0;

    for (const ctx of contexts) {
      const assessment = assessments.get(ctx.portfolioId);
      if (!assessment) continue;

      if (assessment.riskScore >= ctx.config.riskThreshold && assessment.recommendations.length > 0) {
        logger.info('[CentralHedge] Executing hedges for portfolio', {
          portfolioId: ctx.portfolioId,
          riskScore: assessment.riskScore,
          recommendations: assessment.recommendations.length,
        });

        const { executed, failed } = await this.executeHedges(ctx, assessment.recommendations, snapshot);
        totalExecuted += executed;
        totalFailed += failed;
      }
    }

    // ── 5. BATCH PNL UPDATE ──
    const { updated: pnlUpdated, errors: pnlErrors } = await this.batchUpdatePnL(snapshot);

    // ── DONE ──
    const result: CycleResult = {
      timestamp: Date.now(),
      durationMs: Date.now() - cycleStart,
      snapshot,
      portfoliosAssessed: contexts.length,
      assessments,
      hedgesExecuted: totalExecuted,
      hedgesFailed: totalFailed,
      pnlUpdated,
      pnlErrors,
    };

    this.lastCycleResult = result;

    logger.info('[CentralHedge] ═══ Cycle complete ═══', {
      durationMs: result.durationMs,
      portfoliosAssessed: result.portfoliosAssessed,
      hedgesExecuted: result.hedgesExecuted,
      hedgesFailed: result.hedgesFailed,
      pnlUpdated: result.pnlUpdated,
      marketSnapshotDurationMs: snapshot.fetchDurationMs,
    });

    return result;
  }

  // ─── UTILITY ───────────────────────────────────────────────────────────────

  private calculateDrawdown(positions: Position[], totalValue: number): number {
    if (!positions.length || totalValue === 0) return 0;
    return positions.reduce((acc, pos) => {
      return acc + (pos.change24h < 0 ? Math.abs(pos.change24h) * (pos.value / totalValue) : 0);
    }, 0);
  }

  private calculateVolatility(positions: Position[]): number {
    if (!positions.length) return 0;
    return Math.sqrt(
      positions.reduce((acc, pos) => acc + Math.pow(pos.change24h / 100, 2), 0) / positions.length
    ) * 100;
  }

  private calculateConcentrationRisk(positions: Position[], totalValue: number): number {
    if (!positions.length || totalValue === 0) return 0;
    return (Math.max(...positions.map(p => p.value)) / totalValue) * 100;
  }

  /** Get last cycle result */
  getLastCycleResult(): CycleResult | null {
    return this.lastCycleResult;
  }

  /** Get last market snapshot */
  getLastSnapshot(): MarketSnapshot | null {
    return this.lastSnapshot;
  }

  /** Get status summary */
  getStatus(): {
    hasRunCycle: boolean;
    lastCycleDurationMs: number | null;
    lastCycleTimestamp: number | null;
    portfoliosInLastCycle: number;
    snapshotAge: number | null;
  } {
    return {
      hasRunCycle: this.lastCycleResult !== null,
      lastCycleDurationMs: this.lastCycleResult?.durationMs ?? null,
      lastCycleTimestamp: this.lastCycleResult?.timestamp ?? null,
      portfoliosInLastCycle: this.lastCycleResult?.portfoliosAssessed ?? 0,
      snapshotAge: this.lastSnapshot ? Date.now() - this.lastSnapshot.timestamp : null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export function getCentralizedHedgeManager(): CentralizedHedgeManager {
  return CentralizedHedgeManager.getInstance();
}
