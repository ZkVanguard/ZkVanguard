/**
 * Multi-Asset 5-Minute Polymarket Signal Service
 *
 * Companion to Polymarket5MinService (which is BTC-only and has live
 * subscribers — RiskAgent, HedgingAgent, PriceMonitorAgent). This service
 * adds parallel fetch for ETH, SOL, and any other 5-min "Up or Down"
 * binaries that Polymarket lists, without touching the BTC service's
 * subscriber wiring.
 *
 * Used by AIMarketIntelligence to widen the signal surface from one
 * binary to N binaries — so the SUI Community Pool's allocation/gating
 * decisions reflect cross-asset prediction sentiment instead of being
 * dominated by a single BTC market.
 *
 * Design:
 *   - Per-asset 15 s cache so repeat callers within the same window
 *     never re-fetch.
 *   - Parallel slug-and-price fetch (Promise.all) → 4 assets in one
 *     network roundtrip slot instead of 4×.
 *   - Tiered slug discovery: 4 hot windows first, 10 extended on miss.
 *   - Graceful degradation: if any one asset fails, the others still
 *     return. Failures are silent (logged at debug) — the caller gets
 *     a null entry for that asset.
 *   - No event emitter — this is a polled service, not a ticker.
 *     The existing Polymarket5MinService ticker still handles BTC
 *     direction-flip events.
 */

import { logger } from '@/lib/utils/logger';

export interface MultiAssetSignal {
  asset: string;                                  // BTC / ETH / SOL / …
  marketId: string;
  slug: string;
  windowLabel: string;
  direction: 'UP' | 'DOWN';
  probability: number;                            // % of winning direction
  upProbability: number;
  downProbability: number;
  currentPrice: number;
  priceToBeat: number;
  volume: number;
  liquidity: number;
  confidence: number;                             // 0-100
  signalStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  recommendation: 'HEDGE_SHORT' | 'HEDGE_LONG' | 'WAIT';
  timeRemainingSeconds: number;
  windowEndTime: number;
  fetchedAt: number;
  question: string;
  sourceUrl: string;
}

const WINDOW_SECONDS = 300;
const CACHE_TTL_MS = 15_000;
const SLUG_TIMEOUT_MS = 5_000;
const PRICE_TIMEOUT_MS = 3_000;
const PRICE_CACHE_TTL_MS = 30_000;

const HOT_OFFSETS = [-300, 0, 300, 600] as const;
const EXTENDED_OFFSETS = [900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600] as const;

const POLYMARKET_API = 'https://gamma-api.polymarket.com';
const TIME_WINDOW_RE = /(\d{1,2}(?::\d{2})?(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}(?:AM|PM))\s*(ET|EST|UTC)?/i;

// Discovery: matches Polymarket 5-min binary slugs like `btc-updown-5m-1782057000`.
// Captures the asset symbol (lowercase) and the window epoch separately so a
// single broad gamma query can be diff'd against our tracked-asset list.
const FIVE_MIN_SLUG_RE = /^([a-z0-9]{2,8})-updown-5m-(\d{10})$/;

/**
 * The default asset list for the SUI pool's prediction-signal aggregator.
 * Overridable via `POLYMARKET_TRACKED_ASSETS` (comma-separated, e.g.
 * "BTC,ETH,SOL,XRP,DOGE"). Keep this in sync with the assets the cron
 * actually cares about — adding too many makes each sentiment aggregation
 * pay for fetches that won't change any allocation decision.
 */
export function getTrackedAssetList(): string[] {
  const raw = (process.env.POLYMARKET_TRACKED_ASSETS || '').trim();
  if (raw) {
    return raw
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
  }
  return ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'];
}

export class MultiAssetSignalService {
  // Per-asset signal cache
  private static signalCache: Map<string, { signal: MultiAssetSignal | null; ts: number }> = new Map();
  // Per-asset price cache (shared with same-asset queries)
  private static priceCache: Map<string, { price: number; ts: number }> = new Map();

