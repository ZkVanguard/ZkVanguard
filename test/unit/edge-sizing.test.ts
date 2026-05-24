/**
 * Golden tests for the autonomous trader's stake sizing
 * (lib/services/trading/edge-sizing.ts). Locks Kelly compounding + caps so a
 * refactor can't silently up-size real perp trades.
 */
import { describe, it, expect } from '@jest/globals';
import { computeEdgeStake } from '@/lib/services/trading/edge-sizing';

const base = { baseStakeUsd: 5, sizeMultiplier: 1, freeCollateral: 1_000, stakePctOfFree: 0.1, maxStakeUsd: 500 };

describe('computeEdgeStake', () => {
  it('no PnL → compoundMul 1, stake = base × sizeMul (within caps)', () => {
    const r = computeEdgeStake({ ...base, totalPnlUsd: 0 });
    expect(r.compoundMul).toBe(1);
    expect(r.stakeUsd).toBe(5); // base*1*1=5, under free*0.1=100 and max 500
  });
  it('positive cumulative PnL compounds the stake', () => {
    // totalPnl = base → 1 + 5/5 = 2x
    const r = computeEdgeStake({ ...base, totalPnlUsd: 5 });
    expect(r.compoundMul).toBe(2);
    expect(r.stakeUsd).toBe(10);
  });
  it('compounding caps at 5x', () => {
    const r = computeEdgeStake({ ...base, totalPnlUsd: 1000 });
    expect(r.compoundMul).toBe(5);
    expect(r.stakeUsd).toBe(25); // 5*5*1, under caps
  });
  it('losses never shrink below 1x (floor) nor below base stake', () => {
    const r = computeEdgeStake({ ...base, totalPnlUsd: -1000 });
    expect(r.compoundMul).toBe(1);
    expect(r.stakeUsd).toBe(5); // floored at base
  });
  it('caps at 10% of free collateral', () => {
    // huge sizeMul would push stake up, but free*0.1 = 1000*0.1 = 100 caps it
    const r = computeEdgeStake({ ...base, totalPnlUsd: 1000, sizeMultiplier: 10 });
    expect(r.stakeUsd).toBe(100);
  });
  it('caps at the absolute max stake', () => {
    // 5 × 5 × 50 = 1250, free cap huge → absolute max 500 binds
    const r = computeEdgeStake({ ...base, totalPnlUsd: 1000, sizeMultiplier: 50, freeCollateral: 1_000_000 });
    expect(r.stakeUsd).toBe(500); // maxStakeUsd
  });
  it('always floors at the base stake even when caps are tiny', () => {
    const r = computeEdgeStake({ ...base, totalPnlUsd: 0, freeCollateral: 1 });
    expect(r.stakeUsd).toBe(5); // free*0.1=0.1 < base → floored to base
  });
});
