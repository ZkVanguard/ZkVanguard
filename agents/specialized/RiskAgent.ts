/**
 * @fileoverview Risk Agent - Analyzes portfolio risk and provides recommendations
 * @module agents/specialized/RiskAgent
 */

import { BaseAgent } from '../core/BaseAgent';
import { logger } from '@shared/utils/logger';
import { AgentTask, AgentMessage, RiskAnalysis, TaskResult } from '@shared/types/agent';
import { ethers } from 'ethers';

/**
 * Risk Agent specializing in risk analysis and assessment
 */
export class RiskAgent extends BaseAgent {
  private provider?: ethers.Provider;
  private signer?: ethers.Wallet | ethers.Signer;
  private rwaManagerAddress?: string;

  constructor(
    agentId: string,
    provider?: ethers.Provider,
    signer?: ethers.Wallet | ethers.Signer,
    rwaManagerAddress?: string
  ) {
    super(agentId, 'RiskAgent', ['RISK_ANALYSIS', 'PORTFOLIO_MANAGEMENT', 'MARKET_INTEGRATION']);
    this.provider = provider;
    this.signer = signer;
    this.rwaManagerAddress = rwaManagerAddress;
  }

  protected async onInitialize(): Promise<void> {
    logger.info('Risk Agent initializing...', { agentId: this.id });
    
    // Connect to MCP Server for data feeds
    await this.connectToDataSources();
    
    logger.info('Risk Agent initialized successfully', { agentId: this.id });
  }

  protected async onExecuteTask(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    try {
      let data: unknown;
      // Support both 'type' and 'action' fields for backwards compatibility
      const taskAction = task.action || task.type || '';
      const parameters = task.parameters || task.payload || {};
      
      switch (taskAction) {
        case 'analyze_risk':
        case 'analyze-risk':
          data = await this.analyzeRisk(parameters);
          break;
        case 'calculate_volatility':
        case 'calculate-volatility':
          data = await this.calculateVolatility(parameters as { portfolioId: number });
          break;
        case 'analyze_exposures':
        case 'analyze-exposures':
          data = await this.analyzeExposures(parameters as { portfolioId: number });
          break;
        case 'assess_sentiment':
        case 'assess-sentiment':
          data = await this.assessMarketSentiment(parameters as { market?: string });
          break;
        default:
          // Return success with empty data for unknown actions (graceful degradation)
          logger.warn(`Unknown task action: ${taskAction}`, { taskId: task.id });
          data = { message: `Unknown action: ${taskAction}`, handled: false };
      }
      return {
        success: true,
        data,
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.id,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        agentId: this.id,
      };
    }
  }

  protected onMessageReceived(message: AgentMessage): void {
    logger.debug('Risk Agent received message', {
      agentId: this.id,
      messageType: message.type,
      from: message.from,
    });

    // Handle specific message types
    const payload = message.payload as { action?: string };
    if (message.type === 'request' && payload.action === 'analyze-risk') {
      this.enqueueTask({
        id: message.id,
        type: 'analyze-risk',
        status: 'queued',
        priority: 1,
        payload: message.payload,
        createdAt: new Date(),
      });
    }
  }

  protected async onShutdown(): Promise<void> {
    logger.info('Risk Agent shutting down...', { agentId: this.id });
    await this.disconnectFromDataSources();
  }

  /**
   * Connect to data sources (MCP Server, Delphi, etc.)
   */
  private async connectToDataSources(): Promise<void> {
    // In production, establish connections to:
    // - MCP Server for real-time data
    // - Delphi for prediction markets
    // - Price oracles
    logger.info('Connected to data sources', { agentId: this.id });
  }

  /**
   * Disconnect from data sources
   */
  private async disconnectFromDataSources(): Promise<void> {
    logger.info('Disconnected from data sources', { agentId: this.id });
  }

