/**
 * Golden tests for the T5-A Phase 2 multi-venue hedge router.
 * Locks the funding-aware splitting + OI cap behavior so Phase 3
 * (wiring into the cron) inherits a verified routing brain.
 */
import { describe, it, expect } from '@jest/globals';
import { routeHedge, type VenueLiquidity } from '@/lib/services/perps/PerpVenueRouter';

describe('routeHedge — single-venue happy path', () => {
  it('routes a small hedge entirely to the only tradable venue', () => {
    const venues: VenueLiquidity[] = [
      { name: 'bluefin', oiUsd: 1_000_000, fundingRate8h: 0.0001, canTrade: true },
    ];
    const plan = routeHedge({ symbol: 'BTC-PERP', notionalUsd: 10_000, side: 'SHORT', venues });
    expect(plan.filledNotionalUsd).toBe(10_000);
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].venue).toBe('bluefin');
    expect(plan.unfilledNotionalUsd).toBe(0);
    expect(plan.reason).toBeUndefined();
  });
});

describe('routeHedge — unfilled when no tradable venue', () => {
  it('returns 0 filled when every venue is read-only', () => {
    const venues: VenueLiquidity[] = [
      { name: 'hyperliquid', oiUsd: 1_000_000_000, fundingRate8h: 0.0001, canTrade: false },
    ];
    const plan = routeHedge({ symbol: 'BTC-PERP', notionalUsd: 10_000, side: 'SHORT', venues });
    expect(plan.filledNotionalUsd).toBe(0);
    expect(plan.unfilledNotionalUsd).toBe(10_000);
    expect(plan.reason).toMatch(/no tradable venue/);
  });

  it('returns partial fill when sum of caps < requested', () => {
    // Only $2k can fit at 5% of $40k OI; request $10k → $8k unfilled
    const venues: VenueLiquidity[] = [
      { name: 'bluefin', oiUsd: 40_000, fundingRate8h: 0.0001, canTrade: true },
    ];
    const plan = routeHedge({ symbol: 'ETH-PERP', notionalUsd: 10_000, side: 'SHORT', venues, maxOiPct: 5 });
    expect(plan.filledNotionalUsd).toBe(2_000);
    expect(plan.unfilledNotionalUsd).toBe(8_000);
    expect(plan.reason).toMatch(/unfilled \$8000/);
  });
});

describe('routeHedge — multi-venue split with OI caps', () => {
  it('fills hedge across two venues when one cant hold it alone', () => {
    // ETH OI gap from 2026-06-01: BlueFin $40k, Hyperliquid $1.36B
    const venues: VenueLiquidity[] = [
      { name: 'bluefin',     oiUsd: 40_000,         fundingRate8h: 0.0001, canTrade: true },
      { name: 'hyperliquid', oiUsd: 1_360_000_000,  fundingRate8h: 0.0001, canTrade: true },
    ];
    // 5% of $40k = $2k; 5% of $1.36B = $68M
    // Request $5k SHORT: tie-break by deeper OI (Hyperliquid first), takes full $5k
    const plan = routeHedge({ symbol: 'ETH-PERP', notionalUsd: 5_000, side: 'SHORT', venues, maxOiPct: 5 });
    expect(plan.filledNotionalUsd).toBe(5_000);
    expect(plan.unfilledNotionalUsd).toBe(0);
    // Both have identical funding, so the deeper-OI venue should win the tie
    expect(plan.legs[0].venue).toBe('hyperliquid');
  });
});

describe('routeHedge — funding-aware ordering', () => {
  it('SHORT prefers venue with HIGHER funding (shorts get paid)', () => {
    const venues: VenueLiquidity[] = [
      // Both have plenty of OI but different funding
      { name: 'bluefin',     oiUsd: 100_000_000, fundingRate8h: 0.00005, canTrade: true },
      { name: 'hyperliquid', oiUsd: 100_000_000, fundingRate8h: 0.0002,  canTrade: true },
    ];
    // SHORT: positive funding means shorts get paid → prefer the higher one
    const plan = routeHedge({ symbol: 'BTC-PERP', notionalUsd: 1_000, side: 'SHORT', venues, maxOiPct: 5 });
    expect(plan.legs[0].venue).toBe('hyperliquid');
    expect(plan.legs[0].effectiveCostBps8h).toBeLessThan(0); // negative = paid
  });

  it('LONG prefers venue with LOWER funding (longs pay less)', () => {
    const venues: VenueLiquidity[] = [
      { name: 'bluefin',     oiUsd: 100_000_000, fundingRate8h: 0.00005, canTrade: true },
      { name: 'hyperliquid', oiUsd: 100_000_000, fundingRate8h: 0.0002,  canTrade: true },
    ];
    // LONG: positive funding means longs pay → prefer the lower one
    const plan = routeHedge({ symbol: 'BTC-PERP', notionalUsd: 1_000, side: 'LONG', venues, maxOiPct: 5 });
    expect(plan.legs[0].venue).toBe('bluefin');
    expect(plan.legs[0].effectiveCostBps8h).toBeGreaterThan(0); // positive = cost
  });
});

describe('routeHedge — blended funding cost calculation', () => {
  it('weights funding by notional when capacity forces a split', () => {
    // Hyperliquid is preferred (0bps vs +1bps) AND has more capacity, so
    // it would take the whole $5k alone — to verify the WEIGHTED average
    // we have to cap HL artificially small so the split actually happens.
    const venues: VenueLiquidity[] = [
      { name: 'bluefin',     oiUsd: 40_000, fundingRate8h: 0.0001, canTrade: true },
      { name: 'hyperliquid', oiUsd: 60_000, fundingRate8h: 0,      canTrade: true },
    ];
    // 5% of 60k = $3k HL cap, 5% of 40k = $2k BF cap. Total $5k cap = exact fill.
    // LONG ordering by cost: HL (0bps) first, then BF (+1bps).
    // Blended = (3000*0 + 2000*1) / 5000 = 0.4bps
    const plan = routeHedge({ symbol: 'ETH-PERP', notionalUsd: 5_000, side: 'LONG', venues, maxOiPct: 5 });
    expect(plan.filledNotionalUsd).toBe(5_000);
    expect(plan.legs).toHaveLength(2);
    expect(plan.legs[0].venue).toBe('hyperliquid'); // cheapest first
    expect(plan.legs[1].venue).toBe('bluefin');
    expect(plan.blendedFundingCostBps8h).toBeCloseTo(0.4, 1);
  });
});

describe('routeHedge — symmetric SHORT-on-negative-funding case', () => {
  it('SHORTing negative funding means LONGS get paid — we should AVOID', () => {
    const venues: VenueLiquidity[] = [
      { name: 'bluefin',     oiUsd: 100_000_000, fundingRate8h: -0.0001, canTrade: true }, // bearish
      { name: 'hyperliquid', oiUsd: 100_000_000, fundingRate8h:  0.0001, canTrade: true }, // bullish
    ];
    // SHORT cost: -(-0.0001)*10000 = +1bps on bluefin, -(0.0001)*10000 = -1bps on HL
    // Negative cost = paid. Prefer HL (cheapest cost = -1bps).
    const plan = routeHedge({ symbol: 'BTC-PERP', notionalUsd: 1_000, side: 'SHORT', venues, maxOiPct: 5 });
    expect(plan.legs[0].venue).toBe('hyperliquid');
    expect(plan.legs[0].effectiveCostBps8h).toBeCloseTo(-1, 1);
  });
});
