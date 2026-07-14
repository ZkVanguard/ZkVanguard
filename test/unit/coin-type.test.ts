/**
 * Locks the SUI coin-type canonicalization rules used by pool balance
 * summation, allocation drift, and coin matching. A mismatch here means
 * short-form types (0x2::sui::SUI) and padded types don't compare equal,
 * silently double-counting or missing balances.
 */
import { describe, it, expect } from '@jest/globals';
import { canonicalizeCoinType } from '@/lib/services/sui/coin-type';

const PADDED_ZEROS = '0'.repeat(63);

describe('canonicalizeCoinType', () => {
  describe('happy path — pads to 64-char address', () => {
    it('pads SUI native type from 0x2 to full 64 chars', () => {
      expect(canonicalizeCoinType('0x2::sui::SUI'))
        .toBe(`0x${PADDED_ZEROS}2::sui::SUI`);
    });

    it('leaves an already-padded address unchanged', () => {
      const already = `0x${PADDED_ZEROS}2::sui::SUI`;
      expect(canonicalizeCoinType(already)).toBe(already);
    });

    it('lowercases mixed-case addresses', () => {
      const input = `0xABC::mod::COIN`;
      expect(canonicalizeCoinType(input))
        .toBe(`0x${'0'.repeat(61)}abc::mod::COIN`);
    });

    it('strips a leading 0x before padding then re-adds it', () => {
      expect(canonicalizeCoinType('2::sui::SUI'))
        .toBe(`0x${PADDED_ZEROS}2::sui::SUI`);
    });
  });

  describe('invariant — short and padded forms are equal after canonicalization', () => {
    it('two syntactically different forms of the same coin canonicalize identically', () => {
      const short = canonicalizeCoinType('0x2::sui::SUI');
      const long = canonicalizeCoinType(`0x${PADDED_ZEROS}2::sui::SUI`);
      expect(short).toBe(long);
    });

    it('case difference in the address canonicalizes identically', () => {
      const upper = canonicalizeCoinType('0xABC::mod::COIN');
      const lower = canonicalizeCoinType('0xabc::mod::COIN');
      expect(upper).toBe(lower);
    });
  });

  describe('bad input — pass-through instead of throw', () => {
    it('returns empty string unchanged', () => {
      expect(canonicalizeCoinType('')).toBe('');
    });

    it('returns a non-3-part string unchanged', () => {
      expect(canonicalizeCoinType('not-a-coin-type')).toBe('not-a-coin-type');
      expect(canonicalizeCoinType('0x2::sui')).toBe('0x2::sui');
    });
  });

  describe('preserves module + name casing (only address is normalized)', () => {
    it('module and name segments are left untouched', () => {
      // Real wBTC coin type — mixed case must survive
      const input = '0x027792D9::coin::COIN';
      const r = canonicalizeCoinType(input);
      expect(r).toContain('::coin::COIN');  // segments unchanged
      expect(r.split('::')[0]).toBe(`0x${'0'.repeat(56)}027792d9`); // address lowercased + padded
    });
  });
});
