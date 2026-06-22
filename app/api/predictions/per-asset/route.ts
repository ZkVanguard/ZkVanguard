/**
 * GET /api/predictions/per-asset
 *
 * Read-only window into PredictionAggregatorService.getPerAssetPredictions
 * for ops + verification. Surfaces the full per-asset aggregation including:
 *   - Per-asset Polymarket 5-min signals (multi-asset, not just BTC)
 *   - Delphi + Manifold sources routed by relatedAssets
 *   - BlueFin funding rate sentiment
 *   - Cross-asset alignment as its own source
 *   - SignalDriftFusion upgrades (synthetic STRONG)
 *
 * Optional ?assets=BTC,ETH,SOL,XRP,DOGE to override the default scan.
 * Optional ?auto=1 to use the dynamic Polymarket-discovered universe.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readLimiter } from '@/lib/security/rate-limiter';
import { PredictionAggregatorService } from '@/lib/services/market-data/PredictionAggregatorService';
import { getDynamicTrackedAssets, getTrackedAssetList } from '@/lib/services/market-data/MultiAssetSignalService';
import { SignalDriftFusion } from '@/lib/services/market-data/SignalDriftFusion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limited = readLimiter.check(req);
  if (limited) return limited;

  const url = new URL(req.url);
  const assetsParam = url.searchParams.get('assets');
  const useAuto = url.searchParams.get('auto') === '1';

  let assets: string[];
  if (assetsParam) {
    assets = assetsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  } else if (useAuto) {
    assets = await getDynamicTrackedAssets();
  } else {
    assets = getTrackedAssetList();
  }

  const start = Date.now();
  const predictions = await PredictionAggregatorService.getPerAssetPredictions(assets);
  const driftSnapshot = SignalDriftFusion.getHistorySnapshot();

  return NextResponse.json({
    success: true,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    assets,
    predictions: Object.fromEntries(
      Object.entries(predictions).map(([asset, p]) => [asset, {
        direction: p.direction,
        recommendation: p.recommendation,
        confidence: Math.round(p.confidence),
        consensus: Math.round(p.consensus),
        probability: Math.round(p.probability * 10) / 10,
        sourceCount: p.sources.length,
        sources: p.sources.map(s => ({
          name: s.name,
          direction: s.direction,
          confidence: Math.round(s.confidence),
          weight: Math.round(s.weight * 1000) / 10,            // %
        })),
        syntheticStrong: p.sources.some(s => s.name.includes('synthetic STRONG')),
        hasManifold: p.sources.some(s => s.name.startsWith('Manifold:')),
        hasAlignment: p.sources.some(s => s.name.startsWith('Cross-asset alignment')),
        reasoning: p.reasoning,
      }]),
    ),
    driftHistory: driftSnapshot,
  });
}
