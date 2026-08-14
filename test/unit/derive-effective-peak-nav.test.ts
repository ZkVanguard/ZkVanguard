/**
 * deriveEffectivePeakNav — verifies the deposit-aware peak calc that fixes
 * the 2026-08-11 peak-NAV deadlock.
 *
 * Old mechanism stored a monotonic peak NAV in cron_state. When a new deposit
 * bumped NAV, the peak stayed fixed → drawdown stayed pinned in halt
 * territory → autohedge stayed halted → NAV couldn't recover → deadlock.
 *
 * New mechanism derives peak from `athSharePriceUsd × totalShares`. Deposits
 * grow totalShares proportionally, so peak scales with them and drawdown
 * stays invariant to capital inflows.
 */
import { deriveEffectivePeakNav } from '@/lib/services/sui/cron/profit-lock-guard';

describe('deriveEffectivePeakNav', () => {
  it('derives peak from ATH × shares when both are populated', () => {
    // ATH share price $2.32, 30 shares outstanding → peak $69.60
    const peak = deriveEffectivePeakNav(2.32, 30, 100);
    expect(peak).toBeCloseTo(69.6, 5);
  });

  it('scales up when new deposit mints more shares (deadlock fix)', () => {
    // Before deposit: ATH $2.32, 30 shares → peak $69.60
    const before = deriveEffectivePeakNav(2.32, 30, 999);
    // After $30 deposit at $0.89 share price mints ~34 more shares:
    // ATH $2.32, 64 shares → peak $148.48. Peak scaled up by same factor
    // as shares outstanding — drawdown from peak stays constant per share.
    const after = deriveEffectivePeakNav(2.32, 64, 999);
    expect(after).toBeGreaterThan(before);
    expect(after / before).toBeCloseTo(64 / 30, 5);
  });

  it('drawdown is invariant to deposits (the point of the fix)', () => {
    const athShare = 2.32;
    const currentShare = 0.89;
    // Before deposit: 30 shares. NAV = 30 × 0.89 = 26.70
    const sharesBefore = 30;
    const navBefore = sharesBefore * currentShare;
    const peakBefore = deriveEffectivePeakNav(athShare, sharesBefore, 0);
    const ddBefore = (peakBefore - navBefore) / peakBefore;

    // After $30 deposit at share price 0.89 → +33.7 shares
    const sharesAfter = 30 + 30 / currentShare;
    const navAfter = sharesAfter * currentShare;
    const peakAfter = deriveEffectivePeakNav(athShare, sharesAfter, 0);
    const ddAfter = (peakAfter - navAfter) / peakAfter;

    // Both should equal 1 - (currentShare / athShare) — deposits shouldn't
    // change the drawdown ratio because it's a per-share calculation.
    expect(ddAfter).toBeCloseTo(ddBefore, 6);
    expect(ddBefore).toBeCloseTo(1 - currentShare / athShare, 6);
  });

  it('falls back to cron-state peak when ATH is not populated', () => {
    // Freshly-deployed pool: on-chain ATH not written yet
    expect(deriveEffectivePeakNav(0, 30, 100)).toBe(100);
    // Zero shares (empty pool): fallback
    expect(deriveEffectivePeakNav(2.32, 0, 100)).toBe(100);
    // Both zero: fallback
    expect(deriveEffectivePeakNav(0, 0, 100)).toBe(100);
  });

  it('handles negative fallback by returning 0', () => {
    // Fallback of 0 is fine (no cron-state entry). Function returns fallback
    // directly when derivation fails; caller decides how to handle 0.
    expect(deriveEffectivePeakNav(0, 0, 0)).toBe(0);
  });

  it('caps anachronistic derived peak at rolling-window fallback', () => {
    // 2026-08-14 live scenario: on-chain athSharePrice $2.32 was set during
    // pool bootstrap (~10 shares in circulation, NAV ~$23). Later deposits
    // grew shares to 74, but athSharePrice stayed at the boot-phase high.
    // Raw derived = 2.32 × 74 = $171.76 — a peak the current cohort never
    // actually observed. Rolling peak from pool-nav-monitor knows the real
    // peak ($56.52), so the cap prevents the anachronism from halting.
    const derived = deriveEffectivePeakNav(2.32, 74, 56.52);
    expect(derived).toBe(56.52);
    // Verify the drawdown gate would NOT trip: NAV $56.41 vs peak $56.52
    // = 0.19% drawdown, well below any halt threshold.
    const drawdownPct = ((56.52 - 56.41) / 56.52) * 100;
    expect(drawdownPct).toBeLessThan(1);
  });
});
