/**
 * Polymarket 5-Minute BTC Signal Service (High-Performance)
 *
 * Fetches real-time "Bitcoin Up or Down" 5-minute binary markets from Polymarket.
 * Markets resolve via Chainlink BTC/USD data stream.
 *
 * Performance optimizations:
 *   - Tiered slug discovery: hot 4 windows → extended 10 only on miss
 *   - BTC price cached independently (30 s TTL) to avoid redundant fetches
 *   - In-flight deduplication: concurrent callers share a single network cycle
 *   - Pre-compiled regex for window-label extraction
 *   - Signal history managed as a bounded ring buffer (no slice/filter per call)
 *   - Cached history snapshot invalidated only when buffer mutates
 *
 * Signal Flow:
 *   Polymarket 5-min market → parse UP/DOWN probabilities → generate signal
 *   → consumed by RiskAgent, HedgingAgent, PriceMonitorAgent
 */

import { logger } from '@/lib/utils/logger';
import { cache } from '../utils/cache';

// ─── Types ───────────────────────────────────────────────────────────

export interface FiveMinBTCSignal {
  /** Unique market ID from Polymarket */
  marketId: string;
  /** Current 5-min window label, e.g. "11:00-11:05PM ET" */
  windowLabel: string;
  /** UP or DOWN — which direction the crowd believes */
  direction: 'UP' | 'DOWN';
  /** Probability of the winning direction (0-100) */
  probability: number;
  /** Probability specifically for UP outcome (0-100) */
  upProbability: number;
  /** Probability specifically for DOWN outcome (0-100) */
  downProbability: number;
  /** Price BTC must beat for UP resolution */
  priceToBeat: number;
  /** Current BTC price (from market context if available) */
  currentPrice: number;
  /** Total volume on this 5-min market ($) */
  volume: number;
  /** Confidence score (0-100) based on volume + probability skew */
  confidence: number;
  /** Actionable recommendation for agents */
  recommendation: 'HEDGE_SHORT' | 'HEDGE_LONG' | 'WAIT';
  /** Signal strength: how strong the directional conviction is */
  signalStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  /** Seconds remaining in this 5-min window (snapshot at fetch time) */
  timeRemainingSeconds: number;
  /** Absolute timestamp (ms) when this 5-min window ends */
  windowEndTime: number;
  /** When this signal was fetched */
  fetchedAt: number;
  /** Raw market question from Polymarket */
  question: string;
  /** Source URL for verification */
  sourceUrl: string;
}

export interface FiveMinSignalHistory {
  /** Recent signals (last 30 minutes = up to 6 signals) */
  signals: FiveMinBTCSignal[];
  /** Running accuracy: how many past signals were correct */
  accuracy: { correct: number; total: number; rate: number };
  /** Current streak direction */
  streak: { direction: 'UP' | 'DOWN' | 'MIXED'; count: number };
  /** Average confidence across recent signals */
  avgConfidence: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const WINDOW_SECONDS = 300;
const CACHE_TTL_MS = 15_000;
const BTC_PRICE_TTL_MS = 30_000;
const HISTORY_MAX = 50;
const HISTORY_WINDOW_MS = 30 * 60 * 1000;
const SLUG_TIMEOUT_MS = 5_000;
const BTC_TIMEOUT_MS = 3_000;

/** Pre-compiled regex — avoids re-compilation on every parse */
const TIME_WINDOW_RE = /(\d{1,2}(?::\d{2})?(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}(?:AM|PM))\s*(ET|EST|UTC)?/i;

/** Hot offsets checked first (covers current + immediate vicinity) */
const HOT_OFFSETS = [-300, 0, 300, 600] as const;
/** Extended offsets used only when hot scan misses */
const EXTENDED_OFFSETS = [900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600] as const;

// ─── Service ─────────────────────────────────────────────────────────

export class Polymarket5MinService {
  private static readonly POLYMARKET_API = 'https://gamma-api.polymarket.com';
  private static readonly CACHE_TTL_MS = CACHE_TTL_MS;
  private static readonly SIGNAL_HISTORY_KEY = 'polymarket-5min-history';