  /**
   * Fetch latest 5-min signals for all requested assets in parallel.
   * Returns a Map keyed by asset symbol (uppercased) — null entry for
   * any asset where Polymarket doesn't currently list a 5-min binary.
   */
  static async getLatestSignals(
    assets: string[] = getTrackedAssetList(),
  ): Promise<Record<string, MultiAssetSignal | null>> {
    const results = await Promise.all(
      assets.map(async (asset) => {
        const key = asset.toUpperCase();
        const cached = this.signalCache.get(key);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
          return [key, cached.signal] as const;
        }
        try {
          const signal = await this.fetchLatest5MinMarket(key);
          this.signalCache.set(key, { signal, ts: Date.now() });
          return [key, signal] as const;
        } catch (err) {
          logger.debug(`[MultiAssetSignal] ${key} signal fetch failed (graceful)`, {
            error: err instanceof Error ? err.message : String(err),
          });
          // Return cached if available, else null
          return [key, cached?.signal ?? null] as const;
        }
      }),
    );
    return Object.fromEntries(results);
  }

  /**
   * Convenience method: aggregate signals into a single net-direction
   * score across assets. Useful for the SUI cron's rebalance gating
   * which currently uses only the BTC 5-min signal directly.
   *
   * Returns weighted net sentiment: > 0 means net BULLISH, < 0 means
   * net BEARISH, magnitude is overall confidence (0-100).
   */
  static async getAggregatedSentiment(
    assets: string[] = getTrackedAssetList(),
  ): Promise<{
    netScore: number;                  // -100 (all bearish) → +100 (all bullish)
    bullishCount: number;
    bearishCount: number;
    strongCount: number;
    avgConfidence: number;
    perAsset: Record<string, MultiAssetSignal | null>;
  }> {
    const signals = await this.getLatestSignals(assets);
    let netScore = 0;
    let bullishCount = 0;
    let bearishCount = 0;
    let strongCount = 0;
    let confSum = 0;
    let confN = 0;
    for (const s of Object.values(signals)) {
      if (!s) continue;
      const conf = s.confidence;
      confSum += conf;
      confN += 1;
      if (s.signalStrength === 'STRONG') strongCount++;
      const dirSign = s.direction === 'UP' ? 1 : -1;
      if (s.direction === 'UP') bullishCount++;
      else bearishCount++;
      // Each asset contributes `dirSign × conviction` where conviction
      // is how far the binary is from 50/50.
      const conviction = Math.abs(s.probability - 50);
      netScore += dirSign * conviction;
    }
    const n = bullishCount + bearishCount || 1;
    return {
      netScore: Math.round((netScore / n) * 2),   // scale to roughly ±100
      bullishCount,
      bearishCount,
      strongCount,
      avgConfidence: confN > 0 ? confSum / confN : 0,
      perAsset: signals,
    };
  }

  // ── Discovery: surface every 5-min binary Polymarket currently lists ─

  /**
   * Discover every `*-updown-5m-{epoch}` market Polymarket has listed in
   * (and around) the current 5-min window. Returns the unique uppercase
   * asset symbols found, the raw slugs they came from, and the highest
   * 24h volume per asset so callers can prioritize what to add to the
   * tracked-asset list.
   *
   * Single broad gamma query — much cheaper than probing slugs per asset.
   * The same response covers BTC + ETH + every other binary Polymarket
   * is running this window, so we discover new listings the moment they
   * appear without burning a per-asset fetch budget.
   */
  static async discoverAvailableAssets(opts: { lookaheadWindows?: number } = {}): Promise<{
    assets: string[];
    perAsset: Record<string, { slug: string; volume24hr: number; liquidity: number; endDate?: string }>;
    fetchedAt: number;
  }> {
    const lookaheadWindows = Math.max(1, Math.min(12, opts.lookaheadWindows ?? 6));
    const nowEpoch = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(nowEpoch / WINDOW_SECONDS) * WINDOW_SECONDS;
    const windowEnd = windowStart + lookaheadWindows * WINDOW_SECONDS;

    // Gamma API supports active+order; we pull a large batch and filter
    // client-side so new asset symbols can't be missed by a stale allow-list.
    const url = `${POLYMARKET_API}/markets?active=true&closed=false&limit=500&order=volume24hr&ascending=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let raw: unknown = [];
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`gamma ${res.status}`);
      raw = await res.json();
    } catch (err) {
      logger.warn('[MultiAssetSignal] discovery fetch failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { assets: [], perAsset: {}, fetchedAt: Date.now() };
    } finally {
      clearTimeout(timeout);
    }
    const markets: Array<Record<string, unknown>> = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : Array.isArray((raw as { data?: unknown }).data)
        ? ((raw as { data: Array<Record<string, unknown>> }).data)
        : [];

    const perAsset: Record<string, { slug: string; volume24hr: number; liquidity: number; endDate?: string }> = {};
    for (const m of markets) {
      const slug = String(m.slug || '').toLowerCase();
      const match = FIVE_MIN_SLUG_RE.exec(slug);
      if (!match) continue;
      const asset = match[1].toUpperCase();
      const epoch = Number(match[2]);
      // Only count windows in or near the current one — historical resolved
      // markets are noise.
      if (epoch < windowStart - WINDOW_SECONDS || epoch > windowEnd) continue;
      if (m.closed || m.archived || m.resolved) continue;
      const vol = Number(m.volume24hr ?? m.volumeNum ?? m.volume ?? 0) || 0;
      const liq = Number(m.liquidityNum ?? m.liquidity ?? 0) || 0;
      const prev = perAsset[asset];
      if (!prev || vol > prev.volume24hr) {
        perAsset[asset] = {
          slug,
          volume24hr: vol,
          liquidity: liq,
          endDate: (m.endDate as string) || (m.endDateIso as string) || undefined,
        };
      }
    }
    return {
      assets: Object.keys(perAsset).sort(),
      perAsset,
      fetchedAt: Date.now(),
    };
  }

  // ── Internal: per-asset tiered slug discovery ─────────────────────

  private static buildSlug(epochSeconds: number, asset: string): string {
    return `${asset.toLowerCase()}-updown-5m-${epochSeconds}`;
  }

  private static async fetchSlug(
    baseUrl: string,
    slug: string,
    controller: AbortController,
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${baseUrl}?slug=${slug}`, { signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      const markets = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      return (markets.find((m: Record<string, unknown>) => m && m.slug === slug) as Record<string, unknown>) || null;
    } catch {
      return null;
    }
  }

  private static isResolved(m: Record<string, unknown>): boolean {
    return !!(m.closed || m.archived || m.resolved);
  }

  private static pickBest(
    results: Array<Record<string, unknown> | null>,
  ): { market: Record<string, unknown>; endMs: number } | null {
    const now = Date.now();
    let best: Record<string, unknown> | null = null;
    let bestEnd = Infinity;
    for (const m of results) {
      if (!m) continue;
      const endRaw = (m.endDate as string) || (m.endDateIso as string) || '';
      const endMs = endRaw ? new Date(endRaw).getTime() : 0;
      if (!endMs || endMs <= now) continue;
      if (this.isResolved(m)) continue;
      if (endMs < bestEnd) { bestEnd = endMs; best = m; }
    }
    return best ? { market: best, endMs: bestEnd } : null;
  }

  private static async fetchAssetPrice(asset: string): Promise<number> {
    const key = asset.toUpperCase();
    const cached = this.priceCache.get(key);
    if (cached && cached.price > 0 && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
      return cached.price;
    }
    try {
      const res = await fetch(`/api/prices?symbol=${key}`, {
        signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = data?.data?.price ?? data?.price ?? '0';
        const price = parseFloat(String(raw)) || 0;
        if (price > 0) {
          this.priceCache.set(key, { price, ts: Date.now() });
          return price;
        }
      }
    } catch { /* graceful */ }
    return cached?.price ?? 0;
  }

  private static async fetchLatest5MinMarket(asset: string): Promise<MultiAssetSignal | null> {
    // Browser path uses /api/polymarket to avoid CORS; server path hits gamma directly.
    const baseUrl = typeof window !== 'undefined' ? '/api/polymarket' : `${POLYMARKET_API}/markets`;
    const nowEpoch = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(nowEpoch / WINDOW_SECONDS) * WINDOW_SECONDS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SLUG_TIMEOUT_MS);

    try {
      // Tier 1: hot windows + asset price in parallel
      const hotSlugs = HOT_OFFSETS.map(off => this.buildSlug(windowStart + off, asset));
      const [hotResults, assetPrice] = await Promise.all([
        Promise.all(hotSlugs.map(slug => this.fetchSlug(baseUrl, slug, controller))),
        this.fetchAssetPrice(asset),
      ]);

      let best = this.pickBest(hotResults);

      // Tier 2: extended scan only on miss
      if (!best) {
        const extSlugs = EXTENDED_OFFSETS.map(off => this.buildSlug(windowStart + off, asset));
        const extResults = await Promise.all(
          extSlugs.map(slug => this.fetchSlug(baseUrl, slug, controller)),
        );
        best = this.pickBest(extResults);
      }

      if (!best) return null;
      return this.parseMarketToSignal(asset, best.market, assetPrice);
    } finally {
      clearTimeout(timeout);
    }
  }

  private static parseMarketToSignal(
    asset: string,
    market: Record<string, unknown>,
    assetPrice: number,
  ): MultiAssetSignal | null {
    try {
      const question = (market.question as string) || '';
      const marketId = (market.id as string) || (market.conditionId as string) || '';
      const slug = (market.slug as string) || '';
      const volume = parseFloat((market.volume as string) || (market.volumeNum as string) || '0');
      const liquidity = parseFloat((market.liquidity as string) || (market.liquidityNum as string) || '0');

      let upProb = 50;
      let downProb = 50;
      try {
        const pricesStr = market.outcomePrices as string;
        if (pricesStr) {
          const prices = typeof pricesStr === 'string' ? JSON.parse(pricesStr) : pricesStr;
          if (Array.isArray(prices) && prices.length >= 2) {
            upProb = Math.round(parseFloat(prices[0]) * 10000) / 100;
            downProb = Math.round(parseFloat(prices[1]) * 10000) / 100;
          }
        }
      } catch { /* graceful */ }

      const direction: 'UP' | 'DOWN' = upProb >= downProb ? 'UP' : 'DOWN';
      const probability = Math.max(upProb, downProb);

      // Parse "price to beat" from the question text if present
      const priceMatch = question.match(/at\s*([\d,]+(?:\.\d+)?)/i);
      const priceToBeat = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;

      // Window timing from endDate
      const endRaw = (market.endDate as string) || (market.endDateIso as string) || '';
      const windowEndTime = endRaw ? new Date(endRaw).getTime() : Date.now() + WINDOW_SECONDS * 1000;
      const timeRemainingSeconds = Math.max(0, Math.floor((windowEndTime - Date.now()) / 1000));

      // Window label
      const winMatch = question.match(TIME_WINDOW_RE);
      const windowLabel = winMatch ? `${winMatch[1]}-${winMatch[2]} ${winMatch[3] || 'ET'}` : '';

      // Signal strength & confidence: lean on probability skew + volume liquidity
      const skew = Math.abs(upProb - 50);
      const liquidityScore = Math.min(100, Math.log10(Math.max(liquidity, 100)) * 25); // 0-100
      const volumeScore = Math.min(100, Math.log10(Math.max(volume, 100)) * 25);
      const confidence = Math.round(skew * 2 + (liquidityScore + volumeScore) / 4);
      const signalStrength: 'STRONG' | 'MODERATE' | 'WEAK' =
        skew >= 15 ? 'STRONG' : skew >= 6 ? 'MODERATE' : 'WEAK';

      const recommendation: 'HEDGE_SHORT' | 'HEDGE_LONG' | 'WAIT' =
        signalStrength === 'WEAK' ? 'WAIT' : direction === 'UP' ? 'HEDGE_LONG' : 'HEDGE_SHORT';

      return {
        asset: asset.toUpperCase(),
        marketId,
        slug,
        windowLabel,
        direction,
        probability,
        upProbability: upProb,
        downProbability: downProb,
        currentPrice: assetPrice,
        priceToBeat,
        volume,
        liquidity,
        confidence: Math.max(0, Math.min(100, confidence)),
        signalStrength,
        recommendation,
        timeRemainingSeconds,
        windowEndTime,
        fetchedAt: Date.now(),
        question,
        sourceUrl: `https://polymarket.com/event/${slug || marketId}`,
      };
    } catch (err) {
      logger.debug('[MultiAssetSignal] parse failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
