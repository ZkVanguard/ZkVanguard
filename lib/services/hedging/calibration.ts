/**
 * Calibration & Sizing Math
 *
 * Treats Polymarket and aggregated prediction signals as **calibrated
 * probabilities** rather than heuristic confidence scores, and converts
 * them into safe, Kelly-bounded, TVL-relative hedge sizes.
 *
 * Why this matters:
 *  - Polymarket markets with sufficient volume/liquidity are empirically
 *    well-calibrated (the "60% chance" outcomes resolve YES ~60% of the
 *    time). The market price IS the probability — we should not re-derive
 *    confidence from heuristics like `60 + trends*8 - vol*5`.
 *  - We must guard against thin/illiquid markets where probability is noisy.
 *  - Position size must always respect on-chain Move guards
 *    (max_hedge_ratio_bps, daily_hedge_total) — never just `tvl * 0.25`.
 *  - Kelly fraction prevents overbetting on noisy signals.
 *
 * All thresholds here are conservative-by-default. Anything that fails
 * a gate returns 0 size or null, never a large default.
 */

import type { FiveMinBTCSignal } from '../market-data/Polymarket5MinService';
import type { AggregatedPrediction } from '../market-data/PredictionAggregatorService';

// ───────────────────────────────────────────────────────────────────────
// Hard limits — these mirror on-chain Move contract guards.
// Editing these does NOT relax on-chain checks; the chain still rejects.
// ───────────────────────────────────────────────────────────────────────
// Env-driven safe-default helpers — allow tightening in production without redeploys.
function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const SIZING_LIMITS = {
  /** Max hedge collateral as fraction of pool TVL. Default 20% (was 25%). Move on-chain still caps at 50%. */
  MAX_HEDGE_RATIO_OF_TVL: envNum('HEDGE_MAX_RATIO_OF_TVL', 0.20),
  /** Max single-trade collateral as fraction of TVL. Default 5% (was 10%) — keeps blast radius small. */
  MAX_SINGLE_TRADE_OF_TVL: envNum('HEDGE_MAX_SINGLE_TRADE_OF_TVL', 0.05),
  /** Min collateral (USDC) — below this, gas/slippage dominate */
  MIN_HEDGE_USD: envNum('HEDGE_MIN_USD', 50),
  /** Hard leverage cap regardless of config (reduces blow-up risk). Default 2x (was 3x). */
  HARD_LEVERAGE_CAP: envNum('HEDGE_HARD_LEVERAGE_CAP', 2),
  /** Min Polymarket volume (USD) for signal to be considered calibrated. Default $500 (was $100). */
  MIN_POLYMARKET_VOLUME_USD: envNum('HEDGE_MIN_POLYMARKET_VOLUME_USD', 500),
  /** Min Polymarket liquidity (USD). Default $1000 (was $250). */
  MIN_POLYMARKET_LIQUIDITY_USD: envNum('HEDGE_MIN_POLYMARKET_LIQUIDITY_USD', 1000),
  /** Reject probabilities outside [0.30, 0.95] — too uncertain or too extreme to act on */
  MIN_PROB: envNum('HEDGE_MIN_PROB', 0.30),
  MAX_PROB: envNum('HEDGE_MAX_PROB', 0.95),
  /** Probability above 0.5 required to take any directional position. Default 10% edge (p ≥ 60%, was 5%/55%). */
  MIN_EDGE: envNum('HEDGE_MIN_EDGE', 0.10),
  /** Max age of a signal before we refuse to act on it. Default 90s (was 5min) — much fresher. */
  MAX_SIGNAL_AGE_MS: envNum('HEDGE_MAX_SIGNAL_AGE_MS', 90 * 1000),
  /** Max age of a price quote before we refuse to execute a hedge */
  MAX_PRICE_STALENESS_MS: envNum('HEDGE_MAX_PRICE_STALENESS_MS', 30 * 1000),
  /** Kelly fraction divisor (full=1, half=2, quarter=4, eighth=8). Default 8 (eighth-Kelly, was quarter). */
  KELLY_DIVISOR: envNum('HEDGE_KELLY_DIVISOR', 8),
  /** Aggregated prediction: min consensus & confidence to qualify (each 0..100). */
  MIN_AGG_CONSENSUS: envNum('HEDGE_MIN_AGG_CONSENSUS', 70),
  MIN_AGG_CONFIDENCE: envNum('HEDGE_MIN_AGG_CONFIDENCE', 70),
  /** Polymarket 5-min signal: min confidence to qualify (0..100). Default 70. */
  MIN_POLY_CONFIDENCE: envNum('HEDGE_MIN_POLY_CONFIDENCE', 70),
} as const;

/**
 * Hard kill switch — set KILL_SWITCH=true (or =1, =on, =disable) to halt ALL
 * new directional exposure across rebalances + hedges. Existing positions
 * still close normally on the next cron cycle. Use this when in doubt.
 */
