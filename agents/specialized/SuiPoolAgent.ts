/**
 * SUI Pool Agent — AI-driven community pool management on SUI chain
 * 
 * Specialized agent for the USDC-denominated 4-asset community pool:
 * - Analyzes market conditions (BTC, ETH, SUI, CRO)
 * - Generates smart allocations aware of on-chain vs hedged positions
 * - Plans and executes rebalance swaps via BlueFin aggregator
 * - Tracks hedge positions for non-swappable assets
 * - Integrates with SafeExecutionGuard for position limits
 * 
 * Enhanced with AIMarketIntelligence for comprehensive market context:
 * - Multi-timeframe streak analysis
 * - Cross-market correlation
 * - Risk cascade detection
 * - Market sentiment integration
 * 
 * On testnet: SUI is swappable, BTC/ETH/CRO are virtual (price-tracked)
 * On mainnet: SUI/BTC/ETH are swappable via BlueFin, CRO hedged via BlueFin perps
 */

import { BaseAgent } from '../core/BaseAgent';
import { logger } from '@shared/utils/logger';
import type { AgentTask, TaskResult } from '@shared/types/agent';
import {
  getBluefinAggregatorService,
  type PoolAsset,
  type NetworkType,
  type RebalanceSwapPlan,
  type SwapQuoteResult,
} from '../../lib/services/BluefinAggregatorService';
import { AIMarketIntelligence, type AIMarketContext, type EnhancedPrediction } from '../../lib/services/AIMarketIntelligence';

// ============================================================================
// Types
// ============================================================================

const POOL_ASSETS: PoolAsset[] = ['BTC', 'ETH', 'SUI', 'CRO'];

export interface MarketIndicator {
  asset: PoolAsset;
  price: number;
  change24h: number;
  volume24h: number;
  volatility: 'low' | 'medium' | 'high';
  trend: 'bullish' | 'bearish' | 'neutral';
  score: number;
  isSwappable: boolean; // true if on-chain swap available
}

export interface AllocationDecision {
  allocations: Record<PoolAsset, number>;
  confidence: number;
  reasoning: string;
  shouldRebalance: boolean;
  swappableAssets: PoolAsset[];
  hedgedAssets: PoolAsset[];
  riskScore: number;
}

export interface RebalanceResult {
  decision: AllocationDecision;
  plan: RebalanceSwapPlan | null;
  executionResults: {
    onChainSwaps: { asset: PoolAsset; success: boolean; txDigest?: string; error?: string }[];
    hedgedPositions: { asset: PoolAsset; method: string; usdcAmount: number; estimatedQty: string }[];
    totalExecuted: number;
    totalHedged: number;
    totalFailed: number;
  } | null;
}

// ============================================================================
// SUI Pool Agent
// ============================================================================

export class SuiPoolAgent extends BaseAgent {
  private network: NetworkType;
  private lastDecision: AllocationDecision | null = null;
  private rebalanceHistory: Array<{
    timestamp: number;
    decision: AllocationDecision;
    executedSwaps: number;
    hedgedPositions: number;
  }> = [];

  constructor(agentId: string = 'sui-pool-agent', network: NetworkType = 'testnet') {
    super(agentId, 'sui-pool', [
      'PORTFOLIO_MANAGEMENT',
      'MARKET_INTEGRATION',
      'RISK_ANALYSIS',
    ]);
    this.network = network;
  }

  protected async onInitialize(): Promise<void> {
    logger.info('[SuiPoolAgent] Initializing', { network: this.network });
  }

  protected onMessageReceived(): void {
    // No-op: SuiPoolAgent is task-driven, not message-driven
  }

  protected async onShutdown(): Promise<void> {
    logger.info('[SuiPoolAgent] Shutting down');
  }

