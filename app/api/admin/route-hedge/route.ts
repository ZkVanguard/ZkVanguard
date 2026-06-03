/**
 * Plan a hypothetical hedge across all known venues — diagnostic before
 * Phase 3 (router wired into the auto-hedge cron).
 *
 * Two modes:
 *   GET ?symbol=ETH-PERP&notionalUsd=5000&side=SHORT   (manual)
 *   GET ?auto=1                                         (auto from pool state)
 *
 * Auto mode pulls the latest pool NAV + last AI allocations + live prices
 * from the DB and runs the router for each asset that would hedge on the
 * next cron tick — showing the operator what would happen RIGHT NOW
 * without any actual execution.
 *
 * Auth: CRON_SECRET via Bearer header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/qstash';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { HyperliquidService } from '@/lib/services/perps/HyperliquidService';
import { routeHedge, type Side, type VenueLiquidity } from '@/lib/services/perps/PerpVenueRouter';
import { query } from '@/lib/db/postgres';
import { resolveLeverage, hedgeRatioForNav, hedgeValueUsd } from '@/lib/services/sui/cron/hedge-sizing';
import { getMultiSourceValidatedPrice } from '@/lib/services/market-data/unified-price-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 25;

interface VenueSnap {
  bf: { openInterestUsd?: number; fundingRate?: number; price?: number } | null;
  hl: { openInterestUsd: number; fundingRate8h: number; price: number } | null;
}

async function fetchVenuesFor(symbol: string): Promise<VenueSnap> {
  const bf = BluefinService.getInstance();
  const hl = HyperliquidService.getInstance();
  const [bfMd, hlSnap] = await Promise.all([
    bf.getMarketData(symbol).catch(() => null),
    hl.getMarketSnapshot(symbol).catch(() => null),
  ]);
  return {
    bf: bfMd ? { openInterestUsd: bfMd.openInterestUsd, fundingRate: bfMd.fundingRate, price: bfMd.price } : null,
    hl: hlSnap ? { openInterestUsd: hlSnap.openInterestUsd, fundingRate8h: hlSnap.fundingRate, price: hlSnap.price } : null,
  };
}

function venuesFromSnap(snap: VenueSnap): VenueLiquidity[] {
  const venues: VenueLiquidity[] = [];
  if (snap.bf) {
    venues.push({
      name: 'bluefin',
      oiUsd: snap.bf.openInterestUsd ?? 0,
      fundingRate8h: snap.bf.fundingRate ?? 0,
      canTrade: true,
    });
  }
  if (snap.hl) {
    venues.push({
      name: 'hyperliquid',
      oiUsd: snap.hl.openInterestUsd,
      fundingRate8h: snap.hl.fundingRate8h,
      canTrade: false, // Phase 1/2: read-only
    });
  }
  return venues;
}

export async function GET(req: NextRequest) {
  const auth = await verifyCronRequest(req, 'RouteHedge');
  if (auth !== true) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const auto = url.searchParams.get('auto') === '1';
  const maxOiPct = Math.max(0.5, Number(url.searchParams.get('maxOiPct') || 5));

  if (auto) {
    // Pull latest NAV + last AI allocations from DB
    const navRows = await query<{ nav: string }>(
      `SELECT total_nav nav FROM community_pool_nav_history WHERE chain='sui' ORDER BY "timestamp" DESC LIMIT 1`,
    );
    const navUsd = Number(navRows[0]?.nav ?? 0);
    const aiRows = await query<{ details: { allocations?: Record<string, number>; marketSentiment?: string } }>(
      `SELECT details FROM community_pool_transactions WHERE type='AI_DECISION' AND details->>'chain'='sui' ORDER BY created_at DESC LIMIT 1`,
    );
    const allocations = aiRows[0]?.details?.allocations ?? { BTC: 33, ETH: 33, SUI: 34 };
    const sentiment = (aiRows[0]?.details?.marketSentiment || 'NEUTRAL').toUpperCase();
    const side: Side = sentiment === 'BULLISH' ? 'LONG' : 'SHORT';
    const leverage = resolveLeverage(navUsd);
    const ratio = hedgeRatioForNav(navUsd);

    const perAsset = await Promise.all(
      (['BTC', 'ETH', 'SUI'] as const).map(async (asset) => {
        const symbol = `${asset}-PERP`;
        const allocationPct = Number(allocations[asset] || 0);
        const notional = hedgeValueUsd(navUsd, allocationPct, ratio);
        if (notional <= 0 || allocationPct <= 0) {
          return { symbol, skipped: 'allocation 0' };
        }
        const validated = await getMultiSourceValidatedPrice(asset).catch(() => null);
        const price = validated?.price ?? 0;
        if (price <= 0) return { symbol, skipped: 'no price' };
        const snap = await fetchVenuesFor(symbol);
        const venues = venuesFromSnap(snap);
        const plan = routeHedge({ symbol, notionalUsd: notional, side, venues, maxOiPct });
        return {
          symbol,
          allocationPct,
          requestedNotionalUsd: notional,
          venues,
          plan,
        };
      }),
    );

    return NextResponse.json({
      ts: new Date().toISOString(),
      pool: { navUsd, sentiment, side, leverage, hedgeRatio: ratio, allocations },
      perAsset,
      note: 'Auto mode reflects what the cron would route on its next Step 8 tick. Hyperliquid currently shows in venues for visibility but canTrade=false (Phase 3 wallet pending).',
    });
  }

  // Manual mode (existing behavior)
  const symbol = (url.searchParams.get('symbol') || 'ETH-PERP').toUpperCase();
  const notionalUsd = Math.max(0, Number(url.searchParams.get('notionalUsd') || 5000));
  const side = ((url.searchParams.get('side') || 'SHORT').toUpperCase() === 'LONG' ? 'LONG' : 'SHORT') as Side;

  const snap = await fetchVenuesFor(symbol);
  const venues = venuesFromSnap(snap);
  const plan = routeHedge({ symbol, notionalUsd, side, venues, maxOiPct });
  return NextResponse.json({
    input: { symbol, notionalUsd, side, maxOiPct },
    venues,
    plan,
    note: 'Manual mode. Pass ?auto=1 to simulate the cron\'s next-tick decisions for all 3 assets.',
  });
}
