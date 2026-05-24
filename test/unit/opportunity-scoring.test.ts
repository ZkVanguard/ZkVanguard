/**
 * Golden tests for trade-opportunity scoring
 * (lib/services/market-data/opportunity-scoring.ts) — the alpha ranking that
 * picks which asset the autonomous trader opens.
 */
import { describe, it, expect } from '@jest/globals';
import { scoreTradeOpportunity, determineRecommendation, calculateSizeMultiplier } from '@/lib/services/market-data/opportunity-scoring';

describe('scoreTradeOpportunity', () => {
  it('returns 0 for non-actionable recommendations', () => {
    expect(scoreTradeOpportunity({ recommendation: 'WAIT', confidence: 90, consensus: 90, sourceCount: 5 })).toBe(0);
  });

  it('= geometric mean of confidence×consensus at 2 sources (breadth 1.0, no bonus)', () => {
    // sqrt(70*70)=70, breadth = 1 + 0*0.05 = 1, bonus 0
    expect(scoreTradeOpportunity({ recommendation: 'HEDGE_SHORT', confidence: 70, consensus: 70, sourceCount: 2 })).toBeCloseTo(70, 6);
  });

  it('adds +10 for STRONG and scales by source breadth', () => {
    // sqrt(6400)=80, breadth = min(1.25, 1+3*0.05=1.15)=1.15, +10 → 80*1.15+10 = 102
    expect(scoreTradeOpportunity({ recommendation: 'STRONG_HEDGE_LONG', confidence: 80, consensus: 80, sourceCount: 5 })).toBeCloseTo(102, 6);
  });

  it('caps the breadth multiplier at 1.25', () => {
    // 10 sources → 1+8*0.05=1.4, capped to 1.25; sqrt(100*100)=100 → 125
    expect(scoreTradeOpportunity({ recommendation: 'HEDGE_LONG', confidence: 100, consensus: 100, sourceCount: 10 })).toBeCloseTo(125, 6);
  });

  it('penalizes thin source breadth (<2 sources)', () => {
    // 1 source → breadth 1 + (-1)*0.05 = 0.95; sqrt(60*60)=60 → 57
    expect(scoreTradeOpportunity({ recommendation: 'HEDGE_SHORT', confidence: 60, consensus: 60, sourceCount: 1 })).toBeCloseTo(57, 6);
  });
});

describe('determineRecommendation', () => {
  it('WAITs on NEUTRAL or low confidence', () => {
    expect(determineRecommendation('NEUTRAL', 99, 99, 1)).toBe('WAIT');
    expect(determineRecommendation('UP', 39, 99, 1)).toBe('WAIT');
  });
  it('DOWN → SHORT tiers by strength', () => {
    expect(determineRecommendation('DOWN', 70, 70, 0.4)).toBe('STRONG_HEDGE_SHORT');
    expect(determineRecommendation('DOWN', 55, 55, 0.1)).toBe('HEDGE_SHORT');
    expect(determineRecommendation('DOWN', 50, 50, 0.1)).toBe('LIGHT_HEDGE_SHORT');
  });
  it('UP → LONG tiers by strength', () => {
    expect(determineRecommendation('UP', 70, 70, 0.4)).toBe('STRONG_HEDGE_LONG');
    expect(determineRecommendation('UP', 60, 60, 0.1)).toBe('HEDGE_LONG');
    expect(determineRecommendation('UP', 50, 50, 0.1)).toBe('LIGHT_HEDGE_LONG');
  });
  it('STRONG requires all three thresholds (else MEDIUM)', () => {
    // conf/cons high but weak direction → not strong
    expect(determineRecommendation('UP', 90, 90, 0.3)).toBe('HEDGE_LONG');
  });
});

describe('calculateSizeMultiplier', () => {
  it('base 1.0 with mid signals', () => {
    expect(calculateSizeMultiplier(50, 55, 0.3)).toBeCloseTo(1.0, 6);
  });
  it('strong signals push toward the 2.0 cap', () => {
    // +0.3 +0.3 +0.2 = 1.8
    expect(calculateSizeMultiplier(80, 85, 0.6)).toBeCloseTo(1.8, 6);
  });
  it('weak signals push toward the 0.5 floor', () => {
    // 1 -0.2 -0.2 -0.1 = 0.5
    expect(calculateSizeMultiplier(40, 45, 0.1)).toBeCloseTo(0.5, 6);
  });
  it('clamps to [0.5, 2.0]', () => {
    expect(calculateSizeMultiplier(100, 100, 1)).toBeLessThanOrEqual(2.0);
    expect(calculateSizeMultiplier(0, 0, 0)).toBeGreaterThanOrEqual(0.5);
  });
});
