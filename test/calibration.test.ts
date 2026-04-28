/**
 * Calibration & Sizing Math — unit tests
 *
 * These tests pin down the safety contracts that protect the pool at
 * billion-dollar TVL. If you change a threshold here, that must come with
 * a backtest justification.
 */

import {
  qualifyPolymarketSignal,
  qualifyAggregatedPrediction,
  computeSafeCollateralUsd,
  kellyFraction,
  safeLeverage,
  isPriceFreshEnough,
  buildDecisionToken,
  SIZING_LIMITS,
} from '@/lib/services/hedging/calibration';
import type { FiveMinBTCSignal } from '@/lib/services/market-data/Polymarket5MinService';
import type { AggregatedPrediction } from '@/lib/services/market-data/PredictionAggregatorService';

const NOW = 1_777_000_000_000;

function makePolymarketSignal(over: Partial<FiveMinBTCSignal & { volume?: number; volume24h?: number; liquidity?: number }> = {}): FiveMinBTCSignal {
  return {
    direction: 'UP',
    probability: 65,
    upProbability: 65,
    downProbability: 35,
    confidence: 75,
    signalStrength: 'MODERATE',
    fetchedAt: NOW,
    // Cast through unknown — extra liquidity/volume fields are accepted by qualifyPolymarketSignal.
    ...(over as object),
  } as unknown as FiveMinBTCSignal;
}

function makeAggregated(over: Partial<AggregatedPrediction> = {}): AggregatedPrediction {
  return {
    direction: 'DOWN',
    confidence: 75,
    probability: 65,
    consensus: 70,
    recommendation: 'HEDGE_SHORT',
    sizeMultiplier: 1.0,
    sources: [],
    reasoning: 'test',
    timestamp: NOW,
    ...over,
  };
}

describe('calibration / qualifyPolymarketSignal', () => {
  it('rejects null', () => {
    expect(qualifyPolymarketSignal(null, NOW)).toBeNull();
  });

  it('rejects stale signal (>5min)', () => {
    const stale = makePolymarketSignal({ fetchedAt: NOW - 6 * 60 * 1000, volume24h: 1000, liquidity: 1000 });
    expect(qualifyPolymarketSignal(stale, NOW)).toBeNull();
  });

  it('rejects illiquid signal', () => {
    const thin = makePolymarketSignal({ volume24h: 5, liquidity: 5 });
    expect(qualifyPolymarketSignal(thin, NOW)).toBeNull();
  });

  it('rejects probability below MIN_PROB', () => {
    const sig = makePolymarketSignal({ upProbability: 20, volume24h: 1000, liquidity: 1000 });
    expect(qualifyPolymarketSignal(sig, NOW)).toBeNull();
  });

  it('rejects probability above MAX_PROB (likely manipulation or resolved)', () => {
    const sig = makePolymarketSignal({ upProbability: 99, volume24h: 1000, liquidity: 1000 });
    expect(qualifyPolymarketSignal(sig, NOW)).toBeNull();
  });

  it('rejects no edge over coin flip', () => {
    const sig = makePolymarketSignal({ upProbability: 52, volume24h: 1000, liquidity: 1000 });
    expect(qualifyPolymarketSignal(sig, NOW)).toBeNull();
  });

  it('accepts well-calibrated, liquid signal', () => {
    const sig = makePolymarketSignal({ upProbability: 70, volume24h: 5000, liquidity: 5000 });
    const q = qualifyPolymarketSignal(sig, NOW);
    expect(q).not.toBeNull();
    expect(q!.probability).toBeCloseTo(0.7, 5);
    expect(q!.edge).toBeCloseTo(0.2, 5);
    expect(q!.weight).toBe(1);
  });
});

describe('calibration / qualifyAggregatedPrediction', () => {
  it('rejects low consensus', () => {
    expect(qualifyAggregatedPrediction(makeAggregated({ consensus: 40 }), NOW)).toBeNull();
  });
  it('rejects neutral direction', () => {
    expect(qualifyAggregatedPrediction(makeAggregated({ direction: 'NEUTRAL' }), NOW)).toBeNull();
  });
  it('accepts qualified signal', () => {
    const q = qualifyAggregatedPrediction(makeAggregated(), NOW);
    expect(q).not.toBeNull();
    expect(q!.direction).toBe('DOWN');
  });
});

describe('calibration / kellyFraction', () => {
  it('returns 0 at coin flip', () => {
    expect(kellyFraction(0.5)).toBe(0);
  });
  it('returns 0 below coin flip', () => {
    expect(kellyFraction(0.4)).toBe(0);
  });
  it('quarter-Kellys positive edge', () => {
    // p=0.7, b=1: full Kelly = 0.4, /4 = 0.1
    expect(kellyFraction(0.7)).toBeCloseTo(0.1, 5);
  });
  it('caps at full Kelly /4 = 0.25', () => {
    // p=1: full Kelly = 1, /4 = 0.25
    expect(kellyFraction(1)).toBe(0.25);
  });
});