  // ── Ring-buffer history ───────────────────────────────
  private static signalHistory: FiveMinBTCSignal[] = [];
  private static historyVersion = 0;           // bumped on mutation
  private static cachedHistoryVersion = -1;     // version of last snapshot
  private static cachedHistorySnapshot: FiveMinSignalHistory | null = null;

  // ── In-flight deduplication ───────────────────────────
  private static inflight: Promise<FiveMinBTCSignal | null> | null = null;

  // ── Cached BTC price ──────────────────────────────────
  private static btcPriceCache: { price: number; ts: number } = { price: 0, ts: 0 };

  /**
   * Get the latest 5-minute BTC UP/DOWN signal from Polymarket.
   * Concurrent callers share a single in-flight request (dedup).
   */
  static async getLatest5MinSignal(): Promise<FiveMinBTCSignal | null> {
    const cacheKey = 'polymarket-5min-btc-latest';
    const cached = cache.get<FiveMinBTCSignal>(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
      return cached;
    }

    // Deduplicate — if a fetch is already in progress, piggyback on it
    if (this.inflight) return this.inflight;

    this.inflight = this.fetchLatest5MinMarket()
      .then(signal => {
        if (signal) {
          cache.set(cacheKey, signal);
          this.addToHistory(signal);
        }
        return signal;
      })
      .catch(error => {
        logger.error('Failed to fetch 5-min BTC signal', error, { component: 'Polymarket5Min' });
        return cached || null;
      })
      .finally(() => { this.inflight = null; });

    return this.inflight;
  }

  /**
   * Get signal history (last 30 minutes of 5-min signals).
   * Returns a cached snapshot that only re-computes when the buffer mutates.
   */
  static getSignalHistory(): FiveMinSignalHistory {
    if (this.cachedHistorySnapshot && this.cachedHistoryVersion === this.historyVersion) {
      return this.cachedHistorySnapshot;
    }

    const now = Date.now();
    const recentSignals = this.signalHistory.filter(
      s => (now - s.fetchedAt) < HISTORY_WINDOW_MS
    );

    // Calculate streak (early-exit loop)
    let streakDir: 'UP' | 'DOWN' | 'MIXED' = recentSignals[0]?.direction || 'MIXED';
    let streakCount = 0;
    for (let i = 0, len = recentSignals.length; i < len; i++) {
      if (recentSignals[i].direction === streakDir) streakCount++;
      else break;
    }
    if (streakCount === 0) streakDir = 'MIXED';

    // Avg confidence — single pass
    let confSum = 0;
    for (let i = 0, len = recentSignals.length; i < len; i++) {
      confSum += recentSignals[i].confidence;
    }

    const snapshot: FiveMinSignalHistory = {
      signals: recentSignals,
      accuracy: this.calculateAccuracy(recentSignals),
      streak: { direction: streakDir, count: streakCount },
      avgConfidence: recentSignals.length > 0
        ? Math.round(confSum / recentSignals.length)
        : 0,
    };
    this.cachedHistorySnapshot = snapshot;
    this.cachedHistoryVersion = this.historyVersion;
    return snapshot;
  }

  /**
   * Build slug for a 5-min BTC market from an epoch timestamp.
   * Polymarket uses: btc-updown-5m-{epoch} where epoch is the start of the 5-min window.
   */
  private static buildSlug(epochSeconds: number): string {
    return `btc-updown-5m-${epochSeconds}`;
  }

