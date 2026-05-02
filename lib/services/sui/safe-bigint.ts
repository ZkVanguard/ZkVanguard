/**
 * Safe parsing of u64 / u128 fields returned by Sui RPC and Bluefin API.
 *
 * Why this exists:
 *   `Number(rawU64) / 1e6` silently rounds when rawU64 > 2^53. A malformed
 *   field, an oracle attack, or simply a $9B+ TVL would make on-chain caps
 *   read incorrectly without throwing. We parse via BigInt first, sanity-
 *   check against a configurable maximum, and only then divide for ratio
 *   math at the display/sizing boundary.
 *
 * USDC has 6 decimals on Sui, so 1 USDC = 1_000_000 microUSDC. We default
 * to a 100B USDC sanity cap (1e17 microUSDC), well above any plausible
 * pool balance and well above 2^53 so an attacker can't slip a value past
 * us by exploiting silent float rounding.
 */

import { logger } from '@/lib/utils/logger';

/** 1 USDC in microUSDC (Sui Coin<USDC> uses 6 decimals). */
export const MICRO_USDC = 1_000_000n;

/** Sanity ceiling: 100B USDC. Larger reads are treated as malformed. */
export const MAX_REASONABLE_MICRO_USDC = 100_000_000_000n * MICRO_USDC; // 1e17

/**
 * Parse a Sui field that came across the wire as `string | number | bigint`
 * into a non-negative `bigint`. Returns `null` on invalid / malformed input.
 *
 * Sui JSON-RPC returns u64 fields as strings *most* of the time, but some
 * paths surface them as numbers (already lossy if > 2^53). We accept both
 * shapes and convert via the integer-preserving String → BigInt path.
 */
export function parseU64Field(raw: unknown): bigint | null {
  if (raw === null || raw === undefined) return null;
  try {
    if (typeof raw === 'bigint') {
      return raw < 0n ? null : raw;
    }
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || raw < 0) return null;
      if (!Number.isInteger(raw)) return null;
      // Anything above MAX_SAFE_INTEGER reaching us as `number` has
      // ALREADY been lossily rounded. Reject rather than pretend it's fine.
      if (raw > Number.MAX_SAFE_INTEGER) return null;
      return BigInt(raw);
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!/^\d+$/.test(trimmed)) return null;
      return BigInt(trimmed);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a microUSDC u64 field and convert to a plain `Number` for ratio
 * math (caps as percentages, sizing in USD, log output). Returns `0` on
 * invalid input AND logs a warning so silent corruption is auditable.
 *
 * The result is bounded by `MAX_REASONABLE_MICRO_USDC` so an attacker
 * cannot inflate cap calculations by injecting a u64 max value.
 */
export function microUsdcToUsdNumber(
  raw: unknown,
  fieldName: string = 'microUsdc',
): number {
  const big = parseU64Field(raw);
  if (big === null) {
    logger.warn('[safe-bigint] Invalid u64 field — defaulting to 0', {
      fieldName,
      rawType: typeof raw,
      rawSnippet: typeof raw === 'string' ? raw.slice(0, 32) : String(raw).slice(0, 32),
    });
    return 0;
  }
  if (big > MAX_REASONABLE_MICRO_USDC) {
    logger.error('[safe-bigint] u64 field exceeds sanity ceiling — defaulting to 0 (suspected malformed/attack)', {
      fieldName,
      raw: big.toString(),
      ceiling: MAX_REASONABLE_MICRO_USDC.toString(),
    });
    return 0;
  }
  // Below 1e17 microUSDC the integer fits safely in a JS Number after
  // dividing by 1e6 (max 1e11 USD = ~3 orders of magnitude under MAX_SAFE_INTEGER).
  // We do the divide in float space because the result is a USD ratio
  // consumed by Kelly/percentage math, not a u64 to be re-encoded.
  return Number(big) / Number(MICRO_USDC);
}
