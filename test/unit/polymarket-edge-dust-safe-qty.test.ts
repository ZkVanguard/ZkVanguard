/**
 * Locks the dust-safe quantization math from the polymarket-edge trader.
 *
 * BlueFin's dust guard rejects any order where size < 1.5× minQty.
 * quantize() floors to the step size, so an in-band raw qty can snap
 * DOWN below the guard threshold. This module tests the compensation
 * logic that bumps to `max(quantized, ceil(1.5 × step))`.
 *
 * Observed live 2026-07-13:
 *   SOL @ $76.15, minQty/step = 0.1, stake $5, leverage 3× →
 *     rawQty = (5 × 3) / 76.15 = 0.197
 *     quantized = floor(0.197 / 0.1) × 0.1 = 0.1
 *     BlueFin rejected: "Size 0.1 < 1.5× minQty 0.1"
 *   Fix: dust-safe qty = ceil(1.5 × 0.1 / 0.1) × 0.1 = 0.2
 *     max(0.1, 0.2) = 0.2 → passes guard
 */

function quantize(qty: number, step: number): number {
  return Math.floor(qty / step) * step;
}

function dustSafeQty(rawQty: number, step: number): number {
  const minDustSafe = Math.ceil((1.5 * step) / step) * step;
  const quantized = quantize(rawQty, step);
  return Math.max(quantized, minDustSafe);
}

describe('polymarket-edge dust-safe quantization', () => {
  it('reproduces the SOL prod bug (raw 0.197 → dust-safe 0.2)', () => {
    // Real prod values from 2026-07-13
    const stake = 5;
    const leverage = 3;
    const solPrice = 76.152;
    const step = 0.1; // SOL minQty
    const rawQty = (stake * leverage) / solPrice;
    expect(rawQty).toBeCloseTo(0.197, 3);
    expect(quantize(rawQty, step)).toBe(0.1); // old (buggy) behavior
    expect(dustSafeQty(rawQty, step)).toBeCloseTo(0.2, 6); // fix
  });

  it('BTC (0.001 step) — dust-safe = 0.002 minimum', () => {
    const step = 0.001;
    // Any raw qty in the (0, 0.001] range would snap to 0 or 0.001;
    // dust-safe forces at least 2× step.
    expect(dustSafeQty(0.0005, step)).toBeCloseTo(0.002, 6);
    expect(dustSafeQty(0.001, step)).toBeCloseTo(0.002, 6);
    expect(dustSafeQty(0.0019, step)).toBeCloseTo(0.002, 6);
  });

  it('ETH (0.01 step) — dust-safe = 0.02 minimum', () => {
    const step = 0.01;
    expect(dustSafeQty(0.005, step)).toBeCloseTo(0.02, 6);
    expect(dustSafeQty(0.01, step)).toBeCloseTo(0.02, 6);
    expect(dustSafeQty(0.015, step)).toBeCloseTo(0.02, 6);
  });

  it('SUI (1 step) — dust-safe = 2 minimum', () => {
    const step = 1;
    expect(dustSafeQty(0.5, step)).toBeCloseTo(2, 6);
    expect(dustSafeQty(1, step)).toBeCloseTo(2, 6);
    expect(dustSafeQty(1.9, step)).toBeCloseTo(2, 6);
  });

  it('pass-through when raw qty already comfortably above 1.5× step', () => {
    const step = 0.1;
    // rawQty = 0.5 → quantized = 0.5 → max(0.5, 0.2) = 0.5
    expect(dustSafeQty(0.5, step)).toBeCloseTo(0.5, 6);
    // rawQty = 1.23 → quantized = 1.2 → max(1.2, 0.2) = 1.2
    expect(dustSafeQty(1.23, step)).toBeCloseTo(1.2, 6);
  });

  it('recomputed notional from bumped size matches sizeQty × refPrice', () => {
    // The trader recomputes notionalUsd = sizeQty × refPrice AFTER the
    // dust-safe bump so risk-gate sees the true value.
    const sizeQty = 0.2;   // dust-safe SOL qty
    const refPrice = 76.152;
    const notional = sizeQty * refPrice;
    expect(notional).toBeCloseTo(15.23, 2);
    // Old (pre-fix) notional would have been (stake × leverage) = $15,
    // which underreports the real position size after the dust bump.
    expect(notional).toBeGreaterThan(5 * 3);
  });
});
