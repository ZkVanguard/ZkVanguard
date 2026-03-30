/**
 * Price Circuit Breaker
 * 
 * Validates incoming price data against known bounds and recent history
 * to reject anomalous prices (oracle manipulation, flash loan attacks,
 * data feed errors). Designed for mainnet-grade financial safety.
 * 
 * Rules:
 * 1. Absolute bounds: Reject prices outside sane min/max per asset
 * 2. Deviation check: Reject prices that deviate >15% from last known price within a short window
 * 3. Staleness: Reject cached prices older than MAX_STALENESS_MS
 * 4. Zero/negative: Always reject
 */

import { logger } from '@/lib/utils/logger';

// ── Configuration ────────────────────────────────────────────────────────────

/** Maximum allowed single-update deviation (fraction, e.g. 0.15 = 15%) */
const MAX_DEVIATION = 0.15;

/** How long a "last known price" is valid for deviation checks (ms) */
const DEVIATION_WINDOW_MS = 300_000; // 5 minutes

/** Maximum staleness before a cached price is considered unusable */
const MAX_STALENESS_MS = 120_000; // 2 minutes

/** Absolute price bounds per asset (USD). Prices outside these are rejected outright. */
const ABSOLUTE_BOUNDS: Record<string, { min: number; max: number }> = {
  BTC:  { min: 1_000,      max: 1_000_000 },
  ETH:  { min: 100,        max: 100_000 },
  SUI:  { min: 0.01,       max: 1_000 },
  CRO:  { min: 0.001,      max: 100 },
  SOL:  { min: 1,          max: 10_000 },
  AVAX: { min: 0.5,        max: 5_000 },
  USDC: { min: 0.90,       max: 1.10 },
  USDT: { min: 0.90,       max: 1.10 },
  DAI:  { min: 0.90,       max: 1.10 },
};

/** Default bounds for unknown assets */
const DEFAULT_BOUNDS = { min: 0.0001, max: 10_000_000 };

// ── Internal state ───────────────────────────────────────────────────────────

interface PriceRecord {
  price: number;
  timestamp: number;
}

/** Last accepted price per asset */
const lastAccepted = new Map<string, PriceRecord>();

// ── Public API ───────────────────────────────────────────────────────────────

export interface CircuitBreakerResult {
  accepted: boolean;
  reason?: string;
  price: number;
  symbol: string;
}

/**
 * Validate a price before accepting it into the platform.
 * Returns { accepted: true } if the price passes all checks,
 * or { accepted: false, reason } if it should be rejected.
 */
export function validatePrice(symbol: string, price: number): CircuitBreakerResult {
  const sym = symbol.toUpperCase();
  const base: Omit<CircuitBreakerResult, 'accepted' | 'reason'> = { price, symbol: sym };

  // 1. Zero / negative / NaN
  if (!Number.isFinite(price) || price <= 0) {
    logger.warn(`[CircuitBreaker] REJECTED ${sym}: non-positive price ${price}`);
    return { ...base, accepted: false, reason: 'Price is zero, negative, or NaN' };
  }

  // 2. Absolute bounds
  const bounds = ABSOLUTE_BOUNDS[sym] || DEFAULT_BOUNDS;
  if (price < bounds.min || price > bounds.max) {
    logger.warn(`[CircuitBreaker] REJECTED ${sym}: ${price} outside bounds [${bounds.min}, ${bounds.max}]`);
    return { ...base, accepted: false, reason: `Price ${price} outside absolute bounds [${bounds.min}, ${bounds.max}]` };
  }

  // 3. Deviation from last accepted price
  const last = lastAccepted.get(sym);
  if (last) {
    const age = Date.now() - last.timestamp;
    if (age < DEVIATION_WINDOW_MS) {
      const deviation = Math.abs(price - last.price) / last.price;
      if (deviation > MAX_DEVIATION) {
        logger.warn(
          `[CircuitBreaker] REJECTED ${sym}: ${price} deviates ${(deviation * 100).toFixed(1)}% ` +
          `from last accepted ${last.price} (${(age / 1000).toFixed(0)}s ago)`
        );
        return {
          ...base,
          accepted: false,
          reason: `Price deviates ${(deviation * 100).toFixed(1)}% from last accepted (max ${MAX_DEVIATION * 100}%)`,
        };
      }
    }
  }

  // All checks passed — accept and record
  lastAccepted.set(sym, { price, timestamp: Date.now() });
  return { ...base, accepted: true };
}

/**
 * Validate a batch of prices. Returns only accepted prices,
 * logging warnings for any rejected entries.
 */
export function validatePriceBatch(
  prices: Array<{ symbol: string; price: number }>,
): Array<{ symbol: string; price: number; accepted: boolean; reason?: string }> {
  return prices.map(({ symbol, price }) => {
    const result = validatePrice(symbol, price);
    return { symbol: result.symbol, price: result.price, accepted: result.accepted, reason: result.reason };
  });
}

/**
 * Check if a cached price is stale.
 */
export function isPriceStale(updatedAt: Date | number, maxAgeMs = MAX_STALENESS_MS): boolean {
  const age = Date.now() - (updatedAt instanceof Date ? updatedAt.getTime() : updatedAt);
  return age > maxAgeMs;
}

/**
 * Seed the circuit breaker with a known-good price (e.g. from DB cache on startup).
 * This prevents the first live price from being rejected due to no history.
 */
export function seedPrice(symbol: string, price: number): void {
  if (Number.isFinite(price) && price > 0) {
    lastAccepted.set(symbol.toUpperCase(), { price, timestamp: Date.now() });
  }
}
