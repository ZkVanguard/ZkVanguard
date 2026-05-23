/**
 * Golden tests for SUI cron signal classification + gating
 * (lib/services/sui/cron/signal-gating.ts).
 */
import { describe, it, expect } from '@jest/globals';
import {
  classifyVolatility,
  classifyTrend,
  scoreAsset,
  clampConfidence,
  isStrongHedgeSignal,
} from '@/lib/services/sui/cron/signal-gating';

describe('classifyVolatility', () => {
  it('bands at 3% and 7%', () => {
    expect(classifyVolatility(0)).toBe('low');
    expect(classifyVolatility(2.99)).toBe('low');
    expect(classifyVolatility(3)).toBe('medium');
    expect(classifyVolatility(6.99)).toBe('medium');
    expect(classifyVolatility(7)).toBe('high');
  });
});

describe('classifyTrend', () => {
  it('uses a ±2% deadband', () => {
    expect(classifyTrend(2.01)).toBe('bullish');
    expect(classifyTrend(2)).toBe('neutral');
    expect(classifyTrend(-2)).toBe('neutral');
    expect(classifyTrend(-2.01)).toBe('bearish');
    expect(classifyTrend(0)).toBe('neutral');
  });
});

describe('scoreAsset', () => {
  it('base = 50 + 2×change, adjusted by vol/trend/volume, clamped 0–100', () => {
    // change +5 (=60), low vol (+10), bullish (+10), volume*price 2e8>1e8 (+5) = 85
    expect(scoreAsset({ change24h: 5, volatility: 'low', trend: 'bullish', volume24h: 1000, price: 200000 })).toBe(85);
    // change -10 (=30), high vol (-5), bearish (-10), low volume (0) = 15
    expect(scoreAsset({ change24h: -10, volatility: 'high', trend: 'bearish', volume24h: 1, price: 1 })).toBe(15);
    // clamps below 0
    expect(scoreAsset({ change24h: -100, volatility: 'high', trend: 'bearish', volume24h: 0, price: 0 })).toBe(0);
    // clamps above 100
    expect(scoreAsset({ change24h: 100, volatility: 'low', trend: 'bullish', volume24h: 1e6, price: 1e6 })).toBe(100);
  });
});

describe('clampConfidence', () => {
  it('= 60 + 8×clearTrends − 5×highVol, bounded 50–95', () => {
    expect(clampConfidence(0, 0)).toBe(60);
    expect(clampConfidence(3, 0)).toBe(84);
    expect(clampConfidence(10, 0)).toBe(95);  // upper clamp
    expect(clampConfidence(0, 5)).toBe(50);   // lower clamp (60-25=35→50)
  });
});

describe('isStrongHedgeSignal', () => {
  it('true on HIGH/CRITICAL urgency regardless of confidence', () => {
    expect(isStrongHedgeSignal('HIGH', 0, 75)).toBe(true);
    expect(isStrongHedgeSignal('critical', 0, 75)).toBe(true);
  });
  it('true when confidence meets the floor', () => {
    expect(isStrongHedgeSignal('LOW', 75, 75)).toBe(true);
    expect(isStrongHedgeSignal(undefined, 80, 75)).toBe(true);
  });
  it('false on weak signal below the floor', () => {
    expect(isStrongHedgeSignal('MEDIUM', 74, 75)).toBe(false);
    expect(isStrongHedgeSignal('', 0, 75)).toBe(false);
  });
});
