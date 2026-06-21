/**
 * Cron: poly-discover
 *
 * Periodically probes Polymarket for every 5-min `*-updown-5m-*` binary
 * listed in the current window, diffs against the seen-asset set in
 * cron_state, and fires a Discord alert when a NEW crypto binary appears.
 *
 * Why this cron exists: the SUI cron's allocation pipeline weights
 * prediction signals by conviction, so adding a freshly-listed asset
 * (XRP, AVAX, LINK, SUI itself if Polymarket ever lists it) measurably
 * widens the AI's evidence base. Discovery is cheap (one gamma call) so
 * we run it often and let ops decide whether to add to
 * `POLYMARKET_TRACKED_ASSETS`.
 *
 * State stored:
 *   cron:lastRun:poly-discover         heartbeat timestamp
 *   poly-discover:seenAssets           string[] of all asset symbols
 *                                       ever observed in any tick
 *   poly-discover:lastDiscovery        latest per-asset snapshot
 *
 * Auth: QStash signature or CRON_SECRET fallback via verifyCronRequest.
 * Suggested schedule: every 30 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { errMsg } from '@/lib/utils/error-handler';
import { setCronState, getCronStateOr } from '@/lib/db/cron-state';
import { notifyDiscord } from '@/lib/utils/discord-notify';
import {
  MultiAssetSignalService,
  getTrackedAssetList,
} from '@/lib/services/market-data/MultiAssetSignalService';
import {
  fetchBroadCryptoMarkets,
  summarize as summarizeBroad,
} from '@/lib/services/market-data/PolymarketBroadMarketsService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CRON_KEY_LAST_RUN = 'cron:lastRun:poly-discover';
const CRON_KEY_SEEN = 'poly-discover:seenAssets';
const CRON_KEY_LAST_DISCOVERY = 'poly-discover:lastDiscovery';

interface CronResult {
  success: boolean;
  ranAt: string;
  attempted: boolean;
  reason?: string;
  error?: string;
  discoveredCount?: number;
  newAssets?: string[];
  newSinceLastTick?: string[];
  trackedButMissing?: string[];
  trackedList?: string[];
  broad?: {
    summary: {
      total: number;
      byHorizon: Record<string, number>;
      byType: Record<string, number>;
      byAsset: Record<string, number>;
    };
    newHighImpactCount: number;
  };
}

export async function GET(request: NextRequest): Promise<NextResponse<CronResult>> {
  const ranAt = new Date().toISOString();

  const auth = await verifyCronRequest(request, 'PolyDiscover');
  void setCronState(CRON_KEY_LAST_RUN, Date.now()).catch(() => {});
  if (auth !== true) {
    return NextResponse.json(
      { success: false, ranAt, attempted: false, reason: 'Unauthorized' },
      { status: 401 },
    );
  }

  try {
    const [discovery, broad] = await Promise.all([
      MultiAssetSignalService.discoverAvailableAssets(),
      fetchBroadCryptoMarkets({ bypassCache: true }),
    ]);
    const tracked = new Set(getTrackedAssetList());
    const seenBefore = new Set(await getCronStateOr<string[]>(CRON_KEY_SEEN, []));
    const seenBroadSlugs = new Set(await getCronStateOr<string[]>('poly-discover:seenBroadSlugs', []));

    const discoveredAssets = discovery.assets;
    const newAssets = discoveredAssets.filter(a => !tracked.has(a));
    const newSinceLastTick = discoveredAssets.filter(a => !seenBefore.has(a));
    const trackedButMissing = Array.from(tracked).filter(a => !discoveredAssets.includes(a));

    // Persist the union — once an asset has been seen we keep it in the
    // seen set even if Polymarket de-lists it later, so a re-listing
    // doesn't re-fire the "new" alert spuriously.
    const seenAfter = Array.from(new Set([...seenBefore, ...discoveredAssets])).sort();
    await setCronState(CRON_KEY_SEEN, seenAfter).catch(() => {});
    await setCronState(CRON_KEY_LAST_DISCOVERY, {
      ts: Date.now(),
      assets: discoveredAssets,
      perAsset: discovery.perAsset,
    }).catch(() => {});

    if (newSinceLastTick.length > 0) {
      const top = newSinceLastTick
        .map(a => {
          const d = discovery.perAsset[a];
          return `${a} (vol24h=$${(d?.volume24hr ?? 0).toFixed(0)}, liq=$${(d?.liquidity ?? 0).toFixed(0)})`;
        })
        .join(', ');
      await notifyDiscord(
        `New 5-min binary listings detected on Polymarket: ${top}. ` +
        `Add to POLYMARKET_TRACKED_ASSETS to feed the SUI cron's AI.`,
        'INFO',
        { newSinceLastTick, trackedList: Array.from(tracked).sort() },
      );
    }

    // ── Broad-market discovery (hourly / daily / weekly / price-target /
    //    event). The 5-min loop only catches `*-updown-5m-*` slugs; this
    //    captures everything else and alerts on new HIGH-impact markets.
    const broadSummary = summarizeBroad(broad);
    const newBroadHigh = broad
      .filter(m => m.horizon !== '5min')
      .filter(m => !seenBroadSlugs.has(m.slug))
      // HIGH-impact threshold: $50k 24h volume — keeps the Discord channel
      // signal-rich. Lower-volume markets still feed into AIMarketIntelligence;
      // they just don't page anyone.
      .filter(m => m.volume24hr >= 50_000)
      .sort((a, b) => b.volume24hr - a.volume24hr)
      .slice(0, 5);

    if (newBroadHigh.length > 0) {
      const lines = newBroadHigh
        .map(m =>
          `${m.assets.join('/')} ${m.horizon} ${m.marketType}: ` +
          `"${m.question.substring(0, 80)}${m.question.length > 80 ? '…' : ''}" ` +
          `(p=${m.probability.toFixed(0)}%, vol=$${(m.volume24hr / 1000).toFixed(0)}k)`,
        )
        .join('\n');
      await notifyDiscord(
        `New HIGH-impact crypto markets on Polymarket:\n${lines}`,
        'INFO',
        {
          markets: newBroadHigh.map(m => ({ slug: m.slug, horizon: m.horizon, type: m.marketType, vol: m.volume24hr })),
          totals: broadSummary,
        },
      );
    }

    // Persist the union of seen broad slugs so the alert only fires once
    // per market across its lifetime.
    const seenBroadAfter = Array.from(new Set([
      ...seenBroadSlugs,
      ...broad.filter(m => m.horizon !== '5min').map(m => m.slug),
    ]));
    await setCronState('poly-discover:seenBroadSlugs', seenBroadAfter).catch(() => {});
    await setCronState('poly-discover:lastBroadSummary', {
      ts: Date.now(),
      summary: broadSummary,
    }).catch(() => {});

    if (trackedButMissing.length > 0) {
      logger.warn('[PolyDiscover] tracked assets missing from current Polymarket window', {
        trackedButMissing,
      });
    }

    logger.info('[PolyDiscover] tick complete', {
      discoveredCount: discoveredAssets.length,
      newSinceLastTickCount: newSinceLastTick.length,
      trackedCount: tracked.size,
      broadTotal: broadSummary.total,
      newBroadHigh: newBroadHigh.length,
    });

    return NextResponse.json({
      success: true,
      ranAt,
      attempted: true,
      discoveredCount: discoveredAssets.length,
      newAssets,
      newSinceLastTick,
      trackedButMissing,
      trackedList: Array.from(tracked).sort(),
      broad: {
        summary: broadSummary,
        newHighImpactCount: newBroadHigh.length,
      },
    });
  } catch (err) {
    const error = errMsg(err);
    logger.error('[PolyDiscover] tick failed', { error });
    return NextResponse.json({
      success: false,
      ranAt,
      attempted: true,
      error,
    });
  }
}

export const POST = GET;
