/**
 * GET /api/polymarket/multi-asset-signal
 *
 * Returns the latest 5-min Polymarket binaries for multiple assets
 * (default BTC, ETH, SOL) plus an aggregated net-direction score.
 *
 * Used by the SUI Community Pool cron (via AIMarketIntelligence) and
 * exposed publicly so the UI / external integrators can show diversified
 * prediction sentiment instead of just the BTC 5-min binary.
 *
 * Query params:
 *   ?assets=BTC,ETH,SOL   (comma-separated, default 'BTC,ETH,SOL')
 *
 * Cache: 15 s per asset inside MultiAssetSignalService.
 */
import { NextRequest, NextResponse } from 'next/server';
import { MultiAssetSignalService } from '@/lib/services/market-data/MultiAssetSignalService';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const assetsParam = url.searchParams.get('assets') || 'BTC,ETH,SOL';
    const assets = assetsParam
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 8); // cap to avoid abuse

    if (assets.length === 0) {
      return NextResponse.json(
        { success: false, error: 'no assets specified' },
        { status: 400 },
      );
    }

    const agg = await MultiAssetSignalService.getAggregatedSentiment(assets);

    return NextResponse.json(
      {
        success: true,
        fetchedAt: Date.now(),
        assets,
        netScore: agg.netScore,
        bullishCount: agg.bullishCount,
        bearishCount: agg.bearishCount,
        strongCount: agg.strongCount,
        avgConfidence: agg.avgConfidence,
        perAsset: agg.perAsset,
      },
      {
        headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' },
      },
    );
  } catch (err) {
    logger.error('[multi-asset-signal] failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { success: false, error: 'multi-asset signal fetch failed' },
      { status: 500 },
    );
  }
}
