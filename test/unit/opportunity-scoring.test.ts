/**
 * Golden tests for trade-opportunity scoring
 * (lib/services/market-data/opportunity-scoring.ts) — the alpha ranking that
 * picks which asset the autonomous trader opens.
 */
import { describe, it, expect } from '@jest/globals';
import { scoreTradeOpportunity } from '@/lib/services/market-data/opportunity-scoring';

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
