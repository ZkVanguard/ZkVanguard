/**
 * Cron Job: Multi-Market Edge Trader (per-asset aggregated → BlueFin perp)
 *
 * Thesis: prediction-market crowds + funding-rate sentiment + 24h momentum
 * are well-calibrated. Instead of trading a single global signal, this cron
 * SCANS every supported asset (BTC, ETH) independently:
 *
 *   For each asset, `PredictionAggregatorService.getPerAssetPredictions`
 *   builds an asset-specific source bucket from:
 *     • Polymarket 5-min BTC binary           (BTC bucket only)
 *     • Delphi/Polymarket markets tagged with that asset
 *     • Crypto.com 24h ticker for that asset
 *     • Funding-rate sentiment proxy
 *   and produces an independent {direction, confidence, consensus,
 *   recommendation, sizeMultiplier} for that asset.
 *
 * The cron then asks `scanAndPickBest` for the highest-scoring asset whose
 * prediction passes ALL gates (confidence ≥ 60, consensus ≥ 60, ≥2
 * sources, recommendation is HEDGE_* or STRONG_*). Score =
 * sqrt(confidence × consensus) × source-breadth + STRONG bonus.
 *
 * Every tick the full per-asset scan is included in the response under
 * `scan` so the operator can audit which markets the AI considered.
 *
 * Hold period: at most ONE master tick (~5 min); STRONG signals get 10 min.
 *
 * Compounding:
 *   stake = baseStake × sizeMultiplier × (1 + min(cumulativePnL/baseStake, 4))
 *   capped by 10% of free collateral and POLYMARKET_EDGE_MAX_STAKE_USD.
 *
 * Kill switch (24h halt):
 *   • 5 consecutive losing trades, OR
 *   • 30% drawdown from running peak PnL.
 *
 * Idempotency:
 *   • clientOrderId derived from `polyedge_${asset}_${tickEpoch}` so a
 *     retried tick within the same 5-min cron bucket cannot double-open.
 *   • getPositions() pre-flight prevents stacking across BTC/ETH-PERP.
 *
 * Security: QStash signature or CRON_SECRET. Master scheduler invokes every 5m.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { errMsg } from '@/lib/utils/error-handler';
import { BluefinService, type BluefinPosition } from '@/lib/services/sui/BluefinService';
import {
  PredictionAggregatorService,
  type AggregatedPrediction,
} from '@/lib/services/market-data/PredictionAggregatorService';
import { getCronStateOr, setCronState } from '@/lib/db/cron-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ── Tunables (env-overridable) ─────────────────────────────────────────────
const MIN_CONFIDENCE = Number(process.env.POLYMARKET_EDGE_MIN_CONFIDENCE || 60);
const MIN_CONSENSUS = Number(process.env.POLYMARKET_EDGE_MIN_CONSENSUS || 60);
const MIN_FREE_COLLATERAL_USD = Number(process.env.POLYMARKET_EDGE_MIN_COLLATERAL || 25);
const BASE_STAKE_USD = Number(process.env.POLYMARKET_EDGE_BASE_STAKE_USD || 5);
const MAX_STAKE_USD = Number(process.env.POLYMARKET_EDGE_MAX_STAKE_USD || 500);
const STAKE_PCT_OF_FREE = Number(process.env.POLYMARKET_EDGE_STAKE_PCT || 0.10);
const LEVERAGE = Number(process.env.POLYMARKET_EDGE_LEVERAGE || 3);
const MAX_CONSECUTIVE_LOSSES = 5;
const MAX_DRAWDOWN_PCT = 0.30;
const HALT_DURATION_MS = 24 * 60 * 60 * 1000;

// Per-asset min order size (BlueFin step). Mirrors MARKET_CONFIG in BluefinService.
const ASSET_MIN_QTY: Record<SupportedAsset, number> = {
  BTC: 0.001,
  ETH: 0.01,
};
const ASSET_STEP: Record<SupportedAsset, number> = {
  BTC: 0.001,
  ETH: 0.01,
};
type SupportedAsset = 'BTC' | 'ETH';
const SUPPORTED_ASSETS: SupportedAsset[] = ['BTC', 'ETH'];

// ── Cron state keys ────────────────────────────────────────────────────────
const KEY_ACTIVE = 'polymarket-edge:active-trade';
const KEY_STATS = 'polymarket-edge:stats';
const KEY_HALTED_UNTIL = 'polymarket-edge:halted-until';

interface ActiveTrade {
  symbol: string;
  asset: SupportedAsset;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  stakeUsd: number;
  recommendation: AggregatedPrediction['recommendation'];
  consensus: number;
  confidence: number;
  sourceCount: number;
  openedAt: number;
  /** Hard close time. We exit at most one master tick after open (5min). */
  closeBy: number;
  clientOrderId: string;
}

