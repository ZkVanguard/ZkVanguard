/**
 * Contract lock for AutoHedgingService's community-pool risk scorer.
 *
 * The tier weights ARE the strategy. A wrong weight over-hedges (bleeds
 * fees) or under-hedges (bleeds principal). These cases anchor every
 * tier + the +/- prediction adjustment behavior.
 */
import { describe, it, expect } from '@jest/globals';
import { computeCommunityPoolRiskScore } from '@/lib/services/hedging/risk-score';

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
