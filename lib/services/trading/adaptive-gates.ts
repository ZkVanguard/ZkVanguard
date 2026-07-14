/**
 * Adaptive gate relaxation for the polymarket-edge trader.
 *
 * If the trader has skipped with 'no-edge' for many consecutive ticks,
 * slowly lower the effective confidence/consensus thresholds. This
 * self-heals from operator misconfig (e.g. env vars set to 70/70 when
 * live signals peak at 65-70) without needing a redeploy or env change.
 * Bounded floor at RELAX_FLOOR_* so we never trade on genuine noise.
 *
 * Cadence: first relaxation at RELAX_AFTER_N_SKIPS ticks (~15 min at
 * 5-min cadence), then every RELAX_AFTER_N_SKIPS ticks thereafter.
 * Step size is RELAX_STEP_PER_HOUR (aggressive enough to unlock
 * trading within 1 hour of a genuinely-blocked config).
 */

export const RELAX_AFTER_N_SKIPS = 3;      // 15 min stuck at 5-min cadence
export const RELAX_STEP_PER_HOUR = 7;      // lower gates by 7 per step
export const RELAX_FLOOR_CONFIDENCE = 45;
export const RELAX_FLOOR_CONSENSUS = 45;

export interface EffectiveGates {
  effectiveConf: number;
  effectiveCons: number;
  relaxSteps: number;
}

/**
 * Compute the effective conf/cons thresholds given the configured
 * baseline and the number of consecutive no-edge skips.
 *
 * Design note: pass the pre-increment streak (the value the previous
 * tick set) so this tick's own increment can't feed back into its own
 * gate decision. Off-by-one prevention.
 */
export function effectiveGates(
  configuredConf: number,
  configuredCons: number,
  noEdgeStreak: number,
): EffectiveGates {
  if (noEdgeStreak < RELAX_AFTER_N_SKIPS) {
    return { effectiveConf: configuredConf, effectiveCons: configuredCons, relaxSteps: 0 };
  }
  const relaxSteps =
    Math.floor((noEdgeStreak - RELAX_AFTER_N_SKIPS) / RELAX_AFTER_N_SKIPS) + 1;
  const relaxAmount = relaxSteps * RELAX_STEP_PER_HOUR;
  return {
    effectiveConf: Math.max(RELAX_FLOOR_CONFIDENCE, configuredConf - relaxAmount),
    effectiveCons: Math.max(RELAX_FLOOR_CONSENSUS, configuredCons - relaxAmount),
    relaxSteps,
  };
}
