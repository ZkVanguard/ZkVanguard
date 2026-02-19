/**
 * Auto-Hedging Service
 * 
 * Background service that:
 * 1. Continuously monitors portfolio risk
 * 2. Updates hedge PnL with live prices
 * 3. Auto-creates hedges when risk thresholds are exceeded
 * 4. Coordinates with multi-agent system for intelligent decisions
 */

import { logger } from '@/lib/utils/logger';
import { getActiveHedges, createHedge, type Hedge } from '@/lib/db/hedges';
import { query } from '@/lib/db/postgres';
import { cryptocomExchangeService } from './CryptocomExchangeService';
import { getAgentOrchestrator } from './agent-orchestrator';

// Configuration
const CONFIG = {
  // Update frequency
  PNL_UPDATE_INTERVAL_MS: 10000, // 10 seconds
  RISK_CHECK_INTERVAL_MS: 60000, // 1 minute
  
  // Risk thresholds
  MAX_PORTFOLIO_DRAWDOWN_PERCENT: 5, // Auto-hedge if portfolio down > 5%
  MAX_ASSET_CONCENTRATION_PERCENT: 40, // Hedge if single asset > 40%
  MIN_HEDGE_SIZE_USD: 1000, // Minimum hedge size
  
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

  /**
   * Start the auto-hedging service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.info('[AutoHedging] Already running');
      return;
    }

    this.isRunning = true;
    logger.info('[AutoHedging] Starting service...');

    // Initial PnL update
    await this.updateAllHedgePnL();

    // Start PnL update loop
    this.pnlUpdateInterval = setInterval(async () => {
      try {
        await this.updateAllHedgePnL();
      } catch (error) {
        logger.error('[AutoHedging] PnL update error', { error: error instanceof Error ? error.message : error });
      }
    }, CONFIG.PNL_UPDATE_INTERVAL_MS);

    // Start risk check loop
    this.riskCheckInterval = setInterval(async () => {
      try {
        await this.checkAllPortfolioRisks();
      } catch (error) {
        logger.error('[AutoHedging] Risk check error', { error: error instanceof Error ? error.message : error });
      }
    }, CONFIG.RISK_CHECK_INTERVAL_MS);

    logger.info('[AutoHedging] Service started', {
      pnlUpdateInterval: CONFIG.PNL_UPDATE_INTERVAL_MS,
      riskCheckInterval: CONFIG.RISK_CHECK_INTERVAL_MS,
    });

    // Enable auto-hedging for Portfolio #3 by default (institutional portfolio)
    this.enableDefaultPortfolios();
  }

  /**
   * Enable auto-hedging for default portfolios
   */
  private enableDefaultPortfolios(): void {
    // Portfolio #3 - Institutional portfolio with $153M+ allocation
    // Wallet: 0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c
    // Note: Risk threshold will be loaded from portfolio settings
    this.enableForPortfolio({
      portfolioId: 3,
      walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
      enabled: true,
      riskThreshold: 5, // Default, will be overridden by portfolio settings
      maxLeverage: CONFIG.DEFAULT_LEVERAGE,
      allowedAssets: ['BTC', 'ETH', 'CRO', 'SUI'],
    });
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
    logger.info('[AutoHedging] Service stopped');
  }

  /**
   * Enable auto-hedging for a portfolio
   * Fetches portfolio settings from on-chain data to use configured risk tolerance
   */
  enableForPortfolio(config: AutoHedgeConfig): void {
    // Fetch and apply portfolio settings asynchronously
    this.loadPortfolioSettings(config).then(updatedConfig => {
      this.autoHedgeConfigs.set(updatedConfig.portfolioId, updatedConfig);
      logger.info('[AutoHedging] Portfolio enabled with settings', {
        portfolioId: updatedConfig.portfolioId,
        riskThreshold: updatedConfig.riskThreshold,
        riskTolerance: updatedConfig.riskThreshold, // Will be fetched from portfolio
        allowedAssets: updatedConfig.allowedAssets,
      });
    }).catch(error => {
      // Fallback to provided config if fetch fails
      this.autoHedgeConfigs.set(config.portfolioId, config);
      logger.warn('[AutoHedging] Failed to load portfolio settings, using defaults', {
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
      // Query portfolio data from database
      const result = await query(
        `SELECT target_yield, risk_tolerance, portfolio_id
         FROM portfolio_snapshots 
         WHERE wallet_address = $1 
         ORDER BY snapshot_time DESC 
         LIMIT 1`,
        [config.walletAddress.toLowerCase()]
      );

      if (result.rows.length > 0) {
        const portfolio = result.rows[0];
        const riskTolerance = parseInt(portfolio.risk_tolerance) || 50;
        
        // Map risk tolerance (0-100) to risk threshold (1-10)
        // Lower tolerance = lower threshold = more aggressive hedging
        // Higher tolerance = higher threshold = less hedging
        const riskThreshold = Math.max(2, Math.min(10, Math.floor((riskTolerance / 10) * 0.8 + 2)));
        
        logger.info('[AutoHedging] Loaded portfolio settings', {
          portfolioId: config.portfolioId,
          riskTolerance,
          calculatedThreshold: riskThreshold,
        });

        return {
          ...config,
          riskThreshold,
        };
      }
      
      return config;
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
   */
  async updateAllHedgePnL(): Promise<{ updated: number; errors: number }> {
    const activeHedges = await getActiveHedges();
    
    if (activeHedges.length === 0) {
      return { updated: 0, errors: 0 };
    }

    // Get unique assets
    const uniqueAssets = [...new Set(activeHedges.map(h => h.asset))];
    
    // Fetch all prices
    const priceMap = new Map<string, number>();
    for (const asset of uniqueAssets) {
      try {
        const baseAsset = asset.replace('-PERP', '').replace('-USD-PERP', '');
        const price = await cryptocomExchangeService.getPrice(baseAsset);
        if (price) priceMap.set(asset, price);
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

        // Calculate PnL
        let pnlMultiplier: number;
        if (hedge.side === 'SHORT') {
          pnlMultiplier = (entryPrice - currentPrice) / entryPrice;
        } else {
          pnlMultiplier = (currentPrice - entryPrice) / entryPrice;
        }

        const unrealizedPnL = notionalValue * pnlMultiplier * leverage;

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
   * Check risk for all enabled portfolios
   */
  async checkAllPortfolioRisks(): Promise<void> {
    for (const [portfolioId, config] of this.autoHedgeConfigs) {
      if (!config.enabled) continue;

      try {
        const assessment = await this.assessPortfolioRisk(portfolioId, config.walletAddress);
        this.lastRiskAssessments.set(portfolioId, assessment);

        // Check if auto-hedging is needed
        if (assessment.riskScore >= config.riskThreshold) {
          logger.info('[AutoHedging] Risk threshold exceeded', {
            portfolioId,
            riskScore: assessment.riskScore,
            threshold: config.riskThreshold,
          });

          // Execute recommended hedges
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
   * Assess risk for a portfolio
   */
  async assessPortfolioRisk(portfolioId: number, walletAddress: string): Promise<RiskAssessment> {
    const orchestrator = getAgentOrchestrator();
    
    // Get portfolio analysis from agent orchestrator
    const analysisResult = await orchestrator.analyzePortfolio({
      address: walletAddress,
    });

    const portfolioData = analysisResult.data as {
      totalValue?: number;
      positions?: Array<{ symbol: string; value: number; change24h: number }>;
      riskMetrics?: { volatility?: number; drawdown?: number };
    } | null;

    const totalValue = portfolioData?.totalValue || 0;
    const positions = portfolioData?.positions || [];
    const riskMetrics = portfolioData?.riskMetrics || {};

    // Calculate drawdown from positions
    const drawdownPercent = positions.reduce((acc, pos) => {
      return acc + (pos.change24h < 0 ? Math.abs(pos.change24h) * (pos.value / totalValue) : 0);
    }, 0);

    // Calculate volatility (simplified - use 24h changes)
    const volatility = Math.sqrt(
      positions.reduce((acc, pos) => acc + Math.pow(pos.change24h / 100, 2), 0) / positions.length
    ) * 100 || 0;

    // Calculate risk score (1-10)
    let riskScore = 1;
    if (drawdownPercent > 2) riskScore += 2;
    if (drawdownPercent > 5) riskScore += 2;
    if (volatility > 3) riskScore += 2;
    if (volatility > 5) riskScore += 2;
    riskScore = Math.min(riskScore, 10);

    // Generate recommendations
    const recommendations: HedgeRecommendation[] = [];

    // Check for assets that need hedging
    for (const pos of positions) {
      // Hedge assets that are down significantly
      if (pos.change24h < -3 && pos.value > CONFIG.MIN_HEDGE_SIZE_USD) {
        recommendations.push({
          asset: pos.symbol,
          side: 'SHORT',
          reason: `${pos.symbol} down ${pos.change24h.toFixed(2)}%, hedge to protect against further losses`,
          suggestedSize: pos.value * 0.3, // 30% of position
          leverage: CONFIG.DEFAULT_LEVERAGE,
          confidence: Math.min(0.5 + Math.abs(pos.change24h) / 20, 0.95),
        });
      }

      // Check concentration risk
      const concentration = (pos.value / totalValue) * 100;
      if (concentration > CONFIG.MAX_ASSET_CONCENTRATION_PERCENT) {
        recommendations.push({
          asset: pos.symbol,
          side: 'SHORT',
          reason: `${pos.symbol} concentration at ${concentration.toFixed(1)}%, reduce exposure`,
          suggestedSize: pos.value * (concentration - 30) / 100,
          leverage: 2,
          confidence: 0.7,
        });
      }
    }

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

  /**
   * Execute an auto-hedge recommendation
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

    // Convert asset to market format (e.g., BTC -> BTC-USD-PERP)
    const market = `${recommendation.asset}-USD-PERP`;

    try {
      // Create hedge via orchestrator
      const orchestrator = getAgentOrchestrator();
      const result = await orchestrator.executeHedge({
        market,
        side: recommendation.side,
        leverage,
        notionalValue: recommendation.suggestedSize.toString(),
      });

      if (result.success) {
        // Also record in our hedges table for tracking
        const orderId = `auto-hedge-${portfolioId}-${Date.now()}`;
        await createHedge({
          orderId,
          portfolioId,
          asset: recommendation.asset,
          market,
          side: recommendation.side,
          size: recommendation.suggestedSize / 1000, // Convert to contract size
          notionalValue: recommendation.suggestedSize,
          leverage,
          simulationMode: false, // Real hedge
          reason: `[AUTO] ${recommendation.reason}`,
          metadata: {
            confidence: recommendation.confidence,
            orchestratorResult: result.data,
          },
        });

        logger.info('[AutoHedging] Hedge executed successfully', {
          portfolioId,
          asset: recommendation.asset,
          side: recommendation.side,
          size: recommendation.suggestedSize,
        });
        return true;
      } else {
        logger.warn('[AutoHedging] Hedge execution failed', {
          error: result.error,
          asset: recommendation.asset,
        });
        return false;
      }
    } catch (error) {
      logger.error('[AutoHedging] Hedge execution error', { error, recommendation });
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
