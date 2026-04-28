/**
 * Hedge Risk Math
 * Pure calculation functions extracted from AutoHedgingService
 * Used for risk assessment, volatility, drawdown, and recommendation generation.
 */

import type { HedgeRecommendation } from './hedge-types';
import type { AggregatedPrediction } from '../market-data/PredictionAggregatorService';
import {
  qualifyAggregatedPrediction,
  computeSafeCollateralUsd,
  SIZING_LIMITS,
} from './calibration';

// Configuration constants (shared with AutoHedgingService)
export const HEDGE_CONFIG = {
  PNL_UPDATE_INTERVAL_MS: 300000,
  RISK_CHECK_INTERVAL_MS: 600000,
  MAX_PORTFOLIO_DRAWDOWN_PERCENT: 3,
  MAX_ASSET_CONCENTRATION_PERCENT: 40,
  MIN_HEDGE_SIZE_USD: 50,
  DEFAULT_LEVERAGE: 3,
  DEFAULT_STOP_LOSS_PERCENT: 10,
  DEFAULT_TAKE_PROFIT_PERCENT: 20,
};

/**
 * Calculate drawdown from position changes
 */
export function calculateDrawdown(
  positions: Array<{ value: number; change24h: number }>,
  totalValue: number
): number {
  if (!positions.length || totalValue === 0) return 0;
  return positions.reduce((acc, pos) => {
    return acc + (pos.change24h < 0 ? Math.abs(pos.change24h) * (pos.value / totalValue) : 0);
  }, 0);
}

/**
 * Calculate weighted portfolio volatility
 * Uses real market volatility from 24h high/low when available
 * Falls back to change24h-based estimation if volatility field missing
 */
export function calculateVolatility(
  positions: Array<{ change24h: number; value?: number; volatility?: number }>
): number {
  if (!positions.length) return 0;

  const hasRealVolatility = positions.some(p => p.volatility !== undefined && p.volatility > 0);
  const totalValue = positions.reduce((sum, p) => sum + (p.value || 0), 0);

  if (hasRealVolatility && totalValue > 0) {
    const weightedVol = positions.reduce((acc, pos) => {
      const weight = (pos.value || 0) / totalValue;
      const vol = pos.volatility || 0.30;
      return acc + vol * weight;
    }, 0);
    return weightedVol * 100;
  }

  // Fallback: estimate from 24h changes (RMSE approach)
  const dailyVol = Math.sqrt(
    positions.reduce((acc, pos) => acc + Math.pow(pos.change24h / 100, 2), 0) / positions.length
  );
  return dailyVol * Math.sqrt(365) * 100;
}

/**
 * Calculate concentration risk (largest position percentage)
 */
export function calculateConcentrationRisk(
  positions: Array<{ value: number }>,
  totalValue: number
): number {
  if (!positions.length || totalValue === 0) return 0;
  const maxPosition = Math.max(...positions.map(p => p.value));
  return (maxPosition / totalValue) * 100;
}

/**
 * Generate hedge recommendations based on comprehensive portfolio data
 */
