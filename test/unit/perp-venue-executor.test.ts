/**
 * Golden tests for the T5-A Phase 3 PerpVenueExecutor. Verifies the
 * routing-plan-to-per-venue-execution dispatch + aggregation, with both
 * mocked venue clients so we don't touch BlueFin / Hyperliquid live APIs.
 */
import { describe, it, expect } from '@jest/globals';
import { PerpVenueExecutor } from '@/lib/services/perps/PerpVenueExecutor';
import type { TradingPerpVenue, PerpTradingResult, PerpMarketSnapshot } from '@/lib/services/perps/PerpVenue';
import type { RoutePlan } from '@/lib/services/perps/PerpVenueRouter';

function mockVenue(name: string, behavior: 'success' | 'fail' | 'throw'): TradingPerpVenue {
  return {
    name,
    async getMarketSnapshot(): Promise<PerpMarketSnapshot | null> { return null; },
    async canTrade(): Promise<boolean> { return true; },
    async openPosition(p): Promise<PerpTradingResult> {
      if (behavior === 'throw') throw new Error(`${name} synthetic failure`);
      if (behavior === 'fail') return { success: false, venue: name, error: 'simulated failure' };
      return {
        success: true,
        venue: name,
        orderId: `${name}-order-${Date.now()}`,
        filledNotionalUsd: p.notionalUsd,
        fees: p.notionalUsd * 0.0005,
      };
    },
  };
}

const plan2Leg: RoutePlan = {
  symbol: 'ETH-PERP',
  side: 'LONG',
  requestedNotionalUsd: 5000,
  filledNotionalUsd: 5000,
  legs: [
    { venue: 'hyperliquid', notionalUsd: 3000, pctOfVenueOi: 0.001, fundingRate8h: 0, effectiveCostBps8h: 0 },
    { venue: 'bluefin',     notionalUsd: 2000, pctOfVenueOi: 5,     fundingRate8h: 0.0001, effectiveCostBps8h: 1 },
  ],
  blendedFundingCostBps8h: 0.4,
  unfilledNotionalUsd: 0,
};

describe('PerpVenueExecutor — happy path', () => {
  it('executes both legs successfully when both venues are registered', async () => {
    const ex = new PerpVenueExecutor();
    ex.register(mockVenue('bluefin', 'success'));
    ex.register(mockVenue('hyperliquid', 'success'));
    const r = await ex.executePlan(plan2Leg, 3);
    expect(r.successCount).toBe(2);
    expect(r.failureCount).toBe(0);
    expect(r.filledNotionalUsd).toBe(5000);
    expect(r.legs[0].venue).toBe('hyperliquid');
    expect(r.legs[1].venue).toBe('bluefin');
  });
});

describe('PerpVenueExecutor — Phase 3 incompleteness surfaces clearly', () => {
  it('reports VENUE_NOT_CONFIGURED when a leg targets an unregistered venue', async () => {
    const ex = new PerpVenueExecutor();
    ex.register(mockVenue('bluefin', 'success'));
    // Hyperliquid NOT registered — simulates current Phase 2 state
    const r = await ex.executePlan(plan2Leg, 3);
    expect(r.successCount).toBe(1);     // BlueFin leg fills
    expect(r.failureCount).toBe(1);     // Hyperliquid leg fails clearly
    expect(r.filledNotionalUsd).toBe(2000); // only BlueFin's notional
    const hlLeg = r.legs.find(l => l.venue === 'hyperliquid');
    expect((hlLeg?.result as { error: string }).error).toMatch(/VENUE_NOT_CONFIGURED/);
  });

  it('lists registered tradable venues', () => {
    const ex = new PerpVenueExecutor();
    ex.register(mockVenue('bluefin', 'success'));
    expect(ex.listTradableVenues()).toEqual(['bluefin']);
    ex.register(mockVenue('hyperliquid', 'success'));
    expect(ex.listTradableVenues().sort()).toEqual(['bluefin', 'hyperliquid']);
  });
});

describe('PerpVenueExecutor — failure modes', () => {
  it('handles thrown errors as failed legs without aborting the plan', async () => {
    const ex = new PerpVenueExecutor();
    ex.register(mockVenue('bluefin', 'success'));
    ex.register(mockVenue('hyperliquid', 'throw'));
    const r = await ex.executePlan(plan2Leg, 3);
    expect(r.successCount).toBe(1);
    expect(r.failureCount).toBe(1);
    const hlLeg = r.legs.find(l => l.venue === 'hyperliquid');
    expect(hlLeg?.result.success).toBe(false);
    expect((hlLeg?.result as { error: string }).error).toMatch(/synthetic failure/);
  });

  it('aggregates partial fills correctly when one venue returns success:false', async () => {
    const ex = new PerpVenueExecutor();
    ex.register(mockVenue('bluefin', 'fail'));
    ex.register(mockVenue('hyperliquid', 'success'));
    const r = await ex.executePlan(plan2Leg, 3);
    expect(r.successCount).toBe(1);
    expect(r.failureCount).toBe(1);
    expect(r.filledNotionalUsd).toBe(3000); // only HL's leg filled
  });
});
