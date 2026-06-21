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
    const discovery = await MultiAssetSignalService.discoverAvailableAssets();
    const tracked = new Set(getTrackedAssetList());
    const seenBefore = new Set(await getCronStateOr<string[]>(CRON_KEY_SEEN, []));

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

    if (trackedButMissing.length > 0) {
      logger.warn('[PolyDiscover] tracked assets missing from current Polymarket window', {
        trackedButMissing,
      });
    }

    logger.info('[PolyDiscover] tick complete', {
      discoveredCount: discoveredAssets.length,
      newSinceLastTickCount: newSinceLastTick.length,
      trackedCount: tracked.size,
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
