/**
 * Auto-Hedging Service
 * 
 * Background service that:
 * 1. Continuously monitors portfolio risk
 * 2. Updates hedge PnL with live prices
 * 3. Auto-creates hedges when risk thresholds are exceeded
 * 4. Coordinates with multi-agent system for intelligent decisions
 * 5. Integrates Polymarket prediction market signals for enhanced risk detection
 */

import { logger } from '@/lib/utils/logger';
import { getActiveHedges, createHedge, type Hedge } from '@/lib/db/hedges';
import { query } from '@/lib/db/postgres';
import { getAgentOrchestrator } from './agent-orchestrator';
import { ethers } from 'ethers';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { getMarketDataService } from './RealMarketDataService';
import { getUnifiedPriceProvider, getHedgeExecutionPrice } from './unified-price-provider';
import { getAutoHedgeConfigs, type AutoHedgeConfig as StoredAutoHedgeConfig } from '@/lib/storage/auto-hedge-storage';
import { COMMUNITY_POOL_PORTFOLIO_ID, COMMUNITY_POOL_ADDRESS, isCommunityPoolPortfolio } from '@/lib/constants';
import { calculatePoolNAV } from './CommunityPoolService';
import { getPoolStats as getUnifiedPoolStats } from './CommunityPoolStatsService';
import { getCentralizedHedgeManager } from './CentralizedHedgeManager';
import type { FiveMinBTCSignal } from './Polymarket5MinService';
import { PredictionAggregatorService, type AggregatedPrediction } from './PredictionAggregatorService';

// Configuration
const CONFIG = {
  // Update frequency
  PNL_UPDATE_INTERVAL_MS: 10000, // 10 seconds
  RISK_CHECK_INTERVAL_MS: 60000, // 1 minute
  
  // Risk thresholds
  MAX_PORTFOLIO_DRAWDOWN_PERCENT: 3, // Auto-hedge if portfolio down > 3%
  MAX_ASSET_CONCENTRATION_PERCENT: 40, // Hedge if single asset > 40%
  MIN_HEDGE_SIZE_USD: 50, // Minimum hedge size (lowered for demo)
  
  // Hedge parameters
  DEFAULT_LEVERAGE: 3,
  DEFAULT_STOP_LOSS_PERCENT: 10,
  DEFAULT_TAKE_PROFIT_PERCENT: 20,
};

export interface AutoHedgeConfig {
  portfolioId: number;
  walletAddress: string;
  enabled: boolean;
  riskThreshold: number; // 1-10 scale
  maxLeverage: number;
  allowedAssets: string[];
}

export interface RiskAssessment {
  portfolioId: number;
  totalValue: number;
  drawdownPercent: number;
  volatility: number;
  riskScore: number; // 1-10
  recommendations: HedgeRecommendation[];
  aggregatedPrediction?: {
    direction: string;
    confidence: number;
    consensus: number;
    recommendation: string;
    sizeMultiplier: number;
    sources: Array<{
      name: string;
      available: boolean;
      weight: number;
      direction?: string;
      confidence?: number;
    }>;
  } | null;
  timestamp: number;
}

export interface HedgeRecommendation {
  asset: string;
  side: 'LONG' | 'SHORT';
  reason: string;
  suggestedSize: number;
  leverage: number;
  confidence: number; // 0-1
}

class AutoHedgingService {
  private isRunning = false;
  private pnlUpdateInterval: NodeJS.Timeout | null = null;
  private riskCheckInterval: NodeJS.Timeout | null = null;
  private autoHedgeConfigs: Map<number, AutoHedgeConfig> = new Map();
  private lastRiskAssessments: Map<number, RiskAssessment> = new Map();

  // ── Overlap guards: prevent concurrent execution of async interval callbacks ──
  // Without these, if updateAllHedgePnL() takes >10s or checkAllPortfolioRisks() >60s,
  // overlapping executions could cause duplicate hedges, inconsistent state, or DB races.
  private pnlUpdateInProgress = false;
  private riskCheckInProgress = false;

  // ── Memory cap for assessments map ──
  private static readonly MAX_RISK_ASSESSMENTS = 500;

