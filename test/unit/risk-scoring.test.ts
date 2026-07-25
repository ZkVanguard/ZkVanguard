/**
 * Golden tests for the auto-hedging risk gate (lib/services/hedging/risk-scoring.ts):
 * tolerance→threshold map and the 1–10 portfolio risk score that triggers hedges.
 */
import { describe, it, expect } from '@jest/globals';
import {
  riskToleranceToThreshold, computeRiskScore,
  computeCommunityPoolRiskScore, computeSuiPoolRiskScore,
} from '@/lib/services/hedging/risk-scoring';

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

const HEALTHY = {
  isBelowPar: false,
  sharePriceLossPercent: 0,
  drawdownPercent: 0,
  volatility: 0.3,
  concentrationRisk: 20,
  anyPosition24hNegative: false,
  aggregatedPrediction: null,
};

describe('computeCommunityPoolRiskScore', () => {
  it('healthy state → score 1', () => {
    const { riskScore } = computeCommunityPoolRiskScore(HEALTHY);
    expect(riskScore).toBe(1);
  });

  it('below par CRITICAL (5%+ loss) adds +4', () => {
    const { riskScore, contributions } = computeCommunityPoolRiskScore({
      ...HEALTHY, isBelowPar: true, sharePriceLossPercent: 6,
    });
    expect(contributions.belowPar).toBe(4);
    expect(riskScore).toBe(1 + 4);
  });

  it('below par HIGH (3%+ loss) adds +3', () => {
    const { contributions } = computeCommunityPoolRiskScore({
      ...HEALTHY, isBelowPar: true, sharePriceLossPercent: 3.5,
    });
    expect(contributions.belowPar).toBe(3);
  });

  it('below par WARNING (any loss < 1%) adds +1', () => {
    const { contributions } = computeCommunityPoolRiskScore({
      ...HEALTHY, isBelowPar: true, sharePriceLossPercent: 0.3,
    });
    expect(contributions.belowPar).toBe(1);
  });

  it('drawdown tiers are additive (>0.5, >1.5, >4)', () => {
    const dd05 = computeCommunityPoolRiskScore({ ...HEALTHY, drawdownPercent: 0.6 });
    const dd2 = computeCommunityPoolRiskScore({ ...HEALTHY, drawdownPercent: 2 });
    const dd5 = computeCommunityPoolRiskScore({ ...HEALTHY, drawdownPercent: 5 });
    expect(dd05.contributions.drawdown).toBe(1);
    expect(dd2.contributions.drawdown).toBe(2);
    expect(dd5.contributions.drawdown).toBe(3);
  });

  it('volatility >1.5 = +1, >3 = +2', () => {
    expect(computeCommunityPoolRiskScore({ ...HEALTHY, volatility: 2 }).contributions.volatility).toBe(1);
    expect(computeCommunityPoolRiskScore({ ...HEALTHY, volatility: 4 }).contributions.volatility).toBe(2);
  });

  it('concentration >30 = +1, >45 = +2', () => {
    expect(computeCommunityPoolRiskScore({ ...HEALTHY, concentrationRisk: 35 }).contributions.concentration).toBe(1);
    expect(computeCommunityPoolRiskScore({ ...HEALTHY, concentrationRisk: 50 }).contributions.concentration).toBe(2);
  });

  it('prediction DOWN + high conf adds +2', () => {
    const { predictionAdjustment } = computeCommunityPoolRiskScore({
      ...HEALTHY,
      aggregatedPrediction: { direction: 'DOWN', confidence: 75, consensus: 60 },
    });
    expect(predictionAdjustment).toBe(2);
  });

  it('prediction DOWN + medium conf adds +1', () => {
    const { predictionAdjustment } = computeCommunityPoolRiskScore({
      ...HEALTHY,
      aggregatedPrediction: { direction: 'DOWN', confidence: 60, consensus: 55 },
    });
    expect(predictionAdjustment).toBe(1);
  });

  it('prediction UP + strong consensus reduces by 1 (but not below 1)', () => {
    const { riskScore, predictionAdjustment } = computeCommunityPoolRiskScore({
      ...HEALTHY,
      aggregatedPrediction: { direction: 'UP', confidence: 70, consensus: 75 },
    });
    expect(predictionAdjustment).toBe(-1);
    // Base of 1, minus 1 → clamped back to 1
    expect(riskScore).toBe(1);
  });

  it('prediction ignored when consensus <= 50', () => {
    const { predictionAdjustment } = computeCommunityPoolRiskScore({
      ...HEALTHY,
      aggregatedPrediction: { direction: 'DOWN', confidence: 90, consensus: 40 },
    });
    expect(predictionAdjustment).toBe(0);
  });

  it('final score clamped to [1, 10]', () => {
    // Maximum-everything scenario
    const { riskScore } = computeCommunityPoolRiskScore({
      isBelowPar: true, sharePriceLossPercent: 10,     // +4
      drawdownPercent: 20,                              // +3
      volatility: 5,                                    // +2
      concentrationRisk: 80,                            // +2
      anyPosition24hNegative: true,                     // +1
      aggregatedPrediction: { direction: 'DOWN', confidence: 90, consensus: 90 }, // +2
    });
    // Sum: 1 + 4 + 3 + 2 + 2 + 1 + 2 = 15 → clamped to 10
    expect(riskScore).toBe(10);
  });
});

