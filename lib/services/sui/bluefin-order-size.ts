/**
 * BlueFin perp order-size snapping (extracted + FP-hardened).
 *
 * The two call sites in BluefinService used `Math.floor(size / step) * step`,
 * which silently undersizes exact multiples because of IEEE-754 error:
 *   0.003 / 0.001 = 2.9999999999999996 → floor 2 → 0.002  (a full step short!)
 * For BTC (step 0.001) / ETH (step 0.01) hedges this systematically shrinks
 * real orders. This version rounds the quotient by a tiny epsilon before
 * flooring and re-rounds the product to the step's precision, so exact
 * multiples snap correctly while still never producing a size > the input.
 *
 * Pure; locked by test/unit/bluefin-order-size.test.ts.
 */

/** Decimal places implied by a step size (0.001 → 3, 0.01 → 2, 1 → 0). */
export function stepDecimals(stepSize: number): number {
  if (!Number.isFinite(stepSize) || Number.isInteger(stepSize)) return 0;
  const s = stepSize.toString();
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * Snap `size` DOWN to the nearest multiple of `stepSize` (never above `size`).
 * FP-robust: an exact multiple like 0.003 (step 0.001) returns 0.003, not 0.002.
 */
export function snapToStepSize(size: number, stepSize: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (!Number.isFinite(stepSize) || stepSize <= 0) return size;
  const steps = Math.floor(size / stepSize + 1e-9);
  return Number((steps * stepSize).toFixed(stepDecimals(stepSize)));
}

/**
 * Normalize the BlueFin aggregator's price-impact field to an impact fraction.
 * The SDK returns it in one of two formats: a "price ratio remaining" near 1
 * (0.9999 ⇒ 0.01% impact) or a direct impact fraction (0.0001). Values > 0.5
 * are treated as ratio-remaining (impact = 1 − v); otherwise as direct impact.
 * Returns 0 for null/undefined/NaN.
 */
export function normalizePriceImpact(raw: number | null | undefined): number {
  const v = Math.abs(Number(raw) || 0);
  return v > 0.5 ? 1 - v : v;
}
