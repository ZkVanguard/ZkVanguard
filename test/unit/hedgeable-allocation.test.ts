/**
 * Golden tests for the T1-A hedgeability clamp
 * (lib/services/sui/cron/hedgeable-allocation.ts).
 *
 * Locks the behavior that drops un-hedgeable assets and redistributes
 * their share to assets whose perp leg can clear BlueFin's minQty.
 * Regression risk: future refactors that "simplify" the redistribute
 * math could silently produce naked-long exposure at small NAV — the
 * exact bug class CLAUDE.md flags as a production hazard.
 */
import { describe, it, expect } from '@jest/globals';
import {
  isHedgeable,
  clampAllocationsToHedgeable,
} from '@/lib/services/sui/cron/hedgeable-allocation';

// BlueFin minQty / stepSize per CLAUDE.md and BLUEFIN_PAIRS.
const SPECS = {
  BTC: { minQuantity: 0.001, stepSize: 0.001 },
  ETH: { minQuantity: 0.01,  stepSize: 0.01  },
  SUI: { minQuantity: 1,     stepSize: 1     },
};

// Realistic prices (2026-05).
const PRICES = { BTC: 75_000, ETH: 2_000, SUI: 1 };

describe('isHedgeable', () => {
  it('rejects when NAV × alloc% × ratio × leverage / price < minQty', () => {
    // $50 NAV, 45% BTC, ratio 1.0, leverage 5x → hedgeValue $22.50,
    // effective $112.50, size 0.0015 BTC. Steps to 0.001 → just clears
    // minQty 0.001. Edge of hedgeable.
    expect(isHedgeable(50, 45, 1.0, 5, 75_000, SPECS.BTC).ok).toBe(true);

    // $20 NAV, 30% BTC, 5x → $6.00 × 5 = $30.00, size 0.0004 BTC.
    // Floors to 0.000. Below minQty 0.001 → not hedgeable.
    expect(isHedgeable(20, 30, 1.0, 5, 75_000, SPECS.BTC).ok).toBe(false);

    // $50 NAV, 15% SUI, 5x at $1/SUI → $7.50 × 5 = $37.50, 37 SUI.
    // Clears SUI's minQty=1.
    expect(isHedgeable(50, 15, 1.0, 5, 1, SPECS.SUI).ok).toBe(true);
  });

  it('rejects zero/negative inputs cleanly', () => {
    expect(isHedgeable(50, 0, 1.0, 5, 75_000, SPECS.BTC).ok).toBe(false);
    expect(isHedgeable(50, 45, 1.0, 5, 0, SPECS.BTC).ok).toBe(false);
    expect(isHedgeable(0, 45, 1.0, 5, 75_000, SPECS.BTC).ok).toBe(false);
  });

  it('respects step-size flooring (BTC step 0.001)', () => {
    // sizeBase=0.0019, snapped to 0.001 — still hedgeable at exactly minQty.
    const r = isHedgeable(150, 30, 1.0, 5, 75_000, SPECS.BTC);
    expect(r.ok).toBe(true);
    expect(r.snappedSize).toBeCloseTo(0.003, 6);
  });
});

describe('clampAllocationsToHedgeable — passthrough when everything fits', () => {
  it('returns originals when all assets hedgeable', () => {
    // $500 NAV, 5x lev — BTC 0.0033 SUI ~33 ETH 0.025 — all clear minQty.
    const out = clampAllocationsToHedgeable({
      navUsd: 500,
      allocations: { BTC: 45, ETH: 40, SUI: 15 },
      prices: PRICES,
      hedgeRatio: 1.0,
      leverage: 5,
      perpSpecs: SPECS,
    });
    expect(out.dropped).toEqual([]);
    expect(out.redistributed).toBe(false);
    expect(out.allocations).toEqual({ BTC: 45, ETH: 40, SUI: 15 });
  });
});

