/**
 * Autonomous halt-recovery — pure evaluator.
 *
 * The drawdown halt is time-bounded (until UTC midnight) but the underlying
 * REASON (drawdown ≥ threshold) may resolve BEFORE that timestamp — e.g.
 * a rolling-window peak decay (PR #55) or a NAV bounce puts the pool back
 * under the threshold. Historically the halt would stay in force until
 * natural expiry regardless — non-autonomous behavior that operators had
 * to fix manually via /api/admin/clear-cron-halt.
 *
 * This helper decides on every tick: given the current state, should the
 * existing halt AUTO-CLEAR? Called by step-8-auto-hedge before honoring
 * any stored halt.
 *
 * Rules (drawdown halt only — other halt reasons stay as-set):
 *   • Halt reason contains 'below peak' + drawdown NOW < threshold → clear
 *   • Halt reason is anything else (manual, phantom-rate, alert-response) → keep
 *   • Bad NAV read (0 or negative) → keep (can't re-verify)
 *
 * Never clears halts we can't verify. Fail-closed on ambiguity.
 */

export interface HaltRecoveryInput {
  /** Text of the halt reason as stored in cron_state. */
  haltReason: string;
  /** Current pool NAV in USD. */
  currentNavUsd: number;
  /** Current peak NAV (from `poolNav:peak:community-pool`). */
  peakNavUsd: number;
  /** Halt trip threshold in percent (e.g. 10 = 10%). Env-overridable. */
  thresholdPct: number;
}

export interface HaltRecoveryDecision {
  /** True iff the halt should be auto-cleared this tick. */
  shouldClear: boolean;
  /** Computed drawdown percent — for observability. */
  drawdownPct: number;
  /** Human-readable reason for the decision. */
  reason: string;
}

/**
 * Decide whether an existing drawdown-halt should be auto-cleared.
 *
 * Only clears halts that were set by the drawdown-halt logic itself
 * (halt reason contains "below peak"). Halts from other sources
 * (manual admin, alert-response, phantom-rate) are left alone —
 * they have their own recovery paths.
 */
export function evaluateHaltRecovery(input: HaltRecoveryInput): HaltRecoveryDecision {
  const { haltReason, currentNavUsd, peakNavUsd, thresholdPct } = input;

  // Fail-closed: can't verify with a bad NAV read.
  if (!Number.isFinite(currentNavUsd) || currentNavUsd <= 0) {
    return {
      shouldClear: false,
      drawdownPct: 0,
      reason: 'currentNav non-positive — cannot re-verify halt condition',
    };
  }
  if (!Number.isFinite(peakNavUsd) || peakNavUsd <= 0) {
    return {
      shouldClear: false,
      drawdownPct: 0,
      reason: 'peakNav non-positive — cannot compute drawdown',
    };
  }

  // Only touch halts we set (drawdown-based). Others stay.
  if (!haltReason.toLowerCase().includes('below peak')) {
    return {
      shouldClear: false,
      drawdownPct: 0,
      reason: `halt reason not drawdown-based (${haltReason.slice(0, 60)}) — leaving as-set`,
    };
  }

  const drawdownPct = currentNavUsd >= peakNavUsd
    ? 0
    : ((peakNavUsd - currentNavUsd) / peakNavUsd) * 100;

  if (drawdownPct < thresholdPct) {
    return {
      shouldClear: true,
      drawdownPct,
      reason: `drawdown recovered to ${drawdownPct.toFixed(2)}% (< ${thresholdPct}% threshold)`,
    };
  }

  return {
    shouldClear: false,
    drawdownPct,
    reason: `drawdown ${drawdownPct.toFixed(2)}% still ≥ ${thresholdPct}% threshold`,
  };
}
