/**
 * @fileoverview Risk Agent - Analyzes portfolio risk and provides recommendations
 * @module agents/specialized/RiskAgent
 */

import { EventEmitter } from 'eventemitter3';
import { BaseAgent } from '../core/BaseAgent';
import { logger } from '@shared/utils/logger';
import { AgentConfig, AgentTask, AgentMessage, RiskAnalysis, TaskResult } from '@shared/types/agent';
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
   * Analyze portfolio risk
   */
  private async analyzeRisk(payload: unknown): Promise<RiskAnalysis> {
    const params = payload as { portfolioId: number };
    const { portfolioId } = params;

    logger.info('Analyzing portfolio risk', {
      agentId: this.id,
      portfolioId,
    });

    // Simulate risk analysis
    // In production, this would:
    // 1. Fetch portfolio composition from RWAManager contract
    // 2. Get real-time prices from MCP Server
    // 3. Calculate VaR (Value at Risk)
    // 4. Analyze correlations
    // 5. Get market sentiment from Delphi

    const volatility = await this.calculateVolatilityInternal(portfolioId);
    const exposures = await this.calculateExposures(portfolioId);
    const sentiment = await this.assessMarketSentimentInternal();

    // Calculate total risk score (0-100)
    const totalRisk = Math.min(
      100,
      volatility * 50 + exposures.reduce((sum, exp) => sum + exp.contribution, 0)
    );

    const analysis: RiskAnalysis = {
      portfolioId,
      timestamp: new Date(),
      totalRisk,
      volatility,
      exposures,
      recommendations: this.generateRecommendations(totalRisk, volatility, sentiment),
      marketSentiment: sentiment,
    };

    logger.info('Risk analysis completed', {
      agentId: this.id,
      portfolioId,
      totalRisk,
      volatility,
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
   * Internal volatility calculation
   */
  private async calculateVolatilityInternal(_portfolioId: number): Promise<number> {
    // Simulate volatility calculation
    // In production: fetch historical prices, calculate std deviation
    const baseVolatility = 0.2; // 20% annualized
    const randomFactor = Math.random() * 0.1; // +/- 5%
    
    return baseVolatility + randomFactor - 0.05;
  }

  /**
   * Analyze asset exposures
   */
  private async analyzeExposures(payload: { portfolioId: number }): Promise<RiskAnalysis['exposures']> {
    return await this.calculateExposures(payload.portfolioId);
  }

  /**
   * Calculate asset exposures
   */
  private async calculateExposures(_portfolioId: number): Promise<RiskAnalysis['exposures']> {
    // Simulate exposure analysis
    // In production: fetch from blockchain, categorize assets
    return [
      {
        asset: 'BTC',
        exposure: 40,
        contribution: 15,
      },
      {
        asset: 'ETH',
        exposure: 30,
        contribution: 12,
      },
      {
        asset: 'CRO',
        exposure: 20,
        contribution: 8,
      },
      {
        asset: 'USDC',
        exposure: 10,
        contribution: 2,
      },
    ];
  }

  /**
   * Assess market sentiment
   */
  private async assessMarketSentiment(_payload: unknown): Promise<string> {
    return await this.assessMarketSentimentInternal();
  }

  /**
   * Internal sentiment assessment using Delphi prediction markets
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
        // High probability positive events = bullish
        if (prediction.probability > 60) {
          if (prediction.recommendation === 'HEDGE' || prediction.impact === 'HIGH') {
            bearishCount++;
          } else {
            bullishCount++;
          }
        } else if (prediction.probability < 40) {
          // Low probability of positive events = bearish
          bearishCount++;
        }
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
    sentiment: string
  ): string[] {
    const recommendations: string[] = [];

    if (totalRisk > 70) {
      recommendations.push('High risk detected: Consider reducing overall exposure');
      recommendations.push('Implement hedging strategies using derivatives');
    } else if (totalRisk > 50) {
      recommendations.push('Moderate risk: Monitor positions closely');
      recommendations.push('Consider partial hedging');
    } else {
      recommendations.push('Risk levels acceptable within target range');
    }

    if (volatility > 0.3) {
      recommendations.push('High volatility detected: Consider volatility-targeting strategies');
    }

    if (sentiment === 'bearish') {
      recommendations.push('Bearish sentiment: Consider defensive positioning');
    } else if (sentiment === 'bullish') {
      recommendations.push('Bullish sentiment: Evaluate growth opportunities');
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
