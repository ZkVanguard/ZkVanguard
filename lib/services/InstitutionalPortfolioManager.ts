/**
 * Institutional Portfolio Manager
 * 
 * Manages a $150M Mock USDC portfolio distributed across BTC, ETH, CRO, and SUI
 * with AI-powered risk management and real API tracking
 * 
 * Features:
 * - Large-scale position management ($150M)
 * - Real-time price tracking via Crypto.com APIs
 * - AI Risk management using specialized RiskAgent
 * - Multi-chain support (EVM + SUI)
 * - ZK-protected hedge recommendations
 */

import { logger } from '@/lib/utils/logger';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';

// Portfolio allocation configuration
export interface AllocationConfig {
  symbol: string;
  percentage: number;
  chain: 'cronos' | 'sui' | 'ethereum';
  riskWeight: number;
}

export interface InstitutionalPosition {
  symbol: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  value: number;
  pnl: number;
  pnlPercentage: number;
  allocation: number;
  chain: string;
  lastUpdated: number;
}

export interface PortfolioRiskMetrics {
  overallRiskScore: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  var95: number; // Value at Risk 95%
  concentrationRisk: number;
  liquidityScore: number;
  hedgeEffectiveness: number;
  aiRecommendations: string[];
  lastAssessment: Date;
}

export interface InstitutionalPortfolioSummary {
  portfolioId: string;
  name: string;
  initialCapital: number;
  currentValue: number;
  totalPnl: number;
  totalPnlPercentage: number;
  positions: InstitutionalPosition[];
  riskMetrics: PortfolioRiskMetrics;
  lastUpdated: Date;
  realAPITracking: boolean;
  aiRiskManagement: boolean;
}

// Default allocation for 150M Mock USDC portfolio
const DEFAULT_ALLOCATIONS: AllocationConfig[] = [
  { symbol: 'BTC', percentage: 35, chain: 'cronos', riskWeight: 0.45 },  // $52.5M
  { symbol: 'ETH', percentage: 30, chain: 'cronos', riskWeight: 0.50 },  // $45M
  { symbol: 'CRO', percentage: 20, chain: 'cronos', riskWeight: 0.55 },  // $30M
  { symbol: 'SUI', percentage: 15, chain: 'sui', riskWeight: 0.60 },     // $22.5M
];

class InstitutionalPortfolioManager {
  private portfolioId: string;
  private portfolioName: string;
  private positions: Map<string, InstitutionalPosition>;
  private initialCapital: number;
  private allocations: AllocationConfig[];
  private riskMetrics: PortfolioRiskMetrics | null = null;
  private isInitialized: boolean = false;
  private lastPriceUpdate: number = 0;
  private priceUpdateInterval: number = 30000; // 30 seconds

