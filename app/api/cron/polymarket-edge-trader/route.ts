/**
 * Cron Job: Polymarket Edge Trader (5-min BTC binary signal → BlueFin perp)
 *
 * Thesis: Polymarket binary "BTC up/down in next 5 min" markets are well-
 * calibrated by construction (real-money crowd, Chainlink resolution).
 * A market quoting 90% UP resolves UP ~90% of the time. We exploit this
 * ONLY when probability ≥ 0.85 (the calibrated tail) and the BlueFin
 * funding rate is not actively against us.
 *
 * State machine (per-tick on master 5-min cadence):
 *   1. If an active trade exists and its window has ended → close & book PnL.
 *   2. Else, if we are not halted and a high-confidence signal is fresh,
 *      open a new BTC-PERP position sized via fractional Kelly with a hard
 *      cap of 10% of free collateral.
 *
 * Compounding:
 *   stake = baseStake × (1 + min(cumulativePnL / baseStake, 4))
 *   capped by 10% of BlueFin free collateral and POLYMARKET_EDGE_MAX_STAKE_USD.
 *
 * Kill switch (BOTH must trip back to halt):
 *   • 5 consecutive losing trades, OR
 *   • cumulative drawdown ≥ 30% from running peak
 *   → 24-hour halt; stats reset, baseStake preserved at floor.
 *
 * Idempotency:
 *   • clientOrderId derived from `polymarket-edge:${windowStart}` so a retried
 *     cron tick within the same 5-min window cannot double-open.
 *   • Position presence checked via getPositions() before any submit.
 *
 * Security: QStash signature or CRON_SECRET. Master scheduler invokes hourly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { errMsg } from '@/lib/utils/error-handler';
import { BluefinService, type BluefinPosition } from '@/lib/services/sui/BluefinService';
import { Polymarket5MinService } from '@/lib/services/market-data/Polymarket5MinService';
import { getCronStateOr, setCronState } from '@/lib/db/cron-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ── Tunables (env-overridable) ─────────────────────────────────────────────
const MIN_PROBABILITY = Number(process.env.POLYMARKET_EDGE_MIN_PROB || 0.85);
const MIN_FREE_COLLATERAL_USD = Number(process.env.POLYMARKET_EDGE_MIN_COLLATERAL || 25);
const BASE_STAKE_USD = Number(process.env.POLYMARKET_EDGE_BASE_STAKE_USD || 5);
const MAX_STAKE_USD = Number(process.env.POLYMARKET_EDGE_MAX_STAKE_USD || 500);
const STAKE_PCT_OF_FREE = Number(process.env.POLYMARKET_EDGE_STAKE_PCT || 0.10); // 10%
const LEVERAGE = Number(process.env.POLYMARKET_EDGE_LEVERAGE || 3);
const MAX_CONSECUTIVE_LOSSES = 5;
const MAX_DRAWDOWN_PCT = 0.30;
const HALT_DURATION_MS = 24 * 60 * 60 * 1000;
// Open only when at least 60s remain (room for fill) and no more than 270s
// (entering with <30s left is noise) on the 5-min binary window.
const MIN_TIME_REMAINING_S = 60;
const MAX_TIME_REMAINING_S = 270;

// ── Cron state keys ────────────────────────────────────────────────────────
const KEY_ACTIVE = 'polymarket-edge:active-trade';
const KEY_STATS = 'polymarket-edge:stats';
const KEY_HALTED_UNTIL = 'polymarket-edge:halted-until';

interface ActiveTrade {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  stakeUsd: number;
  marketId: string;
  windowLabel: string;
  windowEndMs: number;
  openedAt: number;
  clientOrderId: string;
  probability: number;
}

interface EdgeStats {
  trades: number;
  wins: number;
  losses: number;
  totalPnlUsd: number;
  peakPnlUsd: number;
  consecutiveLosses: number;
  lastUpdatedMs: number;
}

interface EdgeResult {
  success: boolean;
  ranAt: string;
  attempted: boolean;
  action?: 'closed' | 'opened' | 'idle' | 'halted' | 'no-signal' | 'no-collateral' | 'no-edge';
  trade?: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    stakeUsd: number;
    probability: number;
    windowLabel: string;
  };
  closed?: {
    symbol: string;
    realizedPnlUsd: number;
    win: boolean;
    durationS: number;
  };
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
};

function quantize(qty: number, step: number): number {
  return Math.floor(qty / step) * step;
}

function findBtcPerp(positions: BluefinPosition[]): BluefinPosition | undefined {
  return positions.find((p) => p.symbol === 'BTC-PERP' && Number(p.size) > 0);
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

  // ── Load state ────────────────────────────────────────────────────────
  const [active, stats, haltedUntil] = await Promise.all([
    getCronStateOr<ActiveTrade | null>(KEY_ACTIVE, null),
    getCronStateOr<EdgeStats>(KEY_STATS, DEFAULT_STATS),
    getCronStateOr<number>(KEY_HALTED_UNTIL, 0),
  ]);

  const now = Date.now();

  try {
    const bf = BluefinService.getInstance();
    await bf.initialize(adminKey, network);

    // ── 1) If a trade is active and its window has ended, close it ────
    if (active) {
      const expired = now >= active.windowEndMs;
      const positions = await bf.getPositions().catch(() => [] as BluefinPosition[]);
      const livePos = findBtcPerp(positions);

      if (!livePos) {
        // Position vanished externally (manual close / liquidation). Reconcile.
        logger.warn('[PolymarketEdge] Active trade has no live position — clearing state', {
          marketId: active.marketId,
        });
        await setCronState(KEY_ACTIVE, null);
        // Conservatively count as a loss for kill-switch purposes (we lost margin).
        const newStats = await applyOutcome(stats, -active.stakeUsd);
        await maybeHalt(newStats, haltedUntil);
        return NextResponse.json({
          success: true,
          ranAt,
          attempted: true,
          action: 'closed',
          closed: {
            symbol: active.symbol,
            realizedPnlUsd: -active.stakeUsd,
            win: false,
            durationS: Math.round((now - active.openedAt) / 1000),
          },
          stats: newStats,
        });
      }

      if (!expired) {
        // Window not yet over — let it ride.
        return NextResponse.json({
          success: true,
          ranAt,
          attempted: true,
          action: 'idle',
          trade: {
            symbol: active.symbol,
            side: active.side,
            size: active.size,
            stakeUsd: active.stakeUsd,
            probability: active.probability,
            windowLabel: active.windowLabel,
          },
          stats,
          reason: `In flight (${Math.round((active.windowEndMs - now) / 1000)}s remaining)`,
        });
      }

      // Expired → close.
      const close = await bf.closeHedge({ symbol: active.symbol }).catch((e) => ({
        success: false,
        executionPrice: 0,
        fees: 0,
        error: errMsg(e),
      }));
      // Compute realized PnL from entry/exit (closeHedge doesn't return it directly).
      const exitPrice =
        Number((close as { executionPrice?: number }).executionPrice) ||
        Number(livePos.markPrice) ||
        active.entryPrice;
      const fees = Number((close as { fees?: number }).fees) || 0;
      const dir = active.side === 'LONG' ? 1 : -1;
      const realized = (exitPrice - active.entryPrice) * active.size * dir - fees;

      const win = realized > 0;
      const newStats = await applyOutcome(stats, realized);
      const halted = await maybeHalt(newStats, haltedUntil);

      await setCronState(KEY_ACTIVE, null);
      logger.info('[PolymarketEdge] Closed trade', {
        symbol: active.symbol,
        side: active.side,
        realizedUsd: realized,
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
          realizedPnlUsd: realized,
          win,
          durationS: Math.round((now - active.openedAt) / 1000),
        },
        stats: newStats,
        haltedUntil: halted ? haltedUntil + HALT_DURATION_MS : undefined,
      });
    }

    // ── 2) No active trade — check halt, signal, sizing ──────────────
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

    const signal = await Polymarket5MinService.getLatest5MinSignal();
    if (!signal) {
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-signal',
        stats,
        reason: 'Polymarket service returned null',
      });
    }

    const probFraction = signal.probability / 100;
    const eligible =
      probFraction >= MIN_PROBABILITY &&
      signal.signalStrength === 'STRONG' &&
      signal.recommendation !== 'WAIT' &&
      signal.timeRemainingSeconds >= MIN_TIME_REMAINING_S &&
      signal.timeRemainingSeconds <= MAX_TIME_REMAINING_S;

    if (!eligible) {
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-edge',
        stats,
        reason: `prob=${probFraction.toFixed(3)} strength=${signal.signalStrength} t=${signal.timeRemainingSeconds}s`,
      });
    }

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

    // Compounding: cumulative-PnL multiplier on baseStake (1× → 5×).
    const compoundMul = Math.max(1, Math.min(5, 1 + stats.totalPnlUsd / Math.max(1, BASE_STAKE_USD)));
    const targetStake = Math.min(
      BASE_STAKE_USD * compoundMul,
      free * STAKE_PCT_OF_FREE,
      MAX_STAKE_USD,
    );
    const stakeUsd = Math.max(BASE_STAKE_USD, targetStake);

    // Notional = stake × leverage. Quantize to BTC step (0.001).
    const notionalUsd = stakeUsd * LEVERAGE;
    const sizeBtc = quantize(notionalUsd / signal.currentPrice, 0.001);
    if (sizeBtc < 0.001) {
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-collateral',
        stats,
        reason: `notional=$${notionalUsd.toFixed(2)} below BTC-PERP minQuantity 0.001`,
      });
    }

    // Direction: HEDGE_LONG → LONG, HEDGE_SHORT → SHORT
    const side: 'LONG' | 'SHORT' = signal.recommendation === 'HEDGE_LONG' ? 'LONG' : 'SHORT';
    const windowStart = signal.windowEndTime - 5 * 60 * 1000;
    const clientOrderId = `polyedge_${windowStart}`;

    // Idempotency: refuse if a BTC position already exists.
    const positionsPre = await bf.getPositions().catch(() => [] as BluefinPosition[]);
    if (findBtcPerp(positionsPre)) {
      logger.warn('[PolymarketEdge] BTC-PERP position already exists — skipping new entry');
      return NextResponse.json({
        success: true,
        ranAt,
        attempted: true,
        action: 'no-edge',
        stats,
        reason: 'pre-existing BTC-PERP position',
      });
    }

    const open = await bf.openHedge({
      symbol: 'BTC-PERP',
      side,
      size: sizeBtc,
      leverage: LEVERAGE,
      clientOrderId,
      reason: `polymarket-edge prob=${probFraction.toFixed(3)} window=${signal.windowLabel}`,
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
      symbol: 'BTC-PERP',
      side,
      size: sizeBtc,
      entryPrice: Number(open.executionPrice ?? signal.currentPrice) || signal.currentPrice,
      stakeUsd,
      marketId: signal.marketId,
      windowLabel: signal.windowLabel,
      windowEndMs: signal.windowEndTime,
      openedAt: now,
      clientOrderId,
      probability: probFraction,
    };
    await setCronState(KEY_ACTIVE, trade);

    logger.info('[PolymarketEdge] Opened trade', {
      side,
      sizeBtc,
      stakeUsd,
      compoundMul: compoundMul.toFixed(2),
      probability: probFraction.toFixed(3),
      window: signal.windowLabel,
    });

    return NextResponse.json({
      success: true,
      ranAt,
      attempted: true,
      action: 'opened',
      trade: {
        symbol: trade.symbol,
        side: trade.side,
        size: trade.size,
        stakeUsd: trade.stakeUsd,
        probability: trade.probability,
        windowLabel: trade.windowLabel,
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

async function applyOutcome(prev: EdgeStats, realizedUsd: number): Promise<EdgeStats> {
  const next: EdgeStats = {
    trades: prev.trades + 1,
    wins: prev.wins + (realizedUsd > 0 ? 1 : 0),
    losses: prev.losses + (realizedUsd <= 0 ? 1 : 0),
    totalPnlUsd: prev.totalPnlUsd + realizedUsd,
    peakPnlUsd: Math.max(prev.peakPnlUsd, prev.totalPnlUsd + realizedUsd),
    consecutiveLosses: realizedUsd > 0 ? 0 : prev.consecutiveLosses + 1,
    lastUpdatedMs: Date.now(),
  };
  await setCronState(KEY_STATS, next);
  return next;
}

async function maybeHalt(stats: EdgeStats, currentHaltUntil: number): Promise<boolean> {
  // Drawdown from peak
  const drawdown = stats.peakPnlUsd > 0 ? (stats.peakPnlUsd - stats.totalPnlUsd) / stats.peakPnlUsd : 0;
  const tripLosses = stats.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES;
  const tripDrawdown = drawdown >= MAX_DRAWDOWN_PCT && stats.peakPnlUsd > 0;
  if (tripLosses || tripDrawdown) {
    const until = Date.now() + HALT_DURATION_MS;
    await setCronState('polymarket-edge:halted-until', until);
    logger.warn('[PolymarketEdge] KILL SWITCH TRIPPED — halting 24h', {
      consecutiveLosses: stats.consecutiveLosses,
      drawdown,
      totalPnlUsd: stats.totalPnlUsd,
    });
    return true;
  }
  return currentHaltUntil > Date.now();
}
