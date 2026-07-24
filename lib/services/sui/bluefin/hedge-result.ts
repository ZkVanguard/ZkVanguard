/**
 * BluefinHedgeResult failure constructors.
 *
 * openHedge/closeHedge return ~15 different failure shapes, each with
 * boilerplate: `{ success: false, hedgeId, error, code, timestamp: Date.now() }`
 * plus code-specific fields. Extracted here so:
 *   - Adding a new failure code = adding one function, not editing 4
 *     inline blocks
 *   - The error-message wording is one place to fix drift
 *   - The dust/preCloseSize shapes stay consistent across sites
 *
 * BluefinHedgeResult type stays in BluefinService.ts (canonical); this
 * module type-imports so no runtime dependency cycle.
 */
import type { BluefinHedgeResult } from '@/lib/services/sui/BluefinService';

interface DustInfo {
  positionSize: number;
  minQty: number;
  stepSize: number;
  stepMultiples: number;
}

function base(hedgeId: string): Pick<BluefinHedgeResult, 'success' | 'hedgeId' | 'timestamp'> {
  return { success: false, hedgeId, timestamp: Date.now() };
}

export function dustLocked(
  hedgeId: string,
  symbol: string,
  rawSize: number,
  minQty: number,
  dust: DustInfo,
): BluefinHedgeResult {
  return {
    ...base(hedgeId),
    error: `Position size ${rawSize} < minQty ${minQty} for ${symbol} — cannot close via reduce order (dust-locked at venue level)`,
    code: 'DUST_LOCKED',
    dust,
    preCloseSize: rawSize,
  };
}

export function dustRisk(
  hedgeId: string,
  symbol: string,
  size: number,
  minQty: number,
  stepSize: number,
): BluefinHedgeResult {
  return {
    ...base(hedgeId),
    error: `Size ${size} < 1.5× minQty ${minQty} for ${symbol} — would risk creating dust-locked position. Set BLUEFIN_ALLOW_DUST_RISK_OPEN=1 to bypass.`,
    code: 'DUST_RISK',
    dust: {
      positionSize: size,
      minQty,
      stepSize,
      stepMultiples: size / stepSize,
    },
  };
}

export function belowMinQty(hedgeId: string, symbol: string, size: number, minQty: number): BluefinHedgeResult {
  return {
    ...base(hedgeId),
    error: `Order size ${size} below minimum ${minQty} for ${symbol}`,
    code: 'BELOW_MIN_QTY',
  };
}

export function belowMinQtySnapped(
  hedgeId: string,
  symbol: string,
  size: number,
  steppedSize: number,
  minQty: number,
): BluefinHedgeResult {
  return {
    ...base(hedgeId),
    error: `Order size ${size} rounds to ${steppedSize} which is below minimum ${minQty} for ${symbol}`,
    code: 'BELOW_MIN_QTY_SNAPPED',
  };
}
