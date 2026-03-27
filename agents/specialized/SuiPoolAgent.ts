/**
 * SUI Pool Agent — AI-driven community pool management on SUI chain
 * 
 * Specialized agent for the USDC-denominated 4-asset community pool:
 * - Analyzes market conditions (BTC, ETH, SUI, CRO)
 * - Generates smart allocations aware of on-chain vs hedged positions
 * - Plans and executes rebalance swaps via Cetus aggregator
 * - Tracks hedge positions for non-swappable assets
 * - Integrates with SafeExecutionGuard for position limits
 * 
 * On testnet: SUI is swappable, BTC/ETH/CRO are virtual (price-tracked)
 * On mainnet: SUI/BTC/ETH are swappable via Cetus, CRO hedged via BlueFin
 */

import { BaseAgent } from '../core/BaseAgent';
import { logger } from '@shared/utils/logger';
import type { AgentTask, TaskResult } from '@shared/types/agent';
import {
  getCetusAggregatorService,
  type PoolAsset,
  type NetworkType,
  type RebalanceSwapPlan,
  type SwapQuoteResult,
} from '../../lib/services/CetusAggregatorService';

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
    const aggregator = getCetusAggregatorService(this.network);
    const indicators: MarketIndicator[] = [];

    for (const asset of POOL_ASSETS) {
      try {
        const data = await mds.getTokenPrice(asset);
        const price = data.price;
        const change24h = data.change24h ?? 0;
        const volume24h = data.volume24h ?? 0;

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

        // Check if asset can actually be swapped on-chain
        const testQuote = await aggregator.getSwapQuote(asset, 10); // $10 test
        const isSwappable = testQuote.canSwapOnChain && !testQuote.isSimulated;

        indicators.push({
          asset, price, change24h, volume24h, volatility, trend, score, isSwappable,
        });
      } catch {
        indicators.push({
          asset, price: 0, change24h: 0, volume24h: 0,
          volatility: 'medium', trend: 'neutral', score: 50, isSwappable: false,
        });
      }
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

    const aggregator = getCetusAggregatorService(this.network);
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

    const aggregator = getCetusAggregatorService(this.network);

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
