/**
 * Cron Job: Multi-Market Edge Trader (per-asset aggregated → BlueFin perp)
 *
 * Pipeline (every 5-min master tick):
 *
 *   1. Reconcile any active trade.
 *      • If position is missing on Bluefin → book worst-case loss.
 *      • If hold expired → close and book realized PnL.
 *      • If hold still active → re-fetch the per-asset prediction and
 *        EARLY-EXIT if the winning recommendation flipped, dropped below
 *        `LIGHT_*`, or its score collapsed by >50% (signal-flip stop).
 *      • Else hold.
 *
 *   2. Risk gates (every potential entry):
 *      • Halt window not active.
 *      • Daily PnL not below cap (`-2 × BASE_STAKE_USD` by default).
 *      • Free collateral on Bluefin ≥ MIN_FREE_COLLATERAL_USD.
 *      • Multi-source aggregator score passes the asset gate.
 *      • Funding-rate guard inside Bluefin SDK still active (we let the
 *        SDK reject SHORTs paying >0.0001 / 8h funding).
 *      • SLIPPAGE GATE: post-fill, compare avgFillPrice vs ref mark; if
 *        the slippage exceeds POLYMARKET_EDGE_MAX_SLIPPAGE_BPS the trade
 *        is closed immediately and counted as a loss-equivalent.
 *
 *   3. Multi-market scan: `PredictionAggregatorService.scanAndPickBest`
 *      builds per-asset evidence buckets from
 *        • Polymarket 5-min BTC binary           (BTC bucket only)
 *        • Delphi/Polymarket markets tagged by asset
 *        • Crypto.com 24h ticker
 *        • REAL Bluefin funding rate (per asset)
 *      and picks the highest score (sqrt(conf × consensus) × breadth +
 *      STRONG bonus) clearing the gates.
 *
 *   4. Sizing:
 *        stake = baseStake × sizeMultiplier × (1 + min(cumPnL/baseStake, 4))
 *        capped by 10% of free collateral and POLYMARKET_EDGE_MAX_STAKE_USD.
 *
 *   5. Kill switch (24h halt) on any of:
 *        • 5 consecutive losing trades, OR
 *        • 30% drawdown from running peak PnL, OR
 *        • daily realized PnL ≤ DAILY_LOSS_CAP_USD.
 *      Trips emit a Discord notification.
 *
 *   6. Idempotency:
 *        • clientOrderId = `polyedge_${asset}_${tickEpoch}` so a retried
 *          tick within the same 5-min cron bucket cannot double-open.
 *        • getPositions() pre-flight prevents stacking across BTC/ETH-PERP.
 *        • Bluefin server-side enforces clientOrderId uniqueness.
 *
 * Security: QStash signature or CRON_SECRET. Master scheduler invokes every 5m.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { errMsg } from '@/lib/utils/error-handler';
import { computeEdgeStake } from '@/lib/services/trading/edge-sizing';
import { notifyDiscord } from '@/lib/utils/discord-notify';
import { BluefinService, type BluefinPosition } from '@/lib/services/sui/BluefinService';
import { safeBluefinSnapshot } from '@/lib/services/sui/bluefin-read-safe';
import {
  PredictionAggregatorService,
  type AggregatedPrediction,
} from '@/lib/services/market-data/PredictionAggregatorService';
import { getCronStateOr, setCronState } from '@/lib/db/cron-state';
import {
  SUPPORTED_ASSETS,
  ASSET_MIN_QTY,
  ASSET_STEP,
  type SupportedAsset,
} from '@/lib/config/trader-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ── Tunables (env-overridable) ─────────────────────────────────────────────
// Defaults lowered 2026-06-22 from 60/60 → 55/50. Trader had been
// returning action='no-edge' every 5-min tick because BTC/ETH 5-min
// binaries rarely hit BOTH thresholds at 60 simultaneously in normal
// market regimes. Loosening lets the cron act on moderate-conviction
// signals (still rejects WEAK), and the per-trade size + daily-loss-
// cap + 24h kill switch still cap downside. Env override remains for
// emergency tightening without a deploy.
const MIN_CONFIDENCE = Number(process.env.POLYMARKET_EDGE_MIN_CONFIDENCE || 55);
const MIN_CONSENSUS = Number(process.env.POLYMARKET_EDGE_MIN_CONSENSUS || 50);
const MIN_FREE_COLLATERAL_USD = Number(process.env.POLYMARKET_EDGE_MIN_COLLATERAL || 15);
const BASE_STAKE_USD = Number(process.env.POLYMARKET_EDGE_BASE_STAKE_USD || 5);
const MAX_STAKE_USD = Number(process.env.POLYMARKET_EDGE_MAX_STAKE_USD || 500);
const STAKE_PCT_OF_FREE = Number(process.env.POLYMARKET_EDGE_STAKE_PCT || 0.10);
const LEVERAGE = Number(process.env.POLYMARKET_EDGE_LEVERAGE || 3);
const MAX_CONSECUTIVE_LOSSES = Number(process.env.POLYMARKET_EDGE_MAX_CONSECUTIVE_LOSSES || 5);
const MAX_DRAWDOWN_PCT = Number(process.env.POLYMARKET_EDGE_MAX_DRAWDOWN_PCT || 0.30);
const HALT_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_SLIPPAGE_BPS = Number(process.env.POLYMARKET_EDGE_MAX_SLIPPAGE_BPS || 30); // 0.30%
const DAILY_LOSS_CAP_USD = Number(
  process.env.POLYMARKET_EDGE_DAILY_LOSS_CAP_USD || -2 * BASE_STAKE_USD,
);

// Multi-asset universe — see lib/config/trader-assets.ts. Rationale:
//   BTC: minQty $60 notional (needs $30 stake at 3x lev). Traded when pool ≥ $200.
//   ETH: minQty $16 notional (needs $8 stake at 3x). Traded when pool ≥ $50.
//   SUI: minQty $0.72 notional (needs $0.36 stake at 3x). Traded at any NAV. ← THE PRIZE
//   SOL: minQty $14 notional (needs $7 stake at 3x). Traded when pool ≥ $40.
// The trader picks the highest-scoring viable signal each tick. Assets whose
// required stake exceeds MAX_STAKE_PCT_OF_FREE_FOR_MIN_QTY (70% of free) are
// skipped for that tick. Env override:
//   POLYMARKET_EDGE_ASSETS=BTC,ETH,SUI,SOL   ← default

// ── Cron state keys ────────────────────────────────────────────────────────
const KEY_ACTIVE = 'polymarket-edge:active-trade';
const KEY_STATS = 'polymarket-edge:stats';
const KEY_HALTED_UNTIL = 'polymarket-edge:halted-until';
const KEY_DAILY = 'polymarket-edge:daily';
// Records why the last tick did not open a trade. Small helper: gives
// operators a single lookup ("why is the trader idle?") without grepping
// serverless logs across many invocations.
const KEY_LAST_SKIP = 'polymarket-edge:last-skip';
// Consecutive no-edge counter for adaptive gate relaxation. Resets on
// any successful trade or non-no-edge skip. Increments on every
// no-edge skip. Relaxation kicks in after RELAX_AFTER_N_SKIPS.
const KEY_NOEDGE_STREAK = 'polymarket-edge:noedge-streak';

// ── Adaptive gate relaxation ───────────────────────────────────────────────
// If the trader has skipped with 'no-edge' for many consecutive ticks,
// slowly lower the effective confidence/consensus thresholds. This
// self-heals from operator misconfig (e.g. env vars set to 70/70 when
// live signals peak at 65-70) without needing a redeploy or env change.
// Bounded floor at 45/45 so we never trade on genuine noise.
const RELAX_AFTER_N_SKIPS = 12;    // ~1 hour of 5-min ticks
const RELAX_STEP_PER_HOUR = 5;     // lower gates by 5 per hour of stuck ticks
const RELAX_FLOOR_CONFIDENCE = 45;
const RELAX_FLOOR_CONSENSUS = 45;

function effectiveGates(
  configuredConf: number,
  configuredCons: number,
  noEdgeStreak: number,
): { effectiveConf: number; effectiveCons: number; relaxSteps: number } {
  if (noEdgeStreak < RELAX_AFTER_N_SKIPS) {
    return { effectiveConf: configuredConf, effectiveCons: configuredCons, relaxSteps: 0 };
  }
  // Number of 12-tick "hours" past the initial patience period.
  const relaxSteps = Math.floor((noEdgeStreak - RELAX_AFTER_N_SKIPS) / RELAX_AFTER_N_SKIPS) + 1;
  const relaxAmount = relaxSteps * RELAX_STEP_PER_HOUR;
  return {
    effectiveConf: Math.max(RELAX_FLOOR_CONFIDENCE, configuredConf - relaxAmount),
    effectiveCons: Math.max(RELAX_FLOOR_CONSENSUS, configuredCons - relaxAmount),
    relaxSteps,
  };
}

async function recordSkip(action: string, reason: string): Promise<void> {
  try {
    await setCronState(KEY_LAST_SKIP, {
      at: Date.now(),
      action,
      reason,
    });
  } catch {
    /* non-critical — don't fail the tick because we couldn't record a diagnostic */
  }
}

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
  /** Score at entry — used for signal-flip stop comparison. */
  entryScore: number;
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

