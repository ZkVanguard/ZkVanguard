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
import { getAgentOrchestrator } from './agent-orchestrator';
import { ethers } from 'ethers';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { getMarketDataService } from './RealMarketDataService';
import { getUnifiedPriceProvider, getHedgeExecutionPrice } from './unified-price-provider';
import { getAutoHedgeConfigs, type AutoHedgeConfig as StoredAutoHedgeConfig } from '@/lib/storage/auto-hedge-storage';

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

    // Load all enabled portfolios from persistent storage
    await this.loadPortfoliosFromStorage();
  }

  /**
   * Load all enabled portfolio configurations from storage
   * This replaces hardcoded portfolio IDs with dynamic database-driven configuration
   */
  private async loadPortfoliosFromStorage(): Promise<void> {
    try {
      const storedConfigs = await getAutoHedgeConfigs();
      
      if (storedConfigs.length === 0) {
        logger.warn('[AutoHedging] No stored configurations found. Use API to enable portfolios.');
        return;
      }
      
      logger.info('[AutoHedging] Loading configurations from storage', {
        count: storedConfigs.length,
        portfolios: storedConfigs.map(c => c.portfolioId)
      });
      
      for (const config of storedConfigs) {
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
      
      logger.info('[AutoHedging] All stored portfolios loaded', {
        activeCount: this.autoHedgeConfigs.size
      });
    } catch (error) {
      logger.error('[AutoHedging] Failed to load configurations from storage', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Service continues running, but with no portfolios configured
      // Use API to manually enable portfolios
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
   * Uses unified price provider for real-time prices
   */
  async updateAllHedgePnL(): Promise<{ updated: number; errors: number }> {
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
   * Assess risk for a portfolio using comprehensive data
   * Fetches positions, allocations, risk metrics, and active hedges
   */
  async assessPortfolioRisk(portfolioId: number, walletAddress: string): Promise<RiskAssessment> {
    // Special handling for CommunityPool (portfolioId = 0)
    if (portfolioId === 0) {
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
      logger.error('[AutoHedging] Risk assessment error', { portfolioId, error });
      // Return safe default
      return {
        portfolioId,
        totalValue: 0,
        drawdownPercent: 0,
        volatility: 0,
        riskScore: 1,
        recommendations: [],
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Assess risk specifically for CommunityPool TVL
   * Fetches on-chain data from CommunityPool contract
   */
  private async assessCommunityPoolRisk(): Promise<RiskAssessment> {
    const COMMUNITY_POOL_CONTRACT = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B';
    const COMMUNITY_POOL_ABI = [
      'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
    ];

    try {
      const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org');
      const poolContract = new ethers.Contract(COMMUNITY_POOL_CONTRACT, COMMUNITY_POOL_ABI, provider);
      const marketDataService = getMarketDataService();

      // Fetch on-chain pool stats
      const stats = await poolContract.getPoolStats();
      const totalNAV = Number(ethers.formatUnits(stats._totalNAV, 6));
      // Share price is in 6 decimals (USDC-based calculation)
      const rawSharePrice = stats._sharePrice;
      const sharePrice = Number(ethers.formatUnits(rawSharePrice, 6));
      const allocations = {
        BTC: Number(stats._allocations[0]) / 100,
        ETH: Number(stats._allocations[1]) / 100,
        SUI: Number(stats._allocations[2]) / 100,
        CRO: Number(stats._allocations[3]) / 100,
      };

      logger.info('[AutoHedging] Community Pool stats', { 
        totalNAV, 
        rawSharePrice: rawSharePrice.toString(), 
        sharePrice, 
        allocations 
      });

      // Build positions from allocations
      const positions: Array<{ symbol: string; value: number; change24h: number; balance: number }> = [];
      
      for (const [symbol, percentage] of Object.entries(allocations)) {
        if (percentage > 0) {
          try {
            const priceData = await marketDataService.getTokenPrice(symbol);
            const value = totalNAV * (percentage / 100);
            positions.push({
              symbol,
              value,
              change24h: priceData.change24h || 0,
              balance: value / priceData.price,
            });
          } catch (err) {
            logger.warn(`[AutoHedging] Failed to fetch price for ${symbol}`, { error: err });
          }
        }
      }

      // Calculate drawdown from inception share price of $1.00
      // This is the true loss since pool creation, not just 24h token changes
      const INCEPTION_SHARE_PRICE = 1.0;
      const drawdownPercent = sharePrice < INCEPTION_SHARE_PRICE 
        ? ((INCEPTION_SHARE_PRICE - sharePrice) / INCEPTION_SHARE_PRICE) * 100 
        : 0;

      logger.info('[AutoHedging] Drawdown calculation', { 
        sharePrice, 
        inceptionPrice: INCEPTION_SHARE_PRICE, 
        sharePriceLessThanInception: sharePrice < INCEPTION_SHARE_PRICE,
        drawdownPercent 
      });

      const volatility = this.calculateVolatility(positions);
      const concentrationRisk = this.calculateConcentrationRisk(positions, totalNAV);

      // Calculate risk score (more conservative thresholds for community funds)
      let riskScore = 1;
      if (drawdownPercent > 1) riskScore += 1;
      if (drawdownPercent > 3) riskScore += 2;
      if (drawdownPercent > 7) riskScore += 2;
      if (volatility > 2) riskScore += 1;
      if (volatility > 4) riskScore += 1;
      if (concentrationRisk > 35) riskScore += 2;
      if (concentrationRisk > 50) riskScore += 1;
      riskScore = Math.min(riskScore, 10);

      // Fetch active hedges for community pool
      const hedgesResult = await query(
        `SELECT asset, side, size, notional_value
         FROM hedges
         WHERE portfolio_id = 0 AND status = 'active'`,
        []
      );

      const activeHedges = hedgesResult.map(h => ({
        asset: String(h.asset || ''),
        side: String(h.side || ''),
        size: parseFloat(String(h.size)) || 0,
        notionalValue: parseFloat(String(h.notional_value)) || 0,
      }));

      // Generate recommendations
      const recommendations = this.generateHedgeRecommendations(
        positions,
        totalNAV,
        allocations as Record<string, number>,
        activeHedges,
        drawdownPercent,
        concentrationRisk
      );

      logger.info('[AutoHedging] CommunityPool risk assessment', {
        totalNAV: `$${totalNAV.toLocaleString()}`,
        positions: positions.length,
        drawdownPercent: drawdownPercent.toFixed(2),
        volatility: volatility.toFixed(2),
        riskScore,
        recommendations: recommendations.length,
      });

      return {
        portfolioId: 0,
        totalValue: totalNAV,
        drawdownPercent,
        volatility,
        riskScore,
        recommendations,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('[AutoHedging] CommunityPool risk assessment failed', { error });
      return {
        portfolioId: 0,
        totalValue: 0,
        drawdownPercent: 0,
        volatility: 0,
        riskScore: 1,
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

    // Check each position for hedging needs
    for (const pos of positions) {
      // Skip if already hedged
      if (hedgedAssets.has(pos.symbol)) continue;

      // Skip if position too small
      if (pos.value < CONFIG.MIN_HEDGE_SIZE_USD) continue;

      // Hedge assets with significant losses
      if (pos.change24h < -3) {
        recommendations.push({
          asset: pos.symbol,
          side: 'SHORT',
          reason: `${pos.symbol} down ${pos.change24h.toFixed(2)}% (24h) - protect against further losses`,
          suggestedSize: pos.value * Math.min(0.5, Math.abs(pos.change24h) / 10), // Scale with loss
          leverage: CONFIG.DEFAULT_LEVERAGE,
          confidence: Math.min(0.6 + Math.abs(pos.change24h) / 20, 0.95),
        });
      }

      // Hedge concentrated positions
      const concentration = (pos.value / totalValue) * 100;
      if (concentration > CONFIG.MAX_ASSET_CONCENTRATION_PERCENT) {
        recommendations.push({
          asset: pos.symbol,
          side: 'SHORT',
          reason: `${pos.symbol} concentration at ${concentration.toFixed(1)}% - reduce exposure`,
          suggestedSize: pos.value * ((concentration - 30) / 100),
          leverage: 2,
          confidence: 0.75,
        });
      }

      // Hedge volatile assets during high portfolio drawdown
      if (drawdownPercent > 5 && Math.abs(pos.change24h) > 5) {
        recommendations.push({
          asset: pos.symbol,
          side: pos.change24h < 0 ? 'SHORT' : 'SHORT', // Always hedge with short
          reason: `High portfolio drawdown (${drawdownPercent.toFixed(1)}%) + ${pos.symbol} volatility`,
          suggestedSize: pos.value * 0.25,
          leverage: CONFIG.DEFAULT_LEVERAGE,
          confidence: 0.7,
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
        // Also record in our hedges table for tracking with real price
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
          entryPrice: priceContext.effectivePrice, // Use validated price
          simulationMode: false, // Real hedge
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
