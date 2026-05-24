/**
 * Golden tests for the auto-hedging risk gate (lib/services/hedging/risk-scoring.ts):
 * tolerance→threshold map and the 1–10 portfolio risk score that triggers hedges.
 */
import { describe, it, expect } from '@jest/globals';
import { riskToleranceToThreshold, computeRiskScore } from '@/lib/services/hedging/risk-scoring';

describe('riskToleranceToThreshold', () => {
  it('floors at 2, caps at 10, scales with tolerance', () => {
    expect(riskToleranceToThreshold(0)).toBe(2);     // floor 2
    expect(riskToleranceToThreshold(50)).toBe(6);    // floor((5)*0.8+2)=floor(6)=6
    expect(riskToleranceToThreshold(100)).toBe(10);  // floor(8+2)=10
    expect(riskToleranceToThreshold(1000)).toBe(10); // cap 10
  });
});

describe('computeRiskScore', () => {
  it('baseline calm portfolio = 1', () => {
    expect(computeRiskScore({ drawdownPercent: 0, volatility: 1, concentrationRisk: 10 })).toBe(1);
  });
  it('accumulates from drawdown bands', () => {
    // dd 3 → +1 = 2
    expect(computeRiskScore({ drawdownPercent: 3, volatility: 0, concentrationRisk: 0 })).toBe(2);
    // dd 6 → +1+2 = 4
    expect(computeRiskScore({ drawdownPercent: 6, volatility: 0, concentrationRisk: 0 })).toBe(4);
    // dd 12 → +1+2+2 = 6
    expect(computeRiskScore({ drawdownPercent: 12, volatility: 0, concentrationRisk: 0 })).toBe(6);
  });
  it('adds volatility and concentration contributions', () => {
    // dd 12 (5) + vol 6 (+1+1=2) + conc 65 (+2+1=3) = 1+2+2+1+1+2+1 = 10
    expect(computeRiskScore({ drawdownPercent: 12, volatility: 6, concentrationRisk: 65 })).toBe(10);
  });
  it('caps at 10', () => {
    expect(computeRiskScore({ drawdownPercent: 100, volatility: 100, concentrationRisk: 100 })).toBe(10);
  });
});