/** Daily realized-PnL bucket — auto-resets when UTC day changes. */
interface DailyStats {
  utcDayKey: string; // YYYY-MM-DD
  pnlUsd: number;
  trades: number;
}

interface EdgeResult {
  success: boolean;
  ranAt: string;
  attempted: boolean;
  action?:
    | 'closed'
    | 'opened'
    | 'idle'
    | 'halted'
    | 'no-signal'
    | 'no-collateral'
    | 'no-edge'
    | 'signal-flip-exit'
    | 'slippage-exit'
    | 'daily-cap'
    | 'skip-asset-too-small-nav';
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
  daily?: DailyStats;
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

function isActionable(rec: AggregatedPrediction['recommendation']): boolean {
  return rec.startsWith('HEDGE_') || rec.startsWith('STRONG_');
}

function utcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * In-process risk gate (mirrors RiskAgent's invariants without needing
 * an LLM round-trip on the cron hot-path). Refusing here is conservative:
 *   • leverage ≤ 5
 *   • notional ≤ 10% of free collateral × leverage
 *   • size > min step
 *   • symbol in supported set
 *   • not entering with stale market data (md.price within ±10% of last 24h)
 */
function riskGate(args: {
  symbol: string;
  asset: SupportedAsset;
  side: 'LONG' | 'SHORT';
  sizeQty: number;
  notionalUsd: number;
  free: number;
  refPrice: number;
}): { ok: true } | { ok: false; reason: string } {
  if (LEVERAGE > 5) return { ok: false, reason: `leverage ${LEVERAGE} > 5x cap` };
  if (args.sizeQty < ASSET_MIN_QTY[args.asset]) {
    return { ok: false, reason: `size ${args.sizeQty} < ${ASSET_MIN_QTY[args.asset]}` };
  }
  if (args.refPrice <= 0) return { ok: false, reason: 'no ref price' };
  // Notional vs free collateral × leverage.
  const maxNotional = args.free * LEVERAGE;
  if (args.notionalUsd > maxNotional * 0.5) {
    return {
      ok: false,
      reason: `notional $${args.notionalUsd.toFixed(2)} > 50% of capacity $${maxNotional.toFixed(2)}`,
    };
  }
  return { ok: true };
}

export async function GET(request: NextRequest): Promise<NextResponse<EdgeResult>> {
  const ranAt = new Date().toISOString();
  // AWAIT the heartbeat — fire-and-forget gets dropped by Vercel's
  // serverless suspension after response (observed 2026-06-22: trader
  // ran successfully via manual trigger, returned full payload, but
  // health endpoint still showed 'traderCron: no entry yet' because
  // the void setCronState write didn't complete before the lambda
  // suspended). Awaiting adds ~50ms but guarantees the heartbeat
  // lands.
  await setCronState('cron:lastRun:polymarket-edge-trader', Date.now()).catch(() => {});

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

  const [active, stats, haltedUntil, dailyRaw] = await Promise.all([
    getCronStateOr<ActiveTrade | null>(KEY_ACTIVE, null),
    getCronStateOr<EdgeStats>(KEY_STATS, DEFAULT_STATS),
    getCronStateOr<number>(KEY_HALTED_UNTIL, 0),
    getCronStateOr<DailyStats>(KEY_DAILY, { utcDayKey: '', pnlUsd: 0, trades: 0 }),
  ]);

  // Migrate stats: never silently zero peakPnlUsd if it was set previously
  // and the new fetch returned defaults (e.g. transient DB error). We treat
  // a default value as missing and fall back to a safe "no peak yet" zero.
  const safeStats: EdgeStats = {
    ...DEFAULT_STATS,
    ...stats,
    peakPnlUsd: Math.max(stats.peakPnlUsd || 0, stats.totalPnlUsd || 0),
    perAsset: stats.perAsset || {},
  };

  const now = Date.now();
  const today = utcDayKey(now);
  const daily: DailyStats = dailyRaw.utcDayKey === today
    ? dailyRaw
    : { utcDayKey: today, pnlUsd: 0, trades: 0 };

  try {
    const bf = BluefinService.getInstance();
    await bf.initialize(adminKey, network);

    // ── 0) Refresh shared BlueFin cache for downstream NAV / health
    //    consumers. This cron runs every 5 min and already needs both
    //    getBalance and getPositions — using them to keep the
    //    `bluefin:nav-last-good` cache hot gives the pool a SECOND
    //    5-min cache writer alongside bluefin-health, so a single-cron
    //    failure can't stale the cache.
    try {
      const [bal, pos] = await Promise.all([
        bf.getBalance().catch(() => 0),
        bf.getPositions().catch(() => [] as BluefinPosition[]),
      ]);
      const { refreshBluefinCache } = await import('@/lib/services/sui/bluefin-read-safe');
      await refreshBluefinCache({
        free: Number(bal) || 0,
        positions: pos as unknown as Array<Record<string, unknown>>,
        source: 'polymarket-edge-trader',
      });
    } catch { /* best-effort; trader loop continues below */ }

    // ── 1) If a trade is active ─────────────────────────────────────────
    if (active) {
      const positions = await bf.getPositions().catch(() => [] as BluefinPosition[]);
      const livePos = findActivePosition(positions, active.symbol);

      if (!livePos) {
        // Position vanished externally (manual close / liquidation). Reconcile
        // as a worst-case loss bounded by the staked margin.
        logger.warn('[PolymarketEdge] Active trade has no live position — clearing state', {
          asset: active.asset,
        });
        await setCronState(KEY_ACTIVE, null);
        const newStats = await applyOutcome(safeStats, -active.stakeUsd, active.asset);
        const newDaily = await applyDaily(daily, -active.stakeUsd);
        const halted = await maybeHalt(newStats, newDaily, haltedUntil);
        await notifyDiscord(
          `Position vanished — booked as -$${active.stakeUsd.toFixed(2)} loss`,
          'WARN',
          { asset: active.asset, side: active.side, size: active.size },
        );
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
          daily: newDaily,
          haltedUntil: halted ? haltedUntil + HALT_DURATION_MS : undefined,
        });
      }

      const expired = now >= active.closeBy;

      // Signal-flip stop: if hold not yet expired, re-fetch the per-asset
      // prediction and exit early when the recommendation flipped against
      // us, demoted to LIGHT/WAIT, or its score collapsed >50% from entry.
      if (!expired) {
        let flipReason: string | null = null;
        try {
          const liveScan = await PredictionAggregatorService.scanAndPickBest(
            SUPPORTED_ASSETS,
            { minConfidence: 0, minConsensus: 0, minSources: 1 },
          );
          const livePred = liveScan.all[active.asset];
          if (livePred) {
            const liveSide = recommendationToSide(livePred.recommendation);
            const liveScore = PredictionAggregatorService.scoreOpportunity(livePred);
            if (liveSide !== active.side) {
              flipReason = `recommendation flipped: ${livePred.recommendation}`;
            } else if (!isActionable(livePred.recommendation)) {
              flipReason = `recommendation demoted to ${livePred.recommendation}`;
            } else if (liveScore < active.entryScore * 0.5) {
              flipReason = `score collapsed ${active.entryScore.toFixed(0)} → ${liveScore.toFixed(0)}`;
            }
          }
        } catch (e) {
          logger.debug('[PolymarketEdge] re-scan failed (non-fatal)', { error: errMsg(e) });
        }

        if (!flipReason) {
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
            stats: safeStats,
            daily,
            reason: `In flight (${Math.round((active.closeBy - now) / 1000)}s remaining)`,
          });
        }

