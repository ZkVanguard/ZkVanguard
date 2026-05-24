/**
 * Golden tests for the pure hedge risk math (lib/services/hedging/hedge-risk-math.ts):
 * drawdown, volatility, concentration, and the position-driven hedge
 * recommendation rules (prediction-driven path covered separately).
 */
import { describe, it, expect } from '@jest/globals';
import {
  calculateDrawdown,
  calculateVolatility,
  calculateConcentrationRisk,
  generateHedgeRecommendations,
} from '@/lib/services/hedging/hedge-risk-math';

describe('calculateDrawdown', () => {
  it('value-weights only the losing positions', () => {
    // BTC -10% @ 50% weight contributes 5; ETH +5% contributes 0
    expect(calculateDrawdown([{ value: 50, change24h: -10 }, { value: 50, change24h: 5 }], 100)).toBeCloseTo(5, 6);
  });
  it('guards empty / zero total', () => {
    expect(calculateDrawdown([], 100)).toBe(0);
    expect(calculateDrawdown([{ value: 10, change24h: -5 }], 0)).toBe(0);
  });
});

describe('calculateVolatility', () => {
  it('uses value-weighted real volatility when present (→ %)', () => {
    expect(calculateVolatility([{ value: 100, volatility: 0.3 }])).toBeCloseTo(30, 6);
  });
  it('falls back to annualized RMSE of 24h changes', () => {
    // sqrt((0.1^2)/1) * sqrt(365) * 100 = 0.1 * 19.1049… * 100
    expect(calculateVolatility([{ change24h: 10 }])).toBeCloseTo(0.1 * Math.sqrt(365) * 100, 4);
  });
  it('empty → 0', () => {
    expect(calculateVolatility([])).toBe(0);
  });
});

describe('calculateConcentrationRisk', () => {
  it('= largest position as % of total', () => {
    expect(calculateConcentrationRisk([{ value: 60 }, { value: 40 }], 100)).toBeCloseTo(60, 6);
  });
  it('guards empty / zero', () => {
    expect(calculateConcentrationRisk([], 100)).toBe(0);
    expect(calculateConcentrationRisk([{ value: 5 }], 0)).toBe(0);
  });
});

describe('generateHedgeRecommendations (position-driven, no prediction)', () => {
  it('recommends a SHORT on a losing position', () => {
    const recs = generateHedgeRecommendations(
      [{ symbol: 'BTC', value: 1000, change24h: -5 }], 1000, {}, [], 0, 100, null,
    );
    const loss = recs.find(r => r.asset === 'BTC' && r.reason.includes('down'));
    expect(loss).toBeDefined();
    expect(loss!.side).toBe('SHORT');
    expect(loss!.confidence).toBeCloseTo(0.95, 2); // capped
    expect(loss!.suggestedSize).toBeGreaterThan(0);
  });
  it('skips already-hedged assets and dust positions', () => {
    const hedged = generateHedgeRecommendations(
      [{ symbol: 'BTC', value: 1000, change24h: -5 }], 1000, {}, [{ asset: 'BTC' }], 0, 100, null,
    );
    expect(hedged.find(r => r.asset === 'BTC')).toBeUndefined();

    const dust = generateHedgeRecommendations(
      [{ symbol: 'ETH', value: 10, change24h: -9 }], 10, {}, [], 0, 100, null,
    );
    expect(dust.length).toBe(0); // below MIN_HEDGE_SIZE_USD ($50)
  });
  it('flags concentrated positions (>35%)', () => {
    const recs = generateHedgeRecommendations(
      [{ symbol: 'BTC', value: 800, change24h: 0 }, { symbol: 'ETH', value: 200, change24h: 0 }], 1000, {}, [], 0, 80, null,
    );
    expect(recs.find(r => r.asset === 'BTC' && r.reason.includes('concentration'))).toBeDefined();
  });
});
