/**
 * Golden tests for SUI pool allocation composition
 * (lib/services/sui/pool-allocation.ts).
 */
import { describe, it, expect } from '@jest/globals';
import { parseTargetAllocation, computeLiveAllocation } from '@/lib/services/sui/pool-allocation';

describe('parseTargetAllocation', () => {
  it('converts bps fields to percentages', () => {
    expect(parseTargetAllocation({ btc_bps: 4000, eth_bps: 3000, sui_bps: 2000, cro_bps: 1000 }))
      .toEqual({ BTC: 40, ETH: 30, SUI: 20, CRO: 10 });
  });
  it('applies defaults (30/30/20/20) for missing/zero fields', () => {
    expect(parseTargetAllocation(undefined)).toEqual({ BTC: 30, ETH: 30, SUI: 20, CRO: 20 });
    expect(parseTargetAllocation({})).toEqual({ BTC: 30, ETH: 30, SUI: 20, CRO: 20 });
  });
  it('accepts string bps (RPC shape)', () => {
    expect(parseTargetAllocation({ btc_bps: '5000', eth_bps: '2500', sui_bps: '1500', cro_bps: '1000' }))
      .toEqual({ BTC: 50, ETH: 25, SUI: 15, CRO: 10 });
  });
});

describe('computeLiveAllocation', () => {
  const target = { BTC: 30, ETH: 30, SUI: 20, CRO: 20 };

  it('falls back to the AI target when NAV ≈ 0', () => {
    expect(computeLiveAllocation({ assetUsdValue: { BTC: 0, ETH: 0, SUI: 0 }, usdcBucket: 0, totalNavUsdc: 0, target }))
      .toEqual(target);
    expect(computeLiveAllocation({ assetUsdValue: { BTC: 0, ETH: 0, SUI: 0 }, usdcBucket: 0, totalNavUsdc: 0.005, target }))
      .toEqual(target);
  });

  it('computes market-value % of NAV with a USDC bucket', () => {
    // NAV 100: BTC 40, ETH 20, SUI 10, USDC bucket 30
    const live = computeLiveAllocation({
      assetUsdValue: { BTC: 40, ETH: 20, SUI: 10 }, usdcBucket: 30, totalNavUsdc: 100, target,
    });
    expect(live).toEqual({ BTC: 40, ETH: 20, SUI: 10, CRO: 0, USDC: 30 });
  });

  it('rounds to 2 decimals', () => {
    const live = computeLiveAllocation({
      assetUsdValue: { BTC: 1, ETH: 0, SUI: 0 }, usdcBucket: 2, totalNavUsdc: 3, target,
    });
    expect(live.BTC).toBeCloseTo(33.33, 2);
    expect(live.USDC).toBeCloseTo(66.67, 2);
  });
});
