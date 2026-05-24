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

export type PredictionRecommendation =
  | 'STRONG_HEDGE_SHORT' | 'HEDGE_SHORT' | 'LIGHT_HEDGE_SHORT'
  | 'WAIT'
  | 'LIGHT_HEDGE_LONG' | 'HEDGE_LONG' | 'STRONG_HEDGE_LONG';

/**
 * Map a fused signal to a trade recommendation (direction + strength).
 * NEUTRAL or confidence < 40 → WAIT. STRONG needs conf≥70, consensus≥70 and
 * directionStrength≥0.4; MEDIUM needs conf≥55 and consensus≥55.
 */
export function determineRecommendation(
  direction: 'UP' | 'DOWN' | 'NEUTRAL',
  confidence: number,
  consensus: number,
  directionStrength: number,
): PredictionRecommendation {
  if (direction === 'NEUTRAL' || confidence < 40) return 'WAIT';
  const isStrong = confidence >= 70 && consensus >= 70 && directionStrength >= 0.4;
  const isMedium = confidence >= 55 && consensus >= 55;
  if (direction === 'DOWN') {
    if (isStrong) return 'STRONG_HEDGE_SHORT';
    if (isMedium) return 'HEDGE_SHORT';
    return 'LIGHT_HEDGE_SHORT';
  }
  if (isStrong) return 'STRONG_HEDGE_LONG';
  if (isMedium) return 'HEDGE_LONG';
  return 'LIGHT_HEDGE_LONG';
}

/**
 * Position-size multiplier from signal quality, clamped to [0.5, 2.0].
 * Confidence/consensus each contribute ±0.3, direction strength ±0.2.
 */
export function calculateSizeMultiplier(
  confidence: number,
  consensus: number,
  directionStrength: number,
): number {
  let m = 1.0;
  if (confidence >= 75) m += 0.3;
  else if (confidence >= 60) m += 0.15;
  else if (confidence < 45) m -= 0.2;
  if (consensus >= 80) m += 0.3;
  else if (consensus >= 65) m += 0.15;
  else if (consensus < 50) m -= 0.2;
  if (directionStrength >= 0.5) m += 0.2;
  else if (directionStrength < 0.2) m -= 0.1;
  return Math.max(0.5, Math.min(2.0, m));
}
