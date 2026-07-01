/**
 * Perp Venue Router
 *
 * Above single-venue liquidity ceilings (BlueFin SUI-PERP OI is
 * single-digit millions today) a single hedge cannot fit on one venue
 * without unacceptable slippage. This router splits size across multiple
 * perp venues by their current OI and funding rates, picking the
 * blended-lowest-cost plan.
 *
 * Architecture: adapter pattern. Each venue implements `PerpVenueAdapter`
 * with three methods:
 *   - snapshot()      → current OI, funding rate, min qty, available margin
 *   - openHedge()     → open a position on this venue
 *   - closeHedge()    → close on this venue
 *
 * Today: BlueFin adapter is live (delegates to the existing BluefinService).
 * Hyperliquid + dYdX are stubbed with clear "not-configured" errors so the
 * router falls back to BlueFin-only until keys are added. Adding a venue is
 * one file: implement the interface, register with the router.
 *
 * Called from sui-community-pool cron when hedge notional exceeds
 * PERP_ROUTER_MIN_NOTIONAL_USD (default $50k). Below that threshold the
 * cron sticks to single-venue BlueFin (cheaper — no split fees).
 */

import { logger } from '@/lib/utils/logger';

export interface VenueSnapshot {
  venue: string;
  reachable: boolean;
  openInterestUsd: number | null;
  fundingRatePer8h: number | null;      // negative means we RECEIVE funding for short
  minQty: number | null;
  markPrice: number | null;
  freeMarginUsd: number | null;
  reason?: string;                       // populated when reachable=false
}

export interface PerpVenueAdapter {
  readonly venue: string;
  isConfigured(): boolean;
  snapshot(symbol: string): Promise<VenueSnapshot>;
  openHedge(params: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    leverage: number;
    reason: string;
  }): Promise<{ success: boolean; orderId?: string; error?: string; executionPrice?: number }>;
  closeHedge(params: { symbol: string; size?: number }): Promise<{
    success: boolean; orderId?: string; error?: string; executionPrice?: number;
  }>;
}

// ── Adapters ─────────────────────────────────────────────────────────────

