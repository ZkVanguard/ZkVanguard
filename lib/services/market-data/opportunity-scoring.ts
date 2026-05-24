/**
 * Pure trade-opportunity scoring for the prediction aggregator's per-asset
 * ranking (scanAndPickBest). Higher = better edge; 0 = not actionable.
 *
 * Extracted from PredictionAggregatorService so the alpha ranking that decides
 * which asset the autonomous trader opens has a test net (test/unit/
 * opportunity-scoring.test.ts) without dragging the whole market-data stack
 * into the test. score = geometric-mean(confidence, consensus) × source-breadth
 * multiplier + a bonus for STRONG recommendations.
 */
export function scoreTradeOpportunity(p: {
  recommendation: string;
  confidence: number;
  consensus: number;
  sourceCount: number;
}): number {
  const actionable = p.recommendation.startsWith('HEDGE_') || p.recommendation.startsWith('STRONG_');
  if (!actionable) return 0;
  const strongBonus = p.recommendation.startsWith('STRONG_') ? 10 : 0;
  // Geometric mean of confidence × consensus, scaled by source breadth (cap 1.25).
  const breadthMul = Math.min(1.25, 1 + (p.sourceCount - 2) * 0.05);
  return Math.sqrt(p.confidence * p.consensus) * breadthMul + strongBonus;
}