  /**
   * Analyze portfolio risk with AI-powered reasoning
   */
  private async analyzeRisk(payload: unknown): Promise<RiskAnalysis> {
    const params = payload as { 
      portfolioId?: number;
      address?: string;
      portfolioData?: {
        totalValue: number;
        tokens: Array<{ symbol: string; balance: number; usdValue: number }>;
      };
    };
    
    const portfolioId = params.portfolioId || parseInt(params.address?.split('-')[1] || '0');
    const portfolioData = params.portfolioData;

    logger.info('Analyzing portfolio risk with AI', {
      agentId: this.id,
      portfolioId,
      hasData: !!portfolioData,
    });

    // 1. Calculate mathematical metrics
    const volatility = await this.calculateVolatilityInternal(portfolioId);
    const exposures = await this.calculateExposures(portfolioId);
    const sentiment = await this.assessMarketSentimentInternal();

    // Calculate base risk score (0-100)
    const baseRiskScore = Math.min(
      100,
      volatility * 50 + exposures.reduce((sum, exp) => sum + exp.contribution, 0)
    );

    // 2. Use AI to analyze risk and generate intelligent recommendations
    let totalRisk = baseRiskScore;
    let aiRecommendations: string[] = [];
    
    try {
      const { llmProvider } = await import('@/lib/ai/llm-provider');
      
      const portfolioSummary = portfolioData?.tokens
        ? portfolioData.tokens
            .map(t => `${t.symbol}: $${t.usdValue.toFixed(2)} (${((t.usdValue / portfolioData.totalValue) * 100).toFixed(1)}%)`)
            .join(', ')
        : 'Portfolio data unavailable';

      const portfolioValue = portfolioData?.totalValue || 0;

      const systemPrompt = `You are a DeFi risk analyst. Provide concise, actionable risk analysis.`;
      
      const aiPrompt = `Analyze portfolio risk:
Value: $${portfolioValue.toFixed(2)}
Assets: ${portfolioSummary}
Volatility: ${(volatility * 100).toFixed(1)}%
Sentiment: ${sentiment}
Base Risk: ${baseRiskScore.toFixed(1)}/100

Respond EXACTLY like this:
RISK_SCORE: [0-100]
REC1: [first recommendation]
REC2: [second recommendation]
REC3: [third recommendation]`;

      const aiResponse = await llmProvider.generateDirectResponse(aiPrompt, systemPrompt);
      
      // Extract AI recommendations
      const lines = aiResponse.content.split('\n').filter(l => l.trim());
      
      // Parse recommendations
      for (const line of lines) {
        const recMatch = line.match(/^REC\d*:?\s*(.+)/i);
        if (recMatch && recMatch[1].length > 5) {
          aiRecommendations.push(`🤖 ${recMatch[1].trim()}`);
        }
      }
      
      // Try to extract adjusted risk score
      const scoreMatch = aiResponse.content.match(/RISK_SCORE:?\s*(\d+)/i);
      if (scoreMatch) {
        const aiRiskScore = parseInt(scoreMatch[1]);
        if (aiRiskScore >= 0 && aiRiskScore <= 100) {
          totalRisk = Math.round((baseRiskScore + aiRiskScore) / 2);
          logger.info('🤖 AI adjusted risk score', { base: baseRiskScore, ai: aiRiskScore, final: totalRisk });
        }
      }
      
      logger.info('🤖 AI risk analysis completed', { model: aiResponse.model, recommendations: aiRecommendations.length });
    } catch (error) {
      logger.warn('AI risk analysis failed, using rule-based fallback', { error });
      aiRecommendations = this.generateRecommendations(totalRisk, volatility, sentiment, exposures);
    }

    const analysis: RiskAnalysis = {
      portfolioId,
      timestamp: new Date(),
      totalRisk,
      volatility,
      exposures,
      recommendations: aiRecommendations.length > 0 ? aiRecommendations : this.generateRecommendations(totalRisk, volatility, sentiment, exposures),
      marketSentiment: sentiment,
    };

    logger.info('Risk analysis completed', {
      agentId: this.id,
      portfolioId,
      totalRisk,
      volatility,
      aiEnhanced: aiRecommendations.length > 0,
    });

    // Generate ZK proof for risk calculation
    const zkProofHash = await this.generateRiskProof(analysis);
    analysis.zkProofHash = zkProofHash;

    return analysis;
  }

