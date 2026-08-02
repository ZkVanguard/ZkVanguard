/**
 * Pure kill-switch evaluator for the polymarket-edge-trader.
 *
 * Three independent trip conditions:
 *   1. Consecutive losses ≥ MAX_CONSECUTIVE_LOSSES
 *   2. Drawdown from peak ≥ MAX_DRAWDOWN_PCT — but only when the peak
 *      is "meaningful" (see PEAK_FLOOR rationale below). Prevents the
 *      $0.10-win-then-$0.10-loss = "100% drawdown" false trip observed
 *      2026-07-13.
 *   3. Daily realized PnL ≤ DAILY_LOSS_CAP_USD
 *
 * Any one trips → halt for HALT_DURATION_MS. The route uses this
 * decision to write cron_state + notify Discord; this module has no
 * side effects so all 6 branches are unit-testable.
 */

export interface KillSwitchStats {
  totalPnlUsd: number;
  peakPnlUsd: number;
  consecutiveLosses: number;
}

export interface KillSwitchDaily {
  pnlUsd: number;
}

export interface KillSwitchConfig {
  maxConsecutiveLosses: number;
  maxDrawdownPct: number;
  dailyLossCapUsd: number;       // negative number, e.g. -10
  baseStakeUsd: number;          // for computing peak floor
  haltDurationMs: number;
  now?: number;
}

export type KillReason =
  | 'consecutive-losses'
  | 'drawdown'
  | 'daily-cap';

export interface KillSwitchDecision {
  /** true if THIS evaluation caused a new halt (fresh trip). */
  trip: boolean;
  /** true if a halt is currently active (this call caused it OR already active). */
  halted: boolean;
  /** Which condition tripped (only set when trip=true). */
  reason?: KillReason;
  /** Detailed reason string suitable for Discord + logs. */
  detail?: string;
  /** Timestamp (ms) until which trading should be halted (only when trip=true). */
  untilMs?: number;
  /** Computed drawdown-from-peak ratio, for observability. */
  drawdownPct: number;
  /** True when peak is above the meaningful-profit floor — for tests. */
  peakMeaningful: boolean;
}

/**
 * Pure kill-switch evaluator.
 *
 * @param currentHaltUntilMs Existing halt-until timestamp from cron_state
 *                            (0 or absent = not halted). Used to compute
 *                            `halted` in the no-trip case.
 */
export function evaluateKillSwitch(
  stats: KillSwitchStats,
  daily: KillSwitchDaily,
  currentHaltUntilMs: number,
  config: KillSwitchConfig,
): KillSwitchDecision {
  const now = config.now ?? Date.now();

  const drawdownPct =
    stats.peakPnlUsd > 0 ? (stats.peakPnlUsd - stats.totalPnlUsd) / stats.peakPnlUsd : 0;

  // Absolute-$ floor. At penny-level P&L, every trip condition is dominated
  // by noise: 3 losses of $0.10 each is "MAX_CONSECUTIVE_LOSSES tripped"
  // even though the strategy is fine; $0.10 win then $0.10 loss reads as
  // "100% drawdown". Peak of at least max(4×BASE_STAKE, $10) means we've
  // accumulated real money before the halt logic takes over — below that,
  // the trader is still bootstrapping and short streaks are pure variance.
  //
  // Applied to consecutiveLosses + drawdown. dailyLossCap stays absolute-$
  // (unaffected by peak) since it IS the absolute-$ safety.
  //
  // Observed 2026-07-13 (drawdown false trip on $0.10 pullback) and
  // 2026-08-01 (consecutiveLosses=3 trip on 3 tiny penny losses).
  const peakFloor = Math.max(config.baseStakeUsd * 4, 10);
  const peakMeaningful = stats.peakPnlUsd >= peakFloor;

  const tripLosses = stats.consecutiveLosses >= config.maxConsecutiveLosses && peakMeaningful;
  const tripDrawdown = drawdownPct >= config.maxDrawdownPct && peakMeaningful;
  const tripDaily = daily.pnlUsd <= config.dailyLossCapUsd;

  if (tripLosses || tripDrawdown || tripDaily) {
    const untilMs = now + config.haltDurationMs;
    const reason: KillReason = tripLosses
      ? 'consecutive-losses'
      : tripDrawdown
        ? 'drawdown'
        : 'daily-cap';
    const detail = tripLosses
      ? `consecutiveLosses=${stats.consecutiveLosses}`
      : tripDrawdown
        ? `drawdown=${(drawdownPct * 100).toFixed(1)}%`
        : `dailyPnL=$${daily.pnlUsd.toFixed(2)}`;
    return {
      trip: true, halted: true, reason, detail, untilMs,
      drawdownPct, peakMeaningful,
    };
  }
  return {
    trip: false,
    halted: currentHaltUntilMs > now,
    drawdownPct, peakMeaningful,
  };
}
