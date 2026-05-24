/**
 * Golden tests for BlueFin order-size snapping (lib/services/sui/bluefin-order-size.ts).
 * Locks the FP-robust step snapping that fixes the silent under-sizing of exact
 * multiples (0.003 BTC must stay 0.003, not collapse to 0.002).
 */
import { describe, it, expect } from '@jest/globals';
import { snapToStepSize, stepDecimals, normalizePriceImpact } from '@/lib/services/sui/bluefin-order-size';

describe('stepDecimals', () => {
  it('derives decimals from the step size', () => {
    expect(stepDecimals(0.001)).toBe(3);
    expect(stepDecimals(0.01)).toBe(2);
    expect(stepDecimals(0.1)).toBe(1);
    expect(stepDecimals(1)).toBe(0);
  });
});

describe('snapToStepSize — exact multiples survive (the FP fix)', () => {
  it('0.003 BTC @ step 0.001 stays 0.003 (was 0.002 under naive floor)', () => {
    expect(snapToStepSize(0.003, 0.001)).toBe(0.003);
    expect(snapToStepSize(0.007, 0.001)).toBe(0.007);
    expect(snapToStepSize(0.03, 0.01)).toBe(0.03);
  });
  it('produces clean decimals, not 0.006999…', () => {
    expect(snapToStepSize(0.006, 0.001)).toBe(0.006);
    expect(Number.isInteger(snapToStepSize(5, 1))).toBe(true);
  });
});

describe('snapToStepSize — floors between steps, never exceeds input', () => {
  it('rounds down partial steps', () => {
    expect(snapToStepSize(0.0035, 0.001)).toBe(0.003);
    expect(snapToStepSize(0.025, 0.01)).toBe(0.02);
    expect(snapToStepSize(5.9, 1)).toBe(5);
  });
  it('never returns more than the input size', () => {
    for (const [size, step] of [[0.0029, 0.001], [0.099, 0.01], [7.4, 1]] as const) {
      expect(snapToStepSize(size, step)).toBeLessThanOrEqual(size);
    }
  });
});

describe('snapToStepSize — edges', () => {
  it('below one step → 0', () => {
    expect(snapToStepSize(0.0009, 0.001)).toBe(0);
  });
  it('exact minimum step → itself', () => {
    expect(snapToStepSize(0.001, 0.001)).toBe(0.001);
    expect(snapToStepSize(1, 1)).toBe(1);
  });
  it('guards bad inputs', () => {
    expect(snapToStepSize(0, 0.001)).toBe(0);
    expect(snapToStepSize(-1, 0.001)).toBe(0);
    expect(snapToStepSize(0.5, 0)).toBe(0.5); // no step → unchanged
  });
});

describe('normalizePriceImpact', () => {
  it('treats values > 0.5 as ratio-remaining (impact = 1 − v)', () => {
    expect(normalizePriceImpact(0.9999)).toBeCloseTo(0.0001, 6);
    expect(normalizePriceImpact(0.6)).toBeCloseTo(0.4, 6);
    expect(normalizePriceImpact(-0.9999)).toBeCloseTo(0.0001, 6); // abs first
  });
  it('treats values ≤ 0.5 as direct impact', () => {
    expect(normalizePriceImpact(0.0001)).toBeCloseTo(0.0001, 6);
    expect(normalizePriceImpact(0.5)).toBe(0.5);
  });
  it('returns 0 for null/undefined/NaN/0', () => {
    expect(normalizePriceImpact(null)).toBe(0);
    expect(normalizePriceImpact(undefined)).toBe(0);
    expect(normalizePriceImpact(NaN)).toBe(0);
    expect(normalizePriceImpact(0)).toBe(0);
  });
});
