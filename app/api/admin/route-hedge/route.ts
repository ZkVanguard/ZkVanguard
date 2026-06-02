/**
 * Plan a hypothetical hedge across all known venues — diagnostic before
 * Phase 3 (router wired into the auto-hedge cron).
 *
 * Use the live ETH OI gap as the canonical test: request a $5k ETH-PERP
 * SHORT and the router shows that BlueFin can take ~$2k (5% of $40k OI)
 * and Hyperliquid would take the rest IF its canTrade were true (which
 * it isn't in Phase 1).
 *
 *   GET /api/admin/route-hedge?symbol=ETH-PERP&notionalUsd=5000&side=SHORT
 *
 * Auth: CRON_SECRET via Bearer header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/qstash';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { HyperliquidService } from '@/lib/services/perps/HyperliquidService';
import { routeHedge, type Side, type VenueLiquidity } from '@/lib/services/perps/PerpVenueRouter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const auth = await verifyCronRequest(req, 'RouteHedge');
  if (auth !== true) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || 'ETH-PERP').toUpperCase();
  const notionalUsd = Math.max(0, Number(url.searchParams.get('notionalUsd') || 5000));
  const side = ((url.searchParams.get('side') || 'SHORT').toUpperCase() === 'LONG' ? 'LONG' : 'SHORT') as Side;
  const maxOiPct = Math.max(0.5, Number(url.searchParams.get('maxOiPct') || 5));

  const bf = BluefinService.getInstance();
  const hl = HyperliquidService.getInstance();
  const [bfMd, hlSnap] = await Promise.all([
    bf.getMarketData(symbol).catch(() => null),
    hl.getMarketSnapshot(symbol).catch(() => null),
  ]);
  // BluefinService doesn't expose canTrade publicly today; assume true if
  // we got a getMarketData response (init succeeded).
  const bfCanTrade = bfMd != null;

  const venues: VenueLiquidity[] = [];
  if (bfMd) {
    venues.push({
      name: 'bluefin',
      oiUsd: bfMd.openInterestUsd ?? 0,
      fundingRate8h: bfMd.fundingRate ?? 0,
      canTrade: !!bfCanTrade,
    });
  }
  if (hlSnap) {
    venues.push({
      name: 'hyperliquid',
      oiUsd: hlSnap.openInterestUsd,
      fundingRate8h: hlSnap.fundingRate,
      canTrade: false, // Phase 1: read-only
    });
  }

  const plan = routeHedge({ symbol, notionalUsd, side, venues, maxOiPct });
  return NextResponse.json({
    input: { symbol, notionalUsd, side, maxOiPct },
    venues,
    plan,
    note: 'Hyperliquid canTrade=false in Phase 1 (read-only). Plan only routes to canTrade=true venues; Hyperliquid OI shown for context.',
  });
}