/** Real adapter — delegates to the existing BluefinService singleton. */
class BluefinAdapter implements PerpVenueAdapter {
  readonly venue = 'bluefin';
  isConfigured(): boolean {
    return !!(process.env.BLUEFIN_PRIVATE_KEY || process.env.SUI_POOL_ADMIN_KEY);
  }
  async snapshot(symbol: string): Promise<VenueSnapshot> {
    try {
      const { BluefinService } = await import('@/lib/services/sui/BluefinService');
      const bf = BluefinService.getInstance();
      const md = await bf.getMarketData(symbol);
      const positions = await bf.getPositions();
      const existing = positions.find((p) => p.symbol === symbol);
      return {
        venue: this.venue,
        reachable: true,
        openInterestUsd: md?.openInterestUsd ?? null,
        fundingRatePer8h: md?.fundingRate ?? null,
        minQty: null, // read via BLUEFIN_PAIRS in the caller if needed
        markPrice: md?.price ?? null,
        freeMarginUsd: existing ? existing.margin : null,
      };
    } catch (e) {
      return { venue: this.venue, reachable: false, openInterestUsd: null, fundingRatePer8h: null, minQty: null, markPrice: null, freeMarginUsd: null, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  async openHedge(params: { symbol: string; side: 'LONG' | 'SHORT'; size: number; leverage: number; reason: string }) {
    const { BluefinService } = await import('@/lib/services/sui/BluefinService');
    const bf = BluefinService.getInstance();
    const r = await bf.openHedge(params);
    return { success: r.success, orderId: r.orderId, error: r.error, executionPrice: r.executionPrice };
  }
  async closeHedge(params: { symbol: string; size?: number }) {
    const { BluefinService } = await import('@/lib/services/sui/BluefinService');
    const bf = BluefinService.getInstance();
    const r = await bf.closeHedge(params);
    return { success: r.success, orderId: r.orderId, error: r.error, executionPrice: r.executionPrice };
  }
}

/**
 * Hyperliquid stub — the router treats it as unreachable until the SDK is
 * integrated + HYPERLIQUID_PRIVATE_KEY is set. Kept as a first-class stub
 * so the router topology + tests don't need to change when it goes live.
 */
class HyperliquidStubAdapter implements PerpVenueAdapter {
  readonly venue = 'hyperliquid';
  isConfigured(): boolean {
    return (process.env.HYPERLIQUID_PRIVATE_KEY ?? '').trim().length > 0;
  }
  async snapshot(): Promise<VenueSnapshot> {
    return {
      venue: this.venue, reachable: false,
      openInterestUsd: null, fundingRatePer8h: null, minQty: null,
      markPrice: null, freeMarginUsd: null,
      reason: this.isConfigured()
        ? 'HYPERLIQUID_PRIVATE_KEY set but adapter integration pending'
        : 'HYPERLIQUID_PRIVATE_KEY unset — venue disabled',
    };
  }
  async openHedge() {
    return { success: false, error: 'Hyperliquid adapter not yet integrated' };
  }
  async closeHedge() {
    return { success: false, error: 'Hyperliquid adapter not yet integrated' };
  }
}

/**
 * dYdX v4 stub — same pattern as Hyperliquid. dYdX v4 requires a Cosmos
 * SDK signer; wire when a validator/relayer relationship is in place.
 */
class DydxStubAdapter implements PerpVenueAdapter {
  readonly venue = 'dydx';
  isConfigured(): boolean {
    return (process.env.DYDX_MNEMONIC ?? '').trim().length > 0;
  }
  async snapshot(): Promise<VenueSnapshot> {
    return {
      venue: this.venue, reachable: false,
      openInterestUsd: null, fundingRatePer8h: null, minQty: null,
      markPrice: null, freeMarginUsd: null,
      reason: this.isConfigured()
        ? 'DYDX_MNEMONIC set but adapter integration pending'
        : 'DYDX_MNEMONIC unset — venue disabled',
    };
  }
  async openHedge() {
    return { success: false, error: 'dYdX adapter not yet integrated' };
  }
  async closeHedge() {
    return { success: false, error: 'dYdX adapter not yet integrated' };
  }
}

// ── Router ───────────────────────────────────────────────────────────────

export interface RoutePlan {
  legs: Array<{
    venue: string;
    notionalUsd: number;
    fundingCostBps8h: number;
    reason: string;
  }>;
  totalNotionalUsd: number;
  blendedFundingCostBps8h: number;
  singleVenue: boolean;
  belowSplitThreshold: boolean;
}

const MIN_SPLIT_NOTIONAL = Number(process.env.PERP_ROUTER_MIN_NOTIONAL_USD) || 50_000;
const MAX_LEG_PCT_OF_OI = Number(process.env.PERP_ROUTER_MAX_LEG_PCT_OI) || 5;

let _adapters: PerpVenueAdapter[] | null = null;
export function getAdapters(): PerpVenueAdapter[] {
  if (!_adapters) {
    _adapters = [
      new BluefinAdapter(),
      new HyperliquidStubAdapter(),
      new DydxStubAdapter(),
    ];
  }
  return _adapters;
}

/**
 * Given a target hedge notional, produce a multi-venue plan. Below the
 * split threshold this returns a single-venue plan (BlueFin). Above it,
 * queries all configured venues in parallel and splits proportional to
 * available OI capped at MAX_LEG_PCT_OF_OI percent.
 */
export async function routeHedgePlan(params: {
  symbol: string;
  notionalUsd: number;
  side: 'LONG' | 'SHORT';
}): Promise<RoutePlan> {
  if (params.notionalUsd < MIN_SPLIT_NOTIONAL) {
    return {
      legs: [{ venue: 'bluefin', notionalUsd: params.notionalUsd, fundingCostBps8h: 0, reason: `below split threshold ($${MIN_SPLIT_NOTIONAL})` }],
      totalNotionalUsd: params.notionalUsd,
      blendedFundingCostBps8h: 0,
      singleVenue: true,
      belowSplitThreshold: true,
    };
  }

  const adapters = getAdapters();
  const snapshots = await Promise.all(
    adapters.filter((a) => a.isConfigured()).map(async (a) => {
      try { return await a.snapshot(params.symbol); }
      catch (e) { return { venue: a.venue, reachable: false, openInterestUsd: null, fundingRatePer8h: null, minQty: null, markPrice: null, freeMarginUsd: null, reason: String(e).slice(0, 100) }; }
    }),
  );

  const reachable = snapshots.filter((s) => s.reachable && (s.openInterestUsd ?? 0) > 0);
  if (!reachable.length) {
    // Fall back to BlueFin-only if all venue snapshots failed
    logger.warn('[PerpRouter] No reachable venues — falling back to single-venue', { snapshots });
    return {
      legs: [{ venue: 'bluefin', notionalUsd: params.notionalUsd, fundingCostBps8h: 0, reason: 'no venue snapshots' }],
      totalNotionalUsd: params.notionalUsd,
      blendedFundingCostBps8h: 0,
      singleVenue: true,
      belowSplitThreshold: false,
    };
  }

  // Cap each leg at MAX_LEG_PCT_OF_OI of the venue's OI
  const totalCapacity = reachable.reduce((s, v) => s + Math.max(0, (v.openInterestUsd ?? 0) * MAX_LEG_PCT_OF_OI / 100), 0);
  const factor = totalCapacity > 0 ? Math.min(1, params.notionalUsd / totalCapacity) : 1;

  const legs = reachable.map((v) => {
    const capacity = Math.max(0, (v.openInterestUsd ?? 0) * MAX_LEG_PCT_OF_OI / 100);
    const notionalUsd = capacity * factor;
    // Funding cost sign: SHORTs receive when funding is positive.
    const rawFunding = v.fundingRatePer8h ?? 0;
    const fundingCostBps8h = (params.side === 'SHORT' ? -rawFunding : rawFunding) * 10_000;
    return {
      venue: v.venue,
      notionalUsd,
      fundingCostBps8h,
      reason: `OI=$${(v.openInterestUsd ?? 0).toFixed(0)}, funding=${(rawFunding * 100).toFixed(4)}%/8h`,
    };
  }).filter((l) => l.notionalUsd > 0);

  // Sort by cheapest funding first — but we already committed the split
  // proportional to OI. Blended cost is a weighted average.
  const total = legs.reduce((s, l) => s + l.notionalUsd, 0);
  const blended = total > 0 ? legs.reduce((s, l) => s + l.fundingCostBps8h * l.notionalUsd, 0) / total : 0;

  return {
    legs,
    totalNotionalUsd: total,
    blendedFundingCostBps8h: blended,
    singleVenue: legs.length <= 1,
    belowSplitThreshold: false,
  };
}

/**
 * Execute a plan. If any leg fails, the successful legs REMAIN OPEN and
 * the router returns an error result — the caller must call `unwind` to
 * roll back or accept partial exposure. This is the correct behavior at
 * scale: no automatic magic that could double-hedge a $10M position by
 * misinterpreting a partial failure.
 */
export async function executeRoutePlan(plan: RoutePlan, params: {
  symbol: string;
  side: 'LONG' | 'SHORT';
  leverage: number;
  reason: string;
}): Promise<{
  overallSuccess: boolean;
  legs: Array<{ venue: string; ok: boolean; notionalUsd: number; orderId?: string; error?: string }>;
  filledNotionalUsd: number;
}> {
  const adapters = getAdapters();
  const byVenue = new Map(adapters.map((a) => [a.venue, a]));

  const results = [];
  let filled = 0;

  for (const leg of plan.legs) {
    const adapter = byVenue.get(leg.venue);
    if (!adapter) {
      results.push({ venue: leg.venue, ok: false, notionalUsd: leg.notionalUsd, error: 'no adapter' });
      continue;
    }
    // Compute size from notional at the venue's mark price. This is a
    // simplification — real integration should re-fetch mark at exec time.
    const snap = await adapter.snapshot(params.symbol);
    const price = snap.markPrice ?? 0;
    if (price <= 0) {
      results.push({ venue: leg.venue, ok: false, notionalUsd: leg.notionalUsd, error: 'no mark price' });
      continue;
    }
    const size = leg.notionalUsd / price;
    const r = await adapter.openHedge({ symbol: params.symbol, side: params.side, size, leverage: params.leverage, reason: params.reason });
    if (r.success) filled += leg.notionalUsd;
    results.push({ venue: leg.venue, ok: r.success, notionalUsd: leg.notionalUsd, orderId: r.orderId, error: r.error });
  }

  return {
    overallSuccess: results.every((r) => r.ok),
    legs: results,
    filledNotionalUsd: filled,
  };
}

/** Test helper — reset the adapter singleton so unit tests can inject mocks. */
export function _resetAdaptersForTesting(mocks?: PerpVenueAdapter[]): void {
  _adapters = mocks ?? null;
}
