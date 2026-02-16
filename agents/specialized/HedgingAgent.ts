/**
 * Hedging Agent
 * Specialized agent for automated hedging strategies using perpetual futures
 */

import { BaseAgent } from '../core/BaseAgent';
import { AgentCapability, AgentTask, TaskResult, AgentMessage } from '@shared/types/agent';
import { MoonlanderClient, OrderResult, PerpetualPosition, LiquidationRisk } from '@integrations/moonlander/MoonlanderClient';
import { MCPClient } from '@integrations/mcp/MCPClient';
import { HedgeExecutorClient, HedgeExecutorConfig, OnChainHedgeResult } from '@integrations/hedge-executor/HedgeExecutorClient';
import { DelphiMarketService } from '../../lib/services/DelphiMarketService';
import { logger } from '@shared/utils/logger';
import { ethers } from 'ethers';

/** Extended client interface for duck-typing compatibility with varying implementations */
interface MoonlanderClientExt {
  openHedge?: (params: { market: string; side: 'LONG' | 'SHORT'; notionalValue: string; leverage?: number; stopLoss?: string; takeProfit?: string }) => Promise<OrderResult>;
  createOrder?: (params: Record<string, unknown>) => Promise<OrderResult>;
  getPosition?: (market: string) => Promise<PerpetualPosition | null>;
  getPositions?: () => Promise<PerpetualPosition[]>;
  calculateLiquidationRisk?: () => Promise<LiquidationRisk[]>;
}

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
  private hedgeExecutorClient?: HedgeExecutorClient;
  private useOnChainExecution: boolean = false;
  private activeStrategies: Map<string, HedgeStrategy> = new Map();
  private onChainHedges: Map<string, OnChainHedgeResult> = new Map();
  private monitoringInterval?: NodeJS.Timeout;

  constructor(
    agentId: string,
    private provider: ethers.Provider,
    private signer: ethers.Wallet | ethers.Signer,
    hedgeExecutorConfig?: HedgeExecutorConfig
  ) {
    super(agentId, 'HedgingAgent', [
      AgentCapability.RISK_ANALYSIS,
      AgentCapability.PORTFOLIO_MANAGEMENT,
      AgentCapability.MARKET_INTEGRATION,
    ]);

    this.moonlanderClient = new MoonlanderClient(provider, signer);
    this.mcpClient = new MCPClient();

    // Enable on-chain execution if config provided
    if (hedgeExecutorConfig) {
      this.hedgeExecutorClient = new HedgeExecutorClient(hedgeExecutorConfig);
      this.useOnChainExecution = true;
      logger.info('HedgingAgent: On-chain execution enabled via HedgeExecutor', {
        contract: hedgeExecutorConfig.contractAddress,
      });
    }
  }

  /**
   * Enable/disable on-chain execution at runtime
   */
  setOnChainExecution(enabled: boolean) {
    if (enabled && !this.hedgeExecutorClient) {
      throw new Error('HedgeExecutorClient not configured');
    }
    this.useOnChainExecution = enabled;
    logger.info(`On-chain execution ${enabled ? 'enabled' : 'disabled'}`);
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
    // Support both 'action' and 'type' fields for compatibility with LeadAgent
    const taskAction = task.action || task.type || '';
    logger.info('Executing hedging task', { taskId: task.id, action: taskAction });

    try {
      switch (taskAction) {
        case 'analyze_hedge':
        case 'analyze-hedge':
          return await this.analyzeHedgeOpportunity(task);
        
        case 'open_hedge':
        case 'open-hedge':
          return await this.openHedgePosition(task);
        
        case 'close_hedge':
        case 'close-hedge':
          return await this.closeHedgePosition(task);
        
        case 'rebalance_hedge':
        case 'rebalance-hedge':
          return await this.rebalanceHedge(task);
        
        case 'create_strategy':
        case 'create-strategy':
        case 'create_hedge':
        case 'create-hedge':
          return await this.createHedgeStrategy(task);
        
        case 'monitor_positions':
        case 'monitor-positions':
          return await this.monitorPositions(task);
        
        default:
          // Return error for unknown actions
          logger.warn(`Unknown hedging action: ${taskAction}`, { taskId: task.id });
          return {
            success: false,
            data: null,
            error: `Unknown action: ${taskAction}`,
            executionTime: 0,
            agentId: this.agentId,
          };
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
   * Analyze hedging opportunity with Delphi prediction markets
   */
  private async analyzeHedgeOpportunity(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const { portfolioId, assetSymbol, notionalValue } = task.parameters as { portfolioId: string; assetSymbol: string; notionalValue: number };

    if (!portfolioId || !assetSymbol || !notionalValue) {
      throw new Error('Missing required parameters: portfolioId, assetSymbol, or notionalValue');
    }

    try {
      // Get current market data
      const priceData = await this.mcpClient.getPrice(assetSymbol);
      if (!priceData) {
        throw new Error(`Could not retrieve price data for ${assetSymbol}`);
      }
      const volatility = await this.calculateVolatility(assetSymbol);

      // 🔮 NEW: Get Delphi prediction market insights
      const delphiInsights = await DelphiMarketService.getAssetInsights(assetSymbol);
      const highRiskPredictions = delphiInsights.predictions.filter(p => 
        p.impact === 'HIGH' && p.probability > 60 && p.recommendation === 'HEDGE'
      );

      // ⚡ NEW: Get Polymarket 5-minute BTC signal for real-time micro-hedging
      let fiveMinSignal: import('../../lib/services/Polymarket5MinService').FiveMinBTCSignal | null = null;
      let fiveMinSignalHistory: import('../../lib/services/Polymarket5MinService').FiveMinSignalHistory | null = null;
      try {
        const { Polymarket5MinService } = await import('../../lib/services/Polymarket5MinService');
        fiveMinSignal = await Polymarket5MinService.getLatest5MinSignal();
        fiveMinSignalHistory = Polymarket5MinService.getSignalHistory();
        if (fiveMinSignal) {
          logger.info('5-min BTC signal available for hedge analysis', {
            direction: fiveMinSignal.direction,
            probability: fiveMinSignal.probability,
            confidence: fiveMinSignal.confidence,
            recommendation: fiveMinSignal.recommendation,
            streak: fiveMinSignalHistory?.streak,
          });
        }
      } catch {
        logger.debug('5-min signal unavailable for hedge analysis');
      }

      // Determine hedge market (e.g., BTC-USD-PERP for BTC exposure)
      const hedgeMarket = `${assetSymbol}-USD-PERP`;
      let marketInfo;
      try {
        marketInfo = await this.moonlanderClient.getMarketInfo(hedgeMarket);
      } catch (e) {
        logger.warn('Market info unavailable, continuing with analysis', { hedgeMarket, error: e });
      }

      // Calculate optimal hedge ratio using delta-hedging approach
      // 🔮 NEW: Adjust hedge ratio based on Delphi predictions
      let hedgeRatio = await this.calculateOptimalHedgeRatio(
        assetSymbol,
        notionalValue,
        volatility
      );
      
      // Increase hedge ratio if Delphi predicts high-probability risk events
      if (highRiskPredictions.length > 0) {
        const maxPredictionProb = Math.max(...highRiskPredictions.map(p => p.probability));
        const delphiMultiplier = 1 + (maxPredictionProb - 50) / 100; // 60% prob -> 1.1x, 80% prob -> 1.3x
        hedgeRatio = Math.min(hedgeRatio * delphiMultiplier, 1.0); // Cap at 100% hedge
        logger.info('Hedge ratio adjusted based on Delphi predictions', { 
          original: hedgeRatio / delphiMultiplier, 
          adjusted: hedgeRatio,
          delphiMultiplier,
          predictions: highRiskPredictions.length
        });
      }

      // ⚡ NEW: Further adjust hedge ratio based on 5-min BTC signal
      // Strong DOWN signals in real-time = increase urgency of hedge
      // Strong UP signals = can slightly relax hedge ratio
      if (fiveMinSignal && assetSymbol === 'BTC' && fiveMinSignal.signalStrength !== 'WEAK') {
        const fiveMinMultiplier = fiveMinSignal.direction === 'DOWN'
          ? 1 + (fiveMinSignal.probability - 50) / 200  // DOWN: 70% prob → 1.1x boost
          : 1 - (fiveMinSignal.probability - 50) / 400; // UP: 70% prob → 0.95x slight relaxation
        
        // If there's a streak, amplify the signal
        const streakAmplifier = fiveMinSignalHistory?.streak?.direction === fiveMinSignal.direction
          && (fiveMinSignalHistory?.streak?.count ?? 0) >= 3
          ? 1.05 : 1.0;
        
        hedgeRatio = Math.min(Math.max(hedgeRatio * fiveMinMultiplier * streakAmplifier, 0.1), 1.0);
        
        logger.info('Hedge ratio adjusted by 5-min BTC signal', {
          direction: fiveMinSignal.direction,
          probability: fiveMinSignal.probability,
          fiveMinMultiplier: (fiveMinMultiplier * streakAmplifier).toFixed(3),
          adjustedHedgeRatio: hedgeRatio.toFixed(4),
          streak: fiveMinSignalHistory?.streak,
        });
      }

      // Get funding rate (cost of holding perpetual) — may fail for assets without perps
      let avgFundingRate = 0;
      try {
        const fundingHistory = await this.moonlanderClient.getFundingHistory(hedgeMarket, 24);
        avgFundingRate = fundingHistory.reduce((sum, f) => sum + parseFloat(f.rate), 0) / fundingHistory.length;
      } catch (e) {
        logger.warn('Funding rate data unavailable, using 0 (conservative)', { hedgeMarket, error: e });
      }

      // Calculate hedge effectiveness
      const spotFutureCorrelation = await this.calculateSpotFutureCorrelation(assetSymbol);
      const hedgeEffectiveness = Math.pow(spotFutureCorrelation, 2) * 100;

      // Determine recommendation
      // 🔮 NEW: Factor in Delphi predictions + 5-min signals
      const delphiRecommendHedge = delphiInsights.overallRisk === 'HIGH' || highRiskPredictions.length >= 2;
      const fiveMinRecommendHedge = fiveMinSignal?.recommendation === 'HEDGE_SHORT' && fiveMinSignal.signalStrength === 'STRONG';
      const shouldHedge = (volatility > 0.3 || delphiRecommendHedge || fiveMinRecommendHedge) && hedgeEffectiveness > 70 && Math.abs(avgFundingRate) < 0.01;
      
      // Build reason with Delphi insights + 5-min signal and AI analysis
      let reason = shouldHedge
        ? `High volatility (${(volatility * 100).toFixed(2)}%) warrants hedging`
        : 'Volatility acceptable, no immediate hedge needed';
      
      // ⚡ Append 5-min signal context when available
      if (fiveMinSignal && assetSymbol === 'BTC' && fiveMinSignal.signalStrength !== 'WEAK') {
        reason += ` | ⚡ 5-Min Signal: ${fiveMinSignal.direction} (${fiveMinSignal.probability}% prob, ${fiveMinSignal.signalStrength})`;
      }
      
      // 🤖 NEW: Use AI to enhance hedge reasoning
      try {
        const { llmProvider } = await import('@/lib/ai/llm-provider');
        
        const predictionsSummary = highRiskPredictions.length > 0
          ? highRiskPredictions.map(p => `${p.question} (${p.probability}%)`).join('; ')
          : 'No high-risk signals';

        const aiPrompt = `You are a DeFi hedging strategist. Analyze this hedge opportunity:\n\nAsset: ${assetSymbol}\nNotional Value: $${notionalValue.toFixed(2)}\nCurrent Price: $${priceData.price}\nVolatility: ${(volatility * 100).toFixed(1)}%\nHedge Ratio: ${(hedgeRatio * 100).toFixed(1)}%\nFunding Rate: ${(avgFundingRate * 100).toFixed(4)}%\nHedge Effectiveness: ${hedgeEffectiveness.toFixed(1)}%\nDelphi Signals: ${predictionsSummary}\n\nShould hedge: ${shouldHedge ? 'YES' : 'NO'}\n\nProvide:\n1. One-sentence hedge recommendation\n2. Key risk factor to monitor\n\nBe concise and actionable.`;

        const aiResponse = await llmProvider.generateResponse(aiPrompt, `hedge-${portfolioId}-${assetSymbol}`);
        const aiLines = aiResponse.content.split('\\n').filter(l => l.trim());
        if (aiLines.length > 0) {
          reason = `🤖 ${aiLines[0]} | ${reason}`;
        }
        
        logger.info('🤖 AI hedge analysis completed', { model: aiResponse.model });
      } catch (error) {
        logger.warn('AI hedge analysis failed, using rule-based reasoning', { error });
      }
      
      if (delphiRecommendHedge && highRiskPredictions.length > 0) {
        const topPrediction = highRiskPredictions[0];
        reason = `🔮 Delphi: ${topPrediction.probability}% risk - "${topPrediction.question}". ${reason}`;
      }
      
      const analysis: HedgeAnalysis = {
        portfolioId,
        exposure: {
          asset: assetSymbol,
          notionalValue: notionalValue.toString(),
          currentPrice: priceData.price.toString(),
          volatility,
        },
        recommendation: {
          action: shouldHedge ? 'OPEN' : 'HOLD',
          market: hedgeMarket,
          side: 'SHORT', // Typically short perp to hedge long spot
          size: (notionalValue * hedgeRatio).toFixed(4),
          leverage: Math.min(Math.floor(1 / volatility), marketInfo?.maxLeverage ? Math.min(marketInfo.maxLeverage, 5) : 5),
          reason,
        },
        riskMetrics: {
          portfolioVar: notionalValue * volatility * 1.65, // 95% confidence
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
      const details = error instanceof Error ? { message: error.message, stack: error.stack } : { error: String(error) };
      logger.error('Failed to analyze hedge opportunity', details);
      throw error;
    }
  }

  /**
   * Open hedge position (on-chain or off-chain based on configuration)
   */
  private async openHedgePosition(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const parameters = task.parameters as { market: string; side: 'LONG' | 'SHORT'; notionalValue: string; leverage?: number; stopLoss?: string; takeProfit?: string };
    const { market, side, notionalValue, leverage, stopLoss, takeProfit } = parameters;

    try {
      // ═══════════════════════════════════════════════════════════
      // ON-CHAIN EXECUTION (via HedgeExecutor contract)
      // ═══════════════════════════════════════════════════════════
      if (this.useOnChainExecution && this.hedgeExecutorClient) {
        logger.info('Opening ON-CHAIN hedge position', { market, side, notionalValue });

        const result = await this.hedgeExecutorClient.openHedge({
          market,
          side,
          collateralAmount: notionalValue,
          leverage: Math.min(leverage || 1, 100),
        });

        this.onChainHedges.set(result.hedgeId, result);

        return {
          success: true,
          data: {
            hedgeId: result.hedgeId,
            txHash: result.txHash,
            market,
            side,
            collateralAmount: result.collateralAmount,
            leverage: result.leverage,
            openPrice: result.openPrice,
            executionMode: 'on-chain',
            commitmentHash: result.commitmentHash,
          },
          error: null,
          executionTime: Date.now() - startTime,
          agentId: this.agentId,
        };
      }

      // ═══════════════════════════════════════════════════════════
      // OFF-CHAIN EXECUTION (legacy MoonlanderClient REST API)
      // ═══════════════════════════════════════════════════════════
      logger.info('Opening hedge position (off-chain)', { market, side, notionalValue });

      // Support multiple MoonlanderClient interfaces used in tests/mocks
      const extClient = this.moonlanderClient as unknown as MoonlanderClientExt;
      let order: OrderResult;
      if (typeof extClient.openHedge === 'function') {
        order = await extClient.openHedge({
          market,
          side,
          notionalValue,
          leverage: leverage || 1,
          stopLoss,
          takeProfit,
        });
      } else {
        const marketInfo = await this.moonlanderClient.getMarketInfo(market);
        const markPrice = parseFloat(marketInfo.markPrice || '1') || 1;
        const size = (parseFloat(notionalValue) * (leverage || 1) / markPrice).toFixed(4);

        if (typeof extClient.createOrder === 'function') {
          order = await extClient.createOrder({
            market,
            side: side === 'LONG' ? 'BUY' : 'SELL',
            type: 'MARKET',
            quantity: size,
          });
        } else {
          order = await this.moonlanderClient.placeOrder({
            market,
            side: side === 'LONG' ? 'BUY' : 'SELL',
            type: 'MARKET',
            size,
          });
        }

        // Place stop-loss if specified
        if (stopLoss) {
          const stopSide = side === 'LONG' ? 'SELL' : 'BUY';
          if (typeof extClient.createOrder === 'function') {
            await extClient.createOrder({
              market,
              side: stopSide,
              type: 'STOP_MARKET',
              quantity: size,
              stopPrice: stopLoss,
              reduceOnly: true,
              clientOrderId: `${order.orderId}-sl`,
            });
          } else {
            await this.moonlanderClient.placeOrder({
              market,
              side: stopSide,
              type: 'STOP_MARKET',
              size,
              stopPrice: stopLoss,
              reduceOnly: true,
              clientOrderId: `${order.orderId}-sl`,
            });
          }
        }

        // Place take-profit if specified
        if (takeProfit) {
          const tpSide = side === 'LONG' ? 'SELL' : 'BUY';
          if (typeof extClient.createOrder === 'function') {
            await extClient.createOrder({
              market,
              side: tpSide,
              type: 'LIMIT',
              quantity: size,
              price: takeProfit,
              reduceOnly: true,
              postOnly: true,
              clientOrderId: `${order.orderId}-tp`,
            });
          } else {
            await this.moonlanderClient.placeOrder({
              market,
              side: tpSide,
              type: 'LIMIT',
              size,
              price: takeProfit,
              reduceOnly: true,
              postOnly: true,
              clientOrderId: `${order.orderId}-tp`,
            });
          }
        }
      }

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
          leverage: Math.min(leverage || 1, 20),
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
   * Close hedge position (on-chain or off-chain)
   */
  private async closeHedgePosition(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const parameters = task.parameters as { market: string; size: string; hedgeId?: string };
    const { market, size, hedgeId } = parameters;

    try {
      // ═══════════════════════════════════════════════════════════
      // ON-CHAIN CLOSE (via HedgeExecutor contract)
      // ═══════════════════════════════════════════════════════════
      if (this.useOnChainExecution && this.hedgeExecutorClient && hedgeId) {
        logger.info('Closing ON-CHAIN hedge position', { hedgeId, market });

        const result = await this.hedgeExecutorClient.closeHedge(hedgeId);
        this.onChainHedges.delete(hedgeId);

        return {
          success: true,
          data: {
            hedgeId,
            txHash: result.txHash,
            pnl: result.pnl,
            closePrice: result.closePrice,
            executionMode: 'on-chain',
          },
          error: null,
          executionTime: Date.now() - startTime,
          agentId: this.agentId,
        };
      }

      // ═══════════════════════════════════════════════════════════
      // OFF-CHAIN CLOSE (legacy)
      // ═══════════════════════════════════════════════════════════
      logger.info('Closing hedge position (off-chain)', { market });

      const order = await this.moonlanderClient.closePosition({ market, size });

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
    const parameters = task.parameters as { strategyId: string };
    const { strategyId } = parameters;

    try {
      const strategy = this.activeStrategies.get(strategyId);
      if (!strategy) {
        throw new Error(`Strategy ${strategyId} not found`);
      }

      // Get current position. Support clients that expose getPosition or only getPositions
      const extClient = this.moonlanderClient as unknown as MoonlanderClientExt;
      let position: PerpetualPosition | null = null;
      if (typeof extClient.getPosition === 'function') {
        position = await extClient.getPosition(strategy.targetMarket);
      }

      if (!position && typeof extClient.getPositions === 'function') {
        const positions = await extClient.getPositions();
        position = positions.find((p) => p.market === strategy.targetMarket) || null;
      }

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

        let order: OrderResult;
        const rebalExtClient = this.moonlanderClient as unknown as MoonlanderClientExt;
        if (typeof rebalExtClient.createOrder === 'function') {
          order = await rebalExtClient.createOrder({
            market: strategy.targetMarket,
            side: adjustmentSide,
            type: 'MARKET',
            quantity: adjustmentSize,
          });
        } else {
          order = await this.moonlanderClient.placeOrder({
            market: strategy.targetMarket,
            side: adjustmentSide,
            type: 'MARKET',
            size: adjustmentSize,
          });
        }

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
    const params = task.parameters as Omit<HedgeStrategy, 'strategyId' | 'active'>;
    const strategy: HedgeStrategy = {
      strategyId: `strategy-${Date.now()}`,
      ...params,
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
      // Get all positions (guard if client only exposes getPositions)
      const monExtClient = this.moonlanderClient as unknown as MoonlanderClientExt;
      const positions: PerpetualPosition[] = typeof monExtClient.getPositions === 'function'
        ? await monExtClient.getPositions()
        : [];

      // Calculate liquidation risks if available on the client
      const risks: LiquidationRisk[] = typeof monExtClient.calculateLiquidationRisk === 'function'
        ? await monExtClient.calculateLiquidationRisk()
        : [];
      
      // Check each position against strategies
      const alerts = [];
      for (const position of positions) {
        const risk = risks.find((r) => r.positionId === position.positionId);
        
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
   * Calculate optimal hedge ratio using minimum variance approach
   * h* = ρ × (σ_spot / σ_futures) — adjusted for position size and volatility regime
   */
  private async calculateOptimalHedgeRatio(
    assetSymbol: string,
    notionalValue: number,
    volatility: number
  ): Promise<number> {
    try {
      // Get spot-future correlation (already uses real data)
      const correlation = await this.calculateSpotFutureCorrelation(assetSymbol);

      // For crypto perps, σ_spot ≈ σ_futures (perps track spot closely)
      // So minimum variance hedge ratio h* ≈ ρ (correlation)
      let ratio = correlation;

      // Adjust for volatility regime
      if (volatility > 0.8) {
        // Extreme vol: hedge more aggressively
        ratio = Math.min(ratio * 1.15, 1.0);
      } else if (volatility > 0.5) {
        // High vol: slight increase
        ratio = Math.min(ratio * 1.05, 1.0);
      } else if (volatility < 0.15) {
        // Low vol: can be less aggressive
        ratio *= 0.85;
      }

      // Adjust for position size (larger positions → more conservative)
      if (notionalValue > 5_000_000) {
        ratio = Math.min(ratio * 1.1, 1.0); // Large: hedge more
      } else if (notionalValue < 50_000) {
        ratio *= 0.9; // Small: transaction costs matter more
      }

      const finalRatio = Math.max(0.3, Math.min(ratio, 1.0));

      logger.info('Calculated optimal hedge ratio', {
        assetSymbol,
        correlation,
        volatility: (volatility * 100).toFixed(1) + '%',
        notionalValue,
        finalRatio: (finalRatio * 100).toFixed(1) + '%',
      });

      return finalRatio;
    } catch (error) {
      logger.warn('Hedge ratio calculation fallback to volatility-based', {
        assetSymbol,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback: volatility-based heuristic (still uses real vol, not hardcoded)
      return Math.max(0.3, Math.min(0.5 + volatility * 0.5, 1.0));
    }
  }

  /**
   * Calculate asset volatility from real candlestick data
   */
  private async calculateVolatility(assetSymbol: string): Promise<number> {
    try {
      const historicalPrices = await this.mcpClient.getHistoricalPrices(
        assetSymbol,
        '1d',
        30 // 30 days
      );

      if (historicalPrices.length < 5) {
        throw new Error(`Insufficient candlestick data: got ${historicalPrices.length} candles`);
      }

      // Calculate daily log returns
      const returns = [];
      for (let i = 1; i < historicalPrices.length; i++) {
        if (historicalPrices[i - 1].price > 0) {
          const ret = Math.log(historicalPrices[i].price / historicalPrices[i - 1].price);
          returns.push(ret);
        }
      }

      if (returns.length < 3) {
        throw new Error('Not enough valid returns for volatility');
      }

      // Calculate standard deviation (sample variance with n-1)
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
      const dailyVol = Math.sqrt(variance);

      // Annualize (crypto trades 365 days)
      const volatility = dailyVol * Math.sqrt(365);

      logger.info('Calculated real volatility from Exchange candlestick data', {
        assetSymbol,
        dataPoints: returns.length,
        dailyVol: (dailyVol * 100).toFixed(2) + '%',
        annualizedVol: (volatility * 100).toFixed(2) + '%',
      });

      return volatility;
    } catch (error) {
      logger.warn('Real volatility calculation failed, deriving from current price data', {
        assetSymbol,
        error: error instanceof Error ? error.message : String(error),
      });

      // Last resort: derive approximate volatility from current 24h price change
      // This is a rough estimate but still uses REAL data, not hardcoded values
      try {
        const currentPrice = await this.mcpClient.getPrice(assetSymbol);
        const change24h = Math.abs(currentPrice.priceChange24h || 0) / 100; // as decimal
        // Rough annualization: daily move × sqrt(365)
        // 24h change is one sample of daily volatility
        const approxVol = Math.max(change24h, 0.01) * Math.sqrt(365);
        // Clamp to reasonable crypto range [0.1, 2.0]
        const clampedVol = Math.max(0.1, Math.min(2.0, approxVol));

        logger.info('Derived volatility from 24h price change', {
          assetSymbol,
          change24h: (change24h * 100).toFixed(2) + '%',
          derivedVol: (clampedVol * 100).toFixed(2) + '%',
        });

        return clampedVol;
      } catch (priceError) {
        logger.error('All volatility data sources failed', { assetSymbol, error: priceError });
        throw new Error(`Cannot calculate volatility for ${assetSymbol}: no data available`);
      }
    }
  }

  /**
   * Calculate spot-future correlation using real candlestick data
   * Compares spot and perpetual price returns from Exchange API
   */
  private async calculateSpotFutureCorrelation(assetSymbol: string): Promise<number> {
    try {
      // Get real spot candlestick data
      const spotPrices = await this.mcpClient.getHistoricalPrices(
        assetSymbol,
        '1d',
        30
      );

      // Get real perpetual candlestick data
      let perpPrices: { price: number }[] = [];
      try {
        const perpData = await this.mcpClient.getHistoricalPrices(
          assetSymbol,
          '1d',
          30,
          'perp'
        );
        perpPrices = perpData;
      } catch {
        logger.info('No perp candlestick data available, using spot self-analysis', { assetSymbol });
      }

      // Case 1: Both spot and perp data available → real Pearson correlation
      if (spotPrices.length >= 10 && perpPrices.length >= 10) {
        const spotReturns: number[] = [];
        for (let i = 1; i < spotPrices.length; i++) {
          if (spotPrices[i - 1].price > 0) {
            spotReturns.push(Math.log(spotPrices[i].price / spotPrices[i - 1].price));
          }
        }

        const perpReturns: number[] = [];
        for (let i = 1; i < perpPrices.length; i++) {
          if (perpPrices[i - 1].price > 0) {
            perpReturns.push(Math.log(perpPrices[i].price / perpPrices[i - 1].price));
          }
        }

        const n = Math.min(spotReturns.length, perpReturns.length);
        if (n >= 5) {
          const spotSlice = spotReturns.slice(0, n);
          const perpSlice = perpReturns.slice(0, n);

          const spotMean = spotSlice.reduce((a, b) => a + b, 0) / n;
          const perpMean = perpSlice.reduce((a, b) => a + b, 0) / n;

          let num = 0, spotVar = 0, perpVar = 0;
          for (let i = 0; i < n; i++) {
            const sd = spotSlice[i] - spotMean;
            const pd = perpSlice[i] - perpMean;
            num += sd * pd;
            spotVar += sd * sd;
            perpVar += pd * pd;
          }

          const denom = Math.sqrt(spotVar * perpVar);
          // If variance is zero (identical returns), correlation is undefined — compute autocorrelation instead
          if (denom === 0) {
            // Compute lag-1 autocorrelation of spot returns as market efficiency proxy
            let autocov = 0, autoVar = 0;
            for (let i = 1; i < spotSlice.length; i++) {
              autocov += (spotSlice[i] - spotMean) * (spotSlice[i - 1] - spotMean);
              autoVar += (spotSlice[i] - spotMean) * (spotSlice[i] - spotMean);
            }
            const autocorr = autoVar > 0 ? Math.abs(autocov / autoVar) : 0;
            // Low autocorrelation → efficient market → high correlation estimate
            const correlation = Math.max(0.5, Math.min(0.99, 1 - autocorr * 0.4));
            logger.info('Spot-perp correlation from autocorrelation (degenerate variance)', {
              assetSymbol, autocorr, correlation, dataPoints: n,
            });
            return correlation;
          }
          const rawCorrelation = num / denom;
          const correlation = Math.max(0.5, Math.min(1.0, Math.abs(rawCorrelation)));

          logger.info('Calculated real spot-perp correlation from Exchange candlestick data', {
            assetSymbol,
            correlation,
            dataPoints: n,
          });

          return correlation;
        }
      }

      // Case 2: Only spot data → derive correlation proxy from market efficiency
      if (spotPrices.length >= 10) {
        const spotReturns: number[] = [];
        for (let i = 1; i < spotPrices.length; i++) {
          if (spotPrices[i - 1].price > 0) {
            spotReturns.push(Math.log(spotPrices[i].price / spotPrices[i - 1].price));
          }
        }

        if (spotReturns.length >= 5) {
          // Use volume × liquidity as proxy: higher volume → tighter spot-perp tracking
          const avgVolume = spotPrices.reduce((sum, p) => sum + (p.volume24h || 0), 0) / spotPrices.length;

          // Also compute return variance to assess market regime
          const mean = spotReturns.reduce((a, b) => a + b, 0) / spotReturns.length;
          const variance = spotReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / spotReturns.length;
          const dailyVol = Math.sqrt(variance);

          // Compute lag-1 autocorrelation as market efficiency proxy
          let autocov = 0, autoVar = 0;
          for (let i = 1; i < spotReturns.length; i++) {
            autocov += (spotReturns[i] - mean) * (spotReturns[i - 1] - mean);
            autoVar += (spotReturns[i] - mean) * (spotReturns[i] - mean);
          }
          const autocorr = autoVar > 0 ? Math.abs(autocov / autoVar) : 0;

          // Continuous formula using real data:
          // - volumeScore: log-scaled market depth (0 → 1)
          // - dailyVol: higher vol → more basis divergence → lower correlation
          // - autocorr: higher autocorrelation → less efficient → lower correlation
          const volumeScore = avgVolume > 0 ? Math.min(1, Math.log10(avgVolume) / 10) : 0;
          const baseCorr = 0.5 + volumeScore * 0.47;
          const volPenalty = dailyVol * 0.3;
          const efficiencyPenalty = autocorr * 0.15;
          let correlation = baseCorr - volPenalty - efficiencyPenalty;

          correlation = Math.max(0.5, Math.min(0.99, correlation));

          logger.info('Derived spot-perp correlation from volume and volatility', {
            assetSymbol,
            avgVolume: avgVolume.toFixed(0),
            dailyVol: (dailyVol * 100).toFixed(2) + '%',
            correlation,
          });

          return correlation;
        }
      }

      // Case 3: Minimal data — derive from real ticker volume + price change
      const currentPrice = await this.mcpClient.getPrice(assetSymbol);
      const volume = currentPrice.volume24h || 0;
      const priceChange = Math.abs(currentPrice.priceChange24h || 0) / 100; // as decimal
      // Continuous formula: log volume score adjusted by 24h volatility
      const volScore = volume > 0 ? Math.min(1, Math.log10(volume) / 10) : 0;
      const volAdjust = priceChange * 0.3; // Higher daily move → more basis divergence
      const tickerCorr = Math.max(0.5, Math.min(0.99, 0.5 + volScore * 0.47 - volAdjust));
      logger.info('Derived correlation from real ticker data (minimal candlestick)', {
        assetSymbol, volume: volume.toFixed(0), priceChange: (priceChange * 100).toFixed(2) + '%', correlation: tickerCorr,
      });
      return tickerCorr;
    } catch (error) {
      logger.warn('Spot-future correlation using ticker-based estimate', {
        assetSymbol,
        error: error instanceof Error ? error.message : String(error),
      });

      // Even as a last resort, try to use real volume + change data
      try {
        const spot = await this.mcpClient.getPrice(assetSymbol);
        const volume = spot.volume24h || 0;
        const change = Math.abs(spot.priceChange24h || 0) / 100;
        const volScore = volume > 0 ? Math.min(1, Math.log10(volume) / 10) : 0;
        const fallbackCorr = Math.max(0.5, Math.min(0.99, 0.5 + volScore * 0.47 - change * 0.3));
        logger.info('Last-resort correlation from real ticker', { assetSymbol, correlation: fallbackCorr });
        return fallbackCorr;
      } catch {
        // Absolute last resort - but this path should be extremely rare
        logger.error('All correlation data sources failed', { assetSymbol });
        throw new Error(`Cannot calculate correlation for ${assetSymbol}: no data available`);
      }
    }
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
