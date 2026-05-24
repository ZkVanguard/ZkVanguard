/**
 * Golden tests for the hedge calibration & sizing math (lib/services/hedging/
 * calibration.ts) — the most safety-critical sizing in the platform: quarter/
 * eighth-Kelly on calibrated probability, bounded by TVL caps that mirror the
 * on-chain Move guards. Expectations are derived from SIZING_LIMITS so they
 * stay correct under env overrides.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import {
  SIZING_LIMITS,
  kellyFraction,
  computeSafeCollateralUsd,
  safeLeverage,
  isPriceFreshEnough,
  buildDecisionToken,
  qualifyAggregatedPrediction,
  isTradingHalted,
  type QualifiedSignal,
} from '@/lib/services/hedging/calibration';

describe('kellyFraction', () => {
  it('is 0 at or below a coin flip', () => {
    expect(kellyFraction(0.5)).toBe(0);
    expect(kellyFraction(0.3)).toBe(0);
  });
  it('is 0 for non-positive payoff odds', () => {
    expect(kellyFraction(0.7, 0)).toBe(0);
  });
  it('= clamp01(p − (1−p)/b) / KELLY_DIVISOR', () => {
    // p=0.6, b=1 → fullKelly 0.2 → /divisor
    expect(kellyFraction(0.6)).toBeCloseTo(0.2 / SIZING_LIMITS.KELLY_DIVISOR, 9);
    expect(kellyFraction(0.95)).toBeCloseTo(0.9 / SIZING_LIMITS.KELLY_DIVISOR, 9);
  });
});

describe('computeSafeCollateralUsd', () => {
  const good: QualifiedSignal = { probability: 0.6, direction: 'DOWN', edge: 0.1, weight: 1, source: 't', fetchedAt: Date.now() };

  it('refuses non-positive TVL / negative existing hedge', () => {
    expect(computeSafeCollateralUsd({ signal: good, poolTvlUsd: 0, currentHedgedUsd: 0 })).toBe(0);
    expect(computeSafeCollateralUsd({ signal: good, poolTvlUsd: 100000, currentHedgedUsd: -1 })).toBe(0);
  });
  it('refuses corrupted signals (NaN/out-of-range)', () => {
    expect(computeSafeCollateralUsd({ signal: { ...good, probability: NaN }, poolTvlUsd: 100000, currentHedgedUsd: 0 })).toBe(0);
    expect(computeSafeCollateralUsd({ signal: { ...good, probability: 1 }, poolTvlUsd: 100000, currentHedgedUsd: 0 })).toBe(0);
    expect(computeSafeCollateralUsd({ signal: { ...good, weight: 2 }, poolTvlUsd: 100000, currentHedgedUsd: 0 })).toBe(0);
  });
  it('sizes via Kelly × weight, bounded by caps, floored to cents', () => {
    const tvl = 100000;
    const kellySize = tvl * kellyFraction(good.probability) * good.weight;
    const expected = Math.floor(Math.min(
      kellySize,
      tvl * SIZING_LIMITS.MAX_HEDGE_RATIO_OF_TVL,
      tvl * SIZING_LIMITS.MAX_SINGLE_TRADE_OF_TVL,
    ) * 100) / 100;
    expect(computeSafeCollateralUsd({ signal: good, poolTvlUsd: tvl, currentHedgedUsd: 0 })).toBeCloseTo(expected, 2);
  });
  it('returns 0 when the hedge budget is already exhausted', () => {
    const tvl = 100000;
    const exhausted = tvl * SIZING_LIMITS.MAX_HEDGE_RATIO_OF_TVL; // remaining budget 0
    expect(computeSafeCollateralUsd({ signal: good, poolTvlUsd: tvl, currentHedgedUsd: exhausted })).toBe(0);
  });
  it('returns 0 when the resulting size is below the min floor', () => {
    // tiny TVL → size well under MIN_HEDGE_USD
    expect(computeSafeCollateralUsd({ signal: good, poolTvlUsd: 100, currentHedgedUsd: 0 })).toBe(0);
  });
});

describe('safeLeverage', () => {
  it('clamps to [1, HARD_LEVERAGE_CAP] and floors', () => {
    expect(safeLeverage(5, 3)).toBe(SIZING_LIMITS.HARD_LEVERAGE_CAP); // min(5,3,cap)
    expect(safeLeverage(1, 10)).toBe(1);
    expect(safeLeverage(0, 0)).toBe(1);   // floor at 1
    expect(safeLeverage(NaN, NaN)).toBe(1);
  });
});

describe('isPriceFreshEnough', () => {
  it('accepts [0, MAX_PRICE_STALENESS_MS], rejects negative/stale/NaN', () => {
    expect(isPriceFreshEnough(0)).toBe(true);
    expect(isPriceFreshEnough(SIZING_LIMITS.MAX_PRICE_STALENESS_MS)).toBe(true);
    expect(isPriceFreshEnough(SIZING_LIMITS.MAX_PRICE_STALENESS_MS + 1)).toBe(false);
    expect(isPriceFreshEnough(-1)).toBe(false);
    expect(isPriceFreshEnough(NaN)).toBe(false);
  });
});

describe('buildDecisionToken', () => {
  it('is deterministic for the same inputs within a bucket', () => {
    const args = { portfolioId: -2, asset: 'BTC', side: 'SHORT' as const, riskScore: 7.04, now: 1_000_000_000, bucketMs: 300_000 };
    const a = buildDecisionToken(args);
    const b = buildDecisionToken(args);
    expect(a).toBe(b);
    expect(a).toContain('-2:BTC:SHORT:r7');
  });
  it('changes when the time bucket rolls', () => {
    const base = { portfolioId: 1, asset: 'ETH', side: 'LONG' as const, riskScore: 5, bucketMs: 300_000 };
    expect(buildDecisionToken({ ...base, now: 0 })).not.toBe(buildDecisionToken({ ...base, now: 300_001 }));
  });
});

describe('qualifyAggregatedPrediction', () => {
  const now = 1_000_000;
  it('null / stale / neutral → null', () => {
    expect(qualifyAggregatedPrediction(null, now)).toBeNull();
    const stale = { direction: 'DOWN', consensus: 90, confidence: 90, probability: 65, timestamp: 0 } as any;
    expect(qualifyAggregatedPrediction(stale, now)).toBeNull();
    const neutral = { direction: 'NEUTRAL', consensus: 90, confidence: 90, probability: 65, timestamp: now } as any;
    expect(qualifyAggregatedPrediction(neutral, now)).toBeNull();
  });
  it('rejects low consensus/confidence', () => {
    const weak = { direction: 'DOWN', consensus: 50, confidence: 90, probability: 65, timestamp: now } as any;
    expect(qualifyAggregatedPrediction(weak, now)).toBeNull();
  });
  it('qualifies a strong, fresh, sufficiently-edged signal', () => {
    const good = { direction: 'DOWN', consensus: 80, confidence: 80, probability: 65, timestamp: now } as any;
    const q = qualifyAggregatedPrediction(good, now);
    expect(q).not.toBeNull();
    expect(q!.direction).toBe('DOWN');
    expect(q!.probability).toBeCloseTo(0.65, 6);
    expect(q!.edge).toBeCloseTo(0.15, 6);
    expect(q!.weight).toBeCloseTo(0.64, 6); // 0.8 * 0.8
  });
});

describe('isTradingHalted (kill switch)', () => {
  afterEach(() => { delete process.env.KILL_SWITCH; delete process.env.TRADING_KILL_SWITCH; });
  it('false by default, true for kill tokens', () => {
    expect(isTradingHalted()).toBe(false);
    for (const t of ['true', '1', 'on', 'yes', 'disable', 'halt', 'HALT']) {
      process.env.KILL_SWITCH = t;
      expect(isTradingHalted()).toBe(true);
    }
    process.env.KILL_SWITCH = 'no';
    expect(isTradingHalted()).toBe(false);
  });
});