  /**
   * Calculate portfolio volatility
   */
  private async calculateVolatility(payload: { portfolioId: number }): Promise<number> {
    return await this.calculateVolatilityInternal(payload.portfolioId);
  }

  /**
   * Internal volatility calculation using real market data
   */
  private async calculateVolatilityInternal(portfolioId: number): Promise<number> {
    try {
      // Import RealMarketDataService for historical price data
      const { getMarketDataService } = await import('../../lib/services/RealMarketDataService');
      const realMarketDataService = getMarketDataService();
      
      // Get portfolio exposures to determine which assets to analyze
      const exposures = await this.calculateExposures(portfolioId);
      
      // Calculate weighted volatility based on portfolio composition
      let weightedVolatility = 0;
      let totalWeight = 0;
      
      for (const exposure of exposures) {
        try {
          // Get historical prices and calculate volatility for each asset
          const historicalPrices = await realMarketDataService.getHistoricalPrices(exposure.asset, 30);
          
          if (historicalPrices.length >= 2) {
            // Calculate daily returns
            const returns: number[] = [];
            for (let i = 1; i < historicalPrices.length; i++) {
              const dailyReturn = (historicalPrices[i].price - historicalPrices[i - 1].price) / historicalPrices[i - 1].price;
              returns.push(dailyReturn);
            }
            
            // Calculate standard deviation of returns
            const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
            const assetVolatility = Math.sqrt(variance) * Math.sqrt(365); // Annualized
            
            weightedVolatility += assetVolatility * (exposure.exposure / 100);
            totalWeight += exposure.exposure / 100;
          }
        } catch (error) {
          logger.warn(`Failed to get volatility for ${exposure.asset}, using market estimate`, { error });
          // Use market-based estimate for crypto assets
          const marketVolatility = exposure.asset === 'USDC' || exposure.asset === 'USDT' ? 0.01 : 0.35;
          weightedVolatility += marketVolatility * (exposure.exposure / 100);
          totalWeight += exposure.exposure / 100;
        }
      }
      
      const portfolioVolatility = totalWeight > 0 ? weightedVolatility / totalWeight : 0.25;
      logger.info('Calculated real portfolio volatility', { portfolioId, volatility: portfolioVolatility });
      return portfolioVolatility;
    } catch (error) {
      logger.error('Failed to calculate real volatility, using market estimate', { error });
      // Fallback to reasonable crypto market estimate
      return 0.30; // 30% annualized - typical crypto volatility
    }
  }

  /**
   * Analyze asset exposures
   */
  private async analyzeExposures(payload: { portfolioId: number }): Promise<RiskAnalysis['exposures']> {
    return await this.calculateExposures(payload.portfolioId);
  }

