/**
 * ManifoldMarketService
 *
 * Adds Manifold Markets as an additional prediction-market source alongside
 * Polymarket + Delphi. Manifold has a different bettor base and tends to
 * carry markets that Polymarket doesn't (longer-horizon crypto events,
 * niche L1/L2 narratives) — diversifying away from Polymarket-only risk
 * on quiet trading days.
 *
 * Public REST API: https://docs.manifold.markets/api
 *   - GET /v0/search-markets?term=...&limit=N — keyword search
 *   - No auth required for reads
 *   - Markets return YES probability (0-1) for binary outcomes
 *
 * Output shape matches the existing `PredictionMarket` interface from
 * DelphiMarketService so the aggregator can consume both interchangeably.
 */
import { logger } from '@/lib/utils/logger';
import type { PredictionMarket } from './DelphiMarketService';

const MANIFOLD_API = 'https://api.manifold.markets/v0';
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60_000;                  // Manifold markets drift slowly
const MIN_VOLUME_24H = 50;                    // dollar-equivalent in MANA; tiny floor

// Crypto asset → search terms. Manifold's search is keyword-OR'd, so we
// fire several per asset to maximize coverage.
const SEARCH_TERMS: Record<string, string[]> = {
  BTC: ['bitcoin', 'btc'],
  ETH: ['ethereum', 'ether '],
  SOL: ['solana', 'sol price'],
  XRP: ['xrp', 'ripple'],
  DOGE: ['dogecoin', 'doge'],
  ADA: ['cardano', 'ada price'],
  AVAX: ['avalanche', 'avax'],
  MATIC: ['polygon', 'matic'],
  LINK: ['chainlink', 'link'],
};

interface ManifoldMarket {
  id: string;
  question: string;
  slug: string;
  url: string;
  outcomeType?: string;                       // BINARY | MULTI_NUMERIC | …
  probability?: number;                       // 0-1 for binary
  totalLiquidity?: number;
  volume?: number;
  volume24Hours?: number;
  isResolved?: boolean;
  closeTime?: number;
  uniqueBettorCount?: number;
  lastUpdatedTime?: number;
}

export class ManifoldMarketService {
  private static cache = new Map<string, { data: PredictionMarket[]; ts: number }>();

  /**
   * Fetch crypto-relevant prediction markets, keyed per asset.
   * Returns a flat array shaped like `PredictionMarket` (DelphiMarketService
   * compatible) so the aggregator can route by `relatedAssets`.
   */
  static async getCryptoMarkets(
    assets: string[] = ['BTC', 'ETH', 'SOL'],
  ): Promise<PredictionMarket[]> {
    const cacheKey = assets.slice().sort().join(',');
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;

    const allMarkets: PredictionMarket[] = [];
    const seenIds = new Set<string>();

    // Fan-out: each asset × ~2 search terms × one /search-markets call
    const promises: Array<Promise<ManifoldMarket[]>> = [];
    const promiseAssets: string[] = [];
    for (const rawAsset of assets) {
      const asset = rawAsset.toUpperCase();
      const terms = SEARCH_TERMS[asset];
      if (!terms) continue;
      for (const term of terms) {
        promiseAssets.push(asset);
        promises.push(this.searchMarkets(term, 10));
      }
    }

    const results = await Promise.allSettled(promises);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const asset = promiseAssets[i];
      if (r.status !== 'fulfilled') continue;
      for (const m of r.value) {
        if (seenIds.has(m.id)) continue;
        if (m.isResolved) continue;
        if (m.outcomeType !== 'BINARY') continue;       // skip multi-numeric / multi-choice
        if (typeof m.probability !== 'number') continue;
        if ((m.volume24Hours ?? 0) < MIN_VOLUME_24H && (m.uniqueBettorCount ?? 0) < 5) continue;
        if (m.closeTime && m.closeTime < Date.now()) continue;
        seenIds.add(m.id);

        const probPct = Math.round(m.probability * 1000) / 10;        // 0-100, 1 decimal
        const confidence = Math.min(
          90,
          30 + Math.log10(Math.max(m.volume24Hours ?? 1, 1)) * 15
            + Math.min((m.uniqueBettorCount ?? 0) * 1.5, 30),
        );
        // Map to PredictionMarket schema (compatible with DelphiMarketService)
        allMarkets.push({
          id: `manifold-${m.id}`,
          question: m.question,
          category: 'price',
          probability: probPct,
          volume: this.fmtVolume(m.volume24Hours ?? m.volume ?? 0),
          impact: this.classifyImpact(m.volume24Hours ?? 0, m.uniqueBettorCount ?? 0),
          relatedAssets: [asset],
          lastUpdate: m.lastUpdatedTime ?? Date.now(),
          confidence: Math.round(confidence),
          recommendation: 'MONITOR',
          source: 'manifold',
        });
      }
    }

    this.cache.set(cacheKey, { data: allMarkets, ts: Date.now() });

    logger.info('[ManifoldMarkets] fetched crypto markets', {
      assets,
      count: allMarkets.length,
      sample: allMarkets.slice(0, 3).map(m => `${m.relatedAssets[0]}: "${m.question.slice(0, 50)}…" @ ${m.probability}%`),
    });

    return allMarkets;
  }

  private static async searchMarkets(term: string, limit: number): Promise<ManifoldMarket[]> {
    const url = `${MANIFOLD_API}/search-markets?term=${encodeURIComponent(term)}&limit=${limit}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data as ManifoldMarket[] : [];
    } catch (err) {
      logger.debug('[ManifoldMarkets] search failed (graceful)', {
        term,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private static fmtVolume(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${Math.round(n)}`;
  }

  private static classifyImpact(volume: number, bettors: number): 'HIGH' | 'MODERATE' | 'LOW' {
    if (volume > 1000 || bettors > 30) return 'HIGH';
    if (volume > 200 || bettors > 10) return 'MODERATE';
    return 'LOW';
  }
}
