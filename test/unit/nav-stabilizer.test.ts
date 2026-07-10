/**
 * Unit tests for the NAV stabilizer clamp math.
 *
 * The stabilizer's purpose is to absorb short-term BlueFin uPnL/collateral
 * read jitter that would otherwise show up as artificial NAV swings on the
 * pool card. Real market moves (which persist across multiple ticks) must
 * still get through — that's what the "catch up over multiple ticks"
 * behavior in the comment means.
 */
import {
  clampNavAgainstMedian,
  MAX_NAV_STEP_PCT,
  MEDIAN_WINDOW,
} from '@/lib/services/sui/cron/persistence';

describe('clampNavAgainstMedian', () => {
  describe('no history — pass-through', () => {
    it('publishes raw when history is empty', () => {
      const r = clampNavAgainstMedian(50, 30, []);
      expect(r.publishedNav).toBe(50);
      expect(r.publishedSharePrice).toBeCloseTo(50 / 30, 6);
      expect(r.stabilized).toBe(false);
      expect(r.median).toBeNull();
      expect(r.clampedFromRaw).toBe(0);
    });

    it('publishes raw when history has only non-finite values', () => {
      const r = clampNavAgainstMedian(50, 30, [NaN, Infinity, -Infinity]);
      expect(r.publishedNav).toBe(50);
      expect(r.stabilized).toBe(false);
      expect(r.median).toBeNull();
    });
  });

  describe('within-band — pass-through', () => {
    it('publishes raw when delta is exactly zero', () => {
      const r = clampNavAgainstMedian(50, 30, [50, 50, 50]);
      expect(r.publishedNav).toBe(50);
      expect(r.stabilized).toBe(false);
      expect(r.median).toBe(50);
    });

    it(`publishes raw when delta is within ±${MAX_NAV_STEP_PCT}%`, () => {
      // 3% move — inside the 3.5% band
      const r = clampNavAgainstMedian(51.5, 30, [50, 50, 50]);
      expect(r.publishedNav).toBe(51.5);
      expect(r.stabilized).toBe(false);
      expect(r.median).toBe(50);
    });

    it('publishes raw when delta exactly hits the boundary', () => {
      // Exactly 3.5% — boundary is inclusive
      const r = clampNavAgainstMedian(50 * 1.035, 30, [50, 50, 50]);
      expect(r.publishedNav).toBeCloseTo(50 * 1.035, 6);
      expect(r.stabilized).toBe(false);
    });
  });

  describe('spike up — clamp to +band', () => {
    it('clamps a 10% up-spike to +3.5%', () => {
      const r = clampNavAgainstMedian(55, 30, [50, 50, 50]);
      expect(r.stabilized).toBe(true);
      expect(r.publishedNav).toBeCloseTo(50 * (1 + MAX_NAV_STEP_PCT / 100), 6);
      expect(r.publishedNav).toBeLessThan(55);
      expect(r.clampedFromRaw).toBeCloseTo(55 - r.publishedNav, 6);
      expect(r.median).toBe(50);
    });

    it('reproduces the 6.28% spike observed in prod on 2026-07-10', () => {
      // Same numbers as the simulation from the analysis: raw $54.97 vs
      // median $51.72. Should clamp to median * 1.035 = $53.53.
      const r = clampNavAgainstMedian(54.97, 30, [51.5, 51.72, 51.9]);
      expect(r.stabilized).toBe(true);
      expect(r.publishedNav).toBeCloseTo(51.72 * 1.035, 4);
      expect(r.median).toBe(51.72);
    });
  });

  describe('spike down — clamp to −band', () => {
    it('clamps a 10% down-spike to −3.5%', () => {
      const r = clampNavAgainstMedian(45, 30, [50, 50, 50]);
      expect(r.stabilized).toBe(true);
      expect(r.publishedNav).toBeCloseTo(50 * (1 - MAX_NAV_STEP_PCT / 100), 6);
      expect(r.publishedNav).toBeGreaterThan(45);
      expect(r.clampedFromRaw).toBeCloseTo(45 - r.publishedNav, 6);
    });
  });

  describe('median semantics', () => {
    it(`consults only the last ${MEDIAN_WINDOW} history entries`, () => {
      // History includes stale wildly-different values that must be
      // ignored — only the last MEDIAN_WINDOW matter.
      const stale = [10, 200, 3000];
      const recent = [50, 50, 50];
      const r = clampNavAgainstMedian(51, 30, [...stale, ...recent]);
      expect(r.median).toBe(50);
      expect(r.stabilized).toBe(false);
    });

    it('uses the middle value from a 3-window (not the mean)', () => {
      // sorted → [10, 50, 90], middle is 50; mean would be 50 as well, so
      // use an asymmetric window where median ≠ mean.
      // Window [10, 50, 900] → median 50, mean 320.
      const r = clampNavAgainstMedian(51, 30, [10, 50, 900]);
      // 51 vs median 50 → +2% delta, within 3.5% band → pass through.
      // If the code used the mean (320), 51 would be far below and get
      // clamped. So a pass here proves it's using the median.
      expect(r.median).toBe(50);
      expect(r.stabilized).toBe(false);
    });

    it('degrades gracefully with a single history sample', () => {
      const r = clampNavAgainstMedian(60, 30, [50]);
      // Single-sample median = 50; 60 is +20% → clamp
      expect(r.median).toBe(50);
      expect(r.stabilized).toBe(true);
      expect(r.publishedNav).toBeCloseTo(50 * 1.035, 6);
    });
  });

  describe('share price computation', () => {
    it('publishedSharePrice = publishedNav / totalShares', () => {
      const r = clampNavAgainstMedian(51.5, 30, [50, 50, 50]);
      expect(r.publishedSharePrice).toBeCloseTo(51.5 / 30, 6);
    });

    it('never divides by zero when totalShares is 0', () => {
      const r = clampNavAgainstMedian(50, 0, [50, 50, 50]);
      expect(Number.isFinite(r.publishedSharePrice)).toBe(true);
      expect(r.publishedSharePrice).toBeGreaterThan(0);
    });

    it('handles negative totalShares defensively (clamped)', () => {
      const r = clampNavAgainstMedian(50, -5, [50, 50, 50]);
      expect(Number.isFinite(r.publishedSharePrice)).toBe(true);
    });
  });

  describe('median-zero edge case', () => {
    it('passes raw through when median is zero (fresh-pool sentinel)', () => {
      const r = clampNavAgainstMedian(50, 30, [0, 0, 0]);
      // deltaPct math would divide by zero — clamp code short-circuits
      expect(r.publishedNav).toBe(50);
      expect(r.stabilized).toBe(false);
      expect(r.median).toBe(0);
    });
  });
});
