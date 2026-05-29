/**
 * Golden tests for the auto-hedge sizing math (lib/services/sui/cron/hedge-sizing.ts).
 * Locks NAV-tiered leverage, hedge ratio, margin, and NAV-scaled reserves so the
 * Stage-2 cron decomposition can't silently change hedge sizing.
 */
import { describe, it, expect } from '@jest/globals';
import {
  navTier,
  tierLeverageCap,
  resolveLeverage,
  hedgeRatioForNav,
  computeTargetMargin,
  hedgeValueUsd,
  scaledReserves,
} from '@/lib/services/sui/cron/hedge-sizing';

describe('navTier + tierLeverageCap', () => {
  it('classifies NAV into tiers at the documented thresholds', () => {
    expect(navTier(50)).toBe('tiny');
    expect(navTier(999.99)).toBe('tiny');
    expect(navTier(1_000)).toBe('small');
    expect(navTier(999_999)).toBe('small');
    expect(navTier(1_000_000)).toBe('medium');
    expect(navTier(99_999_999)).toBe('medium');
    expect(navTier(100_000_000)).toBe('large');
  });
  it('maps tiers to leverage caps', () => {
    expect(tierLeverageCap('tiny')).toBe(5);
    expect(tierLeverageCap('small')).toBe(3);
    expect(tierLeverageCap('medium')).toBe(3);
    expect(tierLeverageCap('large')).toBe(2);
  });
});

describe('resolveLeverage', () => {
  it('uses the tier cap when no config is given', () => {
    expect(resolveLeverage(50)).toBe(5);          // tiny
    expect(resolveLeverage(5_000)).toBe(3);       // small
    expect(resolveLeverage(5_000_000)).toBe(3);   // medium
    expect(resolveLeverage(200_000_000)).toBe(2); // large
  });
  it('lets an operator config only LOWER leverage, never raise it', () => {
    expect(resolveLeverage(50, 3)).toBe(3);   // config below cap → config
    expect(resolveLeverage(50, 20)).toBe(5);  // config above cap → cap
    expect(resolveLeverage(5_000, 2)).toBe(2);
  });
});

describe('hedgeRatioForNav', () => {
  it('fully hedges tiny pools, 50% otherwise', () => {
    expect(hedgeRatioForNav(999)).toBe(1.0);
    expect(hedgeRatioForNav(1000)).toBe(0.5);
    expect(hedgeRatioForNav(48.69)).toBe(1.0);
  });
});

describe('computeTargetMargin', () => {
  it('= notional/leverage + 0.5, floored at 1.5', () => {
    // NAV 100k, 100% alloc, ratio .5, lev 5 → 100000*0.5/5 + 0.5 = 10000.5
    expect(computeTargetMargin(100_000, 100, 0.5, 5)).toBeCloseTo(10000.5, 6);
    // tiny: NAV 48.69, alloc 90%, ratio 1, lev 10 → 48.69*0.9/10 + 0.5 = 4.882 → above floor
    expect(computeTargetMargin(48.69, 90, 1.0, 10)).toBeCloseTo(4.88210, 5);
    // floor kicks in for dust
    expect(computeTargetMargin(1, 100, 1, 10)).toBe(1.5);
  });
  it('treats leverage < 1 as 1 (no divide-by-zero / inflation)', () => {
    expect(computeTargetMargin(1000, 100, 1, 0)).toBeCloseTo(1000.5, 6);
  });
});

describe('hedgeValueUsd', () => {
  it('= NAV × allocPct% × ratio', () => {
    expect(hedgeValueUsd(48.69, 50, 1.0)).toBeCloseTo(24.345, 6);
    expect(hedgeValueUsd(100_000, 30, 0.5)).toBeCloseTo(15_000, 6);
    expect(hedgeValueUsd(1000, 0, 0.5)).toBe(0);
  });
});

describe('scaledReserves', () => {
  it('applies floors for tiny pools', () => {
    const r = scaledReserves(48.69, 1.5);
    expect(r.spotReserve).toBe(0.5);   // max(0.5, 48.69*0.0005=0.024)
    expect(r.suiReserve).toBe(0.5);    // max(0.5, tiny)
    expect(r.maxSwapSui).toBe(5);      // max(5, tiny)
  });
  it('scales with NAV for large pools and caps spotReserve at 5k', () => {
    const r = scaledReserves(100_000_000, 2);
    expect(r.spotReserve).toBe(5_000); // min(5000, 100M*0.0005=50000)
    expect(r.suiReserve).toBeCloseTo((100_000_000 * 0.00001) / 2, 6); // 500
    expect(r.maxSwapSui).toBeCloseTo((100_000_000 * 0.001) / 2, 6);   // 50000
  });
  it('treats a zero/missing SUI price as 1 (|| 1), and floors a tiny price at 0.01', () => {
    // 0 is falsy → `0 || 1` → suiPrice 1
    const z = scaledReserves(1_000_000, 0);
    expect(z.suiReserve).toBeCloseTo((1_000_000 * 0.00001) / 1, 6); // 10
    // a tiny positive price is clamped up to the 0.01 floor
    const t = scaledReserves(1_000_000, 0.005);
    expect(t.suiReserve).toBeCloseTo((1_000_000 * 0.00001) / 0.01, 6); // 1000
  });
});