  /**
   * Start the auto-hedging service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.info('[AutoHedging] Already running, reloading configs...');
      // Always reload configs so newly-added portfolios (e.g. community pool) are picked up
      await this.loadPortfoliosFromStorage();
      return;
    }

    this.isRunning = true;
    logger.info('[AutoHedging] Starting service...');

    // Initial PnL update
    await this.updateAllHedgePnL();

    // Start PnL update loop — with overlap guard
    this.pnlUpdateInterval = setInterval(async () => {
      if (this.pnlUpdateInProgress) {
        logger.debug('[AutoHedging] PnL update skipped — previous still running');
        return;
      }
      this.pnlUpdateInProgress = true;
      try {
        await this.updateAllHedgePnL();
      } catch (error) {
        logger.error('[AutoHedging] PnL update error', { error: error instanceof Error ? error.message : error });
      } finally {
        this.pnlUpdateInProgress = false;
      }
    }, CONFIG.PNL_UPDATE_INTERVAL_MS);

    // Start risk check loop — with overlap guard
    this.riskCheckInterval = setInterval(async () => {
      if (this.riskCheckInProgress) {
        logger.debug('[AutoHedging] Risk check skipped — previous still running');
        return;
      }
      this.riskCheckInProgress = true;
      try {
        await this.checkAllPortfolioRisks();
      } catch (error) {
        logger.error('[AutoHedging] Risk check error', { error: error instanceof Error ? error.message : error });
      } finally {
        this.riskCheckInProgress = false;
      }
    }, CONFIG.RISK_CHECK_INTERVAL_MS);

    logger.info('[AutoHedging] Service started', {
      pnlUpdateInterval: CONFIG.PNL_UPDATE_INTERVAL_MS,
      riskCheckInterval: CONFIG.RISK_CHECK_INTERVAL_MS,
    });

    // Load all enabled portfolios from persistent storage
    await this.loadPortfoliosFromStorage();
  }

  /**
   * Load all enabled portfolio configurations from storage
   * This replaces hardcoded portfolio IDs with dynamic database-driven configuration
   * 
   * NOTE: Community Pool is ALWAYS auto-enrolled for protective monitoring
   */
  private async loadPortfoliosFromStorage(): Promise<void> {
    try {
      // ALWAYS enroll Community Pool first (self-sustaining fund requires protection)
      // Uses conservative thresholds: riskThreshold=3 means hedge early
      const communityPoolConfig: AutoHedgeConfig = {
        portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
        walletAddress: COMMUNITY_POOL_ADDRESS,
        enabled: true,
        riskThreshold: 3, // Aggressive: hedge at moderate risk (protects community funds)
        maxLeverage: 3,
        allowedAssets: ['BTC', 'ETH', 'SUI', 'CRO'],
      };
      this.enableForPortfolio(communityPoolConfig);
      logger.info('[AutoHedging] Community Pool auto-enrolled for protective monitoring', {
        portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
        address: COMMUNITY_POOL_ADDRESS,
        riskThreshold: communityPoolConfig.riskThreshold,
      });

      // Load additional portfolios from storage
      const storedConfigs = await getAutoHedgeConfigs();
      
      // Filter out community pool from stored configs (we already enrolled it above)
      const otherConfigs = storedConfigs.filter(c => c.portfolioId !== COMMUNITY_POOL_PORTFOLIO_ID);
      
      if (otherConfigs.length > 0) {
        logger.info('[AutoHedging] Loading additional configurations from storage', {
          count: otherConfigs.length,
          portfolios: otherConfigs.map(c => c.portfolioId)
        });
        
        for (const config of otherConfigs) {
          // Convert storage format to service format
          this.enableForPortfolio({
            portfolioId: config.portfolioId,
            walletAddress: config.walletAddress,
            enabled: config.enabled,
            riskThreshold: config.riskThreshold,
            maxLeverage: config.maxLeverage,
            allowedAssets: config.allowedAssets,
          });
        }
      }
      
      logger.info('[AutoHedging] All portfolios loaded (including Community Pool)', {
        activeCount: this.autoHedgeConfigs.size,
        portfolioIds: Array.from(this.autoHedgeConfigs.keys()),
      });
    } catch (error) {
      logger.error('[AutoHedging] Failed to load configurations from storage', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Even on error, Community Pool should still be enrolled from the code above
      // Service continues running with at least the community pool
    }
  }

  /**
   * Stop the auto-hedging service
   */
  stop(): void {
    if (!this.isRunning) return;

    if (this.pnlUpdateInterval) {
      clearInterval(this.pnlUpdateInterval);
      this.pnlUpdateInterval = null;
    }

    if (this.riskCheckInterval) {
      clearInterval(this.riskCheckInterval);
      this.riskCheckInterval = null;
    }

    this.isRunning = false;
    this.pnlUpdateInProgress = false;
    this.riskCheckInProgress = false;
    logger.info('[AutoHedging] Service stopped');
  }

  /**
   * Enable auto-hedging for a portfolio
   * Immediately registers with provided config, then asynchronously fetches on-chain settings.
   * Uses a version counter to prevent stale async results from overwriting newer configs.
   */
  private configVersions: Map<number, number> = new Map();

  enableForPortfolio(config: AutoHedgeConfig): void {
    // Increment version for this portfolio — prevents stale async overwrites
    const version = (this.configVersions.get(config.portfolioId) || 0) + 1;
    this.configVersions.set(config.portfolioId, version);

    // Set config IMMEDIATELY so it's available for risk checks right away
    this.autoHedgeConfigs.set(config.portfolioId, config);
    logger.info('[AutoHedging] Portfolio registered immediately', {
      portfolioId: config.portfolioId,
      riskThreshold: config.riskThreshold,
      allowedAssets: config.allowedAssets,
    });

    // Then asynchronously refine settings from on-chain data (non-blocking)
    this.loadPortfolioSettings(config).then(updatedConfig => {
      // Only apply if this is still the latest version (no newer enableForPortfolio call)
      if (this.configVersions.get(config.portfolioId) === version) {
        this.autoHedgeConfigs.set(updatedConfig.portfolioId, updatedConfig);
        logger.info('[AutoHedging] Portfolio settings refined from on-chain', {
          portfolioId: updatedConfig.portfolioId,
          riskThreshold: updatedConfig.riskThreshold,
        });
      } else {
        logger.debug('[AutoHedging] Skipping stale on-chain config update', {
          portfolioId: config.portfolioId,
          staleVersion: version,
          currentVersion: this.configVersions.get(config.portfolioId),
        });
      }
    }).catch(error => {
      // Config already set above, just log the warning
      logger.warn('[AutoHedging] Failed to load on-chain portfolio settings, using stored defaults', {
        portfolioId: config.portfolioId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * Disable auto-hedging for a portfolio
   */
  disableForPortfolio(portfolioId: number): void {
    this.autoHedgeConfigs.delete(portfolioId);
    logger.info('[AutoHedging] Disabled for portfolio', { portfolioId });
  }

  /**
   * Load portfolio settings and map risk tolerance to hedging threshold
   * Risk tolerance (0-100) → Risk threshold (1-10) mapping:
   * - 0-20: Very Conservative → threshold 2 (hedge at slightest risk)
   * - 21-40: Conservative → threshold 4
   * - 41-60: Moderate → threshold 5-6
   * - 61-80: Aggressive → threshold 7-8
   * - 81-100: Very Aggressive → threshold 9-10 (only hedge at high risk)
   */
  private async loadPortfolioSettings(config: AutoHedgeConfig): Promise<AutoHedgeConfig> {
    try {
      // Use risk tolerance from on-chain contract data
      // Risk tolerance will be fetched from RWAManager in fetchPortfolioData
      // For now, use the config's default or set a reasonable default
      const riskTolerance = config.riskThreshold || 50; // Default medium risk
      
      // Map risk tolerance (0-100) to risk threshold (1-10)
      // Lower tolerance = lower threshold = more aggressive hedging
      // Higher tolerance = higher threshold = less hedging
      const calculatedThreshold = Math.max(2, Math.min(10, Math.floor((riskTolerance / 10) * 0.8 + 2)));
      
      logger.info('[AutoHedging] Using portfolio settings', {
        portfolioId: config.portfolioId,
        riskTolerance,
        calculatedThreshold,
      });

      return {
        ...config,
        riskThreshold: calculatedThreshold,
      };
    } catch (error) {
      logger.error('[AutoHedging] Error loading portfolio settings', { error });
      return config;
    }
  }

  /**
   * Get status of auto-hedging service
   */
  getStatus(): {
    isRunning: boolean;
    enabledPortfolios: number[];
    lastUpdate: number;
    config: typeof CONFIG;
  } {
    return {
      isRunning: this.isRunning,
      enabledPortfolios: Array.from(this.autoHedgeConfigs.keys()),
      lastUpdate: Date.now(),
      config: CONFIG,
    };
  }

  /**
   * Update PnL for all active hedges
   * Uses CentralizedHedgeManager's last snapshot if fresh, else fetches new snapshot
   */
  async updateAllHedgePnL(): Promise<{ updated: number; errors: number }> {
    try {
      const manager = getCentralizedHedgeManager();
      let snapshot = manager.getLastSnapshot();
      
      // Use existing snapshot if fresh (< 15s), else fetch new one
      if (!snapshot || (Date.now() - snapshot.timestamp) > 15_000) {
        snapshot = await manager.fetchMarketSnapshot();
      }

      return await manager.batchUpdatePnL(snapshot);
    } catch (error) {
      logger.warn('[AutoHedging] Centralized PnL update failed, falling back', { error });
      return this.updateAllHedgePnLLegacy();
    }
  }

  /**
   * Legacy PnL update — per-asset price fetching
   */
  private async updateAllHedgePnLLegacy(): Promise<{ updated: number; errors: number }> {
    const activeHedges = await getActiveHedges();
    
    if (activeHedges.length === 0) {
      return { updated: 0, errors: 0 };
    }

    // Get unique assets
    const uniqueAssets = [...new Set(activeHedges.map(h => h.asset))];
    
    // Use unified price provider for real-time prices
    const priceProvider = getUnifiedPriceProvider();
    await priceProvider.initialize();
    
    // Fetch all prices from unified provider (instant, non-blocking)
    const priceMap = new Map<string, number>();
    for (const asset of uniqueAssets) {
      try {
        const baseAsset = asset.replace('-PERP', '').replace('-USD-PERP', '');
        const priceData = priceProvider.getPrice(baseAsset);
        if (priceData?.price) {
          priceMap.set(asset, priceData.price);
        } else {
          // Fallback to market data service if unified provider doesn't have it
          const marketDataService = getMarketDataService();
          const fallbackPrice = await marketDataService.getTokenPrice(baseAsset);
          if (fallbackPrice.price) priceMap.set(asset, fallbackPrice.price);
        }
      } catch (err) {
        logger.warn(`[AutoHedging] Failed to get price for ${asset}`);
      }
    }

    let updated = 0;
    let errors = 0;

    // Update each hedge
    for (const hedge of activeHedges) {
      try {
        const currentPrice = priceMap.get(hedge.asset);
        if (!currentPrice) continue;

        const entryPrice = Number(hedge.entry_price) || 0;
        const notionalValue = Number(hedge.notional_value);
        const leverage = Number(hedge.leverage) || 1;

        // Calculate PnL (guard against division by zero)
        if (entryPrice === 0) continue;

        let pnlMultiplier: number;
        if (hedge.side === 'SHORT') {
          pnlMultiplier = (entryPrice - currentPrice) / entryPrice;
        } else {
          pnlMultiplier = (currentPrice - entryPrice) / entryPrice;
        }

        const unrealizedPnL = notionalValue * pnlMultiplier * leverage;

        // Guard against non-finite values (Infinity, NaN)
        if (!isFinite(unrealizedPnL)) continue;

        // Update in database
        await query(
          `UPDATE hedges SET current_pnl = $1, current_price = $2, price_updated_at = NOW() WHERE id = $3`,
          [unrealizedPnL, currentPrice, hedge.id]
        );

        updated++;
      } catch (err) {
        errors++;
        logger.error(`[AutoHedging] Failed to update hedge ${hedge.id}`, { error: err });
      }
    }

    if (updated > 0) {
      logger.debug(`[AutoHedging] Updated ${updated} hedge PnLs, ${errors} errors`);
    }

    return { updated, errors };
  }

  /**
   * Check risk for all enabled portfolios — CENTRALIZED
   * Uses CentralizedHedgeManager to fetch market data ONCE and assess all portfolios
   */
  async checkAllPortfolioRisks(): Promise<void> {
    if (this.autoHedgeConfigs.size === 0) return;

    try {
      const manager = getCentralizedHedgeManager();
      const result = await manager.runCycle(this.autoHedgeConfigs);

      // Store all assessments
      for (const [portfolioId, assessment] of result.assessments) {
        this.lastRiskAssessments.set(portfolioId, assessment);
      }

      logger.info('[AutoHedging] Centralized cycle complete', {
        portfolios: result.portfoliosAssessed,
        hedgesExecuted: result.hedgesExecuted,
        pnlUpdated: result.pnlUpdated,
        durationMs: result.durationMs,
      });
    } catch (error) {
      logger.error('[AutoHedging] Centralized risk check failed, falling back to serial', { error });
      // Fallback to serial per-portfolio assessment
      await this.checkAllPortfolioRisksSerial();
    }
  }

  /**
   * Serial fallback: check risk for all portfolios one-by-one
   * Used when CentralizedHedgeManager fails
   */
  private async checkAllPortfolioRisksSerial(): Promise<void> {
    for (const [portfolioId, config] of this.autoHedgeConfigs) {
      if (!config.enabled) continue;

      try {
        const assessment = await this.assessPortfolioRisk(portfolioId, config.walletAddress);
        this.lastRiskAssessments.set(portfolioId, assessment);

        if (assessment.riskScore >= config.riskThreshold) {
          logger.info('[AutoHedging] Risk threshold exceeded', {
            portfolioId,
            riskScore: assessment.riskScore,
            threshold: config.riskThreshold,
          });

          for (const recommendation of assessment.recommendations) {
            if (recommendation.confidence >= 0.7) {
              await this.executeAutoHedge(portfolioId, config, recommendation);
            }
          }
        }
      } catch (error) {
        logger.error('[AutoHedging] Risk assessment failed', { portfolioId, error });
      }
    }
  }

  /**
   * Assess risk for a portfolio using comprehensive data
   * Fetches positions, allocations, risk metrics, and active hedges
   */
  async assessPortfolioRisk(portfolioId: number, walletAddress: string): Promise<RiskAssessment> {
    // Special handling for CommunityPool (portfolioId = COMMUNITY_POOL_PORTFOLIO_ID)
    if (isCommunityPoolPortfolio(portfolioId)) {
      return this.assessCommunityPoolRisk();
    }

    try {
      // Fetch comprehensive portfolio data from database
      const portfolioData = await this.fetchPortfolioData(portfolioId, walletAddress);
      
      // Get AI agent analysis with full context
      const orchestrator = getAgentOrchestrator();
      const analysisResult = await orchestrator.analyzePortfolio({
        address: walletAddress,
        portfolioData: {
          portfolioId,
          positions: portfolioData.positions,
          allocations: portfolioData.allocations,
          riskMetrics: portfolioData.riskMetrics,
          activeHedges: portfolioData.activeHedges,
        },
      });

      const aiAnalysis = analysisResult.data as {
        totalValue?: number;
        positions?: Array<{ symbol: string; value: number; change24h: number }>;
        riskMetrics?: { volatility?: number; drawdown?: number };
      } | null;

      // Combine database data with AI analysis
      const totalValue = portfolioData.totalValue || aiAnalysis?.totalValue || 0;
      const positions = portfolioData.positions.length > 0 
        ? portfolioData.positions 
        : (aiAnalysis?.positions || []);

      // Calculate risk metrics
      const drawdownPercent = this.calculateDrawdown(positions, totalValue);
      const volatility = this.calculateVolatility(positions);
      const concentrationRisk = this.calculateConcentrationRisk(positions, totalValue);
      
      // Calculate comprehensive risk score (1-10)
      let riskScore = 1;
      if (drawdownPercent > 2) riskScore += 1;
      if (drawdownPercent > 5) riskScore += 2;
      if (drawdownPercent > 10) riskScore += 2;
      if (volatility > 3) riskScore += 1;
      if (volatility > 5) riskScore += 1;
      if (concentrationRisk > 40) riskScore += 2; // Single asset >40%
      if (concentrationRisk > 60) riskScore += 1; // Single asset >60%
      riskScore = Math.min(riskScore, 10);

      logger.info('[AutoHedging] Portfolio risk assessment', {
        portfolioId,
        totalValue,
        positionsCount: positions.length,
        drawdownPercent: drawdownPercent.toFixed(2),
        volatility: volatility.toFixed(2),
        concentrationRisk: concentrationRisk.toFixed(1),
        riskScore,
        activeHedges: portfolioData.activeHedges.length,
      });

      // Generate hedge recommendations based on comprehensive data
      const recommendations = this.generateHedgeRecommendations(
        positions,
        totalValue,
        portfolioData.allocations,
        portfolioData.activeHedges,
        drawdownPercent,
        concentrationRisk
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
    } catch (error) {
      logger.error('[AutoHedging] Risk assessment error — treating as elevated risk', { portfolioId, error });
      // Unknown state = elevated risk, not safe default
      return {
        portfolioId,
        totalValue: 0,
        drawdownPercent: 0,
        volatility: 0,
        riskScore: 4,
        recommendations: [],
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Assess risk specifically for CommunityPool TVL
   * Uses unified stats service (single source of truth) + CommunityPoolService for allocations
   */
  private async assessCommunityPoolRisk(): Promise<RiskAssessment> {
    try {
      // Get on-chain stats via unified service (single source of truth)
      const poolStats = await getUnifiedPoolStats();
      const totalShares = poolStats.totalShares;
      const onChainNAV = poolStats.totalNAV;
      
      // Get market-adjusted NAV and share price from CommunityPoolService
      // This uses actual token holdings multiplied by live prices
      const marketData = await calculatePoolNAV();
      const { totalValueUSD: marketNAV, sharePrice: marketSharePrice, allocations: marketAllocations } = marketData;

      // Build positions from market allocations
      const positions: Array<{ symbol: string; value: number; change24h: number; balance: number }> = [];
      const marketDataService = getMarketDataService();
      
      for (const [symbol, data] of Object.entries(marketAllocations)) {
        const alloc = data as { amount: number; price: number; valueUSD: number; percentage: number };
        if (alloc.valueUSD > 0) {
          try {
            const priceData = await marketDataService.getTokenPrice(symbol);
            positions.push({
              symbol,
              value: alloc.valueUSD,
              change24h: priceData.change24h || 0,
              balance: alloc.amount,
            });
          } catch (err) {
            // Use stored price data if real-time fails
            positions.push({
              symbol,
              value: alloc.valueUSD,
              change24h: 0,
              balance: alloc.amount,
            });
          }
        }
      }

      // Calculate drawdown from rolling peak (DB-persisted) instead of hardcoded inception
      // This catches drawdowns even when share price is above $1.00
      const INCEPTION_SHARE_PRICE = 1.0;
      let peakSharePrice = INCEPTION_SHARE_PRICE;
      try {
        const { getNavHistory } = await import('@/lib/db/community-pool');
        const navHistory = await getNavHistory(30); // Last 30 days
        if (navHistory && navHistory.length > 0) {
          const historicalPeak = Math.max(...navHistory.map(h => h.share_price || 0));
          peakSharePrice = Math.max(peakSharePrice, historicalPeak, marketSharePrice);
        } else {
          peakSharePrice = Math.max(INCEPTION_SHARE_PRICE, marketSharePrice);
        }
      } catch {
        peakSharePrice = Math.max(INCEPTION_SHARE_PRICE, marketSharePrice);
      }
      const drawdownPercent = marketSharePrice < peakSharePrice
        ? ((peakSharePrice - marketSharePrice) / peakSharePrice) * 100
        : 0;

      // ==========================================
      // CRITICAL: Share Price vs Par Value Check
      // ==========================================
      // Share price should be >= $1.00. Any deviation below is a LOSS.
      const sharePriceDeviationFromPar = INCEPTION_SHARE_PRICE - marketSharePrice;
      const sharePriceLossPercent = (sharePriceDeviationFromPar / INCEPTION_SHARE_PRICE) * 100;
      const isBelowPar = marketSharePrice < INCEPTION_SHARE_PRICE;

      if (isBelowPar) {
        logger.warn('[AutoHedging] ⚠️ SHARE PRICE BELOW PAR - HEDGING REQUIRED', {
          currentSharePrice: marketSharePrice.toFixed(6),
          parValue: INCEPTION_SHARE_PRICE.toFixed(2),
          deviationPercent: sharePriceLossPercent.toFixed(2) + '%',
        });
      }

      logger.info('[AutoHedging] Community Pool market NAV', { 
        onChainNAV,
        marketNAV,
        totalShares,
        marketSharePrice, 
        peakSharePrice,
        inceptionPrice: INCEPTION_SHARE_PRICE, 
        drawdownPercent: drawdownPercent.toFixed(2) + '%',
        sharePriceLossFromPar: sharePriceLossPercent.toFixed(2) + '%',
        isBelowPar,
      });

      const volatility = this.calculateVolatility(positions);
      const concentrationRisk = this.calculateConcentrationRisk(positions, marketNAV);

      // ==========================================
      // AGGRESSIVE Risk Score - Protect $1.00 Par
      // ==========================================
      // Goal: Keep share price at or above $1.00
      // ANY deviation below $1.00 requires immediate hedging action
      let riskScore = 1;
      
      // MOST IMPORTANT: Share price below par
      if (isBelowPar) {
        if (sharePriceLossPercent >= 5) riskScore += 4;      // 5%+ below par = CRITICAL
        else if (sharePriceLossPercent >= 3) riskScore += 3; // 3%+ below par = HIGH
        else if (sharePriceLossPercent >= 2) riskScore += 3; // 2%+ below par = HIGH
        else if (sharePriceLossPercent >= 1) riskScore += 2; // 1%+ below par = ELEVATED
        else riskScore += 1;                                  // Any loss = WARNING
      }
      
      // Drawdown from peak (additional)
      if (drawdownPercent > 0.5) riskScore += 1;  // Even small losses matter
      if (drawdownPercent > 1.5) riskScore += 1;  // Moderate loss
      if (drawdownPercent > 4) riskScore += 1;    // Significant loss
      
      // Volatility
      if (volatility > 1.5) riskScore += 1;       // Lower vol threshold
      if (volatility > 3) riskScore += 1;         // High volatility
      
      // Concentration risk
      if (concentrationRisk > 30) riskScore += 1; // Any concentration risk
      if (concentrationRisk > 45) riskScore += 1; // High concentration
      
      // Any negative 24h change across positions adds risk
      const anyNegative = positions.some(p => p.change24h < -1);
      if (anyNegative) riskScore += 1;

      // 🔮 MULTI-SOURCE PREDICTION AGGREGATION: Combine multiple markets for optimal hedging
      // Uses: Polymarket 5-min, Delphi Digital, Crypto.com, Funding Rate proxy
      let aggregatedPrediction: AggregatedPrediction | null = null;
      try {
        aggregatedPrediction = await PredictionAggregatorService.getAggregatedPrediction();
        
        if (aggregatedPrediction && aggregatedPrediction.consensus > 50) {
          // High consensus + bearish direction = elevated risk
          if (aggregatedPrediction.direction === 'DOWN') {
            // Scale risk increase by confidence and consensus
            const riskIncrease = aggregatedPrediction.confidence >= 70 ? 2 : 
                                 aggregatedPrediction.confidence >= 55 ? 1 : 0;
            if (riskIncrease > 0) {
              riskScore += riskIncrease;
              logger.info('[AutoHedging] Aggregated prediction elevated risk (bearish consensus)', {
                direction: aggregatedPrediction.direction,
                confidence: aggregatedPrediction.confidence,
                consensus: aggregatedPrediction.consensus,
                recommendation: aggregatedPrediction.recommendation,
                sizeMultiplier: aggregatedPrediction.sizeMultiplier,
                sourcesUsed: aggregatedPrediction.sources.length,
                addedRisk: riskIncrease,
              });
            }
          }
          // Strong bullish consensus with high confidence can reduce risk
          else if (aggregatedPrediction.direction === 'UP' && 
                   aggregatedPrediction.confidence >= 65 && 
                   aggregatedPrediction.consensus >= 70) {
            riskScore = Math.max(1, riskScore - 1);
            logger.info('[AutoHedging] Aggregated prediction reduced risk (strong bullish consensus)', {
              direction: aggregatedPrediction.direction,
              confidence: aggregatedPrediction.confidence,
              consensus: aggregatedPrediction.consensus,
            });
          }
        }
        
        logger.info('[AutoHedging] Multi-source prediction aggregation complete', {
          direction: aggregatedPrediction?.direction,
          confidence: aggregatedPrediction?.confidence,
          consensus: aggregatedPrediction?.consensus,
          recommendation: aggregatedPrediction?.recommendation,
          sizeMultiplier: aggregatedPrediction?.sizeMultiplier,
          sourceCount: aggregatedPrediction?.sources.length,
        });
      } catch (predictionErr) {
        logger.debug('[AutoHedging] Prediction aggregation unavailable (non-critical)', { 
          error: predictionErr instanceof Error ? predictionErr.message : String(predictionErr) 
        });
      }

      riskScore = Math.min(riskScore, 10);

      // Fetch active hedges for community pool (gracefully handle DB unavailability)
      let activeHedges: Array<{ asset: string; side: string; size: number; notionalValue: number }> = [];
      try {
        const hedgesResult = await query(
          `SELECT asset, side, size, notional_value
           FROM hedges
           WHERE portfolio_id = $1 AND status = 'active'`,
          [COMMUNITY_POOL_PORTFOLIO_ID]
        );

        activeHedges = hedgesResult.map(h => ({
          asset: String(h.asset || ''),
          side: String(h.side || ''),
          size: parseFloat(String(h.size)) || 0,
          notionalValue: parseFloat(String(h.notional_value)) || 0,
        }));
      } catch (dbError) {
        logger.warn('[AutoHedging] Could not fetch active hedges from DB (continuing without)', {
          error: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }

      // Generate recommendations - convert allocations to Record<string, number>
      const allocationPercentages: Record<string, number> = {};
      for (const [symbol, data] of Object.entries(marketAllocations)) {
        const alloc = data as { amount: number; price: number; valueUSD: number; percentage: number };
        allocationPercentages[symbol] = alloc.percentage;
      }
      
      const recommendations = this.generateHedgeRecommendations(
        positions,
        marketNAV,
        allocationPercentages,
        activeHedges,
        drawdownPercent,
        concentrationRisk
      );

      logger.info('[AutoHedging] CommunityPool risk assessment', {
        marketNAV: `$${marketNAV.toLocaleString()}`,
        positions: positions.length,
        drawdownPercent: drawdownPercent.toFixed(2),
        volatility: volatility.toFixed(2),
        riskScore,
        aggregatedPrediction: aggregatedPrediction ? {
          direction: aggregatedPrediction.direction,
          confidence: aggregatedPrediction.confidence,
          consensus: aggregatedPrediction.consensus,
          recommendation: aggregatedPrediction.recommendation,
          sizeMultiplier: aggregatedPrediction.sizeMultiplier,
          sourceCount: aggregatedPrediction.sources.length,
        } : null,
        recommendations: recommendations.length,
      });

      // Get AI agent analysis via orchestrator for enhanced risk assessment
      // This engages RiskAgent, HedgingAgent, and other specialized agents
      try {
        const orchestrator = getAgentOrchestrator();
        
        // Run parallel agent analysis for comprehensive pool management
        const [riskAnalysis, hedgeAnalysis] = await Promise.all([
          orchestrator.assessRisk({
            address: COMMUNITY_POOL_ADDRESS, // Use constant from @/lib/constants
            portfolioData: {
              portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
              type: 'community_pool',
              positions,
              allocations: allocationPercentages,
              totalValue: marketNAV,
              drawdownPercent,
              volatility,
            },
          }),
          orchestrator.generateHedgeRecommendations({
            portfolioId: String(COMMUNITY_POOL_PORTFOLIO_ID),
            assetSymbol: positions[0]?.symbol || 'BTC',
            notionalValue: marketNAV,
          }),
        ]);

        // Log agent results
        logger.info('[AutoHedging] CommunityPool AI agents analysis complete', {
          riskAgentSuccess: riskAnalysis.success,
          hedgeAgentSuccess: hedgeAnalysis.success,
          riskAgentTime: `${riskAnalysis.executionTime}ms`,
          hedgeAgentTime: `${hedgeAnalysis.executionTime}ms`,
        });

        // Enhance recommendations with agent insights if available
        if (hedgeAnalysis.success && hedgeAnalysis.data) {
          const agentHedgeData = hedgeAnalysis.data as { recommendations?: Array<{ asset: string; action: string; confidence: number }> };
          if (agentHedgeData.recommendations?.length) {
            logger.info('[AutoHedging] HedgingAgent provided recommendations for pool', {
              count: agentHedgeData.recommendations.length,
            });
          }
        }
      } catch (agentError) {
        // Non-critical: manual analysis still valid, agents are enhancement
        logger.warn('[AutoHedging] Agent orchestrator analysis failed (continuing with manual assessment)', {
          error: agentError instanceof Error ? agentError.message : String(agentError),
        });
      }

      return {
        portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
        totalValue: marketNAV,
        drawdownPercent,
        volatility,
        riskScore,
        recommendations,
        aggregatedPrediction: aggregatedPrediction ? {
          direction: aggregatedPrediction.direction,
          confidence: aggregatedPrediction.confidence,
          consensus: aggregatedPrediction.consensus,
          recommendation: aggregatedPrediction.recommendation,
          sizeMultiplier: aggregatedPrediction.sizeMultiplier,
          sources: aggregatedPrediction.sources.map(s => ({
            name: s.name,
            available: true, // All sources in the array have been fetched
            weight: s.weight,
            direction: s.direction,
            confidence: s.confidence,
          })),
        } : null,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('[AutoHedging] CommunityPool risk assessment failed — treating as ELEVATED risk', { error });
      // CRITICAL: Unknown state = elevated risk, NOT safe default
      // If we can't assess the pool, assume something is wrong
      return {
        portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
        totalValue: 0,
        drawdownPercent: 0,
        volatility: 0,
        riskScore: 5, // Elevated — triggers investigation
        recommendations: [],
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Fetch comprehensive portfolio data from on-chain sources (blockchain)
   * Uses RWAManager contract for trustless data retrieval
   */
  private async fetchPortfolioData(portfolioId: number, walletAddress: string): Promise<{
    totalValue: number;
    positions: Array<{ symbol: string; value: number; change24h: number; balance: number }>;
    allocations: Record<string, number>;
    riskMetrics: { volatility: number; sharpeRatio: number; maxDrawdown: number };
    activeHedges: Array<{ asset: string; side: string; size: number; notionalValue: number }>;
  }> {
    try {
      // Setup on-chain connection
      const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org');
      const addresses = getContractAddresses(338); // Cronos Testnet
      const rwaManager = new ethers.Contract(addresses.rwaManager, RWA_MANAGER_ABI, provider);
      const marketDataService = getMarketDataService();

      // Read portfolio data from blockchain
      const portfolioData = await rwaManager.portfolios(portfolioId);
      const [owner, totalValueBN, targetYield, riskTolerance, lastRebalance, isActive] = portfolioData;
      
      if (!isActive) {
        logger.warn('[AutoHedging] Portfolio inactive on-chain', { portfolioId });
        return this.emptyPortfolioData(portfolioId);
      }

      // Get portfolio assets from contract
      const assetAddresses = await rwaManager.getPortfolioAssets(portfolioId);
      
      let totalValue = 0;
      let positions: Array<{ symbol: string; value: number; change24h: number; balance: number }> = [];

      // Read asset allocations from contract
      for (const assetAddress of assetAddresses) {
        const allocation = await rwaManager.getAssetAllocation(portfolioId, assetAddress);
        const addr = assetAddress.toLowerCase();
        
        // MockUSDC = institutional portfolio with virtual allocations
        if (addr === '0x28217daddc55e3c4831b4a48a00ce04880786967') {
          const mockUsdcValue = Number(allocation) / 1e6; // 6 decimals
          
          // Large portfolio? Create virtual BTC/ETH/CRO/SUI allocations
          if (mockUsdcValue > 1000000) {
            totalValue = mockUsdcValue;
            const virtualAllocations = [
              { symbol: 'BTC', percentage: 35 },
              { symbol: 'ETH', percentage: 30 },
              { symbol: 'CRO', percentage: 20 },
              { symbol: 'SUI', percentage: 15 },
            ];
            
            // Fetch live prices and calculate positions
            for (const alloc of virtualAllocations) {
              try {
                const priceData = await marketDataService.getTokenPrice(alloc.symbol);
                const price = priceData.price;
                const change24h = priceData.change24h || 0;
                const value = mockUsdcValue * (alloc.percentage / 100);
                const balance = value / price;
                
                positions.push({
                  symbol: alloc.symbol,
                  value,
                  change24h,
                  balance,
                });
              } catch (error) {
                logger.warn(`[AutoHedging] Failed to fetch price for ${alloc.symbol}`, { error });
              }
            }
          }
        }
      }

      // Calculate allocations
      const allocations: Record<string, number> = {};
      positions.forEach(p => {
        allocations[p.symbol] = (p.value / totalValue) * 100;
      });

      // Calculate on-chain risk metrics from positions
      const volatility = this.calculateVolatility(positions);
      const maxDrawdown = this.calculateDrawdown(positions, totalValue);
      const riskMetrics = {
        volatility,
        sharpeRatio: 0, // Not calculable from on-chain data alone
        maxDrawdown,
      };

      // Fetch active hedges (kept in database for internal tracking)
      const hedgesResult = await query(
        `SELECT asset, side, size, notional_value
         FROM hedges
         WHERE portfolio_id = $1 AND status = 'active'`,
        [portfolioId]
      );
      
      const activeHedges = hedgesResult.map(h => ({
        asset: String(h.asset || ''),
        side: String(h.side || ''),
        size: parseFloat(String(h.size)) || 0,
        notionalValue: parseFloat(String(h.notional_value)) || 0,
      }));

      logger.info('[AutoHedging] Fetched on-chain portfolio data', {
        portfolioId,
        totalValue: `$${totalValue.toLocaleString()}`,
        positions: positions.length,
        activeHedges: activeHedges.length,
      });

      return {
        totalValue,
        positions,
        allocations,
        riskMetrics,
        activeHedges,
      };
    } catch (error) {
      logger.error('[AutoHedging] Failed to fetch on-chain portfolio data', { error, portfolioId });
      return this.emptyPortfolioData(portfolioId);
    }
  }

  /**
   * Return empty portfolio data structure
   */
  private async emptyPortfolioData(portfolioId: number) {
    // Still fetch hedges from DB
    const hedgesResult = await query(
      `SELECT asset, side, size, notional_value
       FROM hedges
       WHERE portfolio_id = $1 AND status = 'active'`,
      [portfolioId]
    );
    
    return {
      totalValue: 0,
      positions: [],
      allocations: {},
      riskMetrics: { volatility: 0, sharpeRatio: 0, maxDrawdown: 0 },
      activeHedges: hedgesResult.map(h => ({
        asset: String(h.asset || ''),
        side: String(h.side || ''),
        size: parseFloat(String(h.size)) || 0,
        notionalValue: parseFloat(String(h.notional_value)) || 0,
      })),
    };
  }

  /**
   * Calculate drawdown from position changes
   */
  private calculateDrawdown(positions: Array<{ value: number; change24h: number }>, totalValue: number): number {
    if (!positions.length || totalValue === 0) return 0;
    return positions.reduce((acc, pos) => {
      return acc + (pos.change24h < 0 ? Math.abs(pos.change24h) * (pos.value / totalValue) : 0);
    }, 0);
  }

  /**
   * Calculate volatility from position changes
   */
  private calculateVolatility(positions: Array<{ change24h: number }>): number {
    if (!positions.length) return 0;
    return Math.sqrt(
      positions.reduce((acc, pos) => acc + Math.pow(pos.change24h / 100, 2), 0) / positions.length
    ) * 100;
  }

  /**
   * Calculate concentration risk (largest position percentage)
   */
  private calculateConcentrationRisk(positions: Array<{ value: number }>, totalValue: number): number {
    if (!positions.length || totalValue === 0) return 0;
    const maxPosition = Math.max(...positions.map(p => p.value));
    return (maxPosition / totalValue) * 100;
  }

  /**
   * Generate hedge recommendations based on comprehensive portfolio data
   */
  private generateHedgeRecommendations(
    positions: Array<{ symbol: string; value: number; change24h: number }>,
    totalValue: number,
    allocations: Record<string, number>,
    activeHedges: Array<{ asset: string }>,
    drawdownPercent: number,
    concentrationRisk: number
  ): HedgeRecommendation[] {
    const recommendations: HedgeRecommendation[] = [];
    const hedgedAssets = new Set(activeHedges.map(h => h.asset));

    // Check each position for hedging needs — ANY loss triggers protection
    for (const pos of positions) {
      // Skip if already hedged
      if (hedgedAssets.has(pos.symbol)) continue;

      // Skip if position too small
      if (pos.value < CONFIG.MIN_HEDGE_SIZE_USD) continue;

      // Hedge assets with ANY meaningful loss (>1%)
      if (pos.change24h < -1) {
        const absChange = Math.abs(pos.change24h);
        // Scale hedge size: 1-3% loss → 20-30% of position, 3-10% → 30-50%
        const hedgeRatio = Math.min(0.5, 0.15 + absChange / 15);
        // Higher confidence for bigger losses — always above 0.7 for >1% loss
        const confidence = Math.min(0.7 + absChange / 15, 0.95);
        recommendations.push({
          asset: pos.symbol,
          side: 'SHORT',
          reason: `${pos.symbol} down ${pos.change24h.toFixed(2)}% (24h) - auto-protect against further losses`,
          suggestedSize: pos.value * hedgeRatio,
          leverage: CONFIG.DEFAULT_LEVERAGE,
          confidence,
        });
      }

      // Hedge concentrated positions (>35% of portfolio)
      const concentration = (pos.value / totalValue) * 100;
      if (concentration > 35) {
        recommendations.push({
          asset: pos.symbol,
          side: 'SHORT',
          reason: `${pos.symbol} concentration at ${concentration.toFixed(1)}% - reduce exposure`,
          suggestedSize: pos.value * ((concentration - 25) / 100),
          leverage: 2,
          confidence: 0.75,
        });
      }

      // Hedge volatile assets during portfolio drawdown (>2%)
      if (drawdownPercent > 2 && Math.abs(pos.change24h) > 3) {
        recommendations.push({
          asset: pos.symbol,
          side: 'SHORT',
          reason: `Portfolio drawdown (${drawdownPercent.toFixed(1)}%) + ${pos.symbol} volatility (${pos.change24h.toFixed(1)}%)`,
          suggestedSize: pos.value * 0.25,
          leverage: CONFIG.DEFAULT_LEVERAGE,
          confidence: 0.75,
        });
      }
    }

    // Sort by confidence (highest first)
    return recommendations.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Execute an auto-hedge recommendation
   * Validates real-time prices before execution
   */
  async executeAutoHedge(
    portfolioId: number,
    config: AutoHedgeConfig,
    recommendation: HedgeRecommendation
  ): Promise<boolean> {
    // Validate asset is allowed
    if (config.allowedAssets.length > 0 && !config.allowedAssets.includes(recommendation.asset)) {
      logger.info('[AutoHedging] Asset not in allowed list', { asset: recommendation.asset });
      return false;
    }

    // Validate leverage
    const leverage = Math.min(recommendation.leverage, config.maxLeverage);

    // ═══ VALIDATE REAL-TIME PRICE BEFORE EXECUTION ═══
    const priceContext = await getHedgeExecutionPrice(recommendation.asset, recommendation.side);
    
    if (!priceContext.validation.isValid) {
      logger.warn('[AutoHedging] Invalid price, skipping hedge', {
        asset: recommendation.asset,
        warnings: priceContext.validation.warnings,
      });
      return false;
    }

    // Log price validation details
    logger.info('[AutoHedging] Price validated for hedge execution', {
      asset: recommendation.asset,
      entryPrice: priceContext.entryPrice,
      effectivePrice: priceContext.effectivePrice,
      slippage: `${priceContext.slippageEstimate.toFixed(3)}%`,
      source: priceContext.validation.priceSource,
      staleness: `${priceContext.validation.staleness}ms`,
    });

    // Convert asset to market format (e.g., BTC -> BTC-USD-PERP)
    const market = `${recommendation.asset}-USD-PERP`;

    try {
      // Create hedge via orchestrator with validated price context
      const orchestrator = getAgentOrchestrator();
      const result = await orchestrator.executeHedge({
        market,
        side: recommendation.side,
        leverage,
        notionalValue: recommendation.suggestedSize.toString(),
      });

      if (result.success) {
        // Record in our hedges table for tracking with real price
        const orderId = `auto-hedge-${portfolioId}-${Date.now()}`;
        await createHedge({
          orderId,
          portfolioId,
          asset: recommendation.asset,
          market,
          side: recommendation.side,
          size: recommendation.suggestedSize / 1000,
          notionalValue: recommendation.suggestedSize,
          leverage,
          entryPrice: priceContext.effectivePrice,
          simulationMode: false,
          reason: `[AUTO] ${recommendation.reason}`,
          metadata: {
            confidence: recommendation.confidence,
            orchestratorResult: result.data,
            priceValidation: {
              source: priceContext.validation.priceSource,
              entryPrice: priceContext.entryPrice,
              effectivePrice: priceContext.effectivePrice,
              slippage: priceContext.slippageEstimate,
            },
          },
        });

        logger.info('[AutoHedging] Hedge executed successfully', {
          portfolioId,
          asset: recommendation.asset,
          side: recommendation.side,
          size: recommendation.suggestedSize,
          entryPrice: priceContext.effectivePrice,
        });
        return true;
      } else {
        // Orchestrator failed — fall through to simulation fallback
        logger.warn('[AutoHedging] Orchestrator execution failed, falling back to simulation', {
          error: result.error,
          asset: recommendation.asset,
        });
      }
    } catch (error) {
      logger.warn('[AutoHedging] Live execution failed, falling back to simulation', { error });
    }

    // ═══ SIMULATION FALLBACK ═══
    // When the exchange API is unavailable (Moonlander offline, no API keys, etc.),
    // record the hedge as a simulation so the system still tracks intended hedges.
    // This ensures losses are never ignored just because the exchange is down.
    try {
      const orderId = `auto-sim-${portfolioId}-${Date.now()}`;
      await createHedge({
        orderId,
        portfolioId,
        asset: recommendation.asset,
        market,
        side: recommendation.side,
        size: recommendation.suggestedSize / 1000,
        notionalValue: recommendation.suggestedSize,
        leverage,
        entryPrice: priceContext.effectivePrice,
        simulationMode: true,
        reason: `[AUTO-SIM] ${recommendation.reason} (exchange unavailable)`,
        metadata: {
          confidence: recommendation.confidence,
          simulationReason: 'exchange_unavailable',
          priceAtDecision: priceContext.effectivePrice,
          priceSource: priceContext.validation.priceSource,
        },
      });

      logger.info('[AutoHedging] Simulation hedge recorded (exchange unavailable)', {
        portfolioId,
        asset: recommendation.asset,
        side: recommendation.side,
        size: recommendation.suggestedSize,
        entryPrice: priceContext.effectivePrice,
      });
      return true;
    } catch (simError) {
      logger.error('[AutoHedging] Even simulation recording failed', { simError, recommendation });
      return false;
    }
  }

  /**
   * Get last risk assessment for a portfolio
   */
  getLastRiskAssessment(portfolioId: number): RiskAssessment | null {
    return this.lastRiskAssessments.get(portfolioId) || null;
  }

  /**
   * Manual trigger for risk assessment
   * When triggered (e.g., after rebalancing), also executes hedges if needed
   */
  async triggerRiskAssessment(portfolioId: number, walletAddress: string): Promise<RiskAssessment> {
    const assessment = await this.assessPortfolioRisk(portfolioId, walletAddress);
    this.lastRiskAssessments.set(portfolioId, assessment);
    
    // Get portfolio config
    const config = this.autoHedgeConfigs.get(portfolioId);
    
    // If auto-hedging is enabled for this portfolio and risk threshold exceeded, execute hedges
    if (config && config.enabled && assessment.riskScore >= config.riskThreshold) {
      logger.info('[AutoHedging] Risk threshold exceeded in triggered assessment', {
        portfolioId,
        riskScore: assessment.riskScore,
        threshold: config.riskThreshold,
        recommendations: assessment.recommendations.length,
      });
      
      // Execute recommended hedges with high confidence
      for (const recommendation of assessment.recommendations) {
        if (recommendation.confidence >= 0.7) {
          logger.info('[AutoHedging] Executing high-confidence hedge recommendation', {
            asset: recommendation.asset,
            side: recommendation.side,
            confidence: recommendation.confidence,
          });
          await this.executeAutoHedge(portfolioId, config, recommendation);
        }
      }
    } else if (config && config.enabled) {
      logger.info('[AutoHedging] Risk within acceptable range', {
        portfolioId,
        riskScore: assessment.riskScore,
        threshold: config.riskThreshold,
      });
    }
    
    return assessment;
  }
}

// Singleton instance
export const autoHedgingService = new AutoHedgingService();

// Auto-start the service (fire and forget)
// This ensures hedging is active as soon as the app starts
if (typeof window === 'undefined') {
  // Server-side only
  autoHedgingService.start().catch(error => {
    logger.error('[AutoHedging] Failed to auto-start service:', error);
  });
}

// Export for API routes
export { AutoHedgingService, CONFIG as AUTO_HEDGE_CONFIG };