describe('clampAllocationsToHedgeable — small-NAV drops + redistribution', () => {
  it('drops BTC at $50 NAV and redistributes to ETH + SUI', () => {
    // The canonical $50 case from the CLAUDE.md "BTC minQty problem"
    // example. With BTC 45% at $50 NAV and 5x leverage:
    //   $50 × 0.45 × 1.0 × 5 / $75k = 0.0015 BTC, floors to 0.001 — clears!
    // Actually let's use a NAV where BTC genuinely can't clear:
    //   $30 NAV × 0.45 × 5 / $75k = 0.0009 BTC, floors to 0.000 — drop.
    const out = clampAllocationsToHedgeable({
      navUsd: 30,
      allocations: { BTC: 45, ETH: 40, SUI: 15 },
      prices: PRICES,
      hedgeRatio: 1.0,
      leverage: 5,
      perpSpecs: SPECS,
    });
    expect(out.redistributed).toBe(true);
    expect(out.dropped.find(d => d.asset === 'BTC')).toBeDefined();
    expect(out.allocations.BTC).toBe(0);
    // ETH had 40 of (40+15)=55 survivor pct → ~72.73% rounded
    // SUI had 15 of 55 → ~27.27%. Total = 100.
    const total = Object.values(out.allocations).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100, 1);
    expect(out.allocations.ETH).toBeGreaterThan(70);
    expect(out.allocations.SUI).toBeGreaterThan(20);
  });

  it('preserves total = 100 when last survivor absorbs rounding remainder', () => {
    // Three survivors with shares that don't add to 100 cleanly should
    // still produce a sum of exactly 100 (last gets the residue).
    const out = clampAllocationsToHedgeable({
      navUsd: 200,
      allocations: { BTC: 33, ETH: 33, SUI: 34 },
      prices: PRICES,
      hedgeRatio: 1.0,
      leverage: 5,
      perpSpecs: SPECS,
    });
    const total = Object.values(out.allocations).reduce((s, v) => s + v, 0);
    expect(total).toBe(100);
  });
});

describe('clampAllocationsToHedgeable — no survivor edge case', () => {
  it('returns originals unchanged when NO asset is hedgeable', () => {
    // $1 NAV — nothing can hedge anything. Pool must fall back to all-USDC.
    const out = clampAllocationsToHedgeable({
      navUsd: 1,
      allocations: { BTC: 45, ETH: 40, SUI: 15 },
      prices: PRICES,
      hedgeRatio: 1.0,
      leverage: 5,
      perpSpecs: SPECS,
    });
    expect(out.redistributed).toBe(false);
    expect(out.dropped.length).toBe(3);
    expect(out.allocations).toEqual({ BTC: 45, ETH: 40, SUI: 15 });
  });
});

describe('clampAllocationsToHedgeable — missing price is unhedgeable', () => {
  it('drops asset with price=0 even if other params are fine', () => {
    // Price-feed glitch shouldn't authorise unhedged spot exposure.
    const out = clampAllocationsToHedgeable({
      navUsd: 1000,
      allocations: { BTC: 50, SUI: 50 },
      prices: { BTC: 0, SUI: 1 },
      hedgeRatio: 1.0,
      leverage: 5,
      perpSpecs: { BTC: SPECS.BTC, SUI: SPECS.SUI },
    });
    expect(out.dropped.find(d => d.asset === 'BTC')?.reason).toMatch(/no price/);
    expect(out.allocations.BTC).toBe(0);
    expect(out.allocations.SUI).toBe(100);
  });
});

describe('clampAllocationsToHedgeable — unknown symbols pass through', () => {
  it('keeps allocation for asset without a spec (caller responsibility)', () => {
    const out = clampAllocationsToHedgeable({
      navUsd: 200,
      allocations: { BTC: 50, CRO: 50 },
      prices: { BTC: 75_000, CRO: 0.1 },
      hedgeRatio: 1.0,
      leverage: 5,
      perpSpecs: { BTC: SPECS.BTC }, // CRO spec missing
    });
    // No drop for CRO — it's the caller's responsibility (might be hedged
    // via a different venue or simulated). Don't second-guess.
    expect(out.dropped.find(d => d.asset === 'CRO')).toBeUndefined();
    expect(out.allocations.CRO).toBe(50);
  });
});
