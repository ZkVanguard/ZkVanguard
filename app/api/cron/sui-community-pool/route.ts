/**
 * Cron Job: SUI Community Pool AI Management (USDC)
 * 
 * Invoked by Upstash QStash every 30 minutes to:
 * 1. Fetch SUI pool on-chain stats (USDC balance, shares, members)
 * 2. Record NAV snapshot with 4-asset allocation tracking
 * 3. Sync member data from on-chain → DB
 * 4. Run AI allocation decision (BTC/ETH/SUI/CRO)
 * 5. Trigger auto-hedge via BlueFin when risk is elevated
 * 
 * 4 Assets: BTC, ETH, SUI, CRO
 * Deposit token: USDC on SUI
 * 
 * Security: QStash signature verification + CRON_SECRET fallback
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { getSuiCommunityPoolService } from '@/lib/services/SuiCommunityPoolService';
import {
  initCommunityPoolTables,
  recordNavSnapshot,
  saveUserSharesToDb,
  savePoolStateToDb,
  addPoolTransactionToDb,
} from '@/lib/db/community-pool';
import { query } from '@/lib/db/postgres';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';
import { getMultiSourceValidatedPrice } from '@/lib/services/unified-price-provider';
import { getBluefinAggregatorService } from '@/lib/services/BluefinAggregatorService';
import { getSuiPoolAgent, type AllocationDecision } from '@/agents/specialized/SuiPoolAgent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 4 pool assets
const POOL_ASSETS = ['BTC', 'ETH', 'SUI', 'CRO'] as const;
type PoolAsset = (typeof POOL_ASSETS)[number];

interface SuiCronResult {
  success: boolean;
  chain: 'sui';
  poolStats?: {
    totalNAV_USDC: string;
    totalShares: string;
    sharePrice: string;
    memberCount: number;
    allocations: Record<PoolAsset, number>;
  };
  aiDecision?: {
    action: string;
    allocations: Record<PoolAsset, number>;
    confidence: number;
    reasoning: string;
    swappableAssets?: string[];
    hedgedAssets?: string[];
    riskScore?: number;
  };
  riskScore?: number;
  pricesUSD?: Record<string, number>;
  rebalanceSwaps?: {
    planned: number;
    executable: number;
    quotes: Array<{
      asset: string;
      amountInUsdc: string;
      expectedOut: string;
      route: string;
      canSwap: boolean;
    }>;
  };
  duration: number;
  error?: string;
}

// ============================================================================
// AI Allocation Engine (same algorithm as EVM, adapted for SUI USDC pool)
// ============================================================================

interface AssetIndicator {
  asset: PoolAsset;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  volatility: 'low' | 'medium' | 'high';
  trend: 'bullish' | 'bearish' | 'neutral';
  score: number;
}

async function fetchMarketIndicators(): Promise<AssetIndicator[]> {
  const mds = getMarketDataService();
  const indicators: AssetIndicator[] = [];

  for (const asset of POOL_ASSETS) {
    try {
      const data = await mds.getTokenPrice(asset);
      const price = data.price;
      const change24h = data.change24h ?? 0;
      const volume24h = data.volume24h ?? 0;
      // Estimate high/low from price and 24h change (MarketPrice doesn't have these)
      const high24h = price * (1 + Math.abs(change24h) / 100 * 0.6);
      const low24h = price * (1 - Math.abs(change24h) / 100 * 0.6);

      // Volatility from 24h range
      const rangePercent = price > 0 ? ((high24h - low24h) / price) * 100 : 0;
      const volatility: 'low' | 'medium' | 'high' =
        rangePercent < 3 ? 'low' : rangePercent < 7 ? 'medium' : 'high';

      // Trend from 24h change
      const trend: 'bullish' | 'bearish' | 'neutral' =
        change24h > 2 ? 'bullish' : change24h < -2 ? 'bearish' : 'neutral';

      // Score 0-100
      let score = 50 + change24h * 2;
      if (volatility === 'low') score += 10;
      else if (volatility === 'high') score -= 5;
      if (trend === 'bullish') score += 10;
      else if (trend === 'bearish') score -= 10;
      if (volume24h * price > 100_000_000) score += 5;
      score = Math.max(0, Math.min(100, score));

      indicators.push({ asset, price, change24h, volume24h, high24h, low24h, volatility, trend, score });
    } catch (err) {
      logger.warn(`[SUI Cron] Failed to fetch ${asset} price — skipping asset (no zero-data fallback)`, { error: err });
      // Do NOT push zero-data indicators — AI should not make decisions on missing data
    }
  }

  return indicators;
}

function generateAllocation(
  indicators: AssetIndicator[],
  currentAllocations?: Record<PoolAsset, number>
): {
  allocations: Record<PoolAsset, number>;
  confidence: number;
  reasoning: string;
  shouldRebalance: boolean;
} {
  const totalScore = indicators.reduce((s, i) => s + i.score, 0) || 1;
  const sorted = [...indicators].sort((a, b) => b.score - a.score);

  const allocations: Record<string, number> = {};
  let remaining = 100;

  for (let i = 0; i < sorted.length; i++) {
    if (i === sorted.length - 1) {
      allocations[sorted[i].asset] = remaining;
    } else {
      let pct = Math.round((sorted[i].score / totalScore) * 100);
      pct = Math.max(10, Math.min(40, pct));
      allocations[sorted[i].asset] = pct;
      remaining -= pct;
    }
  }

  // Confidence
  const clearTrends = indicators.filter(i => i.trend !== 'neutral').length;
  const highVol = indicators.filter(i => i.volatility === 'high').length;
  const confidence = Math.max(50, Math.min(95, 60 + clearTrends * 8 - highVol * 5));

  // Reasoning
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const reasoning = `SUI USDC Pool AI (${new Date().toISOString().split('T')[0]}): ` +
    `Overweight ${top.asset} (${allocations[top.asset]}%) — ${top.trend}, score ${top.score.toFixed(0)}. ` +
    `Underweight ${bottom.asset} (${allocations[bottom.asset]}%) — ${bottom.trend}, score ${bottom.score.toFixed(0)}. ` +
    `Prices: ${indicators.map(i => `${i.asset}=$${i.price.toLocaleString()}`).join(', ')}.`;

  // Check drift to decide if rebalance needed
  let shouldRebalance = false;
  if (currentAllocations) {
    const maxDrift = Math.max(
      ...POOL_ASSETS.map(a => Math.abs((allocations[a] || 25) - (currentAllocations[a] || 25)))
    );
    shouldRebalance = maxDrift > 5;
  } else {
    shouldRebalance = confidence >= 75;
  }

  return {
    allocations: allocations as Record<PoolAsset, number>,
    confidence,
    reasoning,
    shouldRebalance,
  };
}

// ============================================================================
// GET Handler — QStash / Vercel Cron
// ============================================================================

export async function GET(request: NextRequest): Promise<NextResponse<SuiCronResult>> {
  const startTime = Date.now();

  // Verify QStash signature or CRON_SECRET
  const authResult = await verifyCronRequest(request, 'SUI CommunityPool Cron');
  if (authResult !== true) {
    return NextResponse.json(
      { success: false, chain: 'sui', error: 'Unauthorized', duration: Date.now() - startTime },
      { status: 401 }
    );
  }

  const network = (process.env.SUI_NETWORK as 'mainnet' | 'testnet') || 'testnet';
  logger.info('[SUI Cron] Starting SUI community pool AI management', { network });

  try {
    // Step 0: Ensure DB tables exist
    await initCommunityPoolTables();

    // Step 1: Fetch on-chain SUI pool stats
    const suiService = getSuiCommunityPoolService(network);
    const poolStats = await suiService.getPoolStats();

    logger.info('[SUI Cron] Pool stats fetched', {
      totalNAV: poolStats.totalNAV,
      totalNAVUsd: poolStats.totalNAVUsd,
      members: poolStats.memberCount,
      sharePrice: poolStats.sharePrice,
    });

    // Step 2: Fetch live prices for all 4 assets
    const pricesUSD: Record<string, number> = {};
    let pricesFetched = false;
    try {
      const results = await Promise.allSettled(
        POOL_ASSETS.map(async (asset) => {
          const validated = await getMultiSourceValidatedPrice(asset);
          return { asset, price: validated.price };
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          pricesUSD[r.value.asset] = r.value.price;
        }
      }
      pricesFetched = Object.keys(pricesUSD).length === POOL_ASSETS.length;
      logger.info('[SUI Cron] Prices fetched', pricesUSD);
    } catch (priceErr) {
      logger.warn('[SUI Cron] Price fetch failed (non-critical)', { error: priceErr });
    }

    // Step 3: Get AI allocation decision via SuiPoolAgent
    const suiAgent = getSuiPoolAgent(network);
    const indicators = await suiAgent.analyzeMarket();

    // Fetch current allocations from last AI decision in DB (no hardcoded defaults)
    let currentAllocations: Record<PoolAsset, number> = {
      BTC: 0,
      ETH: 0,
      SUI: 0,
      CRO: 0,
    };
    try {
      const lastDecisions = await query(
        `SELECT details FROM community_pool_transactions 
         WHERE type = 'AI_DECISION' AND details->>'chain' = 'sui'
         ORDER BY created_at DESC LIMIT 1`
      ) as Array<{ details: Record<string, unknown> }>;
      if (lastDecisions.length > 0 && lastDecisions[0].details?.allocations) {
        const saved = lastDecisions[0].details.allocations as Record<string, number>;
        for (const asset of POOL_ASSETS) {
          if (typeof saved[asset] === 'number') {
            currentAllocations[asset] = saved[asset];
          }
        }
        logger.info('[SUI Cron] Loaded last AI allocations from DB', currentAllocations);
      } else {
        logger.info('[SUI Cron] No previous AI decision found, using zero allocations (first run)');
      }
    } catch (allocErr) {
      logger.warn('[SUI Cron] Could not load previous allocations from DB', { error: allocErr });
    }

    const aiResult = suiAgent.generateAllocation(indicators, currentAllocations);

    logger.info('[SUI Cron] AI Agent decision', {
      allocations: aiResult.allocations,
      confidence: aiResult.confidence,
      shouldRebalance: aiResult.shouldRebalance,
      swappableAssets: aiResult.swappableAssets,
      hedgedAssets: aiResult.hedgedAssets,
      riskScore: aiResult.riskScore,
    });

    // Step 4: Record NAV snapshot
    // For SUI pool, totalNAV is in SUI. Convert to USD for consistent tracking.
    const navUsd = poolStats.totalNAVUsd || (poolStats.totalNAV * (pricesUSD['SUI'] || 0));
    const sharePriceUsd = poolStats.sharePriceUsd || (poolStats.sharePrice * (pricesUSD['SUI'] || 0));

    try {
      await recordNavSnapshot({
        sharePrice: sharePriceUsd || poolStats.sharePrice,
        totalNav: navUsd || poolStats.totalNAV,
        totalShares: poolStats.totalShares,
        memberCount: poolStats.memberCount,
        allocations: aiResult.allocations,
        source: 'sui-usdc-pool',
        chain: 'sui',
      });
      logger.info('[SUI Cron] NAV snapshot recorded');
    } catch (navErr) {
      logger.warn('[SUI Cron] Failed to record NAV (non-critical)', { error: navErr });
    }

    // Step 5: Sync members to DB from on-chain
    try {
      const members = await suiService.getAllMembers();
      let synced = 0;
      for (const m of members) {
        if (m.shares > 0) {
          await saveUserSharesToDb({
            walletAddress: m.address.toLowerCase(),
            shares: m.shares,
            costBasisUSD: m.valueUsd || m.valueSui * (pricesUSD['SUI'] || 0),
            chain: 'sui',
          });
          synced++;
        }
      }
      logger.info('[SUI Cron] Members synced to DB', { synced, total: members.length });
    } catch (syncErr) {
      logger.warn('[SUI Cron] Member sync failed (non-critical)', { error: syncErr });
    }

    // Step 6: Save pool state to DB
    try {
      const poolAllocRecord: Record<string, { percentage: number; valueUSD: number; amount: number; price: number }> = {};
      for (const asset of POOL_ASSETS) {
        const pct = aiResult.allocations[asset] || 25;
        poolAllocRecord[asset] = {
          percentage: pct,
          valueUSD: navUsd * (pct / 100),
          amount: 0,
          price: pricesUSD[asset] || 0,
        };
      }

      await savePoolStateToDb({
        totalValueUSD: navUsd,
        totalShares: poolStats.totalShares,
        sharePrice: sharePriceUsd || 1,
        allocations: poolAllocRecord,
        lastRebalance: Date.now(),
        lastAIDecision: {
          timestamp: Date.now(),
          reasoning: aiResult.reasoning,
          allocations: aiResult.allocations,
        },
        chain: 'sui',
      });
      logger.info('[SUI Cron] Pool state saved to DB');
    } catch (dbErr) {
      logger.warn('[SUI Cron] DB pool state save failed (non-critical)', { error: dbErr });
    }

    // Step 7: Plan + Execute rebalance via SuiPoolAgent
    let rebalanceSwaps: SuiCronResult['rebalanceSwaps'] = undefined;
    if (aiResult.shouldRebalance && navUsd > 1) {
      try {
        const aggregator = getBluefinAggregatorService(network);

        const plan = await aggregator.planRebalanceSwaps(
          navUsd,
          aiResult.allocations as Record<PoolAsset, number>,
        );

        const onChainCount = plan.swaps.filter(s => s.canSwapOnChain).length;
        const simulatedCount = plan.swaps.filter(s => s.isSimulated).length;

        rebalanceSwaps = {
          planned: plan.swaps.length,
          executable: onChainCount,
          quotes: plan.swaps.map(s => ({
            asset: s.asset,
            amountInUsdc: (Number(s.amountIn) / 1e6).toFixed(2),
            expectedOut: s.expectedAmountOut,
            route: s.route,
            canSwap: s.canSwapOnChain,
          })),
        };

        // Attach agent metadata
        (rebalanceSwaps as any).simulated = simulatedCount;
        (rebalanceSwaps as any).swappableAssets = aiResult.swappableAssets;
        (rebalanceSwaps as any).hedgedAssets = aiResult.hedgedAssets;

        logger.info('[SUI Cron] Agent rebalance plan', {
          planned: plan.swaps.length,
          onChain: onChainCount,
          simulated: simulatedCount,
          quotes: plan.swaps.map(q => 
            `${q.asset}: $${(Number(q.amountIn) / 1e6).toFixed(2)} → ${q.expectedAmountOut} (${q.route})${q.isSimulated ? ' [simulated]' : ''}`
          ),
        });

        // Step 7b: Execute on-chain swaps if admin wallet is configured
        if (process.env.SUI_POOL_ADMIN_KEY && onChainCount > 0) {
          try {
            const execResult = await aggregator.executeRebalance(plan, 0.015);
            
            (rebalanceSwaps as any).executed = execResult.totalExecuted;
            (rebalanceSwaps as any).failed = execResult.totalFailed;
            (rebalanceSwaps as any).txDigests = execResult.results
              .filter(r => r.txDigest)
              .map(r => ({ asset: r.asset, digest: r.txDigest }));

            logger.info('[SUI Cron] On-chain swaps executed', {
              executed: execResult.totalExecuted,
              failed: execResult.totalFailed,
              digests: execResult.results.filter(r => r.txDigest).map(r => r.txDigest),
            });
          } catch (execErr) {
            logger.error('[SUI Cron] On-chain swap execution failed', { error: execErr });
            (rebalanceSwaps as any).executionError = execErr instanceof Error ? execErr.message : String(execErr);
          }
        } else if (!process.env.SUI_POOL_ADMIN_KEY) {
          logger.info('[SUI Cron] Swap execution skipped — SUI_POOL_ADMIN_KEY not set (quotes only)');
        }

        // Step 7c: Log hedged/simulated positions
        const hedgedPositions = plan.swaps.filter(s => s.isSimulated || !s.canSwapOnChain);
        if (hedgedPositions.length > 0) {
          (rebalanceSwaps as any).hedgedPositions = hedgedPositions.map(s => ({
            asset: s.asset,
            method: s.hedgeVia || 'price-tracked',
            usdcAllocated: (Number(s.amountIn) / 1e6).toFixed(2),
            estimatedQty: s.expectedAmountOut,
            route: s.route,
          }));
          logger.info('[SUI Cron] Hedged positions tracked', {
            count: hedgedPositions.length,
            assets: hedgedPositions.map(s => `${s.asset}: $${(Number(s.amountIn) / 1e6).toFixed(2)} via ${s.hedgeVia || 'virtual'}`),
          });
        }

      } catch (swapErr) {
        logger.warn('[SUI Cron] Rebalance planning failed (non-critical)', { error: swapErr });
      }
    }

    // Step 8: Log AI decision to transaction history
    try {
      const decisionId = `sui_ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await addPoolTransactionToDb({
        id: decisionId,
        type: 'AI_DECISION',
        chain: 'sui',
        details: {
          chain: 'sui',
          agent: 'SuiPoolAgent',
          action: aiResult.shouldRebalance ? 'REBALANCE' : 'HOLD',
          allocations: aiResult.allocations,
          confidence: aiResult.confidence,
          reasoning: aiResult.reasoning,
          swappableAssets: aiResult.swappableAssets,
          hedgedAssets: aiResult.hedgedAssets,
          riskScore: aiResult.riskScore,
          prices: pricesUSD,
          rebalanceQuotes: rebalanceSwaps,
          poolNAV_USDC: navUsd,
          poolSharePrice: sharePriceUsd,
          memberCount: poolStats.memberCount,
        },
      });
    } catch (txErr) {
      logger.warn('[SUI Cron] Transaction log failed (non-critical)', { error: txErr });
    }

    // Build response
    const result: SuiCronResult = {
      success: true,
      chain: 'sui',
      poolStats: {
        totalNAV_USDC: navUsd.toFixed(2),
        totalShares: poolStats.totalShares.toFixed(4),
        sharePrice: (sharePriceUsd || poolStats.sharePrice).toFixed(6),
        memberCount: poolStats.memberCount,
        allocations: aiResult.allocations,
      },
      aiDecision: {
        action: aiResult.shouldRebalance ? 'REBALANCE' : 'HOLD',
        allocations: aiResult.allocations,
        confidence: aiResult.confidence,
        reasoning: aiResult.reasoning,
        swappableAssets: aiResult.swappableAssets,
        hedgedAssets: aiResult.hedgedAssets,
        riskScore: aiResult.riskScore,
      },
      pricesUSD,
      rebalanceSwaps,
      duration: Date.now() - startTime,
    };

    logger.info('[SUI Cron] Completed successfully', {
      duration: result.duration,
      action: result.aiDecision?.action,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[SUI Cron] Failed', { error: message });

    return NextResponse.json(
      {
        success: false,
        chain: 'sui' as const,
        error: message,
        duration: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// QStash sends POST by default — support both methods
export const POST = GET;