  protected async onExecuteTask(task: AgentTask): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (task.type) {
        case 'analyze-market':
          return {
            success: true,
            data: await this.analyzeMarket(),
            error: null,
            executionTime: Date.now() - start,
            agentId: this.id,
          };

        case 'plan-rebalance': {
          const { navUsd, currentAllocations } = task.payload as {
            navUsd: number;
            currentAllocations?: Record<PoolAsset, number>;
          };
          return {
            success: true,
            data: await this.planRebalance(navUsd, currentAllocations),
            error: null,
            executionTime: Date.now() - start,
            agentId: this.id,
          };
        }

        case 'execute-rebalance': {
          const { navUsd: nav, currentAllocations: current } = task.payload as {
            navUsd: number;
            currentAllocations?: Record<PoolAsset, number>;
          };
          return {
            success: true,
            data: await this.executeRebalance(nav, current),
            error: null,
            executionTime: Date.now() - start,
            agentId: this.id,
          };
        }

        default:
          return {
            success: false,
            error: `Unknown task type: ${task.type}`,
            executionTime: Date.now() - start,
            agentId: this.id,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[SuiPoolAgent] Task failed', { task: task.type, error: msg });
      return {
        success: false,
        error: msg,
        executionTime: Date.now() - start,
        agentId: this.id,
      };
    }
  }

  // ============================================================================
  // Market Analysis
  // ============================================================================

  /**
   * Analyze market conditions for all 4 pool assets.
   * Checks which assets are actually swappable on the current network.
   */
  async analyzeMarket(): Promise<MarketIndicator[]> {
    const { getMarketDataService } = await import('../../lib/services/RealMarketDataService');
    const mds = getMarketDataService();
    const aggregator = getBluefinAggregatorService(this.network);
    const indicators: MarketIndicator[] = [];

    // Determine swappability deterministically (avoids 4x unnecessary $10 test quotes)
    // On testnet: nothing is on-chain swappable (all hedged via BlueFin)
    // On mainnet: BTC/ETH/SUI are swappable, CRO is hedged
    const swappabilityMap: Record<PoolAsset, boolean> = this.network === 'mainnet'
      ? { BTC: true, ETH: true, SUI: true, CRO: false }
      : { BTC: false, ETH: false, SUI: false, CRO: false };

    // Fetch all market data in parallel
    const marketDataPromises = POOL_ASSETS.map(async (asset) => {
      try {
        const data = await mds.getTokenPrice(asset);
        return { asset, price: data.price, change24h: data.change24h ?? 0, volume24h: data.volume24h ?? 0, ok: true };
      } catch {
        return { asset, price: 0, change24h: 0, volume24h: 0, ok: false };
      }
    });

    const marketResults = await Promise.allSettled(marketDataPromises);

    for (const settled of marketResults) {
      if (settled.status !== 'fulfilled') continue;
      const { asset, price, change24h, volume24h } = settled.value;

      const rangePercent = price > 0 ? Math.abs(change24h) * 1.2 : 0;
      const volatility: 'low' | 'medium' | 'high' =
        rangePercent < 3 ? 'low' : rangePercent < 7 ? 'medium' : 'high';
      const trend: 'bullish' | 'bearish' | 'neutral' =
        change24h > 2 ? 'bullish' : change24h < -2 ? 'bearish' : 'neutral';

      let score = 50 + change24h * 2;
      if (volatility === 'low') score += 10;
      else if (volatility === 'high') score -= 5;
      if (trend === 'bullish') score += 10;
      else if (trend === 'bearish') score -= 10;
      if (volume24h * price > 100_000_000) score += 5;
      score = Math.max(0, Math.min(100, score));

      const isSwappable = swappabilityMap[asset] && aggregator.canSwapOnChain(asset);

      indicators.push({
        asset, price, change24h, volume24h, volatility, trend, score, isSwappable,
      });
    }

    logger.info('[SuiPoolAgent] Market analysis complete', {
      assets: indicators.map(i => ({
        asset: i.asset, price: i.price, trend: i.trend, score: i.score, swappable: i.isSwappable,
      })),
    });

    return indicators;
  }