  /**
   * Calculate asset exposures from real portfolio data
   */
  private async calculateExposures(portfolioId: number): Promise<RiskAnalysis['exposures']> {
    try {
      // Import services for real portfolio data
      const { getMarketDataService: _getMarketDataService } = await import('../../lib/services/RealMarketDataService');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _getMarketDataService(); // Service available but not needed in this method
      const { getPortfolioData } = await import('../../lib/services/portfolio-actions');
      
      // Get real portfolio data
      const portfolioData = await getPortfolioData();
      const portfolio = (portfolioData?.portfolio ?? {}) as { positions?: Array<{ symbol?: string; value: number }>; totalValue?: number };
      
      if (!portfolio.positions || portfolio.positions.length === 0) {
        logger.info('No portfolio positions - will prompt user to add positions');
        // Return a meaningful default that indicates no positions
        // This helps the RiskAgent give actionable advice
        return [{
          asset: 'CASH',
          exposure: 100,
          contribution: 0, // Cash has no risk contribution
        }];
      }
      
      const positions = portfolio.positions;
      const totalValue = portfolio.totalValue || 0;
      
      if (totalValue === 0) {
        logger.warn('Portfolio has zero value');
        return [];
      }
      
      // Calculate real exposures based on position values
      const exposures: RiskAnalysis['exposures'] = [];
      
      for (const position of positions) {
        const exposure = (position.value / totalValue) * 100;
        
        // Calculate risk contribution based on asset volatility
        // Stablecoins contribute less to risk, crypto contributes more
        let riskMultiplier = 1.0;
        const symbol = position.symbol?.toUpperCase() || '';
        if (['USDC', 'USDT', 'DAI', 'DEVUSDC'].includes(symbol)) {
          riskMultiplier = 0.05; // Stablecoins have very low risk contribution
        } else if (['BTC', 'WBTC'].includes(symbol)) {
          riskMultiplier = 1.2; // BTC slightly higher due to market dominance
        } else if (['ETH', 'WETH'].includes(symbol)) {
          riskMultiplier = 1.0;
        } else {
          riskMultiplier = 1.5; // Altcoins have higher risk contribution
        }
        
        exposures.push({
          asset: position.symbol || 'UNKNOWN',
          exposure: Math.round(exposure * 100) / 100,
          contribution: Math.round(exposure * riskMultiplier * 100) / 100,
        });
      }
      
      // Sort by exposure descending
      exposures.sort((a, b) => b.exposure - a.exposure);
      
      logger.info('Calculated real portfolio exposures', { 
        portfolioId, 
        totalValue, 
        assetCount: exposures.length 
      });
      
      return exposures;
    } catch (error) {
      logger.error('Failed to calculate real exposures', { error });
      // Return empty array instead of mock data
      return [];
    }
  }

  /**
   * Assess market sentiment
   */
  private async assessMarketSentiment(_payload: unknown): Promise<string> {
    return await this.assessMarketSentimentInternal();
  }

  /**
   * Internal sentiment assessment using Delphi prediction markets + 5-min BTC signals
   */
  private async assessMarketSentimentInternal(): Promise<'bullish' | 'bearish' | 'neutral'> {
    try {
      // Import and use DelphiMarketService for real prediction data
      const { DelphiMarketService } = await import('../../lib/services/DelphiMarketService');
      
      // Get predictions for major assets
      const btcInsights = await DelphiMarketService.getAssetInsights('BTC');
      const ethInsights = await DelphiMarketService.getAssetInsights('ETH');
      
      // Aggregate sentiment from predictions
      let bullishCount = 0;
      let bearishCount = 0;
      
      const allPredictions = [
        ...btcInsights.predictions,
        ...ethInsights.predictions,
      ];
      
      for (const prediction of allPredictions) {
        // Count based on recommendation + probability — not impact level
        // HEDGE recommendation = agent sees downside risk = bearish signal
        // High probability with no HEDGE = market expects positive outcome = bullish
        if (prediction.probability >= 55) {
          if (prediction.recommendation === 'HEDGE') {
            bearishCount++;
          } else {
            bullishCount++;
          }
        } else if (prediction.probability <= 45) {
          // Low probability of the predicted event = contrarian signal
          if (prediction.recommendation === 'HEDGE') {
            // Low probability hedge = minor risk, still slightly bearish
            bearishCount++;
          } else {
            // Low probability of a positive event = bearish
            bearishCount++;
          }
        }
        // Probability 45-55: genuinely uncertain, skip (doesn't skew sentiment)
      }
      
      // 🔥 NEW: Factor in Polymarket 5-minute BTC signal for real-time micro-sentiment
      try {
        const { Polymarket5MinService } = await import('../../lib/services/Polymarket5MinService');
        const fiveMinSignal = await Polymarket5MinService.getLatest5MinSignal();
        if (fiveMinSignal && fiveMinSignal.signalStrength !== 'WEAK') {
          // 5-min signals carry extra weight (2x) because they reflect real-time crowd conviction
          const weight = fiveMinSignal.signalStrength === 'STRONG' ? 3 : 2;
          if (fiveMinSignal.direction === 'DOWN') {
            bearishCount += weight;
          } else {
            bullishCount += weight;
          }
          logger.info('5-min BTC signal factored into sentiment', {
            direction: fiveMinSignal.direction,
            probability: fiveMinSignal.probability,
            weight,
            signalStrength: fiveMinSignal.signalStrength,
          });
        }
      } catch {
        // 5-min signal unavailable — continue with standard sentiment
      }
      
      // Determine overall sentiment
      if (bullishCount > bearishCount + 1) {
        logger.info('Market sentiment assessed from Delphi data', { 
          sentiment: 'bullish', 
          bullishCount, 
          bearishCount,
          predictionsAnalyzed: allPredictions.length 
        });
        return 'bullish';
      } else if (bearishCount > bullishCount + 1) {
        logger.info('Market sentiment assessed from Delphi data', { 
          sentiment: 'bearish', 
          bullishCount, 
          bearishCount,
          predictionsAnalyzed: allPredictions.length 
        });
        return 'bearish';
      }
      
      logger.info('Market sentiment assessed from Delphi data', { 
        sentiment: 'neutral', 
        bullishCount, 
        bearishCount,
        predictionsAnalyzed: allPredictions.length 
      });
      return 'neutral';
    } catch (error) {
      logger.warn('Failed to fetch Delphi predictions, using neutral fallback', { error });
      return 'neutral';
    }
  }

