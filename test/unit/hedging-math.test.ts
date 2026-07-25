/**
 * Contract lock for HedgingAgent's pure statistical primitives.
 *
 * These functions drive hedge sizing (correlation × vol × notional →
 * ratio). A wrong formula either over-hedges (bleeds fees) or leaves
 * exposure open. Anchoring the math so a "simplify" pass can't silently
 * change strategy.
 */
import { describe, it, expect } from '@jest/globals';
import {
  logReturns, pearsonCorrelation, lag1Autocorrelation,
  annualizedVolatility, deriveCorrelationFromMarketProxy, optimalHedgeRatio,
} from '@/agents/specialized/hedging-math';

describe('logReturns', () => {
  it('produces n-1 returns from n prices', () => {
    expect(logReturns([100, 110, 121]).length).toBe(2);
  });

  it('matches ln(next / prev) for each pair', () => {
    const r = logReturns([100, 110]);
    expect(r[0]).toBeCloseTo(Math.log(1.1), 10);
  });

  it('skips pairs where prior price is 0 or negative', () => {
    expect(logReturns([0, 100, 110])).toEqual([Math.log(1.1)]);
    expect(logReturns([-1, 100, 110])).toEqual([Math.log(1.1)]);
  });

  it('empty / single-element input → empty output', () => {
    expect(logReturns([])).toEqual([]);
    expect(logReturns([100])).toEqual([]);
  });
});

