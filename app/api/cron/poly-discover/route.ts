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
  type BroadMarket,
} from '@/lib/services/market-data/PolymarketBroadMarketsService';
import {
  appendSnapshot,
  computeMomentum,
  scoreRelevance,
  detectThemes,
  type MarketSnapshot,
  type MarketMomentum,
} from '@/lib/services/market-data/PolymarketMomentumService';

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

    // ── Momentum + Relevance + Themes ─────────────────────────────────
    // For the top ~75 markets by current volume, snapshot per-market
    // state into a ring buffer and compute momentum since the prior tick.
    // Hot movers (probability + volume both surging) get a Discord alert
    // because they're the highest-information events for the AI.
    const momentumTargets: BroadMarket[] = broad
      .filter(m => m.horizon !== '5min')
      .sort((a, b) => b.volume24hr - a.volume24hr)
      .slice(0, 75);

    const allMomenta: MarketMomentum[] = [];
    const now = Date.now();
    for (const m of momentumTargets) {
      const histKey = `poly-momentum:history:${m.slug}`;
      const prev = await getCronStateOr<MarketSnapshot[]>(histKey, []);
      const snap: MarketSnapshot = {
        ts: now,
        probability: m.probability,
        volume24hr: m.volume24hr,
        liquidity: m.liquidity,
      };
      const next = appendSnapshot(prev, snap);
      await setCronState(histKey, next).catch(() => {});

      const mom = computeMomentum(m, next);
      if (mom) allMomenta.push(mom);
    }

    // Hot movers: hotness ≥ 60 AND probability moved (i.e., not just a
    // volume blip). Take top 5 so Discord stays readable.
    const HOT_THRESHOLD = Number(process.env.POLY_HOT_THRESHOLD || 60);
    const hotMovers = allMomenta
      .filter(m => m.hotness >= HOT_THRESHOLD && Math.abs(m.probabilityDelta) >= 5)
      .sort((a, b) => b.hotness - a.hotness)
      .slice(0, 5);

    if (hotMovers.length > 0) {
      const lines = hotMovers.map(h =>
        `🔥 [${h.hotness}] ${h.assets.join('/')}: "${h.question.substring(0, 70)}${h.question.length > 70 ? '…' : ''}" ` +
        `Δp=${h.probabilityDelta > 0 ? '+' : ''}${h.probabilityDelta.toFixed(1)}% ` +
        `vol×${h.volumeRatio.toFixed(2)} over ${h.windowMinutes.toFixed(0)}min`,
      ).join('\n');
      await notifyDiscord(
        `HOT prediction-market movers (last 30min):\n${lines}`,
        'INFO',
        {
          hotCount: hotMovers.length,
          markets: hotMovers.map(h => ({ slug: h.slug, hotness: h.hotness, deltaP: h.probabilityDelta, volRatio: h.volumeRatio })),
        },
      );
    }

    // Relevance scoring — rank everything against the SUI pool's
    // asset universe. The cron itself only acts on the top-relevance
    // markets via AIMarketIntelligence, so this is mostly for surfacing
    // and the future "smart-watchlist" UI.
    const relevanceCtx = {
      poolAssets: ['BTC', 'ETH', 'SUI'],
      rebalanceMinutes: 30,
    };
    const ranked = broad
      .filter(m => m.horizon !== '5min')
      .map(m => ({ market: m, relevance: scoreRelevance(m, relevanceCtx) }))
      .sort((a, b) => b.relevance.score - a.relevance.score)
      .slice(0, 25)
      .map(({ market, relevance }) => ({
        slug: market.slug,
        question: market.question,
        horizon: market.horizon,
        marketType: market.marketType,
        assets: market.assets,
        probability: market.probability,
        volume24hr: market.volume24hr,
        score: relevance.score,
        reasons: relevance.reasons,
      }));
    await setCronState('poly-discover:topByRelevance', { ts: now, ranked }).catch(() => {});

    // Theme clustering — group markets by detected narrative + alert
    // when a theme suddenly clusters (e.g. 6 ETF markets up from 2).
    const themes = detectThemes(broad);
    const prevThemeState = await getCronStateOr<Record<string, number>>(
      'poly-momentum:themes:state',
      {},
    );
    const themeAlerts: string[] = [];
    const nextThemeState: Record<string, number> = {};
    for (const t of themes) {
      nextThemeState[t.theme] = t.marketCount;
      const prevCount = prevThemeState[t.theme] || 0;
      // Theme growth trigger: at least 3 markets, AND grew by 2+ since last tick
      if (t.marketCount >= 3 && t.marketCount - prevCount >= 2) {
        const dir = t.weightedDirection > 0.2 ? 'BULLISH'
          : t.weightedDirection < -0.2 ? 'BEARISH'
          : 'MIXED';
        themeAlerts.push(
          `📈 Theme heating: **${t.theme}** ${prevCount} → ${t.marketCount} markets, ` +
          `$${(t.totalVolume24hr / 1000).toFixed(0)}k 24h, ${dir} (affects ${t.affectsAssets.join('/')})`,
        );
      }
    }
    await setCronState('poly-momentum:themes:state', nextThemeState).catch(() => {});
    if (themeAlerts.length > 0) {
      await notifyDiscord(
        `Emerging prediction-market themes:\n${themeAlerts.join('\n')}`,
        'INFO',
        { themes: themes.slice(0, 10).map(t => ({ theme: t.theme, count: t.marketCount, dir: t.weightedDirection })) },
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
