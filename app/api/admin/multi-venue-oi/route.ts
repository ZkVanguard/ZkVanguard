/**
 * Compare per-venue OI / funding / price for BTC, ETH, SUI -PERP across
 * BlueFin (Phase 1 implementer with read+write) and Hyperliquid (Phase 1
 * implementer with read-only).
 *
 * Use this to:
 *  - See at a glance which venue has the deeper liquidity for a hedge
 *  - Sanity-check that BlueFin's OI guard (T3-B) is using sensible numbers
 *  - Validate the multi-venue routing layer once Phase 2 lands
 *
 * Auth: CRON_SECRET via Bearer header. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/qstash';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { HyperliquidService } from '@/lib/services/perps/HyperliquidService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const SYMBOLS = ['BTC-PERP', 'ETH-PERP', 'SUI-PERP'];

export async function GET(req: NextRequest) {
  const auth = await verifyCronRequest(req, 'MultiVenueOi');
  if (auth !== true) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bf = BluefinService.getInstance();
  const hl = HyperliquidService.getInstance();

  // Pull per-symbol snapshots in parallel from both venues.
  const rows = await Promise.all(SYMBOLS.map(async symbol => {
    const [bfMd, hlSnap] = await Promise.all([
      bf.getMarketData(symbol).catch(() => null),
      hl.getMarketSnapshot(symbol).catch(() => null),
    ]);
    const bfPrice = Number(bfMd?.price ?? 0);
    const bfOiUsd = Number(bfMd?.openInterestUsd ?? 0);
    const bfFunding = Number(bfMd?.fundingRate ?? 0);
    const hlPrice = hlSnap?.price ?? 0;
    const hlOiUsd = hlSnap?.openInterestUsd ?? 0;
    const hlFunding = hlSnap?.fundingRate ?? 0;
    const deeperVenue = hlOiUsd > bfOiUsd ? 'hyperliquid' : 'bluefin';
    const ratio = bfOiUsd > 0 ? (hlOiUsd / bfOiUsd) : null;
    return {
      symbol,
      bluefin:    { price: bfPrice, openInterestUsd: bfOiUsd, fundingRate8h: bfFunding },
      hyperliquid:{ price: hlPrice, openInterestUsd: hlOiUsd, fundingRate8h: hlFunding },
      deeperVenue,
      hlOverBfRatio: ratio,
    };
  }));

  return NextResponse.json({
    ts: new Date().toISOString(),
    rows,
    note: 'Hyperliquid is read-only in Phase 1; routing live trades to it requires Phase 2 wallet + signing integration (T5-A).',
  });
}