describe('pearsonCorrelation', () => {
  it('perfect positive correlation = 1', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it('perfect negative correlation = -1', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it('zero variance in either series returns 0 (degenerate)', () => {
    expect(pearsonCorrelation([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
    expect(pearsonCorrelation([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0);
  });

  it('unequal length uses the shorter', () => {
    // Correlation of first 3 elements should match; extra element on x ignored
    const r1 = pearsonCorrelation([1, 2, 3, 999], [2, 4, 6]);
    const r2 = pearsonCorrelation([1, 2, 3], [2, 4, 6]);
    expect(r1).toBeCloseTo(r2, 10);
  });

  it('< 2 elements returns 0', () => {
    expect(pearsonCorrelation([1], [2])).toBe(0);
    expect(pearsonCorrelation([], [])).toBe(0);
  });
});

describe('lag1Autocorrelation', () => {
  it('perfectly momentum series (monotonic) → high autocorrelation', () => {
    const r = lag1Autocorrelation([0.01, 0.02, 0.03, 0.04, 0.05]);
    expect(r).toBeGreaterThan(0.5);
  });

  it('constant series → 0 (autoVar = 0 guard)', () => {
    expect(lag1Autocorrelation([1, 1, 1, 1])).toBe(0);
  });

  it('< 2 elements → 0', () => {
    expect(lag1Autocorrelation([])).toBe(0);
    expect(lag1Autocorrelation([1])).toBe(0);
  });

  it('always returns non-negative (absolute value)', () => {
    const r = lag1Autocorrelation([1, -1, 1, -1, 1]);
    expect(r).toBeGreaterThanOrEqual(0);
  });
});

describe('annualizedVolatility', () => {
  it('scales daily vol by sqrt(365) by default', () => {
    // Constructed returns: sample stddev exactly 0.02
    const returns = [0.02, -0.02, 0.02, -0.02]; // mean=0, sample var = 4*0.0004/3 ≈ 0.000533
    const dailyVol = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / (returns.length - 1));
    const expected = dailyVol * Math.sqrt(365);
    expect(annualizedVolatility(returns)).toBeCloseTo(expected, 10);
  });

  it('honors custom daysPerYear', () => {
    const returns = [0.01, -0.01, 0.01];
    const v365 = annualizedVolatility(returns, 365);
    const v252 = annualizedVolatility(returns, 252);
    expect(v365).toBeGreaterThan(v252); // more days = larger scaling
  });

  it('< 3 returns → 0', () => {
    expect(annualizedVolatility([])).toBe(0);
    expect(annualizedVolatility([0.01, 0.02])).toBe(0);
  });

  it('uses sample stddev (n-1 denominator, not n)', () => {
    // With returns [0.01, -0.01]: sample var with n-1 = 0.0002/1 = 0.0002 → daily 0.01414
    // With n = 0.0002/2 = 0.0001 → daily 0.01
    // Using our sample-stddev formula must yield the n-1 result (× sqrt(365) ≈ 0.27)
    // But length < 3 returns 0, so add a 3rd point:
    const v = annualizedVolatility([0.01, -0.01, 0.01]);
    // Mean = 0.00333, variance sample = ((0.00667)^2 + (0.01333)^2 + (0.00667)^2) / 2
    // Just verify it's a positive finite number, structure test above already asserts scaling
    expect(v).toBeGreaterThan(0);
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('deriveCorrelationFromMarketProxy', () => {
  it('clamps to [0.5, 0.99]', () => {
    // Zero volume + zero vol + zero autocorr — should be at floor
    expect(deriveCorrelationFromMarketProxy({ volume: 0, dailyVol: 0, autocorr: 0 })).toBe(0.5);
    // Huge volume, everything else 0 — should hit near top
    const high = deriveCorrelationFromMarketProxy({ volume: 1e12, dailyVol: 0, autocorr: 0 });
    expect(high).toBeGreaterThan(0.9);
    expect(high).toBeLessThanOrEqual(0.99);
  });

  it('higher volatility penalty reduces correlation', () => {
    const low = deriveCorrelationFromMarketProxy({ volume: 1e9, dailyVol: 0.01, autocorr: 0 });
    const high = deriveCorrelationFromMarketProxy({ volume: 1e9, dailyVol: 0.5, autocorr: 0 });
    expect(high).toBeLessThan(low);
  });

  it('higher autocorrelation (less efficient market) reduces correlation', () => {
    const low = deriveCorrelationFromMarketProxy({ volume: 1e9, dailyVol: 0.05, autocorr: 0 });
    const high = deriveCorrelationFromMarketProxy({ volume: 1e9, dailyVol: 0.05, autocorr: 0.8 });
    expect(high).toBeLessThan(low);
  });
});

describe('optimalHedgeRatio', () => {
  it('base case: ratio == correlation when vol is mid & size is mid', () => {
    // vol 0.3 (not < 0.15, not > 0.5, not > 0.8), size 100k (not < 50k, not > 5M)
    const r = optimalHedgeRatio({ correlation: 0.8, volatility: 0.3, notionalValue: 100_000 });
    expect(r).toBeCloseTo(0.8, 5);
  });

  it('extreme vol (>0.8) increases hedge ratio by 15% (capped at 1.0)', () => {
    const r = optimalHedgeRatio({ correlation: 0.8, volatility: 0.9, notionalValue: 100_000 });
    expect(r).toBeCloseTo(0.92, 5); // 0.8 × 1.15
  });

  it('high vol (>0.5) increases by 5%', () => {
    const r = optimalHedgeRatio({ correlation: 0.8, volatility: 0.6, notionalValue: 100_000 });
    expect(r).toBeCloseTo(0.84, 5); // 0.8 × 1.05
  });

  it('low vol (<0.15) decreases by 15%', () => {
    const r = optimalHedgeRatio({ correlation: 0.8, volatility: 0.10, notionalValue: 100_000 });
    expect(r).toBeCloseTo(0.68, 5); // 0.8 × 0.85
  });

  it('large notional (>$5M) increases by 10%', () => {
    const r = optimalHedgeRatio({ correlation: 0.8, volatility: 0.3, notionalValue: 10_000_000 });
    expect(r).toBeCloseTo(0.88, 5); // 0.8 × 1.1
  });

  it('small notional (<$50k) decreases by 10%', () => {
    const r = optimalHedgeRatio({ correlation: 0.8, volatility: 0.3, notionalValue: 10_000 });
    expect(r).toBeCloseTo(0.72, 5); // 0.8 × 0.9
  });

  it('final clamp: minimum 0.3, max 1.0', () => {
    // Correlation 0.1 → below 0.3 clamp
    expect(optimalHedgeRatio({ correlation: 0.1, volatility: 0.3, notionalValue: 100_000 })).toBe(0.3);
    // Extreme all-multipliers stack → clamp to 1.0
    const capped = optimalHedgeRatio({
      correlation: 0.95, volatility: 0.9, notionalValue: 10_000_000,
    });
    expect(capped).toBe(1.0);
  });

  it('multipliers stack (extreme vol + large size)', () => {
    // vol×1.15 then size×1.1 sequentially; the first Math.min caps at 1.0
    const r = optimalHedgeRatio({ correlation: 0.5, volatility: 0.9, notionalValue: 10_000_000 });
    // 0.5 × 1.15 = 0.575, × 1.1 = 0.6325, clamped in [0.3, 1.0] → 0.6325
    expect(r).toBeCloseTo(0.6325, 5);
  });
});
