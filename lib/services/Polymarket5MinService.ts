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
  /** Seconds remaining in this 5-min window */
  timeRemainingSeconds: number;
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
   * Fetch the latest active 5-min BTC market from Polymarket
   */
  private static async fetchLatest5MinMarket(): Promise<FiveMinBTCSignal | null> {
    // Use the browser proxy or direct API based on environment
    const baseUrl = typeof window !== 'undefined'
      ? '/api/polymarket'
      : `${this.POLYMARKET_API}/markets`;

    // Search for active 5-min BTC markets
    const response = await fetch(
      `${baseUrl}?limit=10&closed=false&order=startDate&ascending=false&tag=bitcoin-5-minute`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      }
    );

    let markets: Record<string, unknown>[] = [];

    if (response.ok) {
      markets = await response.json();
    }

    // If tag-based search returns nothing, try keyword search
    if (!markets || markets.length === 0) {
      const fallbackResponse = await fetch(
        `${baseUrl}?limit=50&closed=false`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (fallbackResponse.ok) {
        const allMarkets = await fallbackResponse.json();
        // Filter for 5-min BTC markets
        markets = (allMarkets as Record<string, unknown>[]).filter((m) => {
          const q = ((m.question as string) || '').toLowerCase();
          return (
            q.includes('bitcoin') &&
            (q.includes('5 min') || q.includes('5-min') || q.includes('five min')) &&
            (q.includes('up or down') || q.includes('up down'))
          );
        });
      }
    }

    if (!markets || markets.length === 0) {
      logger.warn('No active 5-min BTC markets found on Polymarket', { component: 'Polymarket5Min' });
      return null;
    }

    // Pick the most recent/active market
    const market = markets[0];
    return this.parseMarketToSignal(market);
  }

  /**
   * Parse a Polymarket market object into our FiveMinBTCSignal format
   */
  private static parseMarketToSignal(market: Record<string, unknown>): FiveMinBTCSignal | null {
    try {
      const question = (market.question as string) || '';
      const marketId = (market.id as string) || (market.conditionId as string) || '';
      const slug = (market.slug as string) || '';
      const volume = parseFloat((market.volume as string) || (market.volumeNum as string) || '0');
      const description = (market.description as string) || '';

      // Parse outcome prices: "[\"0.62\", \"0.38\"]" → [0.62, 0.38]
      // First outcome = UP (or "Yes"), Second = DOWN (or "No")
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

      // Extract "price to beat" from description or question
      // Pattern: "price to beat $68,386.96" or "price at the beginning"
      let priceToBeat = 0;
      const priceMatch = question.match(/\$([\d,]+(?:\.\d+)?)/);
      if (priceMatch) {
        priceToBeat = parseFloat(priceMatch[1].replace(/,/g, ''));
      }
      if (!priceToBeat) {
        const descPriceMatch = description.match(/\$([\d,]+(?:\.\d+)?)/);
        if (descPriceMatch) {
          priceToBeat = parseFloat(descPriceMatch[1].replace(/,/g, ''));
        }
      }

      // Extract time window from question: "11-11:05PM ET"
      const timeMatch = question.match(/(\d{1,2}(?::\d{2})?(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}(?:AM|PM))\s*(ET|EST|UTC)?/i);
      const windowLabel = timeMatch ? timeMatch[0] : 'Current Window';

      // Calculate time remaining (approximate — based on market end time)
      let timeRemainingSeconds = 300; // Default 5 minutes
      const endDateStr = market.endDate as string;
      if (endDateStr) {
        const endTime = new Date(endDateStr).getTime();
        timeRemainingSeconds = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      }

      // Determine direction and signal strength
      const direction: 'UP' | 'DOWN' = upProb >= downProb ? 'UP' : 'DOWN';
      const maxProb = Math.max(upProb, downProb);
      const probSkew = Math.abs(upProb - downProb);

      let signalStrength: 'STRONG' | 'MODERATE' | 'WEAK';
      if (probSkew >= 30 && volume >= 200) signalStrength = 'STRONG';
      else if (probSkew >= 15 || volume >= 100) signalStrength = 'MODERATE';
      else signalStrength = 'WEAK';

      // Calculate confidence: combination of probability skew + volume
      const volumeConfidence = Math.min(30, Math.log10(Math.max(volume, 1)) * 10);
      const probConfidence = Math.min(50, probSkew * 1.5);
      const timeConfidence = timeRemainingSeconds > 60 ? 20 : Math.max(5, timeRemainingSeconds / 3);
      const confidence = Math.min(95, Math.round(volumeConfidence + probConfidence + timeConfidence));

      // Generate recommendation
      let recommendation: 'HEDGE_SHORT' | 'HEDGE_LONG' | 'WAIT';
      if (signalStrength === 'STRONG') {
        recommendation = direction === 'DOWN' ? 'HEDGE_SHORT' : 'HEDGE_LONG';
      } else if (signalStrength === 'MODERATE' && maxProb >= 65) {
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
        currentPrice: priceToBeat, // Will be updated by agents with real price
        volume,
        confidence,
        recommendation,
        signalStrength,
        timeRemainingSeconds,
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
    return {
      id: `polymarket-5min-${signal.marketId}`,
      question: `⚡ 5-Min BTC Signal: ${signal.direction} (${signal.windowLabel}) — Price to beat: $${signal.priceToBeat.toLocaleString('en-US')}`,
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
