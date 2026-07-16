/**
 * Unit tests for trade quality gates.
 *
 * Regression risk: mis-signed funding math would push us into the
 * funding-paying side by default (silent bleed). Exposure cap is
 * defense against concentration; regret halt is defense against
 * losing-streak drift. All three MUST be locked.
 */
import { describe, it, expect } from '@jest/globals';
import { fundingEdge, exposureCap, regretBasedHalt } from '@/lib/services/trading/trade-quality-gates';

describe('fundingEdge — sign convention', () => {
  it('SHORT + positive funding → RECEIVE', () => {
    const r = fundingEdge('SHORT', 0.00008); // 0.008%/8h
    expect(r.advantage).toBe('RECEIVE');
    expect(r.bonusPct).toBeGreaterThan(0);
    expect(r.reason).toMatch(/receives/);
  });

  it('LONG + negative funding → RECEIVE', () => {
    const r = fundingEdge('LONG', -0.00008);
    expect(r.advantage).toBe('RECEIVE');
    expect(r.bonusPct).toBeGreaterThan(0);
  });

  it('SHORT + negative funding → PAY', () => {
    const r = fundingEdge('SHORT', -0.00008);
    expect(r.advantage).toBe('PAY');
    expect(r.bonusPct).toBeLessThan(0);
  });

  it('LONG + positive funding → PAY', () => {
    const r = fundingEdge('LONG', 0.00008);
    expect(r.advantage).toBe('PAY');
    expect(r.bonusPct).toBeLessThan(0);
  });
});

describe('fundingEdge — neutral band + bonus scaling', () => {
  it('returns NEUTRAL and zero bonus within the neutral band', () => {
    const r = fundingEdge('SHORT', 0.00001); // 0.001%/8h < 0.003% threshold
    expect(r.advantage).toBe('NEUTRAL');
    expect(r.bonusPct).toBe(0);
  });

  it('bonus caps at maxBonus when funding at the guard ceiling', () => {
    const r = fundingEdge('SHORT', 0.0001); // exactly the funding-guard threshold
    expect(r.bonusPct).toBe(15);
  });

  it('respects custom maxBonus', () => {
    const r = fundingEdge('SHORT', 0.0001, { maxBonus: 10 });
    expect(r.bonusPct).toBe(10);
  });
});

describe('exposureCap — total notional relative to NAV', () => {
  it('accepts when post-open exposure is within cap', () => {
    const r = exposureCap({
      navUsd: 100,
      currentTotalNotionalUsd: 10,
      proposedTradeNotionalUsd: 15,
      maxPct: 30,
    });
    expect(r.ok).toBe(true);
    expect(r.postOpenPct).toBe(25);
  });

  it('rejects when post-open would exceed cap', () => {
    const r = exposureCap({
      navUsd: 100,
      currentTotalNotionalUsd: 20,
      proposedTradeNotionalUsd: 15,
      maxPct: 30,
    });
    expect(r.ok).toBe(false);
    expect(r.postOpenPct).toBe(35);
    expect(r.reason).toMatch(/exceed/);
  });

  it('handles NAV=0 gracefully (never divide by zero)', () => {
    const r = exposureCap({
      navUsd: 0,
      currentTotalNotionalUsd: 5,
      proposedTradeNotionalUsd: 5,
    });
    expect(r.postOpenPct).toBe(0);
    expect(r.ok).toBe(true); // 0% < 30% cap
  });

  it('flags the historical concentration case (48% of NAV in one hedge)', () => {
    // 2026-07-15 pool state: NAV $38, existing ETH SHORT $18.28
    // If trader tries to open another $15 SOL trade, total would be $33 = 87% of NAV
    const r = exposureCap({
      navUsd: 38,
      currentTotalNotionalUsd: 18.28,
      proposedTradeNotionalUsd: 15,
    });
    expect(r.ok).toBe(false);
    expect(r.postOpenPct).toBeGreaterThan(80);
  });
});

describe('regretBasedHalt', () => {
  it('halts when regret score is deeply negative (< -0.3 default)', () => {
    const r = regretBasedHalt({ regretScore: -0.5 });
    expect(r.halt).toBe(true);
    expect(r.reason).toMatch(/24h cooldown/);
  });

  it('does NOT halt at exactly -0.3 threshold', () => {
    const r = regretBasedHalt({ regretScore: -0.3 });
    expect(r.halt).toBe(false);
  });

  it('does NOT halt on neutral or positive scores', () => {
    expect(regretBasedHalt({ regretScore: 0 }).halt).toBe(false);
    expect(regretBasedHalt({ regretScore: 0.5 }).halt).toBe(false);
    expect(regretBasedHalt({ regretScore: 1.0 }).halt).toBe(false);
  });

  it('respects custom threshold', () => {
    // Aggressive: halt at -0.1 (mild losing streak)
    const r = regretBasedHalt({ regretScore: -0.15, threshold: -0.1 });
    expect(r.halt).toBe(true);
  });
});
