/**
 * Adaptive gate relaxation for polymarket-edge-trader.
 *
 * When the operator misconfigures MIN_CONFIDENCE / MIN_CONSENSUS above
 * what real signals can achieve (e.g. 70/70 while real signals peak at
 * 65-68), the trader would refuse every tick forever. Adaptive relaxation
 * detects prolonged no-edge streaks and gradually lowers the effective
 * thresholds so the system self-heals without a redeploy.
 *
 * Behavior locked here (mirrors the pure function in route.ts):
 *   - noEdgeStreak < RELAX_AFTER_N_SKIPS   → no relaxation
 *   - noEdgeStreak >= RELAX_AFTER_N_SKIPS  → lower by RELAX_STEP_PER_HOUR
 *     for every additional RELAX_AFTER_N_SKIPS ticks
 *   - Floors enforced: conf ≥ 45, cons ≥ 45 (never trade on noise)
 */

const RELAX_AFTER_N_SKIPS = 12;
const RELAX_STEP_PER_HOUR = 5;
const RELAX_FLOOR_CONFIDENCE = 45;
const RELAX_FLOOR_CONSENSUS = 45;

// Pure copy of the route's effectiveGates
function effectiveGates(
  configuredConf: number,
  configuredCons: number,
  noEdgeStreak: number,
): { effectiveConf: number; effectiveCons: number; relaxSteps: number } {
  if (noEdgeStreak < RELAX_AFTER_N_SKIPS) {
    return { effectiveConf: configuredConf, effectiveCons: configuredCons, relaxSteps: 0 };
  }
  const relaxSteps = Math.floor((noEdgeStreak - RELAX_AFTER_N_SKIPS) / RELAX_AFTER_N_SKIPS) + 1;
  const relaxAmount = relaxSteps * RELAX_STEP_PER_HOUR;
  return {
    effectiveConf: Math.max(RELAX_FLOOR_CONFIDENCE, configuredConf - relaxAmount),
    effectiveCons: Math.max(RELAX_FLOOR_CONSENSUS, configuredCons - relaxAmount),
    relaxSteps,
  };
}

describe('polymarket-edge adaptive gate relaxation', () => {
  describe('no relaxation below the trigger threshold', () => {
    it('returns configured gates unchanged when streak is 0', () => {
      const r = effectiveGates(70, 70, 0);
      expect(r.effectiveConf).toBe(70);
      expect(r.effectiveCons).toBe(70);
      expect(r.relaxSteps).toBe(0);
    });

    it('returns configured gates unchanged when streak is 11 (one below trigger)', () => {
      const r = effectiveGates(70, 70, 11);
      expect(r.effectiveConf).toBe(70);
      expect(r.effectiveCons).toBe(70);
      expect(r.relaxSteps).toBe(0);
    });
  });

  describe('first relaxation step at trigger point', () => {
    it('lowers gates by 5 exactly at streak=12', () => {
      const r = effectiveGates(70, 70, 12);
      expect(r.effectiveConf).toBe(65);
      expect(r.effectiveCons).toBe(65);
      expect(r.relaxSteps).toBe(1);
    });

    it('reproduces the observed prod scenario (BTC 66/60 clears after 1 relax)', () => {
      // Operator's config: 70/70. Signals: BTC 66/60.
      // After 12 no-edge skips (1 hour), effective becomes 65/65.
      // BTC now clears conf (66 >= 65) but still fails cons (60 < 65).
      const r = effectiveGates(70, 70, 12);
      expect(66 >= r.effectiveConf).toBe(true);   // BTC would pass conf
      expect(60 >= r.effectiveCons).toBe(false);  // BTC still fails cons
    });
  });

  describe('progressive relaxation over multiple hours', () => {
    it('applies 2 relax steps at streak=24 (2 hours stuck)', () => {
      const r = effectiveGates(70, 70, 24);
      expect(r.effectiveConf).toBe(60);
      expect(r.effectiveCons).toBe(60);
      expect(r.relaxSteps).toBe(2);
    });

    it('BTC 66/60 clears after 2 hours of stuck', () => {
      // At streak=24, gates are 60/60. BTC 66/60 passes conf and just
      // barely misses cons... wait — 60 >= 60 → passes.
      const r = effectiveGates(70, 70, 24);
      expect(66 >= r.effectiveConf).toBe(true);
      expect(60 >= r.effectiveCons).toBe(true);
    });

    it('applies 3 relax steps at streak=36 (3 hours stuck)', () => {
      const r = effectiveGates(70, 70, 36);
      expect(r.effectiveConf).toBe(55);
      expect(r.effectiveCons).toBe(55);
      expect(r.relaxSteps).toBe(3);
    });
  });

  describe('floors prevent unbounded relaxation', () => {
    it('clamps at 45 no matter how long the streak', () => {
      const r = effectiveGates(70, 70, 10000);
      expect(r.effectiveConf).toBe(45);
      expect(r.effectiveCons).toBe(45);
    });

    it('never trades on genuine noise even after days of streak', () => {
      // With floor at 45, the trader still refuses signals below 45/45.
      // "45 confidence" is roughly random — this is the safety net.
      const r = effectiveGates(70, 70, 1_000_000);
      expect(r.effectiveConf).toBe(45);
      expect(r.effectiveCons).toBe(45);
    });
  });

  describe('respects operator settings when they are already sensible', () => {
    it('operator at 55/50 stays at 55/50 with no streak', () => {
      const r = effectiveGates(55, 50, 0);
      expect(r.effectiveConf).toBe(55);
      expect(r.effectiveCons).toBe(50);
    });

    it('operator at 55/50 lowers to 50/45 after 1 hour of stuck (floor kicks in)', () => {
      const r = effectiveGates(55, 50, 12);
      expect(r.effectiveConf).toBe(50);
      expect(r.effectiveCons).toBe(45);  // floor: max(45, 45) = 45
    });
  });
});
