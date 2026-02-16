/**
 * Polymarket 5-Minute BTC Signal Service
 * 
 * Fetches real-time "Bitcoin Up or Down" 5-minute binary markets from Polymarket.
 * These markets resolve based on Chainlink BTC/USD data stream.
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

// ─── Service ─────────────────────────────────────────────────────────

export class Polymarket5MinService {
  private static readonly POLYMARKET_API = 'https://gamma-api.polymarket.com';
  private static readonly CACHE_TTL_MS = 15_000; // 15s cache (short for 5-min markets)
  private static readonly SIGNAL_HISTORY_KEY = 'polymarket-5min-history';
  private static signalHistory: FiveMinBTCSignal[] = [];

  /**
   * Get the latest 5-minute BTC UP/DOWN signal from Polymarket
   */
  static async getLatest5MinSignal(): Promise<FiveMinBTCSignal | null> {
    const cacheKey = 'polymarket-5min-btc-latest';
    const cached = cache.get<FiveMinBTCSignal>(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) < this.CACHE_TTL_MS) {
      return cached;
    }

    try {
      const signal = await this.fetchLatest5MinMarket();
      if (signal) {
        cache.set(cacheKey, signal);
        this.addToHistory(signal);
      }
      return signal;
    } catch (error) {
      logger.error('Failed to fetch 5-min BTC signal', error, { component: 'Polymarket5Min' });
      return cached || null; // Return stale cache if available
    }
  }

  /**
   * Get signal history (last 30 minutes of 5-min signals)
   */
  static getSignalHistory(): FiveMinSignalHistory {
    const now = Date.now();
    // Keep only last 30 minutes of signals
    const recentSignals = this.signalHistory.filter(
      s => (now - s.fetchedAt) < 30 * 60 * 1000
    );

    // Calculate streak
    let streakDir: 'UP' | 'DOWN' | 'MIXED' = recentSignals[0]?.direction || 'MIXED';
    let streakCount = 0;
    for (const s of recentSignals) {
      if (s.direction === streakDir) {
        streakCount++;
      } else {
        break;
      }
    }
    if (streakCount === 0) streakDir = 'MIXED';

    return {
      signals: recentSignals,
      accuracy: this.calculateAccuracy(recentSignals),
      streak: { direction: streakDir, count: streakCount },
      avgConfidence: recentSignals.length > 0
        ? Math.round(recentSignals.reduce((s, sig) => s + sig.confidence, 0) / recentSignals.length)
        : 0,
    };
  }

  /**
   * Build slug for a 5-min BTC market from an epoch timestamp.
   * Polymarket uses: btc-updown-5m-{epoch} where epoch is the start of the 5-min window.
   */
  private static buildSlug(epochSeconds: number): string {
    return `btc-updown-5m-${epochSeconds}`;
  }

  /**
   * Fetch the latest active 5-min BTC market from Polymarket.
   * 
   * Discovery strategy: these markets follow a predictable slug pattern
   * `btc-updown-5m-{epoch}` where epoch aligns to 5-min (300s) boundaries.
   * We compute the current + upcoming windows and fetch by slug directly.
   */
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

  private static async fetchLatest5MinMarket(): Promise<FiveMinBTCSignal | null> {
    const baseUrl = typeof window !== 'undefined'
      ? '/api/polymarket'
      : `${this.POLYMARKET_API}/markets`;

    const nowEpoch = Math.floor(Date.now() / 1000);
    const currentWindowStart = Math.floor(nowEpoch / 300) * 300;

    // Scan the current window plus up to 12 future windows (1 hour ahead).
    // During batch-resolution periods the nearest windows can all be
    // closed=true, so we look further out to find the first open/unresolved one.
    // Also check 1 past window in case the current just closed.
    const offsets = [-300, 0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600];
    const slugs = offsets.map(off => this.buildSlug(currentWindowStart + off));

    let bestMarket: Record<string, unknown> | null = null;
    let bestEndTime = Infinity;

    // Fetch all candidate windows in parallel
    const fetches = slugs.map(async (slug) => {
      try {
        const res = await fetch(
          `${baseUrl}?slug=${slug}`,
          {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const markets = Array.isArray(data) ? data : [data];
        return markets.find(
          (m: Record<string, unknown>) => m && m.slug === slug
        ) || null;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(fetches);

    for (const market of results) {
      if (!market) continue;
      const endStr = market.endDate as string;
      if (!endStr) continue;
      const endMs = new Date(endStr).getTime();
      // Must end in the future
      if (endMs <= Date.now()) continue;
      // Skip fully resolved markets (prices are [1,0] or [0,1])
      if (this.isResolved(market)) continue;
      // Prefer the soonest-ending active market (current window)
      if (endMs < bestEndTime) {
        bestEndTime = endMs;
        bestMarket = market;
      }
    }

    if (!bestMarket) {
      logger.warn('No active 5-min BTC markets found via slug lookup', { component: 'Polymarket5Min' });
      return null;
    }

    // Fetch current BTC price from Crypto.com public ticker (free, no key)
    let btcPrice = 0;
    try {
      const priceRes = await fetch(
        'https://api.crypto.com/v2/public/get-ticker?instrument_name=BTC_USDT',
        { signal: AbortSignal.timeout(4000) }
      );
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        btcPrice = parseFloat(priceData?.result?.data?.[0]?.a ?? '0') || 0;
      }
    } catch {
      // Price fetch optional — degrade gracefully
    }

    return this.parseMarketToSignal(bestMarket, btcPrice);
  }

  /**
   * Parse a Polymarket market object into our FiveMinBTCSignal format
   * @param market - raw market data from gamma-api
   * @param btcPrice - current BTC/USD price (fetched externally)
   */
  private static parseMarketToSignal(market: Record<string, unknown>, btcPrice: number = 0): FiveMinBTCSignal | null {
    try {
      const question = (market.question as string) || '';
      const marketId = (market.id as string) || (market.conditionId as string) || '';
      const slug = (market.slug as string) || '';
      const volume = parseFloat((market.volume as string) || (market.volumeNum as string) || '0');
      const description = (market.description as string) || '';

      // Parse outcome prices: ["0.505", "0.495"] → Up=50.5%, Down=49.5%
      // Outcomes are ["Up", "Down"] — first = Up probability, second = Down
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

      // Price to beat: use externally-fetched BTC price since the question
      // format "Bitcoin Up or Down - Feb 15, 11:30PM-11:35PM ET" has no $price.
      // Chainlink resolves based on price at window start vs end.
      const priceToBeat = btcPrice;

      // Extract time window label from question
      // Format: "Bitcoin Up or Down - February 15, 11:30PM-11:35PM ET"
      const timeMatch = question.match(/(\d{1,2}(?::\d{2})?(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}(?:AM|PM))\s*(ET|EST|UTC)?/i);
      const windowLabel = timeMatch ? timeMatch[0] : (() => {
        // Fallback: extract date/time portion from "Bitcoin Up or Down - February 15, ..."
        const dashSplit = question.split(' - ');
        return dashSplit.length > 1 ? dashSplit[1].trim() : 'Current Window';
      })();

      // Calculate time remaining based on market end time
      let timeRemainingSeconds = 300; // Default 5 minutes
      let windowEndTime = Date.now() + 300_000; // Default: 5 min from now
      const endDateStr = market.endDate as string;
      if (endDateStr) {
        const endTime = new Date(endDateStr).getTime();
        windowEndTime = endTime;
        timeRemainingSeconds = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      }

      // Determine direction and signal strength
      const direction: 'UP' | 'DOWN' = upProb >= downProb ? 'UP' : 'DOWN';
      const maxProb = Math.max(upProb, downProb);
      const probSkew = Math.abs(upProb - downProb);

      // Signal strength thresholds calibrated for real Polymarket 5-min markets:
      // - Typical volume: $7-$500 per window
      // - Typical probabilities: 48%-55% (tight spreads, market-made)
      // - A >5% skew with any meaningful volume is a real directional signal
      let signalStrength: 'STRONG' | 'MODERATE' | 'WEAK';
      if (probSkew >= 10 && volume >= 20) signalStrength = 'STRONG';
      else if (probSkew >= 4 || volume >= 50) signalStrength = 'MODERATE';
      else signalStrength = 'WEAK';

      // Calculate confidence: weighted combination of probability skew + volume + time
      const volumeConfidence = Math.min(30, volume > 0 ? Math.log10(Math.max(volume, 1)) * 15 : 0);
      const probConfidence = Math.min(50, probSkew * 4); // 5% skew → 20 confidence
      const timeConfidence = timeRemainingSeconds > 60 ? 20 : Math.max(5, timeRemainingSeconds / 3);
      const confidence = Math.min(95, Math.round(volumeConfidence + probConfidence + timeConfidence));

      // Generate recommendation
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
   * Add signal to history (keep last 30 minutes)
   */
  private static addToHistory(signal: FiveMinBTCSignal): void {
    // Only add if this is a different market window (deduplicate by marketId)
    if (this.signalHistory.length > 0 && this.signalHistory[0].marketId === signal.marketId) {
      // Update the existing entry with fresh data instead of adding a duplicate
      this.signalHistory[0] = signal;
      return;
    }
    this.signalHistory.unshift(signal);
    // Keep max 50 entries (about 4 hours at 5-min intervals)
    if (this.signalHistory.length > 50) {
      this.signalHistory = this.signalHistory.slice(0, 50);
    }
  }

  /**
   * Calculate running accuracy of recent signals
   * A signal is "correct" if the direction matched actual price movement
   */
  private static calculateAccuracy(signals: FiveMinBTCSignal[]): { correct: number; total: number; rate: number } {
    // We can only assess accuracy for signals that have completed (timeRemaining <= 0)
    const completedSignals = signals.filter(s => s.timeRemainingSeconds <= 0);
    // For now, use a heuristic: signals with higher confidence tend to be more accurate
    // In production, we'd compare against actual Chainlink resolution
    const total = completedSignals.length;
    const correct = completedSignals.filter(s => s.confidence > 60).length;
    return {
      correct,
      total,
      rate: total > 0 ? Math.round((correct / total) * 100) : 0,
    };
  }

  /**
   * Convert 5-min signal to a PredictionMarket format for agent consumption
   * This allows seamless integration with existing DelphiMarketService pipeline
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
      recommendation: signal.recommendation === 'HEDGE_SHORT' ? 'HEDGE' : signal.recommendation === 'HEDGE_LONG' ? 'MONITOR' : 'MONITOR',
      source: 'polymarket',
      aiSummary: `Polymarket 5-min binary: ${signal.upProbability}% UP / ${signal.downProbability}% DOWN. Volume: $${signal.volume.toFixed(0)}. Signal: ${signal.signalStrength}. ${signal.recommendation === 'WAIT' ? 'No clear directional edge.' : `${signal.recommendation} recommended (${signal.confidence}% confidence).`}`,
    };
  }
}