interface EdgeStats {
  trades: number;
  wins: number;
  losses: number;
  totalPnlUsd: number;
  peakPnlUsd: number;
  consecutiveLosses: number;
  lastUpdatedMs: number;
  perAsset?: Record<string, { trades: number; wins: number; pnlUsd: number }>;
}

interface EdgeResult {
  success: boolean;
  ranAt: string;
  attempted: boolean;
  action?: 'closed' | 'opened' | 'idle' | 'halted' | 'no-signal' | 'no-collateral' | 'no-edge';
  trade?: {
    symbol: string;
    asset: SupportedAsset;
    side: 'LONG' | 'SHORT';
    size: number;
    stakeUsd: number;
    consensus: number;
    confidence: number;
    sourceCount: number;
    recommendation: AggregatedPrediction['recommendation'];
  };
  closed?: {
    symbol: string;
    asset: SupportedAsset;
    realizedPnlUsd: number;
    win: boolean;
    durationS: number;
  };
  prediction?: {
    direction: AggregatedPrediction['direction'];
    recommendation: AggregatedPrediction['recommendation'];
    confidence: number;
    consensus: number;
    probability: number;
    sourceNames: string[];
  };
  /** Per-asset scan summary so the operator can audit why this asset won. */
  scan?: Record<string, {
    direction: AggregatedPrediction['direction'];
    recommendation: AggregatedPrediction['recommendation'];
    confidence: number;
    consensus: number;
    sources: number;
    score: number;
  }>;
  stats?: EdgeStats;
  haltedUntil?: number;
  reason?: string;
  error?: string;
}

const DEFAULT_STATS: EdgeStats = {
  trades: 0,
  wins: 0,
  losses: 0,
  totalPnlUsd: 0,
  peakPnlUsd: 0,
  consecutiveLosses: 0,
  lastUpdatedMs: 0,
  perAsset: {},
};

function quantize(qty: number, step: number): number {
  return Math.floor(qty / step) * step;
}

function findActivePosition(positions: BluefinPosition[], symbol: string): BluefinPosition | undefined {
  return positions.find((p) => p.symbol === symbol && Number(p.size) > 0);
}

/**
 * Map an aggregator recommendation to a hedge side. WAIT → null.
 */
function recommendationToSide(rec: AggregatedPrediction['recommendation']): 'LONG' | 'SHORT' | null {
  if (rec.includes('SHORT')) return 'SHORT';
  if (rec.includes('LONG')) return 'LONG';
  return null;
}