  constructor(
    initialCapital: number = 150_000_000, // $150M default
    portfolioName: string = 'Mock USDC Institutional Portfolio',
    allocations: AllocationConfig[] = DEFAULT_ALLOCATIONS
  ) {
    this.portfolioId = `INST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.portfolioName = portfolioName;
    this.positions = new Map();
    this.initialCapital = initialCapital;
    this.allocations = allocations;
  }

  /**
   * Initialize the portfolio with configured allocations
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      // Just refresh prices if already initialized
      await this.refreshPrices();
      return;
    }

    logger.info('🏛️ Institutional Portfolio Manager initializing...', {
      portfolioId: this.portfolioId,
      capital: `$${(this.initialCapital / 1_000_000).toFixed(0)}M`,
    });

    // Create positions based on allocations
    await this.createPositions();
    
    // Initial risk assessment with AI
    await this.assessRiskWithAI();
    
    this.isInitialized = true;
    logger.info('✅ Institutional Portfolio Manager initialized', {
      positions: this.positions.size,
      totalValue: await this.getTotalValue(),
    });
  }

  /**
   * Create positions based on allocation configuration
   */
  private async createPositions(): Promise<void> {
    logger.info('📊 Creating positions with real market prices...');
    
    const marketService = getMarketDataService();
    
    for (const allocation of this.allocations) {
      const usdAmount = this.initialCapital * (allocation.percentage / 100);
      
      try {
        const priceData = await marketService.getTokenPrice(allocation.symbol);
        const price = priceData.price;
        
        if (price > 0) {
          const amount = usdAmount / price;
          
          const position: InstitutionalPosition = {
            symbol: allocation.symbol,
            amount,
            entryPrice: price,
            currentPrice: price,
            value: usdAmount,
            pnl: 0,
            pnlPercentage: 0,
            allocation: allocation.percentage,
            chain: allocation.chain,
            lastUpdated: Date.now(),
          };
          
          this.positions.set(allocation.symbol, position);
          
          logger.info(`✅ ${allocation.symbol}: ${amount.toLocaleString()} units @ $${price.toFixed(2)} = $${(usdAmount / 1_000_000).toFixed(2)}M`, {
            source: priceData.source,
          });
        }
      } catch (error) {
        logger.error(`Failed to create ${allocation.symbol} position`, error instanceof Error ? error : undefined);
      }
    }
    
    logger.info(`📦 Created ${this.positions.size} positions`);
  }

  /**
   * Refresh all position prices using real APIs
   */
  async refreshPrices(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPriceUpdate < this.priceUpdateInterval) {
      return; // Skip if recently updated
    }
    
    logger.info('🔄 Refreshing prices from real APIs...');
    
    const marketService = getMarketDataService();
    
    for (const [symbol, position] of this.positions) {
      try {
        const priceData = await marketService.getTokenPrice(symbol);
        const newPrice = priceData.price;
        
        if (newPrice > 0) {
          position.currentPrice = newPrice;
          position.value = position.amount * newPrice;
          position.pnl = position.value - (position.amount * position.entryPrice);
          position.pnlPercentage = (position.pnl / (position.amount * position.entryPrice)) * 100;
          position.lastUpdated = now;
          
          logger.debug(`${symbol}: $${newPrice.toFixed(2)} [${priceData.source}]`);
        }
      } catch (error) {
        logger.warn(`Failed to refresh ${symbol} price`, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    this.lastPriceUpdate = now;
  }

  /**
   * Get total portfolio value
   */
  async getTotalValue(): Promise<number> {
    await this.refreshPrices();
    let total = 0;
    for (const position of this.positions.values()) {
      total += position.value;
    }
    return total;
  }

  /**
   * Assess portfolio risk using AI Risk Agent
   */
  async assessRiskWithAI(): Promise<PortfolioRiskMetrics> {
    logger.info('🤖 Running AI Risk Assessment...');
    
    const totalValue = await this.getTotalValue();
    const positions = Array.from(this.positions.values());
    
    // Build portfolio data for AI analysis
    const portfolioData = {
      totalValue,
      tokens: positions.map(pos => ({
        symbol: pos.symbol,
        balance: pos.amount,
        price: pos.currentPrice,
        usdValue: pos.value,
        allocation: pos.allocation,
        chain: pos.chain,
      })),
    };

    // Use REAL agent orchestrator for AI risk analysis
    const orchestrator = getAgentOrchestrator();
    
    try {
      const result = await orchestrator.assessRisk({
        address: this.portfolioId,
        portfolioData,
      });

      if (result.success && result.data) {
        const riskData = result.data as Record<string, unknown>;
        
        // Calculate additional institutional metrics
        const volatility = this.calculateWeightedVolatility();
        const concentrationRisk = this.calculateConcentrationRisk();
        
        this.riskMetrics = {
          overallRiskScore: Number(riskData.riskScore || 50),
          volatility,
          sharpeRatio: Number(riskData.sharpeRatio || 0),
          maxDrawdown: this.estimateMaxDrawdown(volatility),
          var95: this.calculateVaR95(totalValue, volatility),
          concentrationRisk,
          liquidityScore: this.assessLiquidity(),
          hedgeEffectiveness: Number(riskData.hedgeEffectiveness || 0),
          aiRecommendations: (riskData.recommendations as string[]) || [],
          lastAssessment: new Date(),
        };

        logger.info('✅ AI Risk Assessment complete', {
          riskScore: this.riskMetrics.overallRiskScore,
          volatility: `${(volatility * 100).toFixed(1)}%`,
          var95: `$${(this.riskMetrics.var95 / 1_000_000).toFixed(2)}M`,
        });

        return this.riskMetrics;
      }
    } catch (error) {
      logger.warn('Agent orchestrator failed, using fallback', { error: error instanceof Error ? error.message : String(error) });
    }

    // Fallback to AI service
    const aiService = getCryptocomAIService();
    try {
      const riskAssessment = await aiService.assessRisk(portfolioData);
      const volatility = this.calculateWeightedVolatility();
      const concentrationRisk = this.calculateConcentrationRisk();
      
      this.riskMetrics = {
        overallRiskScore: Number(riskAssessment.riskScore || 50),
        volatility,
        sharpeRatio: Number(riskAssessment.sharpeRatio || 0),
        maxDrawdown: this.estimateMaxDrawdown(volatility),
        var95: this.calculateVaR95(totalValue, volatility),
        concentrationRisk,
        liquidityScore: this.assessLiquidity(),
        hedgeEffectiveness: 0, // Calculated separately based on active hedges
        aiRecommendations: riskAssessment.factors.map(f => `${f.factor}: ${f.description}`),
        lastAssessment: new Date(),
      };

      return this.riskMetrics;
    } catch (error) {
      logger.error('AI risk assessment failed', error instanceof Error ? error : undefined);
      
      // Return conservative fallback metrics
      const volatility = this.calculateWeightedVolatility();
      this.riskMetrics = {
        overallRiskScore: 65,
        volatility,
        sharpeRatio: 0.5,
        maxDrawdown: this.estimateMaxDrawdown(volatility),
        var95: this.calculateVaR95(totalValue, volatility),
        concentrationRisk: this.calculateConcentrationRisk(),
        liquidityScore: this.assessLiquidity(),
        hedgeEffectiveness: 0,
        aiRecommendations: ['Consider hedging BTC exposure', 'Monitor SUI volatility'],
        lastAssessment: new Date(),
      };
      
      return this.riskMetrics;
    }
  }

  /**
   * Calculate weighted portfolio volatility
   */
  private calculateWeightedVolatility(): number {
    const volatilityMap: Record<string, number> = {
      'BTC': 0.45,
      'ETH': 0.50,
      'CRO': 0.55,
      'SUI': 0.60,
    };

    let weightedVol = 0;
    for (const allocation of this.allocations) {
      const vol = volatilityMap[allocation.symbol] || 0.50;
      weightedVol += vol * (allocation.percentage / 100);
    }
    
    return weightedVol;
  }

  /**
   * Calculate concentration risk (HHI - Herfindahl-Hirschman Index)
   */
  private calculateConcentrationRisk(): number {
    let hhi = 0;
    for (const allocation of this.allocations) {
      hhi += Math.pow(allocation.percentage, 2);
    }
    // Normalize HHI to 0-100 scale
    return Math.min(100, hhi / 100);
  }

  /**
   * Estimate maximum drawdown based on volatility
   */
  private estimateMaxDrawdown(volatility: number): number {
    // Approximate max drawdown as 2x annual volatility
    return volatility * 2;
  }

  /**
   * Calculate Value at Risk at 95% confidence
   */
  private calculateVaR95(totalValue: number, volatility: number): number {
    // Daily VaR at 95% confidence (1.645 z-score)
    const dailyVol = volatility / Math.sqrt(252);
    return totalValue * dailyVol * 1.645;
  }

  /**
   * Assess portfolio liquidity
   */
  private assessLiquidity(): number {
    // BTC/ETH are highly liquid, CRO/SUI less so
    const liquidityScores: Record<string, number> = {
      'BTC': 100,
      'ETH': 95,
      'CRO': 70,
      'SUI': 65,
    };

    let weightedLiquidity = 0;
    for (const allocation of this.allocations) {
      const liquidity = liquidityScores[allocation.symbol] || 50;
      weightedLiquidity += liquidity * (allocation.percentage / 100);
    }
    
    return weightedLiquidity;
  }

  /**
   * Get AI-powered hedge recommendations
   */
  async getHedgeRecommendations(): Promise<Record<string, unknown>> {
    logger.info('🛡️ Generating AI hedge recommendations...');
    
    const totalValue = await this.getTotalValue();
    const positions = Array.from(this.positions.values());
    
    // Find dominant asset
    const dominantAsset = positions.reduce((max, pos) => 
      pos.value > (max?.value || 0) ? pos : max
    , positions[0]);

    const orchestrator = getAgentOrchestrator();
    
    const result = await orchestrator.generateHedgeRecommendations({
      portfolioId: this.portfolioId,
      assetSymbol: dominantAsset.symbol,
      notionalValue: totalValue,
    });

    if (result.success && result.data) {
      return {
        ...result.data,
        portfolioSize: `$${(totalValue / 1_000_000).toFixed(0)}M`,
        dominantAsset: dominantAsset.symbol,
        realAgent: true,
        aiRiskManagement: true,
      };
    }

    // Fallback recommendations
    return {
      recommendations: [
        {
          strategy: 'BTC Put Protection',
          notional: totalValue * 0.35 * 0.5, // 50% of BTC position
          strike: 'ATM-10%',
          expiry: '30 days',
          reason: 'Protect largest position against drawdown',
        },
        {
          strategy: 'ETH Collar',
          notional: totalValue * 0.30 * 0.3, // 30% of ETH position
          reason: 'Cost-effective downside protection',
        },
      ],
      portfolioSize: `$${(totalValue / 1_000_000).toFixed(0)}M`,
      dominantAsset: dominantAsset.symbol,
      aiRiskManagement: true,
    };
  }

  /**
   * Get portfolio summary
   */
  async getSummary(): Promise<InstitutionalPortfolioSummary> {
    await this.refreshPrices();
    
    const totalValue = await this.getTotalValue();
    const positions = Array.from(this.positions.values());
    
    // Ensure risk metrics are current
    if (!this.riskMetrics || Date.now() - this.riskMetrics.lastAssessment.getTime() > 300000) {
      await this.assessRiskWithAI();
    }

    const totalPnl = totalValue - this.initialCapital;
    const totalPnlPercentage = (totalPnl / this.initialCapital) * 100;

    return {
      portfolioId: this.portfolioId,
      name: this.portfolioName,
      initialCapital: this.initialCapital,
      currentValue: totalValue,
      totalPnl,
      totalPnlPercentage,
      positions,
      riskMetrics: this.riskMetrics!,
      lastUpdated: new Date(),
      realAPITracking: true,
      aiRiskManagement: true,
    };
  }

  /**
   * Get positions array
   */
  getPositions(): InstitutionalPosition[] {
    return Array.from(this.positions.values());
  }
}

// Singleton instance
let institutionalPortfolioInstance: InstitutionalPortfolioManager | null = null;

export function getInstitutionalPortfolioManager(
  initialCapital?: number,
  portfolioName?: string,
  allocations?: AllocationConfig[]
): InstitutionalPortfolioManager {
  if (!institutionalPortfolioInstance) {
    institutionalPortfolioInstance = new InstitutionalPortfolioManager(
      initialCapital,
      portfolioName,
      allocations
    );
  }
  return institutionalPortfolioInstance;
}

export function resetInstitutionalPortfolioManager(): void {
  institutionalPortfolioInstance = null;
}

export { InstitutionalPortfolioManager };
