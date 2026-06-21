/**
 * GET /api/predictions/discover
 *
 * Hits Polymarket's gamma API once and returns every `*-updown-5m-{epoch}`
 * binary listed in (and around) the current 5-min window — uppercased
 * asset symbol + winning slug + 24h volume + liquidity per asset.
 *
 * Lets ops see what new crypto binaries Polymarket has added that the
 * SUI cron's tracked-asset list (`POLYMARKET_TRACKED_ASSETS`) doesn't
 * yet include. Pair with `/api/cron/poly-discover` for periodic
 * monitoring + Discord alerting on new listings.
 */

import { NextResponse } from 'next/server';
import { MultiAssetSignalService, getTrackedAssetList } from '@/lib/services/market-data/MultiAssetSignalService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const tracked = new Set(getTrackedAssetList());
  const discovery = await MultiAssetSignalService.discoverAvailableAssets();

  const newlyAvailable = discovery.assets.filter(a => !tracked.has(a));
  const stillTracked = Array.from(tracked).filter(a => discovery.assets.includes(a));
  const trackedButMissing = Array.from(tracked).filter(a => !discovery.assets.includes(a));

  return NextResponse.json({
    success: true,
    fetchedAt: discovery.fetchedAt,
    summary: {
      totalDiscovered: discovery.assets.length,
      currentlyTracked: tracked.size,
      newlyAvailable: newlyAvailable.length,
      stillTracked: stillTracked.length,
      trackedButMissing: trackedButMissing.length,
    },
    newlyAvailable,
    stillTracked,
    trackedButMissing,
    perAsset: discovery.perAsset,
    trackedList: Array.from(tracked).sort(),
  });
}
