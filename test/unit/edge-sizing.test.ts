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

  describe('dynamicBasePct — autonomous exponential growth', () => {
    // At small NAV, dynamicBasePct × free < baseStakeUsd → effective base
    // stays at baseStake (legacy behaviour). Once free grows past
    // baseStake/dynamicBasePct, effective base scales linearly with free.
    // At 0.20, transition happens at free = $25 (5/0.20).

    it('is a no-op when free × dynamicBasePct < baseStake', () => {
      const r = computeEdgeStake({
        ...base,
        totalPnlUsd: 0,
        freeCollateral: 14,
        stakePctOfFree: 0.30,
        dynamicBasePct: 0.20, // 14 × 0.20 = 2.80 < baseStake 5
      });
      expect(r.stakeUsd).toBe(5); // unchanged
    });

    it('scales stake with free once above the transition point', () => {
      // free=$50, dynamicBasePct=0.20 → effective base $10
      const r = computeEdgeStake({
        ...base,
        totalPnlUsd: 0,
        freeCollateral: 50,
        stakePctOfFree: 0.30,
        dynamicBasePct: 0.20,
      });
      expect(r.stakeUsd).toBe(10);
    });

    it('scales exponentially: 10x free → 10x stake at zero PnL', () => {
      const r = computeEdgeStake({
        ...base,
        totalPnlUsd: 0,
        freeCollateral: 500, // 500 × 0.20 = $100 effective base
        stakePctOfFree: 0.30,
        dynamicBasePct: 0.20,
      });
      expect(r.stakeUsd).toBe(100);
    });

    it('stakePctOfFree cap still binds against runaway compounding', () => {
      // free=$100, dynamicBasePct=0.20 → base $20
      // compoundMul at +$100 PnL = 1 + 100/20 = 6 → clamped to 5
      // target = 20 × 5 × 1 = $100. But stakePct 0.30 × $100 = $30 cap.
      // Result: $30 (cap wins).
      const r = computeEdgeStake({
        ...base,
        totalPnlUsd: 100,
        freeCollateral: 100,
        stakePctOfFree: 0.30,
        dynamicBasePct: 0.20,
      });
      expect(r.stakeUsd).toBe(30);
    });

    it('legacy behaviour when dynamicBasePct = 0', () => {
      const r = computeEdgeStake({
        ...base,
        totalPnlUsd: 0,
        freeCollateral: 500,
        dynamicBasePct: 0,
      });
      expect(r.stakeUsd).toBe(5); // pinned at baseStake
    });

    it('exponential progression: doubling free doubles stake (in scaling regime)', () => {
      const args = { ...base, totalPnlUsd: 0, stakePctOfFree: 0.30, dynamicBasePct: 0.20 };
      const r50 = computeEdgeStake({ ...args, freeCollateral: 50 });   // base=$10
      const r100 = computeEdgeStake({ ...args, freeCollateral: 100 }); // base=$20
      const r200 = computeEdgeStake({ ...args, freeCollateral: 200 }); // base=$40
      expect(r100.stakeUsd).toBe(r50.stakeUsd * 2);
      expect(r200.stakeUsd).toBe(r100.stakeUsd * 2);
    });
  });
});