        logger.warn('[PolymarketEdge] Signal-flip exit', { flipReason, asset: active.asset });
        const close = await closeWithRetry(bf, active.symbol);
        const exitPrice = pickExitPrice(close, livePos.markPrice, active.entryPrice);
        const fees = Number((close as { fees?: number }).fees) || 0;
        const dir = active.side === 'LONG' ? 1 : -1;
        const realized = (exitPrice - active.entryPrice) * active.size * dir - fees;
        const newStats = await applyOutcome(safeStats, realized, active.asset);
        const newDaily = await applyDaily(daily, realized);
        const halted = await maybeHalt(newStats, newDaily, haltedUntil);
        await setCronState(KEY_ACTIVE, null);
        await notifyDiscord(
          `Signal-flip exit: ${flipReason}. Realized $${realized.toFixed(2)}`,
          realized >= 0 ? 'TRADE' : 'WARN',
          { asset: active.asset, side: active.side, exitPrice, entry: active.entryPrice },
        );
        return NextResponse.json({
          success: true,
          ranAt,
          attempted: true,
          action: 'signal-flip-exit',
          closed: {
            symbol: active.symbol,
            asset: active.asset,
            realizedPnlUsd: realized,
            win: realized > 0,
            durationS: Math.round((now - active.openedAt) / 1000),
          },
          stats: newStats,
          daily: newDaily,
          haltedUntil: halted ? haltedUntil + HALT_DURATION_MS : undefined,
          reason: flipReason,
        });
      }

      // Hold expired → close.
      const close = await closeWithRetry(bf, active.symbol);
      const exitPrice = pickExitPrice(close, livePos.markPrice, active.entryPrice);
      const fees = Number((close as { fees?: number }).fees) || 0;
      const dir = active.side === 'LONG' ? 1 : -1;
      const realized = (exitPrice - active.entryPrice) * active.size * dir - fees;

      const win = realized > 0;
      const newStats = await applyOutcome(safeStats, realized, active.asset);
      const newDaily = await applyDaily(daily, realized);
      const halted = await maybeHalt(newStats, newDaily, haltedUntil);

      await setCronState(KEY_ACTIVE, null);
      logger.info('[PolymarketEdge] Closed trade', {
        asset: active.asset,
        side: active.side,
        realizedUsd: realized.toFixed(4),
        win,
        consecutiveLosses: newStats.consecutiveLosses,
      });
      await notifyDiscord(
        `Closed ${active.asset}-PERP ${active.side}: ${win ? 'WIN' : 'LOSS'} $${realized.toFixed(2)}`,
        win ? 'TRADE' : 'WARN',
        {
          entry: active.entryPrice,
          exit: exitPrice,
          fees,
          stake: active.stakeUsd,
          totalPnl: newStats.totalPnlUsd,
        },
      );

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
        daily: newDaily,
        haltedUntil: halted ? haltedUntil + HALT_DURATION_MS : undefined,
      });
    }

    // ── 2) No active trade — check halt & daily cap ──────────────────────
    if (haltedUntil > now) {
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'halted',
        stats: safeStats,
        daily,
        haltedUntil,
        reason: `Halted for ${Math.round((haltedUntil - now) / 60000)}m more`,
      });
    }
    if (daily.pnlUsd <= DAILY_LOSS_CAP_USD) {
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'daily-cap',
        stats: safeStats,
        daily,
        reason: `daily PnL $${daily.pnlUsd.toFixed(2)} ≤ cap $${DAILY_LOSS_CAP_USD.toFixed(2)}`,
      });
    }

    // Multi-market scan: get a SEPARATE aggregated prediction per asset, then
    // pick the one with the strongest score (sqrt(conf*consensus) + STRONG bonus).
    // This is "AI agents looking at multiple markets and deciding smartly":
    // each asset gets its own bucket of Polymarket / Delphi / Crypto.com /
    // funding-proxy sources before scoring.
    // Load the consecutive no-edge streak counter and derive effective
    // gates. If the operator set MIN_CONFIDENCE/MIN_CONSENSUS above what
    // real signals can achieve, this progressively relaxes them over
    // an hour of skips so the trader can eventually fire.
    const noEdgeStreak = await getCronStateOr<number>(KEY_NOEDGE_STREAK, 0);
    const { effectiveConf, effectiveCons, relaxSteps } = effectiveGates(
      MIN_CONFIDENCE,
      MIN_CONSENSUS,
      noEdgeStreak,
    );
    if (relaxSteps > 0) {
      logger.info('[PolymarketEdge] Gates relaxed due to prolonged no-edge streak', {
        noEdgeStreak,
        configuredConf: MIN_CONFIDENCE,
        configuredCons: MIN_CONSENSUS,
        effectiveConf,
        effectiveCons,
        relaxSteps,
      });
    }
    const scan = await PredictionAggregatorService.scanAndPickBest(SUPPORTED_ASSETS, {
      minConfidence: effectiveConf,
      minConsensus: effectiveCons,
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
      // Log per-asset scoring so operators can see WHY nothing cleared.
      // Compact digest small enough for cron_state.
      const rejectionDigest = Object.entries(scan.all)
        .map(([a, p]) => `${a}:${p.recommendation}/${Math.round(p.confidence)}/${Math.round(p.consensus)}/${p.sources.length}s`)
        .join(' ');
      const relaxTag = relaxSteps > 0
        ? ` (relaxed from ${MIN_CONFIDENCE}/${MIN_CONSENSUS} after ${noEdgeStreak} skips)`
        : '';
      await recordSkip(
        'no-edge',
        `no asset cleared gates. Per-asset (rec/conf/cons/srcs): ${rejectionDigest}. Effective gates: conf>=${effectiveConf}, cons>=${effectiveCons}, srcs>=2${relaxTag}`,
      );
      // Increment the consecutive no-edge counter — drives adaptive
      // relaxation on the next tick.
      await setCronState(KEY_NOEDGE_STREAK, noEdgeStreak + 1).catch(() => {});
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-edge',
        stats: safeStats,
        daily,
        scan: allSummary,
        reason: 'no asset cleared confidence/consensus/source gates',
      });
    }
    // Reset the no-edge streak whenever we DO clear the gates — even
    // if a later step (minQty walk, risk gate, etc.) prevents the
    // trade from opening. Once we can find a directional signal,
    // the "prolonged no-edge" state is over.
    if (noEdgeStreak > 0) {
      await setCronState(KEY_NOEDGE_STREAK, 0).catch(() => {});
    }

    // Rank ALL directional candidates by score so we can walk them if the
    // top pick fails the minQty affordability check further down. Without
    // this walk, the trader silently no-ops for weeks whenever BTC (usual
    // top pick) can't clear minQty on a small pool — even though ETH or
    // SUI with much smaller minQty would trade the same signal.
    const rankedCandidates = Object.entries(scan.all)
      .map(([a, p]) => ({
        asset: a as SupportedAsset,
        prediction: p,
        score: PredictionAggregatorService.scoreOpportunity(p),
        side: recommendationToSide(p.recommendation),
      }))
      .filter((c) => c.side !== null && Number.isFinite(c.score))
      .sort((a, b) => b.score - a.score);

    if (rankedCandidates.length === 0) {
      const bestPrediction = scan.best.prediction;
      await recordSkip('no-edge', 'no directional recommendation across universe');
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-edge',
        stats: safeStats,
        daily,
        scan: allSummary,
        prediction: {
          direction: bestPrediction.direction,
          recommendation: bestPrediction.recommendation,
          confidence: bestPrediction.confidence,
          consensus: bestPrediction.consensus,
          probability: bestPrediction.probability,
          sourceNames: bestPrediction.sources.map((s) => s.name.split(':')[0].trim()),
        },
        reason: 'all candidates are WAIT / no directional recommendation',
      });
    }

    // Provisionally use the top-ranked candidate; the minQty affordability
    // walk below may downgrade to a lower-scored candidate when the top
    // pick is too expensive for the pool.
    let asset = rankedCandidates[0].asset;
    let prediction = rankedCandidates[0].prediction;
    let side = rankedCandidates[0].side!;
    let symbol = `${asset}-PERP`;
    let sourceNames = prediction.sources.map((s) => s.name.split(':')[0].trim());

    // Free collateral & sizing.
    //
    // The absolute MIN_FREE_COLLATERAL_USD floor (default $15) was a
    // silent no-op on small pools: a $50-NAV pool with ~$29 in BlueFin
    // collateral and one active hedge locking $16 margin has ~$13 free.
    // The trader would refuse to open every 5-min tick because $13 < $15,
    // even though the actual stake it wants to place is only ~$5.
    //
    // Small-pool relief: cap the effective floor at 2× BASE_STAKE_USD.
    // Operators still get their configured threshold on any pool where
    // that threshold is ≤ 2× the stake (i.e. large pools where the
    // absolute floor is small relative to trade size). Small pools get
    // the relaxed 2×-stake requirement, which is the actual amount the
    // trader will spend + 1 stake of headroom for slippage.
    //
    // Use safeBluefinSnapshot so a transient venue API blip (empty
    // getBalance response) falls back to the last-good cache rather
    // than freezing the trader for hours. `onChainHasExposure: true`
    // means "if venue reports empty AND we have active hedges, prefer
    // cache" — the trader is by definition operating on a chain where
    // it opens hedges, so any hedge id it has ever created counts as
    // exposure. Observed 2026-07-10: 9 consecutive empty BlueFin reads
    // caused the trader to skip 45 minutes of a STRONG_HEDGE_LONG BTC
    // signal at 83% confidence.
    const bfSnap = await safeBluefinSnapshot({
      network: (process.env.BLUEFIN_NETWORK || process.env.SUI_NETWORK || 'mainnet') as 'mainnet' | 'testnet',
      onChainHasExposure: true,
    });
    const free = bfSnap.free;
    if (bfSnap.source !== 'live') {
      logger.info('[PolymarketEdge] Using cached BlueFin snapshot', {
        source: bfSnap.source, ageMs: bfSnap.ageMs, free, warning: bfSnap.warning,
      });
    }
    const effectiveMinFree = Math.min(MIN_FREE_COLLATERAL_USD, BASE_STAKE_USD * 2);
    if (free < effectiveMinFree) {
      const reason = `free=$${free.toFixed(2)} < effective-min=$${effectiveMinFree.toFixed(2)} (configured min=$${MIN_FREE_COLLATERAL_USD}, base-stake=$${BASE_STAKE_USD}, bf-source=${bfSnap.source})`;
      await recordSkip('no-collateral', reason);
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-collateral',
        stats: safeStats,
        daily,
        reason,
      });
    }

    // ── MIN-QTY-AWARE CANDIDATE WALK ────────────────────────────────
    // Fetch reference prices for every ranked candidate in parallel so
    // we can rank affordability without adding round-trips. Then walk
    // candidates highest-score first and pick the first one whose
    // minQty stake fits inside MAX_STAKE_PCT_OF_FREE_FOR_MIN_QTY of
    // the pool's free collateral.
    const OPEN_BUFFER = 1.5;             // matches BluefinService dust guard
    const MAX_STAKE_PCT_OF_FREE_FOR_MIN_QTY = 0.7; // hard cap: don't spend >70% of free collateral clearing minQty

    const priceFetches = await Promise.all(
      rankedCandidates.map(async (c) => {
        const md = await bf.getMarketData(`${c.asset}-PERP`).catch(() => null);
        return { asset: c.asset, refPrice: Number(md?.price) || 0 };
      }),
    );
    const priceMap = new Map(priceFetches.map((p) => [p.asset, p.refPrice]));

    let compoundMul = 1;
    let stakeUsd = BASE_STAKE_USD;
    let effectiveStake = BASE_STAKE_USD;
    let refPrice = 0;
    let picked: (typeof rankedCandidates)[number] | null = null;
    const rejectedForMinQty: string[] = [];

    for (const c of rankedCandidates) {
      const rp = priceMap.get(c.asset) || 0;
      if (rp <= 0) {
        rejectedForMinQty.push(`${c.asset}: no mark price`);
        continue;
      }
      const cStake = computeEdgeStake({
        baseStakeUsd: BASE_STAKE_USD,
        totalPnlUsd: safeStats.totalPnlUsd,
        sizeMultiplier: c.prediction.sizeMultiplier,
        freeCollateral: free,
        stakePctOfFree: STAKE_PCT_OF_FREE,
        maxStakeUsd: MAX_STAKE_USD,
      });
      const actualMinQty = ASSET_STEP[c.asset];
      const minNotionalToClearFloor = actualMinQty * rp * OPEN_BUFFER;
      const minStakeToClearFloor = minNotionalToClearFloor / LEVERAGE;
      const requiredStakeUsd = Math.max(cStake.stakeUsd, minStakeToClearFloor);
      const requiredStakePct = requiredStakeUsd / free;
      if (requiredStakePct > MAX_STAKE_PCT_OF_FREE_FOR_MIN_QTY) {
        rejectedForMinQty.push(
          `${c.asset}: needs $${requiredStakeUsd.toFixed(2)} stake (${(requiredStakePct * 100).toFixed(1)}% of free)`,
        );
        continue;
      }
      // Found an affordable candidate — pin it and break.
      picked = c;
      asset = c.asset;
      prediction = c.prediction;
      side = c.side!;
      symbol = `${asset}-PERP`;
      sourceNames = prediction.sources.map((s) => s.name.split(':')[0].trim());
      compoundMul = cStake.compoundMul;
      stakeUsd = cStake.stakeUsd;
      effectiveStake = requiredStakeUsd;
      refPrice = rp;
      if (requiredStakeUsd > cStake.stakeUsd) {
        logger.info('[PolymarketEdge] auto-bumping stake to clear minQty', {
          asset, originalStake: cStake.stakeUsd.toFixed(2),
          bumpedStake: requiredStakeUsd.toFixed(2),
          originalPct: (cStake.stakeUsd / free * 100).toFixed(1),
          bumpedPct: (requiredStakeUsd / free * 100).toFixed(1),
        });
      }
      if (c !== rankedCandidates[0]) {
        logger.info('[PolymarketEdge] fell back from top-ranked candidate', {
          topRanked: rankedCandidates[0].asset,
          picked: c.asset,
          reason: 'top-ranked failed minQty affordability check',
          rejected: rejectedForMinQty,
        });
      }
      break;
    }

    if (!picked) {
      const skipReason = `all candidates fail minQty check on free=$${free.toFixed(2)}. Rejects: ${rejectedForMinQty.join('; ')}`;
      await recordSkip('skip-asset-too-small-nav', skipReason);
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'skip-asset-too-small-nav',
        stats: safeStats,
        daily,
        reason: skipReason,
      });
    }

    const notionalUsd = effectiveStake * LEVERAGE;
    const rawQty = notionalUsd / refPrice;
    const sizeQty = quantize(rawQty, ASSET_STEP[asset]);

    // Risk gate (mirrors RiskAgent invariants without an LLM round-trip).
    const risk = riskGate({
      symbol,
      asset,
      side,
      sizeQty,
      notionalUsd,
      free,
      refPrice,
    });
    if (!risk.ok) {
      logger.warn('[PolymarketEdge] risk gate blocked entry', { reason: risk.reason });
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-edge',
        stats: safeStats,
        daily,
        reason: `risk-gate: ${risk.reason}`,
      });
    }

    // Idempotency: refuse if THIS asset's perp already has a position.
    // Previously blocked ANY supported perp — meaning an open ETH trade
    // blocked SUI trades even though they're independent bets. Per-asset
    // check unblocks concurrent multi-market opportunities.
    const positionsPre = await bf.getPositions().catch(() => [] as BluefinPosition[]);
    const conflict = !!findActivePosition(positionsPre, symbol);
    if (conflict) {
      logger.warn(`[PolymarketEdge] ${symbol} position already exists — skipping new entry`);
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-edge',
        stats: safeStats,
        daily,
        reason: `pre-existing ${symbol} position (other assets can still trade)`,
      });
    }

    // Bucket the master tick into a 5-min epoch so retries within the same
    // tick share one clientOrderId.
    const tickEpoch = Math.floor(now / (5 * 60 * 1000));
    const clientOrderId = `polyedge_${asset}_${tickEpoch}`;

    // ── AGENT GATE — AG2 + AG4 ──────────────────────────────────────────
    // Same SafeExecutionGuard + HedgingAgent gate as sui-community-pool.
    // The polymarket-edge-trader previously had its OWN inline risk gate
    // ("mirrors RiskAgent's invariants without needing the actual agent");
    // this unifies it under the same authoritative path so both crons share
    // limits, cooldowns, and circuit breakers.
    const { checkBeforeTrade, completeTrade } = await import('@/lib/services/agents/agent-trade-guard');
    const guard = await checkBeforeTrade({
      chain: 'sui',
      asset,
      intendedSide: side as 'LONG' | 'SHORT',
      notionalUsd,
      agentSource: 'polymarket-edge-trader',
    });

    if (!guard.approved) {
      logger.warn('[PolymarketEdge] Agent guard BLOCKED', {
        asset, side, notionalUsd, stage: guard.stage, reason: guard.reason,
      });
      await notifyDiscord(
        `🛡️ PolymarketEdge agent-guard blocked ${asset} ${side} ($${notionalUsd.toFixed(2)}): ${guard.reason}`,
        'WARN',
        { stage: guard.stage, asset, side, agentSide: guard.agentSide, agentConfidence: guard.agentConfidence },
      );
      return NextResponse.json({
        success: false,
        ranAt,
        attempted: false,
        blockedBy: 'agent-guard',
        stage: guard.stage,
        reason: guard.reason,
        stats: safeStats,
        daily,
      });
    }

    const open = await bf.openHedge({
      symbol,
      side,
      size: sizeQty,
      leverage: LEVERAGE,
      clientOrderId,
      reason: `polyedge ${prediction.recommendation} conf=${prediction.confidence.toFixed(0)} cons=${prediction.consensus.toFixed(0)} sources=${prediction.sources.length} | agent: ${guard.reason}`,
    });

    // Settle the SafeGuard execution counter regardless of outcome
    try {
      await completeTrade(guard, {
        chain: 'sui', asset,
        intendedSide: side as 'LONG' | 'SHORT',
        notionalUsd,
        orderId: open.orderId ?? null,
        success: !!open.success,
        error: open.error,
      });
    } catch {
      // best-effort; never break trade execution
    }

    if (!open.success) {
      logger.error('[PolymarketEdge] openHedge failed', { error: open.error });
      return NextResponse.json({
        success: false,
        ranAt,
        attempted: true,
        stats: safeStats,
        daily,
        error: open.error || 'openHedge returned !success',
      });
    }

    const fillPrice = Number(open.executionPrice ?? refPrice) || refPrice;

    // SLIPPAGE GATE — if we filled outside the budget, close immediately
    // and book the round-trip cost (entry slip + exit slip + fees) as a
    // loss. This converts a runaway market-impact event into a bounded
    // small loss instead of holding a structurally bad position.
    const slipBps = Math.abs((fillPrice - refPrice) / refPrice) * 10_000;
    if (slipBps > MAX_SLIPPAGE_BPS) {
      logger.warn('[PolymarketEdge] Slippage exceeded — emergency close', {
        slipBps: slipBps.toFixed(1),
        limit: MAX_SLIPPAGE_BPS,
        fill: fillPrice,
        ref: refPrice,
      });
      const close = await closeWithRetry(bf, symbol);
      const exitPrice = pickExitPrice(close, refPrice, fillPrice);
      const fees = (Number(open.fees) || 0) + (Number((close as { fees?: number }).fees) || 0);
      const dir = side === 'LONG' ? 1 : -1;
      const realized = (exitPrice - fillPrice) * sizeQty * dir - fees;
      const newStats = await applyOutcome(safeStats, realized, asset);
      const newDaily = await applyDaily(daily, realized);
      const halted = await maybeHalt(newStats, newDaily, haltedUntil);
      await setCronState(KEY_ACTIVE, null);
      await notifyDiscord(
        `Slippage emergency close: ${slipBps.toFixed(1)}bps > ${MAX_SLIPPAGE_BPS}bps. Realized $${realized.toFixed(2)}`,
        'WARN',
        { asset, side, fill: fillPrice, ref: refPrice, exit: exitPrice },
      );
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'slippage-exit',
        closed: {
          symbol,
          asset,
          realizedPnlUsd: realized,
          win: realized > 0,
          durationS: 0,
        },
        stats: newStats,
        daily: newDaily,
        haltedUntil: halted ? haltedUntil + HALT_DURATION_MS : undefined,
        reason: `slip ${slipBps.toFixed(1)}bps > ${MAX_SLIPPAGE_BPS}bps`,
      });
    }

    const trade: ActiveTrade = {
      symbol,
      asset,
      side,
      size: sizeQty,
      entryPrice: fillPrice,
      stakeUsd,
      recommendation: prediction.recommendation,
      consensus: prediction.consensus,
      confidence: prediction.confidence,
      sourceCount: prediction.sources.length,
      entryScore: scan.best.score,
      openedAt: now,
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
    await notifyDiscord(
      `Opened ${asset}-PERP ${side} size=${sizeQty} stake=$${stakeUsd.toFixed(2)} (${prediction.recommendation}, conf ${prediction.confidence.toFixed(0)}, cons ${prediction.consensus.toFixed(0)})`,
      'TRADE',
      { fill: fillPrice, slipBps: slipBps.toFixed(1), sources: sourceNames.length },
    );

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
      scan: allSummary,
      stats: safeStats,
      daily,
    });
  } catch (e) {
    logger.error('[PolymarketEdge] tick failed', { error: errMsg(e) });
    return NextResponse.json(
      { success: false, ranAt, attempted: true, stats: safeStats, daily, error: errMsg(e) },
      { status: 500 },
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Close with one retry on transient RPC failure. */
async function closeWithRetry(bf: BluefinService, symbol: string) {
  const attempt = () =>
    bf.closeHedge({ symbol }).catch((e) => ({
      success: false,
      executionPrice: 0,
      fees: 0,
      error: errMsg(e),
    }));
  const first = await attempt();
  if (first && (first as { success?: boolean }).success) return first;
  // Brief backoff then retry once.
  await new Promise((r) => setTimeout(r, 1500));
  return attempt();
}

function pickExitPrice(close: unknown, markPriceRaw: unknown, fallback: number): number {
  const exec = Number((close as { executionPrice?: number })?.executionPrice);
  if (Number.isFinite(exec) && exec > 0) return exec;
  const mark = Number(markPriceRaw);
  if (Number.isFinite(mark) && mark > 0) return mark;
  return fallback;
}

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

  const newTotal = prev.totalPnlUsd + realizedUsd;
  const next: EdgeStats = {
    trades: prev.trades + 1,
    wins: prev.wins + (realizedUsd > 0 ? 1 : 0),
    losses: prev.losses + (realizedUsd <= 0 ? 1 : 0),
    totalPnlUsd: newTotal,
    peakPnlUsd: Math.max(prev.peakPnlUsd, newTotal),
    consecutiveLosses: realizedUsd > 0 ? 0 : prev.consecutiveLosses + 1,
    lastUpdatedMs: Date.now(),
    perAsset,
  };
  await setCronState(KEY_STATS, next);
  return next;
}

async function applyDaily(prev: DailyStats, realizedUsd: number): Promise<DailyStats> {
  const today = utcDayKey(Date.now());
  const base: DailyStats = prev.utcDayKey === today
    ? prev
    : { utcDayKey: today, pnlUsd: 0, trades: 0 };
  const next: DailyStats = {
    utcDayKey: base.utcDayKey,
    pnlUsd: base.pnlUsd + realizedUsd,
    trades: base.trades + 1,
  };
  await setCronState(KEY_DAILY, next);
  return next;
}

async function maybeHalt(
  stats: EdgeStats,
  daily: DailyStats,
  currentHaltUntil: number,
): Promise<boolean> {
  const drawdown =
    stats.peakPnlUsd > 0 ? (stats.peakPnlUsd - stats.totalPnlUsd) / stats.peakPnlUsd : 0;
  const tripLosses = stats.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES;
  const tripDrawdown = drawdown >= MAX_DRAWDOWN_PCT && stats.peakPnlUsd > 0;
  const tripDaily = daily.pnlUsd <= DAILY_LOSS_CAP_USD;
  if (tripLosses || tripDrawdown || tripDaily) {
    const until = Date.now() + HALT_DURATION_MS;
    await setCronState(KEY_HALTED_UNTIL, until);
    const reason = tripLosses
      ? `consecutiveLosses=${stats.consecutiveLosses}`
      : tripDrawdown
        ? `drawdown=${(drawdown * 100).toFixed(1)}%`
        : `dailyPnL=$${daily.pnlUsd.toFixed(2)}`;
    logger.warn('[PolymarketEdge] KILL SWITCH TRIPPED — halting 24h', {
      reason,
      consecutiveLosses: stats.consecutiveLosses,
      drawdown,
      totalPnlUsd: stats.totalPnlUsd,
      dailyPnlUsd: daily.pnlUsd,
    });
    await notifyDiscord(`KILL SWITCH TRIPPED — halting 24h (${reason})`, 'KILL', {
      totalPnlUsd: stats.totalPnlUsd,
      peakPnlUsd: stats.peakPnlUsd,
      dailyPnlUsd: daily.pnlUsd,
      consecutiveLosses: stats.consecutiveLosses,
    });
    return true;
  }
  return currentHaltUntil > Date.now();
}

// QStash sends POST by default — support both methods. Without this the cron
// silently 405s on every tick (root cause of zero cron-initiated trades from
// 2026-05-07 through 2026-06-14; manual GET probes still worked).
export const POST = GET;