  // ============================================================================
  // Allocation Decision
  // ============================================================================

  /**
   * Generate allocation considering which assets are swappable vs hedged.
   * On testnet: boosts SUI allocation (only swappable), reduces others.
   * On mainnet: full allocation across BTC/ETH/SUI, CRO hedged.
   */
  generateAllocation(
    indicators: MarketIndicator[],
    currentAllocations?: Record<PoolAsset, number>,
  ): AllocationDecision {
    const swappableAssets = indicators.filter(i => i.isSwappable).map(i => i.asset);
    const hedgedAssets = indicators.filter(i => !i.isSwappable).map(i => i.asset);

    const totalScore = indicators.reduce((s, i) => s + i.score, 0) || 1;
    const sorted = [...indicators].sort((a, b) => b.score - a.score);

    // Base allocation from scores
    const rawAllocations: Record<string, number> = {};
    let remaining = 100;

    for (let i = 0; i < sorted.length; i++) {
      if (i === sorted.length - 1) {
        rawAllocations[sorted[i].asset] = remaining;
      } else {
        let pct = Math.round((sorted[i].score / totalScore) * 100);
        pct = Math.max(10, Math.min(40, pct));
        rawAllocations[sorted[i].asset] = pct;
        remaining -= pct;
      }
    }

    // On testnet, boost swappable assets slightly (SUI) since they can actually execute
    const allocations = { ...rawAllocations } as Record<PoolAsset, number>;
    if (this.network === 'testnet' && swappableAssets.length > 0 && swappableAssets.length < POOL_ASSETS.length) {
      const boostPer = 5; // Give +5% per swappable asset
      const hedgeCount = hedgedAssets.length;
      const swapCount = swappableAssets.length;
      for (const a of swappableAssets) {
        allocations[a] = Math.min(45, (allocations[a] || 25) + boostPer);
      }
      // Reduce hedged assets proportionally
      const totalBoost = swapCount * boostPer;
      const reducePer = Math.ceil(totalBoost / hedgeCount);
      for (const a of hedgedAssets) {
        allocations[a] = Math.max(5, (allocations[a] || 25) - reducePer);
      }
      // Normalize to 100
      const sum = POOL_ASSETS.reduce((s, a) => s + (allocations[a] || 0), 0);
      if (sum !== 100) {
        const diff = 100 - sum;
        allocations[sorted[0].asset] += diff;
      }
    }

    // Confidence
    const clearTrends = indicators.filter(i => i.trend !== 'neutral').length;
    const highVol = indicators.filter(i => i.volatility === 'high').length;
    const confidence = Math.max(50, Math.min(95, 60 + clearTrends * 8 - highVol * 5));

    // Risk score (0-100, higher = riskier)
    const avgVolScore = indicators.reduce((s, i) => s + (i.volatility === 'high' ? 30 : i.volatility === 'medium' ? 15 : 5), 0) / indicators.length;
    const bearishCount = indicators.filter(i => i.trend === 'bearish').length;
    const riskScore = Math.min(100, avgVolScore + bearishCount * 15);

    // Reasoning
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    const reasoning = `SUI Pool AI [${this.network}] (${new Date().toISOString().split('T')[0]}): ` +
      `Overweight ${top.asset} (${allocations[top.asset]}%) — ${top.trend}, score ${top.score.toFixed(0)}. ` +
      `Underweight ${bottom.asset} (${allocations[bottom.asset]}%) — ${bottom.trend}, score ${bottom.score.toFixed(0)}. ` +
      `Swappable: [${swappableAssets.join(',')}]. Hedged: [${hedgedAssets.join(',')}]. ` +
      `Risk: ${riskScore.toFixed(0)}/100. ` +
      `Prices: ${indicators.map(i => `${i.asset}=$${i.price.toLocaleString()}`).join(', ')}.`;

    // Check drift
    let shouldRebalance = false;
    if (currentAllocations) {
      const maxDrift = Math.max(
        ...POOL_ASSETS.map(a => Math.abs((allocations[a] || 25) - (currentAllocations[a] || 25)))
      );
      shouldRebalance = maxDrift > 5;
    } else {
      shouldRebalance = confidence >= 70;
    }

    this.lastDecision = {
      allocations,
      confidence,
      reasoning,
      shouldRebalance,
      swappableAssets,
      hedgedAssets,
      riskScore,
    };

    return this.lastDecision;
  }

