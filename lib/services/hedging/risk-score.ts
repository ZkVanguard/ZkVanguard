/**
 * Pure risk-scoring for AutoHedgingService.assessCommunityPoolRisk.
 *
 * Given the numeric inputs a risk assessor computed (share price vs par,
 * drawdown, volatility, concentration, prediction consensus), produce
 * a 1-10 integer risk score. Extracted so the tunable weights are
 * testable + reviewable in one place instead of buried in a 383-LOC
 * class method.
 *
 * The weights ARE the strategy — a wrong weight either over-hedges
 * (bleeds fees) or under-hedges (bleeds principal). Every tier here
 * corresponds to a concrete threshold the operator has calibrated.
 */

export interface RiskScoreInputs {
  /** Share price is below the $1.00 par value — anything below is a loss. */
  isBelowPar: boolean;
  /** How far below par as a percentage (positive number). */
  sharePriceLossPercent: number;
  /** Drawdown from rolling peak share price (0 if no drawdown). */
  drawdownPercent: number;
  /** Annualized volatility of the current position basket. */
  volatility: number;
  /** Concentration risk score (0-100). */
  concentrationRisk: number;
  /** True if any position's 24h change is < -1%. */
  anyPosition24hNegative: boolean;
  /** Optional multi-source prediction aggregation (nullable). */
  aggregatedPrediction?: {
    direction: 'UP' | 'DOWN' | 'NEUTRAL';
    confidence: number;    // 0-100
    consensus: number;     // 0-100
  } | null;
}

export interface RiskScoreBreakdown {
  riskScore: number;               // final 1-10 integer
  contributions: Record<string, number>; // per-signal contribution (for logs)
  predictionAdjustment: number;    // -1 to +2
}

export function computeCommunityPoolRiskScore(inputs: RiskScoreInputs): RiskScoreBreakdown {
  const contributions: Record<string, number> = {};
  let riskScore = 1;

  // MOST IMPORTANT: Share price below par
  if (inputs.isBelowPar) {
    let sub: number;
    if (inputs.sharePriceLossPercent >= 5) sub = 4;        // CRITICAL
    else if (inputs.sharePriceLossPercent >= 3) sub = 3;   // HIGH
    else if (inputs.sharePriceLossPercent >= 2) sub = 3;   // HIGH
    else if (inputs.sharePriceLossPercent >= 1) sub = 2;   // ELEVATED
    else sub = 1;                                          // WARNING (any loss)
    contributions.belowPar = sub;
    riskScore += sub;
  }

  // Drawdown from peak (additive)
  let drawdown = 0;
  if (inputs.drawdownPercent > 0.5) drawdown += 1;
  if (inputs.drawdownPercent > 1.5) drawdown += 1;
  if (inputs.drawdownPercent > 4) drawdown += 1;
  if (drawdown > 0) { contributions.drawdown = drawdown; riskScore += drawdown; }

  // Volatility
  let vol = 0;
  if (inputs.volatility > 1.5) vol += 1;
  if (inputs.volatility > 3) vol += 1;
  if (vol > 0) { contributions.volatility = vol; riskScore += vol; }

  // Concentration risk
  let conc = 0;
  if (inputs.concentrationRisk > 30) conc += 1;
  if (inputs.concentrationRisk > 45) conc += 1;
  if (conc > 0) { contributions.concentration = conc; riskScore += conc; }

  // Any negative 24h change across positions
  if (inputs.anyPosition24hNegative) {
    contributions.anyNegative24h = 1;
    riskScore += 1;
  }

  // Multi-source prediction adjustment
  let predictionAdjustment = 0;
  const pred = inputs.aggregatedPrediction;
  if (pred && pred.consensus > 50) {
    if (pred.direction === 'DOWN') {
      // Scale risk increase by confidence
      predictionAdjustment = pred.confidence >= 70 ? 2 : pred.confidence >= 55 ? 1 : 0;
    } else if (pred.direction === 'UP' && pred.confidence >= 65 && pred.consensus >= 70) {
      // Strong bullish consensus can reduce risk (but not below 1)
      predictionAdjustment = -1;
    }
  }
  if (predictionAdjustment !== 0) {
    contributions.prediction = predictionAdjustment;
    riskScore += predictionAdjustment;
  }

  // Final clamp: 1-10
  const clamped = Math.max(1, Math.min(riskScore, 10));
  return { riskScore: clamped, contributions, predictionAdjustment };
}

// ─── SUI pool variant ──────────────────────────────────────────────────────
// Distinct from computeCommunityPoolRiskScore. Same shape but a
// deliberately simpler weight table — the SUI pool has different
// tolerance (institution-facing, more conservative), only 2 drawdown
// tiers vs 3, no prediction aggregation input, tighter volatility
// & concentration sensitivities. Kept separate so a Cronos-side
// change doesn't accidentally re-tune the SUI weights.

export interface SuiPoolRiskInputs {
  isBelowPar: boolean;
  sharePriceLossPercent: number;
  drawdownPercent: number;
  volatility: number;
  concentrationRisk: number;
  anyPosition24hNegative: boolean;
}

export function computeSuiPoolRiskScore(inputs: SuiPoolRiskInputs): RiskScoreBreakdown {
  const contributions: Record<string, number> = {};
  let riskScore = 1;

  // Below par (3-tier: 5%+ / 2%+ / 1%+ / any)
  if (inputs.isBelowPar) {
    let sub: number;
    if (inputs.sharePriceLossPercent >= 5) sub = 4;
    else if (inputs.sharePriceLossPercent >= 2) sub = 3;
    else if (inputs.sharePriceLossPercent >= 1) sub = 2;
    else sub = 1;
    contributions.belowPar = sub;
    riskScore += sub;
  }

  // Drawdown (2-tier vs 3-tier — SUI is coarser)
  let drawdown = 0;
  if (inputs.drawdownPercent > 0.5) drawdown += 1;
  if (inputs.drawdownPercent > 4) drawdown += 1;
  if (drawdown > 0) { contributions.drawdown = drawdown; riskScore += drawdown; }

  // Volatility (single tier)
  if (inputs.volatility > 1.5) { contributions.volatility = 1; riskScore += 1; }

  // Concentration (single tier)
  if (inputs.concentrationRisk > 30) { contributions.concentration = 1; riskScore += 1; }

  // Any negative 24h change across positions
  if (inputs.anyPosition24hNegative) {
    contributions.anyNegative24h = 1;
    riskScore += 1;
  }

  const clamped = Math.max(1, Math.min(riskScore, 10));
  return { riskScore: clamped, contributions, predictionAdjustment: 0 };
}