export function generateHedgeRecommendations(
  positions: Array<{ symbol: string; value: number; change24h: number }>,
  totalValue: number,
  allocations: Record<string, number>,
  activeHedges: Array<{ asset: string; side?: string }>,
  drawdownPercent: number,
  concentrationRisk: number,
  prediction?: AggregatedPrediction | null
): HedgeRecommendation[] {
  const recommendations: HedgeRecommendation[] = [];
  const hedgedAssets = new Set(activeHedges.map(h => h.asset));

  for (const pos of positions) {
    if (hedgedAssets.has(pos.symbol)) continue;
    if (pos.value < HEDGE_CONFIG.MIN_HEDGE_SIZE_USD) continue;

    // Hedge assets with ANY meaningful loss (>1%)
    if (pos.change24h < -1) {
      const absChange = Math.abs(pos.change24h);
      const hedgeRatio = Math.min(0.5, 0.15 + absChange / 15);
      const confidence = Math.min(0.7 + absChange / 15, 0.95);
      recommendations.push({
        asset: pos.symbol,
        side: 'SHORT',
        reason: `${pos.symbol} down ${pos.change24h.toFixed(2)}% (24h) - auto-protect against further losses`,
        suggestedSize: pos.value * hedgeRatio,
        leverage: HEDGE_CONFIG.DEFAULT_LEVERAGE,
        confidence,
      });
    }

    // Hedge concentrated positions (>35% of portfolio)
    const concentration = (pos.value / totalValue) * 100;
    if (concentration > 35) {
      recommendations.push({
        asset: pos.symbol,
        side: 'SHORT',
        reason: `${pos.symbol} concentration at ${concentration.toFixed(1)}% - reduce exposure`,
        suggestedSize: pos.value * ((concentration - 25) / 100),
        leverage: 2,
        confidence: 0.75,
      });
    }

    // Hedge volatile assets during portfolio drawdown (>2%)
    if (drawdownPercent > 2 && Math.abs(pos.change24h) > 3) {
      recommendations.push({
        asset: pos.symbol,
        side: 'SHORT',
        reason: `Portfolio drawdown (${drawdownPercent.toFixed(1)}%) + ${pos.symbol} volatility (${pos.change24h.toFixed(1)}%)`,
        suggestedSize: pos.value * 0.25,
        leverage: HEDGE_CONFIG.DEFAULT_LEVERAGE,
        confidence: 0.75,
      });
    }
  }

  // Prediction-driven hedges (Polymarket-calibrated probability + Kelly sizing)
  // We trust the *probability* output of the aggregator (which weights
  // Polymarket's order-book-implied probability heaviest) and convert it
  // through quarter-Kelly with TVL caps. No more heuristic confidence.
  const qualified = qualifyAggregatedPrediction(prediction);
  if (qualified) {
    const direction: 'LONG' | 'SHORT' = qualified.direction === 'DOWN' ? 'SHORT' : 'LONG';
    const primaryAsset = positions.length > 0
      ? positions.reduce((a, b) => b.value > a.value ? b : a).symbol
      : 'BTC';

    const alreadyHedgedSameDirection = activeHedges.some(
      h => h.asset === primaryAsset && h.side === direction
    );

    if (!alreadyHedgedSameDirection) {
      // Sum currently hedged USD so we respect the on-chain max-hedge-ratio.
      const currentHedgedUsd = activeHedges.reduce((sum, h) => {
        // Hedge type may carry notionalValue; fall back to 0 if unavailable.
        const n = (h as unknown as { notionalValue?: number }).notionalValue;
        return sum + (Number.isFinite(n) ? Number(n) : 0);
      }, 0);

      const collateralUsd = computeSafeCollateralUsd({
        signal: qualified,
        poolTvlUsd: totalValue,
        currentHedgedUsd,
      });

      // computeSafeCollateralUsd returns 0 when caps are hit — only push
      // a recommendation when it actually wants to size something.
      if (collateralUsd >= SIZING_LIMITS.MIN_HEDGE_USD) {
        const recName = prediction!.recommendation.replace(/_/g, ' ');
        recommendations.push({
          asset: primaryAsset,
          side: direction,
          reason: `[CALIBRATED] ${recName} — p=${(qualified.probability * 100).toFixed(1)}%, ` +
                  `edge=${(qualified.edge * 100).toFixed(1)}%, kelly¼-bounded, ` +
                  `${prediction!.sources.length} sources (${prediction!.consensus.toFixed(0)}% consensus)`,
          suggestedSize: collateralUsd,
          // Use leverage 1 for calibrated bets so payoff odds match Kelly assumption.
          // Higher leverage is reserved for drawdown/loss hedges where we're
          // protecting an existing position rather than betting on probability.
          leverage: 1,
          // Pass the *calibrated* probability through as confidence so downstream
          // gates compare apples-to-apples with Polymarket calibration.
          confidence: qualified.probability,
        });
      }
    }
  }

  return recommendations.sort((a, b) => b.confidence - a.confidence);
}