  /**
   * Enhanced allocation using AIMarketIntelligence for comprehensive market context.
   * Provides AI-driven allocation recommendations based on prediction markets,
   * cross-market correlations, and risk cascade analysis.
   */
  async getEnhancedAllocationContext(): Promise<{
    allocations: Record<PoolAsset, number>;
    confidence: number;
    marketSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    recommendations: string[];
    riskAlerts: string[];
    correlationInsight: string;
    predictionSignals: Array<{ market: string; signal: string; probability: number }>;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    reasoning: string;
  }> {
    const context = await AIMarketIntelligence.getMarketContext();
    
    // Get base allocation from market indicators
    const indicators = await this.analyzeMarket();
    const baseDecision = this.generateAllocation(indicators);
    
    // Adjust allocations based on AI context
    const adjustedAllocations = { ...baseDecision.allocations };
    const recommendations: string[] = [];
    const riskAlerts: string[] = [];
    
    // 1. Adjust for risk cascade (severity is 0-100)
    if (context.riskCascade.detected) {
      const cascadeSignals = context.riskCascade.signals.map(s => s.source).join(', ');
      riskAlerts.push(`RISK CASCADE: Severity ${context.riskCascade.severity}/100 - ${cascadeSignals}`);
      
      if (context.riskCascade.severity > 70) {
        // High severity - reduce risk exposure by shifting to more stable allocation
        recommendations.push('Reduce volatile asset exposure due to high risk cascade');
        const suiBoost = 10;
        adjustedAllocations['SUI'] = Math.min(50, (adjustedAllocations['SUI'] || 25) + suiBoost);
        adjustedAllocations['BTC'] = Math.max(15, (adjustedAllocations['BTC'] || 25) - suiBoost / 2);
        adjustedAllocations['ETH'] = Math.max(15, (adjustedAllocations['ETH'] || 25) - suiBoost / 2);
      }
    }
    
    // 2. Adjust for BTC/ETH correlation (btcEthCorrelation is 0-1)
    const btcEthAligned = context.correlation.btcEthCorrelation > 0.7;
    if (btcEthAligned) {
      // Check direction from aligned assets
      const isBullish = context.correlation.marketAlignment > 50;
      if (isBullish) {
        recommendations.push('BTC/ETH highly correlated with positive alignment - consider overweight crypto majors');
        adjustedAllocations['BTC'] = Math.min(40, (adjustedAllocations['BTC'] || 25) + 5);
        adjustedAllocations['ETH'] = Math.min(35, (adjustedAllocations['ETH'] || 25) + 5);
        adjustedAllocations['SUI'] = Math.max(10, (adjustedAllocations['SUI'] || 25) - 10);
      } else {
        recommendations.push('BTC/ETH correlated with weak alignment - defensive allocation recommended');
        adjustedAllocations['SUI'] = Math.min(45, (adjustedAllocations['SUI'] || 25) + 10);
        adjustedAllocations['BTC'] = Math.max(15, (adjustedAllocations['BTC'] || 25) - 5);
        adjustedAllocations['ETH'] = Math.max(15, (adjustedAllocations['ETH'] || 25) - 5);
      }
    }
    
    // 3. Analyze prediction market signals (probability in PredictionMarket is 0-100, not 0-1)
    const predictionSignals: Array<{ market: string; signal: string; probability: number }> = [];
    for (const pred of context.predictions.slice(0, 5)) {
      let signal = 'NEUTRAL';
      if (pred.probability > 70) signal = 'BULLISH';
      else if (pred.probability < 30) signal = 'BEARISH';
      
      predictionSignals.push({
        market: pred.question.substring(0, 60),
        signal,
        probability: pred.probability,
      });
    }
    
    // 4. Calculate overall sentiment from marketSentiment.score (-100 to +100)
    let marketSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    const sentimentScore = context.marketSentiment.score; // -100 to +100
    if (sentimentScore > 30) marketSentiment = 'BULLISH';
    else if (sentimentScore < -30) marketSentiment = 'BEARISH';
    
    // 5. Determine urgency based on streak and risk
    let urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    const streakActive = context.streaks.streak5Min.count > 2;
    if (context.riskCascade.severity > 70) urgency = 'CRITICAL';
    else if (streakActive && context.streaks.streak5Min.direction === 'DOWN' && context.streaks.streak5Min.count > 4) urgency = 'HIGH';
    else if (context.riskCascade.detected || streakActive) urgency = 'MEDIUM';
    
    // 6. Liquidity-based adjustments
    if (!context.liquidity.sufficientLiquidity) {
      riskAlerts.push('Low market liquidity detected - reduce position sizes');
    }
    if (context.liquidity.liquidityRatio < 0.5) {
      recommendations.push('Low exchange liquidity relative to prediction markets - proceed with caution');
    }
    
    // 7. Correlation insight
    const correlationInsight = btcEthAligned
      ? `BTC/ETH ${context.correlation.btcEthCorrelation > 0.8 ? 'strongly' : 'moderately'} correlated (${(context.correlation.btcEthCorrelation * 100).toFixed(0)}%)`
      : `BTC/ETH decoupled (${(context.correlation.btcEthCorrelation * 100).toFixed(0)}%) - divergent market dynamics`;
    
    // Normalize allocations to 100%
    const total = Object.values(adjustedAllocations).reduce((a, b) => a + b, 0);
    if (total !== 100) {
      const diff = 100 - total;
      adjustedAllocations['SUI'] = (adjustedAllocations['SUI'] || 25) + diff;
    }
    
    // Build comprehensive reasoning
    const reasoning = `AI-Enhanced Allocation [${this.network}]: ` +
      `Sentiment=${marketSentiment} (${context.marketSentiment.label}). ` +
      `${streakActive ? `Active ${context.streaks.streak5Min.direction} streak (${context.streaks.streak5Min.count} periods).` : 'No active streak.'} ` +
      `${context.riskCascade.detected ? `Risk cascade: ${context.riskCascade.severity}/100.` : ''} ` +
      `Allocations: BTC=${adjustedAllocations['BTC']}%, ETH=${adjustedAllocations['ETH']}%, SUI=${adjustedAllocations['SUI']}%, CRO=${adjustedAllocations['CRO']}%. ` +
      `Urgency: ${urgency}. ${recommendations.length} recommendations, ${riskAlerts.length} alerts.`;
    
    return {
      allocations: adjustedAllocations as Record<PoolAsset, number>,
      confidence: baseDecision.confidence,
      marketSentiment,
      recommendations,
      riskAlerts,
      correlationInsight,
      predictionSignals,
      urgency,
      reasoning,
    };
  }

