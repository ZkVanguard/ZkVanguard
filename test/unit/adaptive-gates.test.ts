/**
 * Locks the adaptive-gate relaxation math from the polymarket-edge trader.
 *
 * Rule: while noEdgeStreak < 3, gates stay at configured baseline.
 * Once ≥ 3, relaxation kicks in: each 3-tick window past the threshold
 * shaves 7 more bps off both conf & cons, floored at 45/45.
 *
 * Off-by-one prevention: the trader passes the PRIOR streak value (not
 * the incremented one), so this tick's own increment doesn't feed its
 * own gate decision.
 */
import { describe, it, expect } from '@jest/globals';
import { effectiveGates } from '@/lib/services/trading/adaptive-gates';

describe('effectiveGates', () => {
  describe('no relaxation (streak < 3)', () => {
    it('returns configured values at streak 0', () => {
      const r = effectiveGates(70, 70, 0);
      expect(r).toEqual({ effectiveConf: 70, effectiveCons: 70, relaxSteps: 0 });
    });

    it('returns configured values at streak 1', () => {
      expect(effectiveGates(70, 70, 1).relaxSteps).toBe(0);
    });

    it('returns configured values at streak 2 (last tick before relaxation)', () => {
      const r = effectiveGates(70, 70, 2);
      expect(r.effectiveConf).toBe(70);
      expect(r.effectiveCons).toBe(70);
      expect(r.relaxSteps).toBe(0);
    });
  });

  describe('single-step relaxation (streak 3-5)', () => {
    it('drops gates by 7 at streak 3', () => {
      const r = effectiveGates(70, 70, 3);
      expect(r.effectiveConf).toBe(63);
      expect(r.effectiveCons).toBe(63);
      expect(r.relaxSteps).toBe(1);
    });

    it('holds at 63/63 for streak 4 and 5 (still 1 step)', () => {
      expect(effectiveGates(70, 70, 4).effectiveConf).toBe(63);
      expect(effectiveGates(70, 70, 5).effectiveConf).toBe(63);
    });
  });

  describe('multi-step relaxation', () => {
    it('drops to 56/56 at streak 6 (2 steps)', () => {
      const r = effectiveGates(70, 70, 6);
      expect(r).toEqual({ effectiveConf: 56, effectiveCons: 56, relaxSteps: 2 });
    });

    it('drops to 49/49 at streak 9 (3 steps)', () => {
      expect(effectiveGates(70, 70, 9).effectiveConf).toBe(49);
    });

    it('drops to 45 floor at streak 12+ (should hit floor)', () => {
      const r = effectiveGates(70, 70, 12);
      // step 4 = 70 - 28 = 42, floored to 45
      expect(r.effectiveConf).toBe(45);
      expect(r.effectiveCons).toBe(45);
    });

    it('never drops below floor even at absurd streaks', () => {
      const r = effectiveGates(70, 70, 1_000_000);
      expect(r.effectiveConf).toBe(45);
      expect(r.effectiveCons).toBe(45);
    });
  });

  describe('respects operator baseline', () => {
    it('scales from a stricter baseline (80/80)', () => {
      // step 1: 80 - 7 = 73
      expect(effectiveGates(80, 80, 3).effectiveConf).toBe(73);
    });

    it('scales from a looser baseline (60/60) — but never below floor 45', () => {
      // step 3: 60 - 21 = 39, floored to 45
      expect(effectiveGates(60, 60, 9).effectiveConf).toBe(45);
    });
  });

  describe('monotonicity — relaxation never reverses direction', () => {
    it('effectiveConf is non-increasing in streak', () => {
      let prev = effectiveGates(70, 70, 0).effectiveConf;
      for (let s = 1; s < 50; s++) {
        const cur = effectiveGates(70, 70, s).effectiveConf;
        expect(cur).toBeLessThanOrEqual(prev);
        prev = cur;
      }
    });
  });
});
