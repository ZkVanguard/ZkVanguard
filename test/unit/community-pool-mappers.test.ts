/**
 * Golden tests for the community-pool API→view-model mappers
 * (components/dashboard/community-pool/mappers.ts).
 */
import { describe, it, expect } from '@jest/globals';
import {
  normalizeAllocations,
  mapApiToPoolSummary,
  mapApiToUserPosition,
} from '@/components/dashboard/community-pool/mappers';

describe('normalizeAllocations', () => {
  it('passes through a server-computed composition', () => {
    expect(normalizeAllocations({ BTC: 35, ETH: 30, SUI: 20, USDC: 15, CRO: 0 }, 100))
      .toEqual({ BTC: 35, ETH: 30, SUI: 20, USDC: 15, CRO: 0 });
  });
  it('falls back to SUI 100% for a non-empty pool with no server composition', () => {
    expect(normalizeAllocations(undefined, 48.69)).toEqual({ BTC: 0, ETH: 0, SUI: 100, CRO: 0, USDC: 0 });
    expect(normalizeAllocations({}, 48.69)).toEqual({ BTC: 0, ETH: 0, SUI: 100, CRO: 0, USDC: 0 });
  });
  it('uses 0% SUI for an empty pool', () => {
    expect(normalizeAllocations({}, 0)).toEqual({ BTC: 0, ETH: 0, SUI: 0, CRO: 0, USDC: 0 });
  });
});

describe('mapApiToPoolSummary', () => {
  it('coerces the live API shape into a PoolSummary', () => {
    const s = mapApiToPoolSummary({
      totalShares: '30.2107', totalNAV: '48.69', totalNAVUsd: '48.69',
      sharePrice: '1.611533', sharePriceUsd: '1.611533', memberCount: 3,
      allocation: { BTC: 40, ETH: 30, SUI: 20, USDC: 10, CRO: 0 },
      allTimeHighNav: '1.671583', totalDeposited: '30.80', totalWithdrawn: '0',
    });
    expect(s.totalShares).toBeCloseTo(30.2107, 4);
    expect(s.totalValueUSD).toBeCloseTo(48.69, 2);
    expect(s.sharePrice).toBeCloseTo(1.611533, 6);
    expect(s.memberCount).toBe(3);
    expect(s.allocations.BTC).toBe(40);
    expect(s.allTimeHighNav).toBeCloseTo(1.671583, 6);
    expect(s.totalDeposited).toBeCloseTo(30.8, 2);
    expect(s.aiLastUpdate).toBeNull();
  });
  it('applies safe defaults for missing fields', () => {
    const s = mapApiToPoolSummary({});
    expect(s.totalShares).toBe(0);
    expect(s.sharePrice).toBe(1.0);     // defaults to par
    expect(s.memberCount).toBe(0);
    expect(s.allTimeHighNav).toBeUndefined();
    expect(s.allocations.SUI).toBe(0);  // empty pool → 0% SUI
  });
});

describe('mapApiToUserPosition', () => {
  it('coerces shares/value/percentage and member flag', () => {
    const u = mapApiToUserPosition(
      { shares: '5.98', valueUsd: '9.6', valueSui: '0', percentage: '19.8', isMember: true, depositedSui: '5.98', withdrawnSui: '0' },
      '0xWALLET',
    );
    expect(u.walletAddress).toBe('0xWALLET');
    expect(u.shares).toBeCloseTo(5.98, 2);
    expect(u.valueUSD).toBeCloseTo(9.6, 2);
    expect(u.percentage).toBeCloseTo(19.8, 2);
    expect(u.isMember).toBe(true);
  });
  it('defaults a non-member empty position', () => {
    const u = mapApiToUserPosition({}, '');
    expect(u.shares).toBe(0);
    expect(u.isMember).toBe(false);
    expect(u.walletAddress).toBe('');
  });
});
