/**
 * Pure market-signal classification + gating for the SUI cron's heuristic
 * allocation and the AI-driven daily-cap reset guard. Extracted from
 * app/api/cron/sui-community-pool/route.ts so these risk decisions have a
 * single source of truth and a test net (test/unit/signal-gating.test.ts).
 * No I/O — pure functions of price/volatility/signal inputs.
 */
export type Volatility = 'low' | 'medium' | 'high';
export type Trend = 'bullish' | 'bearish' | 'neutral';

/** 24h-range volatility band. */
export function classifyVolatility(rangePercent: number): Volatility {
  return rangePercent < 3 ? 'low' : rangePercent < 7 ? 'medium' : 'high';
}

/** 24h-change trend (±2% deadband). */
export function classifyTrend(change24h: number): Trend {
  return change24h > 2 ? 'bullish' : change24h < -2 ? 'bearish' : 'neutral';
}

/** Per-asset 0–100 score driving allocation weight. */
export function scoreAsset(args: {
  change24h: number;
  volatility: Volatility;
  trend: Trend;
  volume24h: number;
  price: number;
}): number {
  let score = 50 + args.change24h * 2;
  if (args.volatility === 'low') score += 10;
  else if (args.volatility === 'high') score -= 5;
  if (args.trend === 'bullish') score += 10;
  else if (args.trend === 'bearish') score -= 10;
  if (args.volume24h * args.price > 100_000_000) score += 5;
  return Math.max(0, Math.min(100, score));
}

/** Allocation confidence, bounded to 50–95. */
export function clampConfidence(clearTrends: number, highVol: number): number {
  return Math.max(50, Math.min(95, 60 + clearTrends * 8 - highVol * 5));
}

/**
 * Gate for the AI-driven daily-hedge-cap reset: a weak/compromised signal must
 * not be able to lift the on-chain cap. Strong = HIGH/CRITICAL urgency, or
 * confidence at/above the configured floor.
 */
export function isStrongHedgeSignal(
  urgency: string | undefined,
  confidence: number,
  minConfidence: number,
): boolean {
  const u = (urgency || '').toUpperCase();
  return u === 'HIGH' || u === 'CRITICAL' || confidence >= minConfidence;
}