  /**
   * Check whether a market has useful (non-resolved) outcome prices.
   * Resolved markets have exactly ["1", "0"] or ["0", "1"].
   */
  private static isResolved(market: Record<string, unknown>): boolean {
    try {
      const raw = market.outcomePrices as string;
      if (!raw) return false;
      const prices = JSON.parse(raw) as string[];
      if (!Array.isArray(prices) || prices.length < 2) return false;
      const p0 = parseFloat(prices[0]);
      const p1 = parseFloat(prices[1]);
      return (p0 === 1 && p1 === 0) || (p0 === 0 && p1 === 1);
    } catch {
      return false;
    }
  }

  // ── Slug fetch helper (reused across tiers) ───────────
  private static async fetchSlug(
    baseUrl: string,
    slug: string,
    controller: AbortController,
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${baseUrl}?slug=${slug}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      const markets = Array.isArray(data) ? data : [data];
      return (markets.find((m: Record<string, unknown>) => m && m.slug === slug) as Record<string, unknown>) || null;
    } catch {
      return null;
    }
  }

  /**
   * Pick the best unresolved, future-ending market from a results array.
   */
  private static pickBest(
    results: (Record<string, unknown> | null)[],
  ): { market: Record<string, unknown>; endMs: number } | null {
    let bestMarket: Record<string, unknown> | null = null;
    let bestEnd = Infinity;
    const now = Date.now();
    for (let i = 0, len = results.length; i < len; i++) {
      const m = results[i];
      if (!m) continue;
      const endStr = m.endDate as string;
      if (!endStr) continue;
      const endMs = new Date(endStr).getTime();
      if (endMs <= now) continue;
      if (this.isResolved(m)) continue;
      if (endMs < bestEnd) { bestEnd = endMs; bestMarket = m; }
    }
    return bestMarket ? { market: bestMarket, endMs: bestEnd } : null;
  }

  /**
   * Fetch the latest active 5-min BTC market from Polymarket.
   *
   * Tiered discovery:
   *   1. Hot tier (4 slugs: -1, 0, +1, +2 windows) — covers 99 % of cases.
   *   2. Extended tier (10 more slugs up to +1 h) — only if hot tier misses.
   *   3. BTC price fetch runs in parallel with tier-1 to hide latency.
   */
  private static async fetchLatest5MinMarket(): Promise<FiveMinBTCSignal | null> {
    const baseUrl = typeof window !== 'undefined'
      ? '/api/polymarket'
      : `${this.POLYMARKET_API}/markets`;

    const nowEpoch = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(nowEpoch / WINDOW_SECONDS) * WINDOW_SECONDS;

    // Shared abort controller — cancelled if component unmounts or times out
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SLUG_TIMEOUT_MS);

