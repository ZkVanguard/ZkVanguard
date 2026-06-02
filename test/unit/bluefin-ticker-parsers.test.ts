/**
 * Golden tests for the BlueFin ticker OI parser.
 *
 * Locks the fix for the 2026-06-01 production bug where openInterestE9
 * was incorrectly treated as `base × 1e9` (like volume24hrE9) and
 * multiplied by price, inflating BTC OI from $1.66M to $117B.
 *
 * Inputs are exact values pulled from the live BlueFin API on 2026-06-01.
 */
import { describe, it, expect } from '@jest/globals';
import { parseTickerOpenInterest } from '@/lib/services/sui/bluefin-ticker-parsers';

describe('parseTickerOpenInterest — real production values (2026-06-01)', () => {
  it('BTC-PERP — $1.66M OI from "1661914791900000" E9 USD value', () => {
    const r = parseTickerOpenInterest({
      openInterestE9: '1661914791900000',
      quoteVolume24hrE9: '465489266900000',
    }, 70838.1);
    expect(r.openInterestUsd).toBeCloseTo(1_661_914.79, 0);
    expect(r.rejectedReason).toBeUndefined();
  });

  it('ETH-PERP — $40k OI from "40231910100000" E9 USD value', () => {
    const r = parseTickerOpenInterest({
      openInterestE9: '40231910100000',
      quoteVolume24hrE9: '222293492800000',
    }, 1961.8);
    expect(r.openInterestUsd).toBeCloseTo(40_231.91, 0);
    expect(r.rejectedReason).toBeUndefined();
  });

  it('SUI-PERP — $1.36M OI from observed parsing math', () => {
    const r = parseTickerOpenInterest({
      openInterestE9: '1361882733010800',
      quoteVolume24hrE9: '50000000000000',
    }, 0.87);
    expect(r.openInterestUsd).toBeCloseTo(1_361_882.73, 0);
  });
});

describe('parseTickerOpenInterest — convention regression', () => {
  it('does NOT multiply by price (the original bug)', () => {
    // If we mistakenly multiplied by price, BTC OI would be $117B.
    const r = parseTickerOpenInterest({
      openInterestE9: '1661914791900000',
      quoteVolume24hrE9: '465489266900000',
    }, 70838.1);
    expect(r.openInterestUsd!).toBeLessThan(10_000_000);    // sane order of magnitude
    expect(r.openInterestUsd!).toBeLessThan(70_838.1 * 1e6); // and definitely not OI × price
  });

  it('falls back to non-E9 field as USD value directly', () => {
    const r = parseTickerOpenInterest({
      openInterest: '5000000', // plain $5M USD
    }, 100);
    expect(r.openInterestUsd).toBe(5_000_000);
  });
});

describe('parseTickerOpenInterest — sanity check rejects implausible values', () => {
  it('rejects OI > 10000× the 24h quote volume', () => {
    // Volume $100 (1e11 / 1e9), OI claims $1B → ratio 10M× volume → reject.
    const r = parseTickerOpenInterest({
      openInterestE9: '1000000000000000000', // $1B
      quoteVolume24hrE9: '100000000000',     // $100
    }, 100);
    expect(r.openInterestUsd).toBeUndefined();
    expect(r.rejectedReason).toMatch(/implausibly large/);
  });

  it('accepts plausible OI < 10000× the 24h quote volume', () => {
    // Real BTC ratio is ~3.5× — well within bounds
    const r = parseTickerOpenInterest({
      openInterestE9: '1661914791900000',
      quoteVolume24hrE9: '465489266900000',
    }, 70838.1);
    expect(r.openInterestUsd).toBeDefined();
  });
});

describe('parseTickerOpenInterest — defensive edge cases', () => {
  it('returns empty when no OI field present', () => {
    const r = parseTickerOpenInterest({}, 100);
    expect(r.openInterestUsd).toBeUndefined();
  });

  it('returns empty when price is zero or negative', () => {
    const r = parseTickerOpenInterest({ openInterestE9: '1000000000000' }, 0);
    expect(r.openInterestUsd).toBeUndefined();
  });

  it('returns empty on non-numeric OI string', () => {
    const r = parseTickerOpenInterest({ openInterestE9: 'NaN' }, 100);
    expect(r.openInterestUsd).toBeUndefined();
  });

  it('skips sanity check if quote volume missing', () => {
    // Even implausible-looking OI is kept when there's nothing to compare to
    const r = parseTickerOpenInterest({ openInterestE9: '999999999999999999' }, 100);
    expect(r.openInterestUsd).toBeDefined();
  });
});