  // ============================================================================
  // Rebalance Planning + Execution
  // ============================================================================

  /**
   * Full pipeline: analyze → allocate → plan swaps
   */
  async planRebalance(
    navUsd: number,
    currentAllocations?: Record<PoolAsset, number>,
  ): Promise<{ decision: AllocationDecision; plan: RebalanceSwapPlan }> {
    const indicators = await this.analyzeMarket();
    const decision = this.generateAllocation(indicators, currentAllocations);

    const aggregator = getBluefinAggregatorService(this.network);
    const plan = await aggregator.planRebalanceSwaps(navUsd, decision.allocations);

    logger.info('[SuiPoolAgent] Rebalance planned', {
      action: decision.shouldRebalance ? 'REBALANCE' : 'HOLD',
      confidence: decision.confidence,
      onChainSwaps: plan.swaps.filter(s => s.canSwapOnChain).length,
      simulatedSwaps: plan.swaps.filter(s => s.isSimulated).length,
      totalUsdcToSwap: plan.totalUsdcToSwap,
    });

    return { decision, plan };
  }

  /**
   * Full pipeline: analyze → allocate → plan → execute swaps + record hedges
   */
  async executeRebalance(
    navUsd: number,
    currentAllocations?: Record<PoolAsset, number>,
  ): Promise<RebalanceResult> {
    const { decision, plan } = await this.planRebalance(navUsd, currentAllocations);

    if (!decision.shouldRebalance) {
      logger.info('[SuiPoolAgent] HOLD — no rebalance needed', { confidence: decision.confidence });
      return { decision, plan, executionResults: null };
    }

    const aggregator = getBluefinAggregatorService(this.network);

    // Execute on-chain swaps
    const onChainSwaps: RebalanceResult['executionResults'] extends infer T ? T extends null ? never : T : never = {
      onChainSwaps: [],
      hedgedPositions: [],
      totalExecuted: 0,
      totalHedged: 0,
      totalFailed: 0,
    };

    const swappable = plan.swaps.filter(s => s.canSwapOnChain && s.routerData);
    const simulated = plan.swaps.filter(s => s.isSimulated || !s.canSwapOnChain);

    // Execute real swaps
    if (swappable.length > 0 && process.env.SUI_POOL_ADMIN_KEY) {
      const execResult = await aggregator.executeRebalance(plan, 0.015);
      for (const r of execResult.results) {
        onChainSwaps.onChainSwaps.push({
          asset: r.asset,
          success: r.success,
          txDigest: r.txDigest,
          error: r.error,
        });
      }
      onChainSwaps.totalExecuted = execResult.totalExecuted;
      onChainSwaps.totalFailed = execResult.totalFailed;
    }

    // Record hedged/simulated positions
    for (const s of simulated) {
      const usdcAmount = Number(s.amountIn) / 1e6;
      onChainSwaps.hedgedPositions.push({
        asset: s.asset,
        method: s.hedgeVia || (s.isSimulated ? 'price-tracked' : 'bluefin-perps'),
        usdcAmount,
        estimatedQty: s.expectedAmountOut,
      });
      onChainSwaps.totalHedged++;
    }

    // Track in execution history
    this.rebalanceHistory.push({
      timestamp: Date.now(),
      decision,
      executedSwaps: onChainSwaps.totalExecuted,
      hedgedPositions: onChainSwaps.totalHedged,
    });
    // Keep last 100 executions
    if (this.rebalanceHistory.length > 100) this.rebalanceHistory.shift();

    logger.info('[SuiPoolAgent] Rebalance executed', {
      onChainSwaps: onChainSwaps.totalExecuted,
      hedgedPositions: onChainSwaps.totalHedged,
      failed: onChainSwaps.totalFailed,
      network: this.network,
    });

    return { decision, plan, executionResults: onChainSwaps };
  }

  // ============================================================================
  // State Access
  // ============================================================================

  getLastDecision(): AllocationDecision | null {
    return this.lastDecision;
  }

  getRebalanceHistory() {
    return [...this.rebalanceHistory];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _suiPoolAgent: SuiPoolAgent | null = null;

export function getSuiPoolAgent(network?: NetworkType): SuiPoolAgent {
  const net = network || (process.env.SUI_NETWORK as NetworkType) || 'testnet';
  if (!_suiPoolAgent || _suiPoolAgent['network'] !== net) {
    _suiPoolAgent = new SuiPoolAgent('sui-pool-agent', net);
  }
  return _suiPoolAgent;
}
