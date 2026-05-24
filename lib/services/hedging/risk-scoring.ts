/**
 * Pure risk-scoring for the auto-hedging engine. Extracted from
 * AutoHedgingService so the gate that decides WHEN to hedge (riskScore ≥
 * threshold) has a single source of truth and a test net
 * (test/unit/risk-scoring.test.ts). No I/O.
 */

/**
 * Map operator risk tolerance (0–100) to the hedge-trigger threshold (2–10).
 * Lower tolerance → lower threshold → hedges fire sooner.
 */
export function riskToleranceToThreshold(riskTolerance: number): number {
  return Math.max(2, Math.min(10, Math.floor((riskTolerance / 10) * 0.8 + 2)));
}

/**
 * Comprehensive portfolio risk score (1–10) from drawdown %, volatility %, and
 * single-asset concentration %. Hedging fires when this meets the threshold.
 */
export function computeRiskScore(args: {
  drawdownPercent: number;
  volatility: number;
  concentrationRisk: number;
}): number {
  const { drawdownPercent, volatility, concentrationRisk } = args;
  let riskScore = 1;
  if (drawdownPercent > 2) riskScore += 1;
  if (drawdownPercent > 5) riskScore += 2;
  if (drawdownPercent > 10) riskScore += 2;
  if (volatility > 3) riskScore += 1;
  if (volatility > 5) riskScore += 1;
  if (concentrationRisk > 40) riskScore += 2; // single asset > 40%
  if (concentrationRisk > 60) riskScore += 1; // single asset > 60%
  return Math.min(riskScore, 10);
}
