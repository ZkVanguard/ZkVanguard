/**
 * Single source of truth for SUI hedge PnL estimation.
 *
 * PnL = notional × pctMove × side-sign, where pctMove = (price − entry) / entry.
 * Uses NOTIONAL (consistent across code paths) NOT `size` (whose unit varies:
 * asset-units for auto-hedge rows, collateral-USDC for reconciler rows — the old
 * size-based formula produced garbage like $304 PnL on a $1.73 hedge).
 *
 * Returns 0 when any input is missing/non-positive so callers never propagate
 * NaN/Infinity into the DB. Behavior is locked by test/unit/hedge-pnl.test.ts.
 */
export type HedgeSide = 'LONG' | 'SHORT';

export function estimateHedgePnl(
  side: HedgeSide | string,
  notionalValue: number,
  entryPrice: number,
  currentOrExitPrice: number,
): number {
  const notional = Number(notionalValue) || 0;
  const entry = Number(entryPrice) || 0;
  const price = Number(currentOrExitPrice) || 0;
  if (entry <= 0 || price <= 0 || notional <= 0) return 0;
  const sign = side === 'LONG' ? 1 : -1;
  return sign * notional * ((price - entry) / entry);
}

/** Round to 8 decimals (DB current_pnl precision) the way the reconciler does. */
export function roundPnl8(pnl: number): number {
  return Math.round(pnl * 1e8) / 1e8;
}
