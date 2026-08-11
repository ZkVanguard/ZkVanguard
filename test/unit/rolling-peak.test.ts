/**
 * Unit tests for computeRollingPeak — regression barrier for the
 * peak-NAV deadlock class of bug (PR #55, 2026-08-11).
 *
 * The bug: pool-nav-monitor.calculateDrawdown used to ratchet a
 * monotonic-max peak (only-updates-on-new-high). When the pool took a
 * real drawdown, HEDGE_DRAWDOWN_HALT_PCT (>10%) and PROFIT_LOCK_ZERO_RISK_AT
 * (>20%) both permanently tripped against a stale historical peak;
 * autohedge got halted at every UTC midnight; no recovery path.
 *
 * The fix: peak = max(currentNAV, ...N-day rolling history max).
 *
 * These tests lock the invariants that made the bug re-introducible:
 *   1. Old highs OUTSIDE the window are IGNORED
 *   2. currentNAV is ALWAYS included (peak can never be < currentNAV)
 *   3. Empty history falls back to currentNAV (no NaN, no negatives)
 *   4. Non-finite values in history are skipped, not propagated
 */
import { describe, it, expect } from '@jest/globals';
import { computeRollingPeak, type NavPoint } from '@/lib/services/hedging/rolling-peak';

const day = (dGiven: number): Date => new Date(Date.now() - dGiven * 86400_000);

describe('computeRollingPeak', () => {
  describe('deadlock-regression invariants', () => {
    it('IGNORES old highs — history outside the window has already been filtered by caller', () => {
      // Caller (pool-nav-monitor) queries getNavHistory(7) — this fn only
      // sees the last 7 days. Old $57 peak from 2 months ago is NOT here.
      const history: NavPoint[] = [
        { total_nav: 30.5, timestamp: day(1) },
        { total_nav: 30.9, timestamp: day(2) },  // recent-window peak
        { total_nav: 28.7, timestamp: day(3) },
      ];
      expect(computeRollingPeak(28.06, history)).toBe(30.9);
    });

    it('peak NEVER lags behind currentNAV — currentNAV always in the max', () => {
      const history: NavPoint[] = [
        { total_nav: 25 }, { total_nav: 26 }, { total_nav: 27 },
      ];
      // currentNAV higher than any history entry — must become the peak
      expect(computeRollingPeak(30, history)).toBe(30);
    });

    it('produces the expected unstick for the actual 2026-08-11 incident state', () => {
      // Real DB values at time of PR #55 landing:
      //   currentNAV = 28.06, 7d history max ≈ 30.92
      // pre-fix cached peak was 36.27 → 22.6% drawdown → deadlock
      // post-fix should yield 30.92 → 9.2% drawdown → both gates release
      const history: NavPoint[] = [
        { total_nav: 30.92 }, { total_nav: 30.88 }, { total_nav: 30.69 },
        { total_nav: 29.68 }, { total_nav: 29.68 }, { total_nav: 28.91 },
      ];
      const peak = computeRollingPeak(28.06, history);
      const drawdownPct = ((peak - 28.06) / peak) * 100;
      expect(peak).toBeCloseTo(30.92, 2);
      expect(drawdownPct).toBeLessThan(10); // below halt threshold
      expect(drawdownPct).toBeLessThan(20); // below profit-lock zero-risk
    });
  });

  describe('boundary + sanity', () => {
    it('empty history → currentNAV', () => {
      expect(computeRollingPeak(28.06, [])).toBe(28.06);
    });

    it('non-finite currentNAV → 0', () => {
      expect(computeRollingPeak(NaN, [])).toBe(0);
      expect(computeRollingPeak(Infinity, [])).toBe(0);
    });

    it('negative currentNAV clamped to 0', () => {
      expect(computeRollingPeak(-5, [])).toBe(0);
    });

    it('non-finite entries in history are skipped', () => {
      const history: NavPoint[] = [
        { total_nav: 30 }, { total_nav: NaN }, { total_nav: 35 }, { total_nav: 'x' as unknown as number },
      ];
      expect(computeRollingPeak(20, history)).toBe(35);
    });

    it('string-encoded numeric total_nav (from Postgres text-cast) is accepted', () => {
      // getNavHistory sometimes returns { total_nav: '30.92' } depending
      // on the query cast; the fn must coerce transparently.
      const history: NavPoint[] = [
        { total_nav: '30.92' as unknown as number },
        { total_nav: '28.5' as unknown as number },
      ];
      expect(computeRollingPeak(28, history)).toBeCloseTo(30.92, 2);
    });
  });
});