// ── SUI pool variant — different tier table ────────────────────────────────
const SUI_HEALTHY = {
  isBelowPar: false,
  sharePriceLossPercent: 0,
  drawdownPercent: 0,
  volatility: 0.3,
  concentrationRisk: 20,
  anyPosition24hNegative: false,
};

describe('computeSuiPoolRiskScore', () => {
  it('healthy state → score 1', () => {
    expect(computeSuiPoolRiskScore(SUI_HEALTHY).riskScore).toBe(1);
  });

  it('below par tiers (5% / 2% / 1% / any)', () => {
    expect(computeSuiPoolRiskScore({ ...SUI_HEALTHY, isBelowPar: true, sharePriceLossPercent: 6 }).contributions.belowPar).toBe(4);
    expect(computeSuiPoolRiskScore({ ...SUI_HEALTHY, isBelowPar: true, sharePriceLossPercent: 2.5 }).contributions.belowPar).toBe(3);
    expect(computeSuiPoolRiskScore({ ...SUI_HEALTHY, isBelowPar: true, sharePriceLossPercent: 1.5 }).contributions.belowPar).toBe(2);
    expect(computeSuiPoolRiskScore({ ...SUI_HEALTHY, isBelowPar: true, sharePriceLossPercent: 0.3 }).contributions.belowPar).toBe(1);
  });

  it('drawdown is 2-tier vs Cronos 3-tier — no middle tier at 1.5%', () => {
    // 2% drawdown should be +1 on SUI (not +2 like Cronos)
    expect(computeSuiPoolRiskScore({ ...SUI_HEALTHY, drawdownPercent: 2 }).contributions.drawdown).toBe(1);
    expect(computeSuiPoolRiskScore({ ...SUI_HEALTHY, drawdownPercent: 5 }).contributions.drawdown).toBe(2);
  });

  it('volatility is single-tier — high vol still +1 (not +2 like Cronos)', () => {
    expect(computeSuiPoolRiskScore({ ...SUI_HEALTHY, volatility: 5 }).contributions.volatility).toBe(1);
  });

  it('concentration is single-tier — same story', () => {
    expect(computeSuiPoolRiskScore({ ...SUI_HEALTHY, concentrationRisk: 60 }).contributions.concentration).toBe(1);
  });

  it('predictionAdjustment is always 0 (SUI variant has no aggregated-prediction input)', () => {
    expect(computeSuiPoolRiskScore(SUI_HEALTHY).predictionAdjustment).toBe(0);
  });

  it('maximum-everything scenario clamps to 10', () => {
    const { riskScore } = computeSuiPoolRiskScore({
      isBelowPar: true, sharePriceLossPercent: 10,
      drawdownPercent: 20, volatility: 5, concentrationRisk: 80,
      anyPosition24hNegative: true,
    });
    // 1 + 4 + 2 + 1 + 1 + 1 = 10 exactly
    expect(riskScore).toBe(10);
  });
});