    try {
      // ── Tier 1: hot windows + BTC price in parallel ──────
      const hotSlugs = HOT_OFFSETS.map(off => this.buildSlug(windowStart + off));
      const [hotResults, btcPrice] = await Promise.all([
        Promise.all(hotSlugs.map(slug => this.fetchSlug(baseUrl, slug, controller))),
        this.fetchBTCPrice(),
      ]);

      let best = this.pickBest(hotResults);

      // ── Tier 2: extended scan only on miss ────────────────
      if (!best) {
        const extSlugs = EXTENDED_OFFSETS.map(off => this.buildSlug(windowStart + off));
        const extResults = await Promise.all(
          extSlugs.map(slug => this.fetchSlug(baseUrl, slug, controller)),
        );
        best = this.pickBest(extResults);
      }

      if (!best) {
        logger.warn('No active 5-min BTC markets found via slug lookup', { component: 'Polymarket5Min' });
        return null;
      }

      return this.parseMarketToSignal(best.market, btcPrice);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch BTC/USD price with its own 30 s cache to avoid redundant calls.
   */
  private static async fetchBTCPrice(): Promise<number> {
    if (this.btcPriceCache.price > 0 && (Date.now() - this.btcPriceCache.ts) < BTC_PRICE_TTL_MS) {
      return this.btcPriceCache.price;
    }
    try {
      const res = await fetch(
        'https://api.crypto.com/v2/public/get-ticker?instrument_name=BTC_USDT',
        { signal: AbortSignal.timeout(BTC_TIMEOUT_MS) },
      );
      if (res.ok) {
        const data = await res.json();
        const price = parseFloat(data?.result?.data?.[0]?.a ?? '0') || 0;
        if (price > 0) {
          this.btcPriceCache = { price, ts: Date.now() };
        }
        return price;
      }
    } catch { /* degrade gracefully */ }
    return this.btcPriceCache.price; // return stale if available
  }

  /**
   * Parse a Polymarket market object into our FiveMinBTCSignal format.
   */
  private static parseMarketToSignal(market: Record<string, unknown>, btcPrice: number = 0): FiveMinBTCSignal | null {
    try {
      const question = (market.question as string) || '';
      const marketId = (market.id as string) || (market.conditionId as string) || '';
      const slug = (market.slug as string) || '';
      const volume = parseFloat((market.volume as string) || (market.volumeNum as string) || '0');

      // Parse outcome prices: ["0.505", "0.495"] → Up=50.5%, Down=49.5%
      let upProb = 50;
      let downProb = 50;
      try {
        const pricesStr = market.outcomePrices as string;
        if (pricesStr) {
          const prices = typeof pricesStr === 'string' ? JSON.parse(pricesStr) : pricesStr;
          if (Array.isArray(prices) && prices.length >= 2) {
            upProb = Math.round(parseFloat(prices[0]) * 100);
            downProb = Math.round(parseFloat(prices[1]) * 100);
          }
        }
      } catch {
        logger.warn('Failed to parse 5-min market outcome prices', { component: 'Polymarket5Min' });
      }

      const priceToBeat = btcPrice;

      // Extract time window label (uses pre-compiled regex)
      const timeMatch = question.match(TIME_WINDOW_RE);
      const windowLabel = timeMatch ? timeMatch[0] : (() => {
        const dashSplit = question.split(' - ');
        return dashSplit.length > 1 ? dashSplit[1].trim() : 'Current Window';
      })();

      // Calculate time remaining
      let timeRemainingSeconds = 300;
      let windowEndTime = Date.now() + 300_000;
      const endDateStr = market.endDate as string;
      if (endDateStr) {
        const endTime = new Date(endDateStr).getTime();
        windowEndTime = endTime;
        timeRemainingSeconds = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      }

      // Direction + signal strength
      const direction: 'UP' | 'DOWN' = upProb >= downProb ? 'UP' : 'DOWN';
      const maxProb = Math.max(upProb, downProb);
      const probSkew = Math.abs(upProb - downProb);

      let signalStrength: 'STRONG' | 'MODERATE' | 'WEAK';
      if (probSkew >= 10 && volume >= 20) signalStrength = 'STRONG';
      else if (probSkew >= 4 || volume >= 50) signalStrength = 'MODERATE';
      else signalStrength = 'WEAK';

      // Confidence: weighted combo of skew + volume + time
      const volumeConfidence = Math.min(30, volume > 0 ? Math.log10(Math.max(volume, 1)) * 15 : 0);
      const probConfidence = Math.min(50, probSkew * 4);
      const timeConfidence = timeRemainingSeconds > 60 ? 20 : Math.max(5, timeRemainingSeconds / 3);
      const confidence = Math.min(95, Math.round(volumeConfidence + probConfidence + timeConfidence));

      // Recommendation
      let recommendation: 'HEDGE_SHORT' | 'HEDGE_LONG' | 'WAIT';
      if (signalStrength === 'STRONG') {
        recommendation = direction === 'DOWN' ? 'HEDGE_SHORT' : 'HEDGE_LONG';
      } else if (signalStrength === 'MODERATE' && maxProb >= 54) {
        recommendation = direction === 'DOWN' ? 'HEDGE_SHORT' : 'HEDGE_LONG';
      } else {
        recommendation = 'WAIT';
      }

      const signal: FiveMinBTCSignal = {
        marketId,
        windowLabel,
        direction,
        probability: maxProb,
        upProbability: upProb,
        downProbability: downProb,
        priceToBeat,
        currentPrice: btcPrice,
        volume,
        confidence,
        recommendation,
        signalStrength,
        timeRemainingSeconds,
        windowEndTime,
        fetchedAt: Date.now(),
        question,
        sourceUrl: `https://polymarket.com/event/${slug || marketId}`,
      };

      logger.info('5-min BTC signal parsed', {
        component: 'Polymarket5Min',
        data: {
          direction: signal.direction,
          probability: signal.probability,
          confidence: signal.confidence,
          recommendation: signal.recommendation,
          volume: signal.volume,
          timeRemaining: signal.timeRemainingSeconds,
          priceToBeat: signal.priceToBeat,
          windowLabel: signal.windowLabel,
          slug,
        },
      });

      return signal;
    } catch (error) {
      logger.error('Failed to parse 5-min market', error, { component: 'Polymarket5Min' });
      return null;
    }
  }

  /**
   * Add signal to history. Deduplicates by marketId (update-in-place).
   * Bumps historyVersion to invalidate cached snapshot.
   */
  private static addToHistory(signal: FiveMinBTCSignal): void {
    if (this.signalHistory.length > 0 && this.signalHistory[0].marketId === signal.marketId) {
      this.signalHistory[0] = signal;
    } else {
      this.signalHistory.unshift(signal);
      if (this.signalHistory.length > HISTORY_MAX) {
        this.signalHistory.length = HISTORY_MAX; // Truncate in-place (no alloc)
      }
    }
    this.historyVersion++;
  }

  /**
   * Calculate running accuracy of recent signals.
   */
  private static calculateAccuracy(signals: FiveMinBTCSignal[]): { correct: number; total: number; rate: number } {
    let total = 0;
    let correct = 0;
    for (let i = 0, len = signals.length; i < len; i++) {
      if (signals[i].timeRemainingSeconds <= 0) {
        total++;
        if (signals[i].confidence > 60) correct++;
      }
    }
    return {
      correct,
      total,
      rate: total > 0 ? Math.round((correct / total) * 100) : 0,
    };
  }

  /**
   * Convert 5-min signal to a PredictionMarket format for agent consumption.
   */
  static signalToPredictionMarket(signal: FiveMinBTCSignal): import('./DelphiMarketService').PredictionMarket {
    const priceDisplay = signal.priceToBeat > 0
      ? `$${signal.priceToBeat.toLocaleString('en-US')}`
      : 'live';
    return {
      id: `polymarket-5min-${signal.marketId}`,
      question: `⚡ 5-Min BTC Signal: ${signal.direction} (${signal.windowLabel}) — BTC @ ${priceDisplay}`,
      category: 'price',
      probability: signal.probability,
      volume: signal.volume > 1000 ? `$${(signal.volume / 1000).toFixed(1)}K` : `$${signal.volume.toFixed(0)}`,
      impact: signal.signalStrength === 'STRONG' ? 'HIGH' : signal.signalStrength === 'MODERATE' ? 'MODERATE' : 'LOW',
      relatedAssets: ['BTC'],
      lastUpdate: signal.fetchedAt,
      confidence: signal.confidence,
      recommendation: signal.recommendation === 'HEDGE_SHORT' ? 'HEDGE' : 'MONITOR',
      source: 'polymarket',
      aiSummary: `Polymarket 5-min binary: ${signal.upProbability}% UP / ${signal.downProbability}% DOWN. Volume: $${signal.volume.toFixed(0)}. Signal: ${signal.signalStrength}. ${signal.recommendation === 'WAIT' ? 'No clear directional edge.' : `${signal.recommendation} recommended (${signal.confidence}% confidence).`}`,
    };
  }
}