export async function GET(request: NextRequest): Promise<NextResponse<EdgeResult>> {
  const ranAt = new Date().toISOString();

  const auth = await verifyCronRequest(request, 'PolymarketEdgeTrader');
  if (auth !== true) {
    return NextResponse.json(
      { success: false, ranAt, attempted: false, reason: 'Unauthorized' },
      { status: 401 },
    );
  }

  const adminKey = (process.env.BLUEFIN_PRIVATE_KEY || process.env.SUI_POOL_ADMIN_KEY || '').trim();
  if (!adminKey) {
    return NextResponse.json({
      success: true,
      ranAt,
      attempted: false,
      reason: 'BLUEFIN_PRIVATE_KEY not configured',
    });
  }

  const network: 'mainnet' | 'testnet' =
    (process.env.SUI_NETWORK as 'mainnet' | 'testnet') === 'testnet' ? 'testnet' : 'mainnet';

  const [active, stats, haltedUntil] = await Promise.all([
    getCronStateOr<ActiveTrade | null>(KEY_ACTIVE, null),
    getCronStateOr<EdgeStats>(KEY_STATS, DEFAULT_STATS),
    getCronStateOr<number>(KEY_HALTED_UNTIL, 0),
  ]);

  const now = Date.now();

  try {
    const bf = BluefinService.getInstance();
    await bf.initialize(adminKey, network);

    // ── 1) If a trade is active and its hold-window has elapsed, close it ──
    if (active) {
      const expired = now >= active.closeBy;
      const positions = await bf.getPositions().catch(() => [] as BluefinPosition[]);
      const livePos = findActivePosition(positions, active.symbol);

      if (!livePos) {
        // Position vanished externally (manual close / liquidation). Reconcile.
        logger.warn('[PolymarketEdge] Active trade has no live position — clearing state', {
          asset: active.asset,
        });
        await setCronState(KEY_ACTIVE, null);
        const newStats = await applyOutcome(stats, -active.stakeUsd, active.asset);
        await maybeHalt(newStats, haltedUntil);
        return NextResponse.json({
          success: true,
          ranAt,
          attempted: true,
          action: 'closed',
          closed: {
            symbol: active.symbol,
            asset: active.asset,
            realizedPnlUsd: -active.stakeUsd,
            win: false,
            durationS: Math.round((now - active.openedAt) / 1000),
          },
          stats: newStats,
        });
      }

      if (!expired) {
        return NextResponse.json({
          success: true,
          ranAt,
          attempted: true,
          action: 'idle',
          trade: {
            symbol: active.symbol,
            asset: active.asset,
            side: active.side,
            size: active.size,
            stakeUsd: active.stakeUsd,
            consensus: active.consensus,
            confidence: active.confidence,
            sourceCount: active.sourceCount,
            recommendation: active.recommendation,
          },
          stats,
          reason: `In flight (${Math.round((active.closeBy - now) / 1000)}s remaining)`,
        });
      }

      // Hold expired → close.
      const close = await bf.closeHedge({ symbol: active.symbol }).catch((e) => ({
        success: false,
        executionPrice: 0,
        fees: 0,
        error: errMsg(e),
      }));
      const exitPrice =
        Number((close as { executionPrice?: number }).executionPrice) ||
        Number(livePos.markPrice) ||
        active.entryPrice;
      const fees = Number((close as { fees?: number }).fees) || 0;
      const dir = active.side === 'LONG' ? 1 : -1;
      const realized = (exitPrice - active.entryPrice) * active.size * dir - fees;

      const win = realized > 0;
      const newStats = await applyOutcome(stats, realized, active.asset);
      const halted = await maybeHalt(newStats, haltedUntil);

      await setCronState(KEY_ACTIVE, null);
      logger.info('[PolymarketEdge] Closed trade', {
        asset: active.asset,
        side: active.side,
        realizedUsd: realized.toFixed(4),
        win,
        consecutiveLosses: newStats.consecutiveLosses,
      });

      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'closed',
        closed: {
          symbol: active.symbol,
          asset: active.asset,
          realizedPnlUsd: realized,
          win,
          durationS: Math.round((now - active.openedAt) / 1000),
        },
        stats: newStats,
        haltedUntil: halted ? haltedUntil + HALT_DURATION_MS : undefined,
      });
    }

    // ── 2) No active trade — check halt, fetch aggregated prediction ─────
    if (haltedUntil > now) {
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'halted',
        stats,
        haltedUntil,
        reason: `Halted for ${Math.round((haltedUntil - now) / 60000)}m more`,
      });
    }

    // Multi-market scan: get a SEPARATE aggregated prediction per asset, then
    // pick the one with the strongest score (sqrt(conf*consensus) + STRONG bonus).
    // This is "AI agents looking at multiple markets and deciding smartly":
    // each asset gets its own bucket of Polymarket / Delphi / Crypto.com /
    // funding-proxy sources before scoring.
    const scan = await PredictionAggregatorService.scanAndPickBest(SUPPORTED_ASSETS, {
      minConfidence: MIN_CONFIDENCE,
      minConsensus: MIN_CONSENSUS,
      minSources: 2,
    });

    const allSummary = Object.fromEntries(
      Object.entries(scan.all).map(([a, p]) => [
        a,
        {
          direction: p.direction,
          recommendation: p.recommendation,
          confidence: Math.round(p.confidence),
          consensus: Math.round(p.consensus),
          sources: p.sources.length,
          score: Math.round(PredictionAggregatorService.scoreOpportunity(p)),
        },
      ]),
    );

    if (!scan.best) {
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-edge',
        stats,
        scan: allSummary,
        reason: 'no asset cleared confidence/consensus/source gates',
      });
    }

    const prediction = scan.best.prediction;
    const sourceNames = prediction.sources.map((s) => s.name.split(':')[0].trim());

    const side = recommendationToSide(prediction.recommendation);
    if (!side) {
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-edge',
        stats,
        scan: allSummary,
        prediction: {
          direction: prediction.direction,
          recommendation: prediction.recommendation,
          confidence: prediction.confidence,
          consensus: prediction.consensus,
          probability: prediction.probability,
          sourceNames,
        },
        reason: 'recommendation is WAIT',
      });
    }

    const asset = scan.best.asset as SupportedAsset;
    const symbol = `${asset}-PERP`;

    // Free collateral & sizing
    const free = Number(await bf.getBalance().catch(() => 0)) || 0;
    if (free < MIN_FREE_COLLATERAL_USD) {
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-collateral',
        stats,
        reason: `free=$${free.toFixed(2)} < min=$${MIN_FREE_COLLATERAL_USD}`,
      });
    }

    // Compounding × aggregator's sizeMultiplier
    const compoundMul = Math.max(1, Math.min(5, 1 + stats.totalPnlUsd / Math.max(1, BASE_STAKE_USD)));
    const targetStake = Math.min(
      BASE_STAKE_USD * compoundMul * prediction.sizeMultiplier,
      free * STAKE_PCT_OF_FREE,
      MAX_STAKE_USD,
    );
    const stakeUsd = Math.max(BASE_STAKE_USD, targetStake);

    // Need a current price for sizing. Use the BluefinService price feed.
    const md = await bf.getMarketData(symbol).catch(() => null);
    const refPrice = Number(md?.price) || 0;
    if (!refPrice) {
      return NextResponse.json({
        success: false,
        ranAt,
        attempted: true,
        stats,
        error: `Could not read ${symbol} mark price`,
      });
    }

    const notionalUsd = stakeUsd * LEVERAGE;
    const rawQty = notionalUsd / refPrice;
    const sizeQty = quantize(rawQty, ASSET_STEP[asset]);
    if (sizeQty < ASSET_MIN_QTY[asset]) {
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-collateral',
        stats,
        reason: `notional=$${notionalUsd.toFixed(2)} below ${symbol} minQuantity ${ASSET_MIN_QTY[asset]}`,
      });
    }

    // Idempotency: refuse if any of our supported perps already has a position.
    const positionsPre = await bf.getPositions().catch(() => [] as BluefinPosition[]);
    const conflict = SUPPORTED_ASSETS.some((a) => findActivePosition(positionsPre, `${a}-PERP`));
    if (conflict) {
      logger.warn('[PolymarketEdge] BTC/ETH-PERP position already exists — skipping new entry');
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-edge',
        stats,
        reason: 'pre-existing perp position',
      });
    }

    // Bucket the master tick into a 5-min epoch so retries within the same
    // tick share one clientOrderId.
    const tickEpoch = Math.floor(now / (5 * 60 * 1000));
    const clientOrderId = `polyedge_${asset}_${tickEpoch}`;

    const open = await bf.openHedge({
      symbol,
      side,
      size: sizeQty,
      leverage: LEVERAGE,
      clientOrderId,
      reason: `polyedge ${prediction.recommendation} conf=${prediction.confidence.toFixed(0)} cons=${prediction.consensus.toFixed(0)} sources=${prediction.sources.length}`,
    });

    if (!open.success) {
      logger.error('[PolymarketEdge] openHedge failed', { error: open.error });
      return NextResponse.json({
        success: false,
        ranAt,
        attempted: true,
        stats,
        error: open.error || 'openHedge returned !success',
      });
    }

    const trade: ActiveTrade = {
      symbol,
      asset,
      side,
      size: sizeQty,
      entryPrice: Number(open.executionPrice ?? refPrice) || refPrice,
      stakeUsd,
      recommendation: prediction.recommendation,
      consensus: prediction.consensus,
      confidence: prediction.confidence,
      sourceCount: prediction.sources.length,
      openedAt: now,
      // Hold for one master tick (~5 min). Master runs every 5 min; the next
      // tick will close + re-evaluate. STRONG signals get one extra tick (10m).
      closeBy: now + (prediction.recommendation.startsWith('STRONG_') ? 10 : 5) * 60 * 1000,
      clientOrderId,
    };
    await setCronState(KEY_ACTIVE, trade);

    logger.info('[PolymarketEdge] Opened trade', {
      asset,
      side,
      size: sizeQty,
      stakeUsd: stakeUsd.toFixed(2),
      compoundMul: compoundMul.toFixed(2),
      sizeMul: prediction.sizeMultiplier.toFixed(2),
      recommendation: prediction.recommendation,
      consensus: prediction.consensus.toFixed(0),
      sources: prediction.sources.length,
    });

    return NextResponse.json({
      success: true,
      ranAt,
      attempted: true,
      action: 'opened',
      trade: {
        symbol,
        asset,
        side,
        size: sizeQty,
        stakeUsd,
        consensus: prediction.consensus,
        confidence: prediction.confidence,
        sourceCount: prediction.sources.length,
        recommendation: prediction.recommendation,
      },
      prediction: {
        direction: prediction.direction,
        recommendation: prediction.recommendation,
        confidence: prediction.confidence,
        consensus: prediction.consensus,
        probability: prediction.probability,
        sourceNames,
      },
      stats,
    });
  } catch (e) {
    logger.error('[PolymarketEdge] tick failed', { error: errMsg(e) });
    return NextResponse.json(
      { success: false, ranAt, attempted: true, stats, error: errMsg(e) },
      { status: 500 },
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function applyOutcome(
  prev: EdgeStats,
  realizedUsd: number,
  asset: SupportedAsset,
): Promise<EdgeStats> {
  const perAsset = { ...(prev.perAsset || {}) };
  const cur = perAsset[asset] || { trades: 0, wins: 0, pnlUsd: 0 };
  perAsset[asset] = {
    trades: cur.trades + 1,
    wins: cur.wins + (realizedUsd > 0 ? 1 : 0),
    pnlUsd: cur.pnlUsd + realizedUsd,
  };

  const next: EdgeStats = {
    trades: prev.trades + 1,
    wins: prev.wins + (realizedUsd > 0 ? 1 : 0),
    losses: prev.losses + (realizedUsd <= 0 ? 1 : 0),
    totalPnlUsd: prev.totalPnlUsd + realizedUsd,
    peakPnlUsd: Math.max(prev.peakPnlUsd, prev.totalPnlUsd + realizedUsd),
    consecutiveLosses: realizedUsd > 0 ? 0 : prev.consecutiveLosses + 1,
    lastUpdatedMs: Date.now(),
    perAsset,
  };
  await setCronState(KEY_STATS, next);
  return next;
}

async function maybeHalt(stats: EdgeStats, currentHaltUntil: number): Promise<boolean> {
  const drawdown = stats.peakPnlUsd > 0 ? (stats.peakPnlUsd - stats.totalPnlUsd) / stats.peakPnlUsd : 0;
  const tripLosses = stats.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES;
  const tripDrawdown = drawdown >= MAX_DRAWDOWN_PCT && stats.peakPnlUsd > 0;
  if (tripLosses || tripDrawdown) {
    const until = Date.now() + HALT_DURATION_MS;
    await setCronState(KEY_HALTED_UNTIL, until);
    logger.warn('[PolymarketEdge] KILL SWITCH TRIPPED — halting 24h', {
      consecutiveLosses: stats.consecutiveLosses,
      drawdown,
      totalPnlUsd: stats.totalPnlUsd,
    });
    return true;
  }
  return currentHaltUntil > Date.now();
}
