/**
 * Golden / characterization tests for the u64 money-safety helpers.
 *
 * These lock the CURRENT behavior of the on-chain integer parsing that guards
 * NAV / cap / sizing math against silent float rounding and overflow attacks
 * (lib/services/sui/safe-bigint.ts). They must keep passing through any
 * refactor of the SUI financial core — if a change breaks one of these, the
 * change altered money behavior and needs review, not the test.
 */
import { describe, it, expect } from '@jest/globals';
import {
  MICRO_USDC,
  MAX_REASONABLE_MICRO_USDC,
  parseU64Field,
  microUsdcToUsdNumber,
} from '@/lib/services/sui/safe-bigint';

describe('safe-bigint constants', () => {
  it('1 USDC = 1_000_000 microUSDC', () => {
    expect(MICRO_USDC).toBe(1_000_000n);
  });
  it('sanity ceiling is 100B USDC in microUSDC (1e17)', () => {
    expect(MAX_REASONABLE_MICRO_USDC).toBe(100_000_000_000n * MICRO_USDC);
    expect(MAX_REASONABLE_MICRO_USDC).toBe(100_000_000_000_000_000n);
  });
});

describe('parseU64Field', () => {
  it('accepts non-negative bigint unchanged', () => {
    expect(parseU64Field(0n)).toBe(0n);
    expect(parseU64Field(48_690_000n)).toBe(48_690_000n);
  });
  it('rejects negative bigint', () => {
    expect(parseU64Field(-1n)).toBeNull();
  });
  it('accepts safe integer number', () => {
    expect(parseU64Field(0)).toBe(0n);
    expect(parseU64Field(48_690_000)).toBe(48_690_000n);
  });
  it('rejects negative / non-integer / non-finite numbers', () => {
    expect(parseU64Field(-5)).toBeNull();
    expect(parseU64Field(1.5)).toBeNull();
    expect(parseU64Field(NaN)).toBeNull();
    expect(parseU64Field(Infinity)).toBeNull();
  });
  it('rejects a number already lossily rounded above MAX_SAFE_INTEGER', () => {
    expect(parseU64Field(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
  });
  it('parses digit strings exactly, including values far beyond 2^53', () => {
    expect(parseU64Field('1000000')).toBe(1_000_000n);
    // 9.99e18 — would lose precision as a JS number; must survive as bigint
    expect(parseU64Field('9999999999999999999')).toBe(9_999_999_999_999_999_999n);
  });
  it('trims surrounding whitespace on string input', () => {
    expect(parseU64Field('  42 ')).toBe(42n);
  });
  it('rejects non-digit / malformed strings', () => {
    expect(parseU64Field('12.5')).toBeNull();
    expect(parseU64Field('0x1f')).toBeNull();
    expect(parseU64Field('1e6')).toBeNull();
    expect(parseU64Field('abc')).toBeNull();
    expect(parseU64Field('')).toBeNull();
  });
  it('rejects null / undefined / objects', () => {
    expect(parseU64Field(null)).toBeNull();
    expect(parseU64Field(undefined)).toBeNull();
    expect(parseU64Field({})).toBeNull();
    expect(parseU64Field([])).toBeNull();
  });
});

describe('microUsdcToUsdNumber', () => {
  it('converts microUSDC to USD', () => {
    expect(microUsdcToUsdNumber('1000000')).toBe(1);
    expect(microUsdcToUsdNumber('48690000')).toBeCloseTo(48.69, 6);
    expect(microUsdcToUsdNumber(0n)).toBe(0);
  });
  it('defaults invalid input to 0', () => {
    expect(microUsdcToUsdNumber('not-a-number')).toBe(0);
    expect(microUsdcToUsdNumber(null)).toBe(0);
    expect(microUsdcToUsdNumber(-1)).toBe(0);
  });
  it('rejects values above the sanity ceiling (overflow/attack) by returning 0', () => {
    expect(microUsdcToUsdNumber((MAX_REASONABLE_MICRO_USDC + 1n).toString())).toBe(0);
  });
  it('accepts a value exactly at the ceiling', () => {
    expect(microUsdcToUsdNumber(MAX_REASONABLE_MICRO_USDC.toString())).toBe(100_000_000_000);
  });
});
