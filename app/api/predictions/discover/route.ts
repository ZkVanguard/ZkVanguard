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
import { fetchBroadCryptoMarkets, summarize as summarizeBroad } from '@/lib/services/market-data/PolymarketBroadMarketsService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const tracked = new Set(getTrackedAssetList());

  // 5-min binary discovery (narrow) AND broad-horizon market discovery
  // (hourly / daily / weekly / price-target / event) in parallel.
  const [fiveMinDiscovery, broad] = await Promise.all([
    MultiAssetSignalService.discoverAvailableAssets(),
    fetchBroadCryptoMarkets(),
  ]);

  const newlyAvailable = fiveMinDiscovery.assets.filter(a => !tracked.has(a));
  const stillTracked = Array.from(tracked).filter(a => fiveMinDiscovery.assets.includes(a));
  const trackedButMissing = Array.from(tracked).filter(a => !fiveMinDiscovery.assets.includes(a));

  const broadSummary = summarizeBroad(broad);
  // Surface 10 highest-volume markets per non-5min horizon so callers can
  // skim what's actually trading without paginating.
  const sampleByHorizon: Record<string, Array<Record<string, unknown>>> = {};
  for (const horizon of ['hourly', 'daily', 'weekly', 'monthly', 'longer'] as const) {
    sampleByHorizon[horizon] = broad
      .filter(m => m.horizon === horizon)
      .sort((a, b) => b.volume24hr - a.volume24hr)
      .slice(0, 10)
      .map(m => ({
        slug: m.slug,
        question: m.question,
        type: m.marketType,
        probability: m.probability,
        direction: m.direction,
        volume24hr: m.volume24hr,
        liquidity: m.liquidity,
        assets: m.assets,
        targetPrice: m.targetPrice,
        targetDate: m.targetDate,
      }));
  }

  return NextResponse.json({
    success: true,
    fetchedAt: fiveMinDiscovery.fetchedAt,
    fiveMin: {
      summary: {
        totalDiscovered: fiveMinDiscovery.assets.length,
        currentlyTracked: tracked.size,
        newlyAvailable: newlyAvailable.length,
        stillTracked: stillTracked.length,
        trackedButMissing: trackedButMissing.length,
      },
      newlyAvailable,
      stillTracked,
      trackedButMissing,
      perAsset: fiveMinDiscovery.perAsset,
      trackedList: Array.from(tracked).sort(),
    },
    broad: {
      summary: broadSummary,
      sampleByHorizon,
    },
  });
}
