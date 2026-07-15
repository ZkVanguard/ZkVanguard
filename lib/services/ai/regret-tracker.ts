/**
 * AI Regret Tracker — confidence-weighted decision-outcome memory.
 *
 * ## Why
 *
 * AI conviction peaks near tops. The rebalance cron loaded up on
 * wBTC/wETH/SUI at 80%+ AI confidence in late June, right into the
 * $1.97 ATH. After the drawdown, nothing scaled the AI's trust down —
 * the next high-conviction call would size the same as the losing one.
 *
 * ## Rule
 *
 * For each closed decision, compute:
 *   outcome = sign(realized_pnl)  ∈ {-1, 0, +1}
 *   weight  = openConfidence / 100
 *   contribution = outcome × weight
 *
 * Rolling window (default 30 days) sum → regretScore ∈ [-1, +1].
 * Map to sizeMultiplier:
 *   regret >= +0.3  → 1.0 (full size)
 *   regret <= -0.3  → 0.25 (quarter size)
 *   linear between
 *
 * SafeExecutionGuard + polymarket-edge-trader multiply their computed
 * stake by this. Recovers automatically when AI starts winning again.
 */

import { logger } from '@/lib/utils/logger';

export interface DecisionOutcome {
  openConfidence: number; // percent 0-100
  realizedPnl: number; // USD
  openedAt: Date;
}

export interface RegretComputeInput {
  recentDecisions: DecisionOutcome[];
  windowDays?: number;
  minMultiplier?: number;
  maxMultiplier?: number;
}

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_MIN = 0.25;
const DEFAULT_MAX = 1.0;

export function computeRegretScore(decisions: DecisionOutcome[]): number {
  if (decisions.length === 0) return 0;
  let numerator = 0;
  let denominator = 0;
  for (const d of decisions) {
    const weight = Math.max(0, Math.min(1, d.openConfidence / 100));
    const outcome = d.realizedPnl > 0 ? 1 : d.realizedPnl < 0 ? -1 : 0;
    numerator += weight * outcome;
    denominator += weight;
  }
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export async function computeSizeMultiplier(input: RegretComputeInput): Promise<number> {
  const windowMs = (input.windowDays ?? DEFAULT_WINDOW_DAYS) * 24 * 3600 * 1000;
  const minMult = input.minMultiplier ?? DEFAULT_MIN;
  const maxMult = input.maxMultiplier ?? DEFAULT_MAX;
  const now = Date.now();

  const inWindow = input.recentDecisions.filter((d) => now - d.openedAt.getTime() <= windowMs);
  const regret = computeRegretScore(inWindow);

  // Map [-0.3, +0.3] linearly to [minMult, maxMult]
  const lo = -0.3;
  const hi = 0.3;
  let mult: number;
  if (regret <= lo) mult = minMult;
  else if (regret >= hi) mult = maxMult;
  else {
    const t = (regret - lo) / (hi - lo);
    mult = minMult + (maxMult - minMult) * t;
  }

  logger.debug('[RegretTracker] size multiplier computed', {
    decisions: inWindow.length,
    regret: regret.toFixed(3),
    multiplier: mult.toFixed(3),
  });

  return Math.max(minMult, Math.min(maxMult, mult));
}
