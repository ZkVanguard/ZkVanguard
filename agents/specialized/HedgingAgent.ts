/**
 * Hedging Agent
 * Specialized agent for automated hedging strategies using perpetual futures
 */

import { BaseAgent } from '../core/BaseAgent';
import { AgentCapability, AgentTask, TaskResult } from '@shared/types/agent';
import { MoonlanderClient } from '@integrations/moonlander/MoonlanderClient';
import { MCPClient } from '@integrations/mcp/MCPClient';
import { logger } from '@shared/utils/logger';
import { ethers } from 'ethers';

export interface HedgeStrategy {
  strategyId: string;
  portfolioId: string;
  targetMarket: string;
  hedgeRatio: number; // 0-1, percentage of exposure to hedge
  rebalanceThreshold: number; // percentage change triggering rebalance
  stopLoss?: number; // percentage
  takeProfit?: number;
  maxLeverage: number;
  active: boolean;
}

export interface HedgeAnalysis {
  portfolioId: string;
  exposure: {
    asset: string;
    notionalValue: string;
    currentPrice: string;
    volatility: number;
  };
  recommendation: {
    action: 'OPEN' | 'CLOSE' | 'REBALANCE' | 'HOLD';
    market: string;
    side: 'LONG' | 'SHORT';
    size: string;
    leverage: number;
    reason: string;
  };
  riskMetrics: {
    portfolioVar: number; // Value at Risk
    hedgeEffectiveness: number;
    basisRisk: number;
    fundingCost: number;
  };
  timestamp: number;
}

export class HedgingAgent extends BaseAgent {
  private moonlanderClient: MoonlanderClient;
  private mcpClient: MCPClient;
  private activeStrategies: Map<string, HedgeStrategy> = new Map();
  private monitoringInterval?: NodeJS.Timeout;

  constructor(
    agentId: string,
    private provider: ethers.Provider,
    private signer: ethers.Wallet | ethers.Signer
  ) {
    super(agentId, 'HedgingAgent', [
      AgentCapability.RISK_ANALYSIS,
      AgentCapability.PORTFOLIO_MANAGEMENT,
      AgentCapability.MARKET_INTEGRATION,
    ]);

    this.moonlanderClient = new MoonlanderClient(provider, signer);
    this.mcpClient = new MCPClient();
  }

  /**
   * Initialize agent
   */
  protected async onInitialize(): Promise<void> {
    try {
      // Initialize integrations
      await this.moonlanderClient.initialize();
      await this.mcpClient.connect();

      logger.info('HedgingAgent initialized', { agentId: this.agentId });
    } catch (error) {
      logger.error('Failed to initialize HedgingAgent', { error });
      throw error;
    }
  }
  
  /**
   * Handle incoming messages
   */
  protected onMessageReceived(_message: AgentMessage): void {
    // Handle messages from other agents
  }
  
  /**
   * Cleanup on shutdown
   */
  protected async onShutdown(): Promise<void> {
    try {
      await this.mcpClient.disconnect();
      logger.info('HedgingAgent shutdown complete', { agentId: this.agentId });
    } catch (error) {
      logger.error('Error during HedgingAgent shutdown', { error });
    }
  }