describe('calibration / computeSafeCollateralUsd', () => {
  const goodSignal = qualifyPolymarketSignal(
    makePolymarketSignal({ upProbability: 70, volume24h: 5000, liquidity: 5000 }),
    NOW,
  )!;

  it('returns 0 on zero TVL', () => {
    expect(computeSafeCollateralUsd({ signal: goodSignal, poolTvlUsd: 0, currentHedgedUsd: 0 })).toBe(0);
  });

  it('respects MAX_HEDGE_RATIO_OF_TVL across multiple positions', () => {
    // Pool TVL 1M, already hedged to 250K (=cap of 25%) — must return 0.
    const out = computeSafeCollateralUsd({
      signal: goodSignal,
      poolTvlUsd: 1_000_000,
      currentHedgedUsd: 250_000,
    });
    expect(out).toBe(0);
  });

  it('respects MAX_SINGLE_TRADE_OF_TVL', () => {
    // Pool 1M, no existing hedges. Kelly(0.7)*weight(1) = 0.1 → 100K.
    // Per-trade cap = 10% × 1M = 100K. So output ≤ 100K.
    const out = computeSafeCollateralUsd({
      signal: goodSignal,
      poolTvlUsd: 1_000_000,
      currentHedgedUsd: 0,
    });
    expect(out).toBeLessThanOrEqual(100_000);
    expect(out).toBeGreaterThan(SIZING_LIMITS.MIN_HEDGE_USD);
  });

  it('returns 0 when result below MIN_HEDGE_USD', () => {
    // Tiny pool — Kelly fraction of $100 is way below $50 floor.
    const out = computeSafeCollateralUsd({
      signal: goodSignal,
      poolTvlUsd: 100,
      currentHedgedUsd: 0,
    });
    expect(out).toBe(0);
  });

  it('scales with TVL — billion-dollar pool, capped trade', () => {
    // Pool $1B, no hedges. Kelly says 10% but per-trade cap is 10% TVL = $100M.
    const out = computeSafeCollateralUsd({
      signal: goodSignal,
      poolTvlUsd: 1_000_000_000,
      currentHedgedUsd: 0,
    });
    expect(out).toBeLessThanOrEqual(1_000_000_000 * SIZING_LIMITS.MAX_SINGLE_TRADE_OF_TVL);
    // And total hedge budget after this trade does not exceed 25% TVL
    expect(out).toBeLessThanOrEqual(1_000_000_000 * SIZING_LIMITS.MAX_HEDGE_RATIO_OF_TVL);
  });
});

describe('calibration / safeLeverage', () => {
  it('caps to HARD_LEVERAGE_CAP regardless of inputs', () => {
    expect(safeLeverage(100, 100)).toBe(SIZING_LIMITS.HARD_LEVERAGE_CAP);
  });
  it('honours config max', () => {
    expect(safeLeverage(5, 2)).toBe(2);
  });
  it('floors at 1', () => {
    expect(safeLeverage(0, 0)).toBe(1);
    expect(safeLeverage(NaN, NaN)).toBe(1);
  });
});

describe('calibration / isPriceFreshEnough', () => {
  it('accepts fresh', () => {
    expect(isPriceFreshEnough(0)).toBe(true);
    expect(isPriceFreshEnough(15_000)).toBe(true);
  });
  it('rejects stale', () => {
    expect(isPriceFreshEnough(31_000)).toBe(false);
  });
  it('rejects negative or NaN', () => {
    expect(isPriceFreshEnough(-1)).toBe(false);
    expect(isPriceFreshEnough(NaN)).toBe(false);
  });
});

describe('calibration / buildDecisionToken', () => {
  it('is stable within a 5-minute bucket', () => {
    const a = buildDecisionToken({ portfolioId: -2, asset: 'BTC', side: 'SHORT', riskScore: 6, now: NOW });
    const b = buildDecisionToken({ portfolioId: -2, asset: 'BTC', side: 'SHORT', riskScore: 6, now: NOW + 60_000 });
    expect(a).toBe(b);
  });

  it('changes across buckets', () => {
    const a = buildDecisionToken({ portfolioId: -2, asset: 'BTC', side: 'SHORT', riskScore: 6, now: NOW });
    const b = buildDecisionToken({ portfolioId: -2, asset: 'BTC', side: 'SHORT', riskScore: 6, now: NOW + 6 * 60_000 });
    expect(a).not.toBe(b);
  });

  it('changes across direction', () => {
    const a = buildDecisionToken({ portfolioId: -2, asset: 'BTC', side: 'SHORT', riskScore: 6, now: NOW });
    const b = buildDecisionToken({ portfolioId: -2, asset: 'BTC', side: 'LONG', riskScore: 6, now: NOW });
    expect(a).not.toBe(b);
  });
});
