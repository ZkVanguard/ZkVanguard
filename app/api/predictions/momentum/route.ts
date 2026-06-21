/**
 * GET /api/predictions/momentum
 *
 * Three views on top of the broad-markets corpus:
 *
 *   * `hotMovers` — markets where probability + volume are surging
 *     (computed live from the same broad fetch, paired against the
 *     last cron snapshot persisted in cron_state).
 *   * `topByRelevance` — markets scored against the SUI pool's
 *     asset universe + rebalance cadence. Read from the cron's last
 *     persisted ranking so this endpoint is cheap.
 *   * `themes` — keyword-clustered narratives (ETF, fed, halving,
 *     etc.) with weighted direction + total volume per cluster.
 *
 * No state-changing side effects — pure read.
 */

import { NextResponse } from 'next/server';
import { fetchBroadCryptoMarkets } from '@/lib/services/market-data/PolymarketBroadMarketsService';
import {
  computeMomentum,
  detectThemes,
  scoreRelevance,
  type MarketSnapshot,
} from '@/lib/services/market-data/PolymarketMomentumService';
import { getCronStateOr } from '@/lib/db/cron-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const broad = await fetchBroadCryptoMarkets();
  const targets = broad
    .filter(m => m.horizon !== '5min')
    .sort((a, b) => b.volume24hr - a.volume24hr)
    .slice(0, 75);

  // Live momentum — read each market's snapshot history from cron_state
  // (written by the poly-discover cron) and compute deltas. If the cron
  // hasn't run yet, momentum is null for that market and it's skipped.
  const momenta = (
    await Promise.all(
      targets.map(async m => {
        const hist = await getCronStateOr<MarketSnapshot[]>(`poly-momentum:history:${m.slug}`, []);
        return computeMomentum(m, hist);
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);

  const hotMovers = momenta
    .filter(h => h.hotness >= 40 && Math.abs(h.probabilityDelta) >= 3)
    .sort((a, b) => b.hotness - a.hotness)
    .slice(0, 15);

  // Top by relevance — read the cron's persisted ranking if fresh
  // (< 1 hour), otherwise compute live as fallback so this endpoint
  // never returns empty when the cron is between schedules.
  const persistedRanked = await getCronStateOr<{
    ts: number;
    ranked: Array<Record<string, unknown>>;
  } | null>('poly-discover:topByRelevance', null);
  let topByRelevance: Array<Record<string, unknown>>;
  if (persistedRanked && Date.now() - persistedRanked.ts < 60 * 60 * 1000) {
    topByRelevance = persistedRanked.ranked;
  } else {
    const relCtx = { poolAssets: ['BTC', 'ETH', 'SUI'], rebalanceMinutes: 30 };
    topByRelevance = broad
      .filter(m => m.horizon !== '5min')
      .map(m => ({ market: m, rel: scoreRelevance(m, relCtx) }))
      .sort((a, b) => b.rel.score - a.rel.score)
      .slice(0, 25)
      .map(({ market, rel }) => ({
        slug: market.slug,
        question: market.question,
        horizon: market.horizon,
        marketType: market.marketType,
        assets: market.assets,
        probability: market.probability,
        volume24hr: market.volume24hr,
        score: rel.score,
        reasons: rel.reasons,
      }));
  }

  const themes = detectThemes(broad);

  return NextResponse.json({
    success: true,
    fetchedAt: Date.now(),
    counts: {
      broadTotal: broad.length,
      momentaComputed: momenta.length,
      hotMovers: hotMovers.length,
      themesActive: themes.length,
    },
    hotMovers,
    topByRelevance,
    themes,
  });
}
