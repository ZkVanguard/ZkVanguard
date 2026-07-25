/**
 * Pure statistical primitives for HedgingAgent.
 *
 * Extracted from HedgingAgent.ts (1593 LOC) — the class had ~250 LOC of
 * pure math intermixed with async data-fetch calls. Now the math has a
 * dedicated home + a test contract. HedgingAgent's async methods
 * become thin orchestrators: fetch data → call pure fn → log + return.
 *
 * Every function is deterministic and side-effect-free. Zero I/O, zero
 * globals. Suitable for property testing (future: verify statistical
 * identities like Pearson r ∈ [-1, 1] under any input).
 */

// ─── Log returns ──────────────────────────────────────────────────────────

/**
 * Convert a price series into log returns. Skips consecutive pairs where
 * the prior price is <= 0 (log undefined). Returns array of length
 * `prices.length - 1` at most.
 */
export function logReturns(prices: number[]): number[] {
  const rets: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      rets.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return rets;
}

// ─── Pearson correlation ──────────────────────────────────────────────────

/**
 * Pearson correlation coefficient between two equally-sized series.
 * Returns 0 when either series has zero variance (identical values —
 * correlation is mathematically undefined). Never throws.
 *
 * Caller uses the return signal (0 vs |r| > 0) to distinguish "no
 * relationship" from "degenerate — try alternative signal."
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const xMean = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const yMean = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0, xVar = 0, yVar = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;
    num += dx * dy;
    xVar += dx * dx;
    yVar += dy * dy;
  }
  const denom = Math.sqrt(xVar * yVar);
  if (denom === 0) return 0;
  return num / denom;
}

// ─── Lag-1 autocorrelation ────────────────────────────────────────────────

/**
 * Lag-1 autocorrelation of a return series, using absolute value.
 * A market-efficiency proxy: 0 = perfectly efficient (no serial
 * dependence), 1 = strong momentum/mean-reversion. Never throws.
 */
export function lag1Autocorrelation(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  let autocov = 0, autoVar = 0;
  for (let i = 1; i < returns.length; i++) {
    autocov += (returns[i] - mean) * (returns[i - 1] - mean);
    autoVar += (returns[i] - mean) * (returns[i] - mean);
  }
  return autoVar > 0 ? Math.abs(autocov / autoVar) : 0;
}

// ─── Annualized volatility ────────────────────────────────────────────────

/**
 * Given a log-returns series, compute annualized volatility (365-day
 * convention for crypto). Uses sample stddev (n-1 denominator). Returns
 * 0 on insufficient data (< 3 returns) — caller falls back.
 */
export function annualizedVolatility(returns: number[], daysPerYear = 365): number {
  if (returns.length < 3) return 0;
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const dailyVol = Math.sqrt(variance);
  return dailyVol * Math.sqrt(daysPerYear);
}

// ─── Correlation-from-market-proxy ────────────────────────────────────────

/**
 * When perp candlestick data isn't available, derive a spot-perp
 * correlation estimate from spot market microstructure:
 *   - higher volume → tighter spot-perp tracking (more arbitrage)
 *   - higher volatility → wider basis divergence
 *   - higher autocorrelation → less efficient market → wider basis
 *
 * Returns a value clamped to [0.5, 0.99] — the hedge ratio derived
 * downstream is never below 0.5 in this "no perp data" degraded mode.
 */
export function deriveCorrelationFromMarketProxy(inputs: {
  volume: number;
  dailyVol: number;
  autocorr: number;
}): number {
  const volumeScore = inputs.volume > 0 ? Math.min(1, Math.log10(inputs.volume) / 10) : 0;
  const baseCorr = 0.5 + volumeScore * 0.47;
  const volPenalty = inputs.dailyVol * 0.3;
  const efficiencyPenalty = inputs.autocorr * 0.15;
  const raw = baseCorr - volPenalty - efficiencyPenalty;
  return Math.max(0.5, Math.min(0.99, raw));
}

// ─── Optimal hedge ratio ──────────────────────────────────────────────────

/**
 * Minimum-variance hedge ratio: h* = ρ × (σ_spot / σ_futures).
 *
 * For crypto perps σ_spot ≈ σ_futures, so h* ≈ ρ (the correlation).
 * Then applies:
 *   - vol regime adjustments (higher vol → hedge more aggressively)
 *   - position-size adjustments (larger positions → more conservative)
 *   - clamp to [0.3, 1.0]
 *
 * All thresholds are documented; changing them changes strategy.
 */
export function optimalHedgeRatio(inputs: {
  correlation: number;
  volatility: number;
  notionalValue: number;
}): number {
  let ratio = inputs.correlation;

  // Vol regime
  if (inputs.volatility > 0.8) ratio = Math.min(ratio * 1.15, 1.0);        // extreme
  else if (inputs.volatility > 0.5) ratio = Math.min(ratio * 1.05, 1.0);   // high
  else if (inputs.volatility < 0.15) ratio *= 0.85;                        // low

  // Size regime
  if (inputs.notionalValue > 5_000_000) ratio = Math.min(ratio * 1.1, 1.0); // large
  else if (inputs.notionalValue < 50_000) ratio *= 0.9;                     // small

  return Math.max(0.3, Math.min(ratio, 1.0));
}
