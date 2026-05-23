/**
 * Golden tests for the hedge PnL formula (lib/services/sui/hedge-pnl.ts).
 * Locks the notional × pctMove × sign computation used on close-estimate and
 * live-PnL paths. A change that breaks these changed money behavior.
 */
import { describe, it, expect } from '@jest/globals';
import { estimateHedgePnl, roundPnl8 } from '@/lib/services/sui/hedge-pnl';

describe('estimateHedgePnl', () => {
  it('LONG gains when price rises', () => {
    // $100 notional, entry 50k, exit 55k → +10% → +$10
    expect(estimateHedgePnl('LONG', 100, 50000, 55000)).toBeCloseTo(10, 9);
  });
  it('LONG loses when price falls', () => {
    expect(estimateHedgePnl('LONG', 100, 50000, 45000)).toBeCloseTo(-10, 9);
  });
  it('SHORT gains when price falls', () => {
    expect(estimateHedgePnl('SHORT', 100, 50000, 45000)).toBeCloseTo(10, 9);
  });
  it('SHORT loses when price rises', () => {
    expect(estimateHedgePnl('SHORT', 100, 50000, 55000)).toBeCloseTo(-10, 9);
  });
  it('returns 0 when entry/price/notional is missing or non-positive', () => {
    expect(estimateHedgePnl('LONG', 100, 0, 55000)).toBe(0);
    expect(estimateHedgePnl('LONG', 100, 50000, 0)).toBe(0);
    expect(estimateHedgePnl('LONG', 0, 50000, 55000)).toBe(0);
    expect(estimateHedgePnl('LONG', -100, 50000, 55000)).toBe(0);
    // @ts-expect-error — guard against NaN inputs
    expect(estimateHedgePnl('LONG', NaN, 50000, 55000)).toBe(0);
  });
  it('treats any non-LONG side as SHORT', () => {
    expect(estimateHedgePnl('SHORT', 100, 50000, 45000)).toBeCloseTo(10, 9);
    expect(estimateHedgePnl('short', 100, 50000, 45000)).toBeCloseTo(10, 9);
  });
});

describe('roundPnl8', () => {
  it('rounds to 8 decimals', () => {
    expect(roundPnl8(1.123456789)).toBe(1.12345679);
    expect(roundPnl8(-2.000000004)).toBe(-2);
  });
});