  /**
   * Execute task
   */
  protected async onExecuteTask(task: AgentTask): Promise<TaskResult> {
    logger.info('Executing hedging task', { taskId: task.id, action: task.action });

    try {
      switch (task.action) {
        case 'analyze_hedge':
          return await this.analyzeHedgeOpportunity(task);
        
        case 'open_hedge':
          return await this.openHedgePosition(task);
        
        case 'close_hedge':
          return await this.closeHedgePosition(task);
        
        case 'rebalance_hedge':
          return await this.rebalanceHedge(task);
        
        case 'create_strategy':
          return await this.createHedgeStrategy(task);
        
        case 'monitor_positions':
          return await this.monitorPositions(task);
        
        default:
          throw new Error(`Unknown action: ${task.action}`);
      }
    } catch (error) {
      logger.error('Task execution failed', { taskId: task.id, error });
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: 0,
        agentId: this.agentId,
      };
    }
  }

  /**
   * Analyze hedging opportunity
   */
  private async analyzeHedgeOpportunity(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const { portfolioId, assetSymbol, notionalValue } = task.parameters;

    try {
      // Get current market data
      const priceData = await this.mcpClient.getPrice(assetSymbol);
      const volatility = await this.calculateVolatility(assetSymbol);

      // Determine hedge market (e.g., BTC-USD-PERP for BTC exposure)
      const hedgeMarket = `${assetSymbol}-USD-PERP`;
      await this.moonlanderClient.getMarketInfo(hedgeMarket);

      // Calculate optimal hedge ratio using delta-hedging approach
      const hedgeRatio = await this.calculateOptimalHedgeRatio(
        assetSymbol,
        notionalValue,
        volatility
      );

      // Get funding rate (cost of holding perpetual)
      const fundingHistory = await this.moonlanderClient.getFundingHistory(hedgeMarket, 24);
      const avgFundingRate = fundingHistory.reduce((sum, f) => sum + parseFloat(f.rate), 0) / fundingHistory.length;

      // Calculate hedge effectiveness
      const spotFutureCorrelation = await this.calculateSpotFutureCorrelation(assetSymbol);
      const hedgeEffectiveness = Math.pow(spotFutureCorrelation, 2) * 100;

      // Determine recommendation
      const shouldHedge = volatility > 0.3 && hedgeEffectiveness > 70 && Math.abs(avgFundingRate) < 0.01;
      
      const analysis: HedgeAnalysis = {
        portfolioId,
        exposure: {
          asset: assetSymbol,
          notionalValue,
          currentPrice: priceData.price.toString(),
          volatility,
        },
        recommendation: {
          action: shouldHedge ? 'OPEN' : 'HOLD',
          market: hedgeMarket,
          side: 'SHORT', // Typically short perp to hedge long spot
          size: (parseFloat(notionalValue) * hedgeRatio).toFixed(4),
          leverage: Math.min(Math.floor(1 / volatility), 5),
          reason: shouldHedge
            ? `High volatility (${(volatility * 100).toFixed(2)}%) warrants hedging`
            : 'Volatility acceptable, no immediate hedge needed',
        },
        riskMetrics: {
          portfolioVar: parseFloat(notionalValue) * volatility * 1.65, // 95% confidence
          hedgeEffectiveness,
          basisRisk: (1 - spotFutureCorrelation) * 100,
          fundingCost: avgFundingRate * 100,
        },
        timestamp: Date.now(),
      };

      return {
        success: true,
        data: analysis,
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to analyze hedge opportunity', { error });
      throw error;
    }
  }

  /**
   * Open hedge position
   */
  private async openHedgePosition(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const { market, side, notionalValue, leverage, stopLoss, takeProfit } = task.parameters;

    try {
      logger.info('Opening hedge position', { market, side, notionalValue });

      const order = await this.moonlanderClient.openHedge({
        market,
        side,
        notionalValue,
        leverage: leverage || 1,
        stopLoss,
        takeProfit,
      });

      // Log the hedge execution
      logger.info('Hedge position opened', {
        agentId: this.agentId,
        action: 'open_hedge',
        orderId: order.orderId,
        timestamp: Date.now(),
      });

      return {
        success: true,
        data: {
          orderId: order.orderId,
          market: order.market,
          side: order.side,
          size: order.size,
          avgFillPrice: order.avgFillPrice,
          status: order.status,
        },
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to open hedge position', { error });
      throw error;
    }
  }

  /**
   * Close hedge position
   */
  private async closeHedgePosition(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const { market, size } = task.parameters;

    try {
      logger.info('Closing hedge position', { market });

      const order = await this.moonlanderClient.closePosition(market, size);

      return {
        success: true,
        data: {
          orderId: order.orderId,
          market: order.market,
          closedSize: order.filledSize,
          avgExitPrice: order.avgFillPrice,
        },
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to close hedge position', { error });
      throw error;
    }
  }

  /**
   * Rebalance hedge
   */
  private async rebalanceHedge(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const { strategyId } = task.parameters;

    try {
      const strategy = this.activeStrategies.get(strategyId);
      if (!strategy) {
        throw new Error(`Strategy ${strategyId} not found`);
      }

      // Get current position
      const position = await this.moonlanderClient.getPosition(strategy.targetMarket);
      if (!position) {
        logger.warn('No position to rebalance', { strategyId });
        return {
          success: true,
          data: { action: 'none', reason: 'No position found' },
          error: null,
          executionTime: Date.now() - startTime,
          agentId: this.agentId,
        };
      }

      // Analyze current hedge effectiveness
      const analysis = await this.analyzeHedgeOpportunity({
        id: `rebalance-${strategyId}`,
        action: 'analyze_hedge',
        parameters: {
          portfolioId: strategy.portfolioId,
          assetSymbol: strategy.targetMarket.split('-')[0],
          notionalValue: position.size,
        },
        priority: 1,
        createdAt: new Date(),
      });

      if (!analysis.success || !analysis.data) {
        throw new Error('Failed to analyze hedge');
      }

      const hedgeAnalysis = analysis.data as HedgeAnalysis;
      
      // Check if rebalance is needed
      const currentSize = parseFloat(position.size);
      const targetSize = parseFloat(hedgeAnalysis.recommendation.size);
      const sizeChange = Math.abs((currentSize - targetSize) / currentSize) * 100;

      if (sizeChange > strategy.rebalanceThreshold) {
        // Adjust position size
        const adjustmentSize = Math.abs(targetSize - currentSize).toFixed(4);
        const adjustmentSide = targetSize > currentSize ? 
          (position.side === 'LONG' ? 'BUY' : 'SELL') :
          (position.side === 'LONG' ? 'SELL' : 'BUY');

        const order = await this.moonlanderClient.placeOrder({
          market: strategy.targetMarket,
          side: adjustmentSide,
          type: 'MARKET',
          size: adjustmentSize,
        });

        return {
          success: true,
          data: {
            action: 'rebalanced',
            oldSize: currentSize,
            newSize: targetSize,
            orderId: order.orderId,
          },
          error: null,
          executionTime: Date.now() - startTime,
          agentId: this.agentId,
        };
      }

      return {
        success: true,
        data: { action: 'hold', reason: 'Within rebalance threshold' },
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to rebalance hedge', { error });
      throw error;
    }
  }

  /**
   * Create hedge strategy
   */
  private async createHedgeStrategy(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const strategy: HedgeStrategy = {
      strategyId: `strategy-${Date.now()}`,
      ...task.parameters,
      active: true,
    };

    this.activeStrategies.set(strategy.strategyId, strategy);

    logger.info('Hedge strategy created', { strategyId: strategy.strategyId });

    return {
      success: true,
      data: strategy,
      error: null,
      executionTime: Date.now() - startTime,
      agentId: this.agentId,
    };
  }

  /**
   * Monitor positions
   */
  private async monitorPositions(_task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      // Get all positions
      const positions = await this.moonlanderClient.getPositions();
      
      // Calculate liquidation risks
      const risks = await this.moonlanderClient.calculateLiquidationRisk();
      
      // Check each position against strategies
      const alerts = [];
      for (const position of positions) {
        const risk = risks.find(r => r.positionId === position.positionId);
        
        if (risk && (risk.riskLevel === 'HIGH' || risk.riskLevel === 'CRITICAL')) {
          alerts.push({
            positionId: position.positionId,
            market: position.market,
            riskLevel: risk.riskLevel,
            distanceToLiquidation: risk.distanceToLiquidation,
            action: 'ADD_MARGIN_OR_REDUCE_SIZE',
          });

          // Auto-add margin if critical
          if (risk.riskLevel === 'CRITICAL') {
            const marginToAdd = (parseFloat(position.margin) * 0.5).toFixed(6);
            await this.moonlanderClient.addMargin(position.market, marginToAdd);
            logger.warn('Emergency margin added', { market: position.market, amount: marginToAdd });
          }
        }
      }

      return {
        success: true,
        data: {
          positions: positions.length,
          alerts,
          timestamp: Date.now(),
        },
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to monitor positions', { error });
      throw error;
    }
  }

  /**
   * Calculate optimal hedge ratio
   */
  private async calculateOptimalHedgeRatio(
    assetSymbol: string,
    notionalValue: string,
    volatility: number
  ): Promise<number> {
    // Simplified hedge ratio calculation
    // In production, would use regression analysis of spot vs futures
    
    // Higher volatility → higher hedge ratio
    const baseRatio = 0.5;
    const volatilityAdjustment = Math.min(volatility, 0.5);
    
    return Math.min(baseRatio + volatilityAdjustment, 1.0);
  }

  /**
   * Calculate asset volatility
   */
  private async calculateVolatility(assetSymbol: string): Promise<number> {
    try {
      const historicalPrices = await this.mcpClient.getHistoricalPrices(
        assetSymbol,
        '1d',
        30 // 30 days
      );

      // Calculate daily returns
      const returns = [];
      for (let i = 1; i < historicalPrices.length; i++) {
        const ret = (historicalPrices[i].price - historicalPrices[i - 1].price) / historicalPrices[i - 1].price;
        returns.push(ret);
      }

      // Calculate standard deviation
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance);

      // Annualize (assuming 365 days)
      return volatility * Math.sqrt(365);
    } catch (error) {
      logger.error('Failed to calculate volatility', { assetSymbol, error });
      return 0.3; // Default volatility
    }
  }

  /**
   * Calculate spot-future correlation
   */
  private async calculateSpotFutureCorrelation(_assetSymbol: string): Promise<number> {
    // Simplified correlation calculation
    // In production, would fetch perpetual funding rates and spot prices
    
    // Assume high correlation for liquid markets
    return 0.95;
  }

  /**
   * Start monitoring active strategies
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(async () => {
      try {
        this.enqueueTask({
          id: `monitor-${Date.now()}`,
          action: 'monitor_positions',
          parameters: {},
          priority: 1,
          createdAt: new Date(),
        });
      } catch (error) {
        logger.error('Monitoring error', { error });
      }
    }, intervalMs);

    logger.info('Hedge monitoring started', { intervalMs });
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      logger.info('Hedge monitoring stopped');
    }
  }

  /**
   * Shutdown agent
   */
  async shutdown(): Promise<void> {
    this.stopMonitoring();
    await this.moonlanderClient.disconnect();
    await this.mcpClient.disconnect();
    await super.shutdown();
  }
}
