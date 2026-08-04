/**
 * Unit tests for profit-lock recovery re-engagement (2026-07-15).
 *
 * When drawdown is IMPROVING vs 7 days ago, we add a momentum bonus to
 * the risk cap so we don't sit in USDC through the whole recovery.
 * Regression risk: over-aggressive bonus would defeat profit-lock entirely.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { applyProfitLock } from '@/lib/services/sui/cron/profit-lock-guard';

const ORIGINAL_ENV = { ...process.env };
beforeAll(() => { delete process.env.PROFIT_LOCK_DISABLE; delete process.env.RECOVERY_REENGAGE_DISABLE; });
afterAll(() => { process.env = { ...ORIGINAL_ENV }; });

describe('recovery re-engagement bonus', () => {
  it('adds no bonus when drawdown is worsening', () => {
    // Now 35% off peak, was 30% a week ago → getting worse → no bonus
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      65, // NAV
      100, // peak
      { drawdownPct7dAgo: 30 },
    );
    // At 35% drawdown, base cap = 0 (past 20% zero-risk-at)
    expect(decision.riskAllocationCap).toBe(0);
    expect(decision.reason).not.toMatch(/recovery bonus/i);
  });

  it('adds no bonus when improvement < 5 ppts (below threshold)', () => {
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      65,
      100,
      { drawdownPct7dAgo: 38 }, // improved 38 → 35 = 3 ppts, below 5
    );
    expect(decision.riskAllocationCap).toBe(0);
    expect(decision.reason).not.toMatch(/recovery bonus/i);
  });

  it('adds full 30 ppts bonus at max improvement (15+ ppts)', () => {
    // Was 50% dd, now 35% → improved 15 ppts → full 30% bonus
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      65,
      100,
      { drawdownPct7dAgo: 50 },
    );
    expect(decision.riskAllocationCap).toBe(30); // 0 base + 30 bonus
    expect(decision.reason).toMatch(/recovery bonus/i);
  });

  it('interpolates bonus linearly between 5 and 15 ppts improvement', () => {
    // Was 45% dd, now 35% → improved 10 ppts → mid-range bonus
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      65,
      100,
      { drawdownPct7dAgo: 45 },
    );
    // (10 - 5) / (15 - 5) × 30 = 15
    expect(decision.riskAllocationCap).toBe(15);
    expect(decision.reason).toMatch(/recovery bonus 15/);
  });

  it('caps total risk allocation at 100', () => {
    // Was 20% dd, now 5% (baseline no-clamp) → improvement 15 ppts
    // Base cap at 5% = 100 (no clamp). Adding 30 bonus doesn't overflow.
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      95,
      100,
      { drawdownPct7dAgo: 20 },
    );
    expect(decision.riskAllocationCap).toBeLessThanOrEqual(100);
  });

  it('respects RECOVERY_REENGAGE_DISABLE=1', () => {
    process.env.RECOVERY_REENGAGE_DISABLE = '1';
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      65,
      100,
      { drawdownPct7dAgo: 50 },
    );
    expect(decision.riskAllocationCap).toBe(0);
    expect(decision.reason).not.toMatch(/recovery bonus/i);
    delete process.env.RECOVERY_REENGAGE_DISABLE;
  });

  it('emits no bonus when drawdownPct7dAgo is undefined', () => {
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      65,
      100,
    );
    expect(decision.riskAllocationCap).toBe(0);
    expect(decision.reason).not.toMatch(/recovery bonus/i);
  });
});

describe('recovery bonus does not compromise defense', () => {
  it('still caps risk when drawdown ≥ 20% even with bonus', () => {
    // Was 50% dd, now 35% → improved 15 → bonus 30 → cap = 0 + 30 = 30%
    // Result: still 70% USDC target (down from 100%), NOT full risk-on
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      65,
      100,
      { drawdownPct7dAgo: 50 },
    );
    expect(decision.cappedAllocations.USDC).toBeGreaterThanOrEqual(50);
  });

  it('does not fire when drawdown worsens (peak grew)', () => {
    // Was 30% dd, but peak moved so now 45% dd → NO bonus
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      55,
      100,
      { drawdownPct7dAgo: 30 },
    );
    expect(decision.riskAllocationCap).toBe(0);
  });
});

describe('zero-risk exit hysteresis (2026-08-04)', () => {
  it('holds zero-risk when in-streak and drawdown within hysteresis of zeroAt', () => {
    // wasInZeroRisk=true, drawdown 18% (< 20% zeroAt but >= 20-5=15%) → HELD
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      82, 100,
      { wasInZeroRisk: true },
    );
    expect(decision.riskAllocationCap).toBe(0);
    expect(decision.reason).toMatch(/hysteresis-hold/);
    expect(decision.cappedAllocations.USDC).toBe(100);
  });

  it('exits zero-risk once drawdown recovers past hysteresis threshold', () => {
    // wasInZeroRisk=true, drawdown 14% (< 20-5=15%) → EASE
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      86, 100,
      { wasInZeroRisk: true },
    );
    // At 14% dd we're in the 10-15% tier (~ interpolated cap ~48%)
    expect(decision.riskAllocationCap).toBeGreaterThan(0);
    expect(decision.reason).not.toMatch(/hysteresis-hold/);
  });

  it('does not force zero-risk when NOT in-streak (first entry uses base threshold)', () => {
    // wasInZeroRisk=false, drawdown 18% → normal tier calc (not zero)
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      82, 100,
      { wasInZeroRisk: false },
    );
    expect(decision.riskAllocationCap).toBeGreaterThan(0);
  });

  it('respects PROFIT_LOCK_HYSTERESIS_PCT env override', () => {
    process.env.PROFIT_LOCK_HYSTERESIS_PCT = '10';
    // wasInZeroRisk=true, drawdown 12% (< 20% but >= 20-10=10%) → HELD
    const decision = applyProfitLock(
      { BTC: 40, ETH: 30, SUI: 30, USDC: 0 },
      88, 100,
      { wasInZeroRisk: true },
    );
    expect(decision.riskAllocationCap).toBe(0);
    delete process.env.PROFIT_LOCK_HYSTERESIS_PCT;
  });
});
