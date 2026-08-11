/**
 * Rolling-window peak NAV — pure function shared by pool-nav-monitor.
 *
 * Extracted 2026-08-11 as the regression-prevention layer for the peak-NAV
 * deadlock class of bug (see PR #55). Was inlined in calculateDrawdown;
 * pulling it out lets us contract-test the "peak must decay when old highs
 * age out" invariant that the monotonic-max version violated.
 *
 * Rule: peak = max(currentNAV, ...max of history within lookback window).
 *   • Peak can never lag behind currentNAV (currentNAV is always included).
 *   • Peak can never ratchet indefinitely upward — history entries older
 *     than `windowDays` are excluded, so a peak from 2 months ago decays.
 *
 * Tests: test/unit/rolling-peak.test.ts
 */

export interface NavPoint {
  /** Any NAV value ≥ 0. Non-finite or negative values are ignored. */
  total_nav: number | string;
  /** ISO string or Date. Used only for the sanity assertion in tests. */
  timestamp?: string | Date;
}

/**
 * Compute the rolling-window peak.
 *
 * @param currentNAV Current NAV — always included in the max calc so
 *                   peak can never be < currentNAV.
 * @param history    NAV points from the last `windowDays` days. Caller
 *                   is responsible for the window filter (this fn is
 *                   pure — it doesn't touch time or DB).
 * @returns          max(currentNAV, ...history[].total_nav). Falls back
 *                   to currentNAV if history is empty. Never negative.
 */
export function computeRollingPeak(currentNAV: number, history: NavPoint[]): number {
  if (!Number.isFinite(currentNAV) || currentNAV < 0) currentNAV = 0;

  let peak = currentNAV;
  for (const p of history) {
    const v = Number(p.total_nav);
    if (Number.isFinite(v) && v > peak) peak = v;
  }
  return peak;
}