export function isTradingHalted(): boolean {
  const v = (process.env.KILL_SWITCH || process.env.TRADING_KILL_SWITCH || '').toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes' || v === 'disable' || v === 'halt';
}

// ───────────────────────────────────────────────────────────────────────

export interface QualifiedSignal {
  /** Calibrated probability (0..1) of the outcome we'd take */
  probability: number;
  /** UP or DOWN — the direction the signal supports */
  direction: 'UP' | 'DOWN';
  /** Edge over coin flip (probability - 0.5), clamped to [0, 0.5] */
  edge: number;
  /** Liquidity-adjusted weight (0..1) — used to scale size */
  weight: number;
  /** Source name for audit trail */
  source: string;
  /** When the signal was fetched */
  fetchedAt: number;
}

/**
 * Reject Polymarket signals that don't meet calibration prerequisites.
 * Returns null if the signal is too thin/stale/uncertain to act on.
 */
export function qualifyPolymarketSignal(
  signal: FiveMinBTCSignal | null | undefined,
  now: number = Date.now()
): QualifiedSignal | null {
  if (!signal) return null;

  // Confidence floor — even a clean probability is unsafe if the market's own
  // confidence (volume × skew × liquidity) is too low.
  const conf = (signal as unknown as { confidence?: number }).confidence ?? 0;
  if (conf < SIZING_LIMITS.MIN_POLY_CONFIDENCE) return null;

  // Staleness — Polymarket 5-min markets resolve every 5 min; if we have
  // a signal older than that window, the underlying market has likely
  // moved on and the probability is meaningless.
  if (now - signal.fetchedAt > SIZING_LIMITS.MAX_SIGNAL_AGE_MS) return null;

  // Liquidity gate — calibration breaks down on thin markets. A 70% probability
  // on a $5 volume market is noise; on $5,000 volume it's information.
  const volume = (signal as unknown as { volume24h?: number; volume?: number }).volume24h
              ?? (signal as unknown as { volume?: number }).volume
              ?? 0;
  const liquidity = (signal as unknown as { liquidity?: number }).liquidity ?? 0;
  if (volume < SIZING_LIMITS.MIN_POLYMARKET_VOLUME_USD) return null;
  if (liquidity > 0 && liquidity < SIZING_LIMITS.MIN_POLYMARKET_LIQUIDITY_USD) return null;

  // Direction must be decisive
  if (signal.direction !== 'UP' && signal.direction !== 'DOWN') return null;

  // Probability comes back as 0..100 in this codebase — normalise to 0..1
  const probPct = signal.direction === 'UP' ? signal.upProbability : signal.downProbability;
  const probability = clamp01(probPct / 100);

  if (!Number.isFinite(probability)) return null;
  if (probability < SIZING_LIMITS.MIN_PROB) return null;
  if (probability > SIZING_LIMITS.MAX_PROB) return null;

  const edge = Math.max(0, probability - 0.5);
  if (edge < SIZING_LIMITS.MIN_EDGE) return null;

  // Liquidity-adjusted weight: more liquid → more weight, capped at 1.0
  const liqRef = Math.max(volume, liquidity);
  const weight = Math.min(1.0, liqRef / 5_000); // saturates at $5K volume

  return {
    probability,
    direction: signal.direction,
    edge,
    weight,
    source: 'polymarket-5min',
    fetchedAt: signal.fetchedAt,
  };
}

/**
 * Aggregate prediction → qualified signal.
 * Used when we don't have a raw Polymarket BTC signal but have a
 * weighted aggregation across sources. We treat `probability` as already
 * weighted but require `consensus` ≥ 60% (sources agree) AND
 * `confidence` ≥ 60% to consider it qualified.
 */
export function qualifyAggregatedPrediction(
  pred: AggregatedPrediction | null | undefined,
  now: number = Date.now()
): QualifiedSignal | null {
  if (!pred) return null;
  if (now - pred.timestamp > SIZING_LIMITS.MAX_SIGNAL_AGE_MS) return null;

  if (pred.direction !== 'UP' && pred.direction !== 'DOWN') return null;
  if (pred.consensus < SIZING_LIMITS.MIN_AGG_CONSENSUS) return null;
  if (pred.confidence < SIZING_LIMITS.MIN_AGG_CONFIDENCE) return null;

  const probability = clamp01(pred.probability / 100);
  if (probability < SIZING_LIMITS.MIN_PROB || probability > SIZING_LIMITS.MAX_PROB) return null;

  const edge = Math.max(0, probability - 0.5);
  if (edge < SIZING_LIMITS.MIN_EDGE) return null;

  // Weight degrades when sources disagree
  const weight = clamp01((pred.consensus / 100) * (pred.confidence / 100));

  return {
    probability,
    direction: pred.direction,
    edge,
    weight,
    source: 'prediction-aggregator',
    fetchedAt: pred.timestamp,
  };
}

