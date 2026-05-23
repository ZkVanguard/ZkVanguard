/**
 * Golden tests for SUI pool NAV / share-price math (lib/services/sui/pool-nav.ts).
 * Locks the platform's core money computation against refactor drift.
 */
import { describe, it, expect } from '@jest/globals';
import {
  MAX_REASONABLE_NAV_USDC,
  MAX_REASONABLE_SHARE_PRICE,
  composeNavUsdc,
  computeSharePrice,
  isNavSane,
} from '@/lib/services/sui/pool-nav';

describe('composeNavUsdc', () => {
  it('sums idle + off-chain + bluefin', () => {
    // live mainnet shape: idle 0.4354 + offchain 48.2544 + bluefin 0
    expect(composeNavUsdc(0.4354, 48.2544, 0)).toBeCloseTo(48.6898, 4);
    expect(composeNavUsdc(0, 0, 0)).toBe(0);
  });
});

describe('computeSharePrice', () => {
  it('= NAV / shares', () => {
    expect(computeSharePrice(48.69, 30.2107)).toBeCloseTo(1.61168, 4);
  });
  it('is $1.00 for an empty (zero-share) pool', () => {
    expect(computeSharePrice(0, 0)).toBe(1.0);
    expect(computeSharePrice(100, 0)).toBe(1.0);
  });
});

describe('isNavSane', () => {
  it('accepts realistic values', () => {
    expect(isNavSane(48.69, 1.6117)).toBe(true);
    expect(isNavSane(MAX_REASONABLE_NAV_USDC, 1)).toBe(true);
    expect(isNavSane(100, MAX_REASONABLE_SHARE_PRICE)).toBe(true);
  });
  it('rejects NAV above $10B', () => {
    expect(isNavSane(MAX_REASONABLE_NAV_USDC + 1, 1)).toBe(false);
  });
  it('rejects share price above $1M (overflow/oracle attack)', () => {
    expect(isNavSane(100, MAX_REASONABLE_SHARE_PRICE + 1)).toBe(false);
  });
});