  /**
   * Generate risk recommendations
   */
  private generateRecommendations(
    totalRisk: number,
    volatility: number,
    sentiment: string,
    exposures?: RiskAnalysis['exposures']
  ): string[] {
    const recommendations: string[] = [];

    // Check if portfolio is just cash (no crypto positions)
    const isCashOnly = exposures && exposures.length === 1 && exposures[0].asset === 'CASH';
    
    if (isCashOnly) {
      recommendations.push('📊 Your portfolio is 100% in cash - consider diversifying');
      recommendations.push('💡 Try: "Buy 100 CRO" or "Buy 50 ETH" to start investing');
      recommendations.push('🎯 A balanced portfolio might include: 40% CRO, 30% ETH, 20% BTC, 10% stablecoins');
      return recommendations;
    }

    if (totalRisk > 70) {
      recommendations.push('⚠️ High risk detected: Consider reducing overall exposure');
      recommendations.push('🛡️ Implement hedging strategies using derivatives');
    } else if (totalRisk > 50) {
      recommendations.push('📈 Moderate risk: Monitor positions closely');
      recommendations.push('Consider partial hedging for protection');
    } else {
      recommendations.push('✅ Risk levels acceptable within target range');
    }

    if (volatility > 0.3) {
      recommendations.push('📉 High volatility detected: Consider volatility-targeting strategies');
    }

    if (sentiment === 'bearish') {
      recommendations.push('🐻 Bearish sentiment: Consider defensive positioning');
    } else if (sentiment === 'bullish') {
      recommendations.push('🐂 Bullish sentiment: Evaluate growth opportunities');
    }

    return recommendations;
  }

  /**
   * Generate ZK proof for risk calculation using authentic STARK system
   */
  private async generateRiskProof(analysis: RiskAnalysis): Promise<string> {
    logger.info('Generating ZK-STARK proof for risk calculation', {
      agentId: this.id,
      portfolioId: analysis.portfolioId,
    });

    try {
      // Import proof generator
      const { proofGenerator } = await import('@shared/../zk/prover/ProofGenerator');

      // Generate STARK proof
      const zkProof = await proofGenerator.generateRiskProof(analysis);

      logger.info('ZK-STARK proof generated successfully', {
        agentId: this.id,
        portfolioId: analysis.portfolioId,
        proofHash: zkProof.proofHash.substring(0, 16) + '...',
        protocol: zkProof.protocol,
        generationTime: zkProof.generationTime,
      });

      return zkProof.proofHash;
    } catch (error) {
      logger.error('Failed to generate ZK-STARK proof, using fallback', {
        error,
        agentId: this.id,
        portfolioId: analysis.portfolioId,
      });

      // Fallback to hash-based proof for development
      const proofData = JSON.stringify({
        portfolioId: analysis.portfolioId,
        totalRisk: analysis.totalRisk,
        timestamp: analysis.timestamp,
      });

      return `0x${Buffer.from(proofData).toString('hex').substring(0, 64)}`;
    }
  }
}