/**
 * Kelly fraction for a binary bet at calibrated probability `p` with
 * 1:1 payoff (typical for perp delta-hedge with leverage 1).
 *
 *   kelly = p - (1-p) / b   where b = payoff odds
 *
 * For perp hedges with leverage L, an adverse 1/L move liquidates,
 * so effective payoff odds ≈ L. We assume `payoffOdds = 1` (no leverage)
 * and let leverage be a separate decision so we don't double-count risk.
 *
 * Returns a fraction in [0, 1]. Always returns ≤ 1/KELLY_DIVISOR of
 * full Kelly to stay conservative.
 */
export function kellyFraction(probability: number, payoffOdds: number = 1): number {
  if (probability <= 0.5) return 0;
  if (payoffOdds <= 0) return 0;
  const fullKelly = probability - (1 - probability) / payoffOdds;
  if (!Number.isFinite(fullKelly) || fullKelly <= 0) return 0;
  return clamp01(fullKelly) / SIZING_LIMITS.KELLY_DIVISOR;
}

/**
 * Compute the safe collateral USD for a hedge.
 *
 * Combines:
 *   1. Quarter-Kelly on calibrated probability
 *   2. TVL-relative caps (mirrors Move on-chain max_hedge_ratio_bps)
 *   3. Per-trade cap so a single decision can't drain the pool
 *   4. Min $50 floor (below which gas dominates) — returns 0 if can't meet
 *
 * Returns 0 if any cap would be violated or if min not reachable.
 */
export function computeSafeCollateralUsd(args: {
  signal: QualifiedSignal;
  poolTvlUsd: number;
  currentHedgedUsd: number;
  /** Optional override: max ratio of TVL allowed (defaults to SIZING_LIMITS) */
  maxHedgeRatioOfTvl?: number;
}): number {
  const { signal, poolTvlUsd, currentHedgedUsd } = args;
  if (!Number.isFinite(poolTvlUsd) || poolTvlUsd <= 0) return 0;
  if (!Number.isFinite(currentHedgedUsd) || currentHedgedUsd < 0) return 0;

  const maxHedgeRatio = args.maxHedgeRatioOfTvl ?? SIZING_LIMITS.MAX_HEDGE_RATIO_OF_TVL;

  // 1. Kelly-derived size (from signal alone)
  const kelly = kellyFraction(signal.probability);
  // Apply liquidity weight — illiquid signals shrink size
  const sizingFraction = kelly * signal.weight;
  const kellySize = poolTvlUsd * sizingFraction;

  // 2. Hard caps
  const remainingHedgeBudget = Math.max(0, poolTvlUsd * maxHedgeRatio - currentHedgedUsd);
  const perTradeCap = poolTvlUsd * SIZING_LIMITS.MAX_SINGLE_TRADE_OF_TVL;

  let size = Math.min(kellySize, remainingHedgeBudget, perTradeCap);

  // 3. Floor — if below min, refuse rather than execute a dust trade
  if (size < SIZING_LIMITS.MIN_HEDGE_USD) return 0;

  // 4. Round to 2 decimals (USDC has 6 dec on-chain; whole cents are plenty)
  size = Math.floor(size * 100) / 100;
  return size;
}

/**
 * Cap leverage to the lower of (caller config, hard limit).
 * Always returns an integer in [1, HARD_LEVERAGE_CAP].
 */
export function safeLeverage(requested: number, configMax: number): number {
  const r = Math.floor(Number.isFinite(requested) ? requested : 1);
  const c = Math.floor(Number.isFinite(configMax) ? configMax : 1);
  const lev = Math.max(1, Math.min(r, c, SIZING_LIMITS.HARD_LEVERAGE_CAP));
  return lev;
}

/**
 * Returns true if the price quote is fresh enough to execute a hedge.
 * `staleness` is in milliseconds (age of the quote).
 */
export function isPriceFreshEnough(stalenessMs: number): boolean {
  if (!Number.isFinite(stalenessMs)) return false;
  return stalenessMs >= 0 && stalenessMs <= SIZING_LIMITS.MAX_PRICE_STALENESS_MS;
}

/**
 * Build a stable idempotency token for a hedge decision so a duplicate
 * cron tick doesn't fire the same hedge twice.
 *
 * The token is a hash of the *decision inputs* rounded to a 5-minute bucket.
 * Same pool + same risk score + same direction + same window → same token.
 */
export function buildDecisionToken(args: {
  portfolioId: number | string;
  asset: string;
  side: 'LONG' | 'SHORT';
  riskScore: number;
  bucketMs?: number;
  now?: number;
}): string {
  const bucket = args.bucketMs ?? 5 * 60 * 1000;
  const t = Math.floor((args.now ?? Date.now()) / bucket);
  // Simple deterministic token — readable in logs/DB
  const score = Math.round(args.riskScore * 10) / 10;
  return `${args.portfolioId}:${args.asset}:${args.side}:r${score}:b${t}`;
}

// ───────────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────────
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
