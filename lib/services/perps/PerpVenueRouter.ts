/**
 * Multi-venue perp hedge router. T5-A Phase 2 (planning logic).
 *
 * Pure functions only — takes a desired hedge + a snapshot of each venue's
 * liquidity & funding, returns the optimal per-venue split. NO trading
 * happens here; the caller is responsible for executing each leg via the
 * appropriate venue client. That separation means Phase 2 can ship + be
 * inspected (via `/api/admin/route-hedge`) before Phase 3 wires it into
 * the cron's hot path.
 *
 * Decision rules (in order):
 *   1. Filter to venues that can_trade. Read-only venues (Hyperliquid in
 *      Phase 1) drop out — useful only for visibility.
 *   2. Each venue gets a `maxNotionalUsd = oiUsd × maxOiPct/100` cap so a
 *      single hedge can't dominate any one venue's order book.
 *   3. If total max-allowed across venues < requested notional, the hedge
 *      cannot be filled. Return null. Caller falls back to "shrink the
 *      hedge" or "skip this asset entirely" (the existing T1-A clamp).
 *   4. Funding-aware ordering: when going LONG, prefer venues where
 *      funding is most NEGATIVE (longs get paid). When going SHORT,
 *      prefer venues where funding is most POSITIVE (shorts get paid).
 *      Tie-break by deeper OI (less slippage, less concentration).
 *   5. Greedy fill in that order: take min(remaining, venue cap) per
 *      venue until the hedge is filled.
 *
 * Funding economics (per-8h decimal):
 *   LONG paying funding (cost):  funding > 0
 *   LONG receiving funding:      funding < 0
 *   SHORT paying funding:        funding < 0
 *   SHORT receiving funding:     funding > 0
 */

export type { Side } from './PerpVenue';
import type { Side } from './PerpVenue';

export interface VenueLiquidity {
  name: string;             // 'bluefin' | 'hyperliquid' | ...
  oiUsd: number;            // venue OI for the symbol in USD
  fundingRate8h: number;    // decimal, e.g. 0.0001 = 1bps per 8h
  canTrade: boolean;        // true iff venue client has live trading
}

export interface RouteInput {
  symbol: string;
  notionalUsd: number;
  side: Side;
  venues: VenueLiquidity[];
  maxOiPct?: number;        // default 5
}

export interface RouteLeg {
  venue: string;
  notionalUsd: number;
  pctOfVenueOi: number;     // 0-100, mostly for diagnostics
  fundingRate8h: number;
  effectiveCostBps8h: number; // signed: positive = cost, negative = paid
}

export interface RoutePlan {
  symbol: string;
  side: Side;
  requestedNotionalUsd: number;
  filledNotionalUsd: number;
  legs: RouteLeg[];
  blendedFundingCostBps8h: number; // weighted avg, positive = bleed
  unfilledNotionalUsd: number;
  reason?: string;          // when unfilled or null
}

/**
 * The "cost" of a leg given the side + funding. Positive = paid to hold.
 * Returns BPS per 8h for human-readable comparison.
 */
function legCostBps(side: Side, fundingRate8h: number): number {
  // funding > 0 means LONGS pay funding to SHORTS.
  // Cost for our position = +funding if LONG, -funding if SHORT (we
  // receive it when funding is positive and we're short).
  const sign = side === 'LONG' ? 1 : -1;
  return sign * fundingRate8h * 10_000;
}

export function routeHedge(input: RouteInput): RoutePlan {
  const { symbol, notionalUsd, side } = input;
  const maxOiPct = Math.max(0.5, input.maxOiPct ?? 5);

  const tradable = input.venues.filter(v => v.canTrade && v.oiUsd > 0);
  if (tradable.length === 0) {
    return {
      symbol, side,
      requestedNotionalUsd: notionalUsd,
      filledNotionalUsd: 0,
      legs: [],
      blendedFundingCostBps8h: 0,
      unfilledNotionalUsd: notionalUsd,
      reason: 'no tradable venue (all venues canTrade=false or oiUsd=0)',
    };
  }

  // Ordering: cheapest-cost first; tie-break deeper OI.
  const ordered = [...tradable].sort((a, b) => {
    const ca = legCostBps(side, a.fundingRate8h);
    const cb = legCostBps(side, b.fundingRate8h);
    if (Math.abs(ca - cb) > 0.01) return ca - cb;
    return b.oiUsd - a.oiUsd;
  });

  const legs: RouteLeg[] = [];
  let remaining = notionalUsd;
  let weightedCost = 0;
  for (const v of ordered) {
    if (remaining <= 0) break;
    const cap = v.oiUsd * (maxOiPct / 100);
    const take = Math.min(remaining, cap);
    if (take <= 0) continue;
    const cost = legCostBps(side, v.fundingRate8h);
    legs.push({
      venue: v.name,
      notionalUsd: take,
      pctOfVenueOi: (take / v.oiUsd) * 100,
      fundingRate8h: v.fundingRate8h,
      effectiveCostBps8h: cost,
    });
    weightedCost += cost * take;
    remaining -= take;
  }

  const filled = notionalUsd - remaining;
  const blended = filled > 0 ? weightedCost / filled : 0;

  let reason: string | undefined;
  if (remaining > 0) {
    const totalCap = ordered.reduce((s, v) => s + v.oiUsd * (maxOiPct / 100), 0);
    reason = `unfilled $${remaining.toFixed(2)} — sum of venue caps $${totalCap.toFixed(2)} < requested $${notionalUsd.toFixed(2)} at ${maxOiPct}% of OI`;
  }

  return {
    symbol, side,
    requestedNotionalUsd: notionalUsd,
    filledNotionalUsd: filled,
    legs,
    blendedFundingCostBps8h: blended,
    unfilledNotionalUsd: remaining,
    reason,
  };
}
