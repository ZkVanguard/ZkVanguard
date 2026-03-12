/**
 * Prediction Market Aggregator Service
 * 
 * Combines multiple prediction market data sources to produce
 * optimized hedge recommendations for the community pool.
 * 
 * Data Sources:
 * 1. Polymarket 5-min BTC signals (short-term sentiment)
 * 2. Crypto.com market data (real-time prices, 24h momentum)
 * 3. Delphi Digital predictions (medium-term market outlook)
 * 4. On-chain metrics (funding rates approximated from sentiment)
 * 
 * Weighting: Each source gets a confidence-weighted score
 * Final recommendation combines all signals for optimal hedging
 */

import { logger } from '@/lib/utils/logger';
import { cache } from '../utils/cache';
import type { FiveMinBTCSignal } from './Polymarket5MinService';
import type { PredictionMarket } from './DelphiMarketService';

// ─── Types ───────────────────────────────────────────────────────────

export interface PredictionSource {
  name: string;
  type: 'short_term' | 'medium_term' | 'long_term' | 'sentiment' | 'on_chain';
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number; // 0-100
  probability: number; // 0-100 for the predicted direction
  weight: number; // How much this source influences the final decision
  rawData: unknown;
  fetchedAt: number;
}

export interface AggregatedPrediction {
  /** Overall predicted direction */
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  /** Combined confidence (weighted average) */
  confidence: number;
  /** Overall probability of the predicted direction */
  probability: number;
  /** Consensus score: how aligned are sources (0-100) */
  consensus: number;
  /** Recommended hedge action */
  recommendation: 'STRONG_HEDGE_SHORT' | 'HEDGE_SHORT' | 'LIGHT_HEDGE_SHORT' | 'WAIT' | 'LIGHT_HEDGE_LONG' | 'HEDGE_LONG' | 'STRONG_HEDGE_LONG';
  /** Recommended hedge size multiplier (0.5-2.0) */
  sizeMultiplier: number;
  /** Individual source contributions */
  sources: PredictionSource[];
  /** Summary of reasoning */
  reasoning: string;
  /** When this aggregation was computed */
  timestamp: number;
}

// Cache TTL for aggregated predictions
const CACHE_KEY = 'prediction_aggregation';
const CACHE_TTL_MS = 20_000; // 20 seconds - balance freshness vs. API load

// ─── Service ─────────────────────────────────────────────────────────

export class PredictionAggregatorService {
  
  /**
   * Get aggregated prediction from all available sources
   * Uses caching to reduce API load
   */
  static async getAggregatedPrediction(): Promise<AggregatedPrediction> {
    // Check cache first
    const cached = cache.get<AggregatedPrediction>(CACHE_KEY);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached;
    }

    // Fetch from all sources in parallel
    const [
      polymarketSignal,
      delphiPredictions,
      cryptoComData,
    ] = await Promise.all([
      this.fetchPolymarketSignal(),
      this.fetchDelphiPredictions(),
      this.fetchCryptoComData(),
    ]);

    // Build source array
    const sources: PredictionSource[] = [];

    // 1. Polymarket 5-min signal (weight: 30% - real-time crowd wisdom)
    if (polymarketSignal) {
      sources.push({
        name: 'Polymarket 5-Min BTC',
        type: 'short_term',
        direction: polymarketSignal.direction,
        confidence: polymarketSignal.confidence,
        probability: polymarketSignal.direction === 'UP' 
          ? polymarketSignal.upProbability 
          : polymarketSignal.downProbability,
        weight: 0.30,
        rawData: polymarketSignal,
        fetchedAt: polymarketSignal.fetchedAt,
      });
    }

    // 2. Delphi/Crypto.com price momentum signals (weight: 25% each)
    for (const pred of delphiPredictions) {
      const isPositive = pred.probability > 50;
      sources.push({
        name: `Delphi: ${pred.question.substring(0, 40)}...`,
        type: pred.category === 'price' ? 'medium_term' : 'sentiment',
        direction: isPositive ? 'UP' : pred.probability < 45 ? 'DOWN' : 'NEUTRAL',
        confidence: pred.confidence,
        probability: pred.probability,
        weight: pred.impact === 'HIGH' ? 0.15 : pred.impact === 'MODERATE' ? 0.10 : 0.05,
        rawData: pred,
        fetchedAt: pred.lastUpdate,
      });
    }

    // 3. Crypto.com 24h data (weight: 20% - real market momentum)
    if (cryptoComData.btc) {
      const btcChange = cryptoComData.btc.change24h;
      const btcDirection: 'UP' | 'DOWN' | 'NEUTRAL' = 
        btcChange > 1 ? 'UP' : btcChange < -1 ? 'DOWN' : 'NEUTRAL';
      sources.push({
        name: 'Crypto.com BTC 24h',
        type: 'medium_term',
        direction: btcDirection,
        confidence: Math.min(50 + Math.abs(btcChange) * 10, 90),
        probability: btcChange > 0 ? 50 + Math.min(btcChange * 5, 30) : 50 + Math.max(btcChange * 5, -30),
        weight: 0.20,
        rawData: cryptoComData.btc,
        fetchedAt: Date.now(),
      });
    }

    // 4. ETH correlation signal (weight: 10%)
    if (cryptoComData.eth) {
      const ethChange = cryptoComData.eth.change24h;
      const ethDirection: 'UP' | 'DOWN' | 'NEUTRAL' = 
        ethChange > 1 ? 'UP' : ethChange < -1 ? 'DOWN' : 'NEUTRAL';
      sources.push({
        name: 'Crypto.com ETH 24h',
        type: 'medium_term',
        direction: ethDirection,
        confidence: Math.min(45 + Math.abs(ethChange) * 8, 85),
        probability: ethChange > 0 ? 50 + Math.min(ethChange * 4, 25) : 50 + Math.max(ethChange * 4, -25),
        weight: 0.10,
        rawData: cryptoComData.eth,
        fetchedAt: Date.now(),
      });
    }

    // 5. Funding rate approximation (weight: 10% - market sentiment proxy)
    const fundingSignal = this.approximateFundingRateSentiment(sources);
    if (fundingSignal) {
      sources.push(fundingSignal);
    }

    // Normalize weights
    const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);
    sources.forEach(s => { s.weight = s.weight / totalWeight; });

    // Calculate aggregated metrics
    const aggregation = this.calculateAggregation(sources);
    
    logger.info('[PredictionAggregator] Computed aggregated prediction', {
      direction: aggregation.direction,
      confidence: aggregation.confidence.toFixed(1),
      consensus: aggregation.consensus.toFixed(1),
      recommendation: aggregation.recommendation,
      sourceCount: sources.length,
    });

    // Cache result
    cache.set(CACHE_KEY, aggregation, CACHE_TTL_MS);
    
    return aggregation;
  }

  /**
   * Calculate weighted aggregation from all sources
   */
  private static calculateAggregation(sources: PredictionSource[]): AggregatedPrediction {
    if (sources.length === 0) {
      return {
        direction: 'NEUTRAL',
        confidence: 0,
        probability: 50,
        consensus: 0,
        recommendation: 'WAIT',
        sizeMultiplier: 1.0,
        sources: [],
        reasoning: 'No prediction data available',
        timestamp: Date.now(),
      };
    }

    // Calculate weighted direction score (-1 = DOWN, +1 = UP)
    let directionScore = 0;
    let totalConfidenceWeight = 0;
    let upCount = 0;
    let downCount = 0;

    for (const source of sources) {
      const dirValue = source.direction === 'UP' ? 1 : source.direction === 'DOWN' ? -1 : 0;
      const effectiveWeight = source.weight * (source.confidence / 100);
      directionScore += dirValue * effectiveWeight;
      totalConfidenceWeight += effectiveWeight;
      
      if (source.direction === 'UP') upCount++;
      else if (source.direction === 'DOWN') downCount++;
    }

    // Normalize direction score
    const normalizedDirection = totalConfidenceWeight > 0 
      ? directionScore / totalConfidenceWeight 
      : 0;

    // Determine overall direction
    const direction: 'UP' | 'DOWN' | 'NEUTRAL' = 
      normalizedDirection > 0.15 ? 'UP' : 
      normalizedDirection < -0.15 ? 'DOWN' : 'NEUTRAL';

    // Calculate consensus (how aligned are sources)
    const totalSources = sources.length;
    const dominantCount = Math.max(upCount, downCount);
    const consensus = totalSources > 0 
      ? (dominantCount / totalSources) * 100 
      : 0;

    // Calculate weighted confidence
    const weightedConfidence = sources.reduce((sum, s) => 
      sum + s.confidence * s.weight, 0);

    // Calculate weighted probability
    const weightedProbability = sources.reduce((sum, s) => 
      sum + s.probability * s.weight, 0);

    // Determine recommendation based on direction + confidence + consensus
    const recommendation = this.determineRecommendation(
      direction, 
      weightedConfidence, 
      consensus, 
      Math.abs(normalizedDirection)
    );

    // Calculate size multiplier (1.0 = normal, 0.5 = small, 2.0 = large)
    const sizeMultiplier = this.calculateSizeMultiplier(
      weightedConfidence, 
      consensus, 
      Math.abs(normalizedDirection)
    );

    // Build reasoning
    const reasoning = this.buildReasoning(sources, direction, consensus, recommendation);

    return {
      direction,
      confidence: weightedConfidence,
      probability: weightedProbability,
      consensus,
      recommendation,
      sizeMultiplier,
      sources,
      reasoning,
      timestamp: Date.now(),
    };
  }

  /**
   * Determine hedge recommendation
   */
  private static determineRecommendation(
    direction: 'UP' | 'DOWN' | 'NEUTRAL',
    confidence: number,
    consensus: number,
    directionStrength: number
  ): AggregatedPrediction['recommendation'] {
    // Neutral or low confidence = wait
    if (direction === 'NEUTRAL' || confidence < 40) {
      return 'WAIT';
    }

    // Strong signals (high confidence + consensus + direction)
    const isStrong = confidence >= 70 && consensus >= 70 && directionStrength >= 0.4;
    const isMedium = confidence >= 55 && consensus >= 55;
    
    if (direction === 'DOWN') {
      if (isStrong) return 'STRONG_HEDGE_SHORT';
      if (isMedium) return 'HEDGE_SHORT';
      return 'LIGHT_HEDGE_SHORT';
    } else {
      if (isStrong) return 'STRONG_HEDGE_LONG';
      if (isMedium) return 'HEDGE_LONG';
      return 'LIGHT_HEDGE_LONG';
    }
  }

  /**
   * Calculate position size multiplier
   */
  private static calculateSizeMultiplier(
    confidence: number,
    consensus: number,
    directionStrength: number
  ): number {
    // Base: 1.0
    let multiplier = 1.0;

    // Confidence adjustment: +/- 0.3
    if (confidence >= 75) multiplier += 0.3;
    else if (confidence >= 60) multiplier += 0.15;
    else if (confidence < 45) multiplier -= 0.2;

    // Consensus adjustment: +/- 0.3
    if (consensus >= 80) multiplier += 0.3;
    else if (consensus >= 65) multiplier += 0.15;
    else if (consensus < 50) multiplier -= 0.2;

    // Direction strength adjustment: +/- 0.2
    if (directionStrength >= 0.5) multiplier += 0.2;
    else if (directionStrength < 0.2) multiplier -= 0.1;

    // Clamp to reasonable range
    return Math.max(0.5, Math.min(2.0, multiplier));
  }

  /**
   * Build human-readable reasoning
   */
  private static buildReasoning(
    sources: PredictionSource[],
    direction: 'UP' | 'DOWN' | 'NEUTRAL',
    consensus: number,
    recommendation: AggregatedPrediction['recommendation']
  ): string {
    const parts: string[] = [];

    // Direction summary
    if (direction === 'NEUTRAL') {
      parts.push('Mixed signals from prediction markets - no clear direction.');
    } else {
      const upSources = sources.filter(s => s.direction === 'UP').map(s => s.name.split(':')[0]);
      const downSources = sources.filter(s => s.direction === 'DOWN').map(s => s.name.split(':')[0]);
      
      if (direction === 'DOWN') {
        parts.push(`Bearish signals from ${downSources.length} sources (${downSources.slice(0, 3).join(', ')}).`);
      } else {
        parts.push(`Bullish signals from ${upSources.length} sources (${upSources.slice(0, 3).join(', ')}).`);
      }
    }

    // Consensus
    if (consensus >= 75) {
      parts.push('High consensus among prediction sources.');
    } else if (consensus >= 50) {
      parts.push('Moderate consensus - some disagreement between sources.');
    } else {
      parts.push('Low consensus - sources are divergent.');
    }

    // Recommendation explanation
    if (recommendation.includes('STRONG')) {
      parts.push('Strong hedge recommended due to aligned high-confidence signals.');
    } else if (recommendation === 'WAIT') {
      parts.push('Recommend waiting - signals are too weak or mixed.');
    }

    return parts.join(' ');
  }

  // ─── Data Fetchers ─────────────────────────────────────────────────

  private static async fetchPolymarketSignal(): Promise<FiveMinBTCSignal | null> {
    try {
      const { Polymarket5MinService } = await import('./Polymarket5MinService');
      return await Polymarket5MinService.getLatest5MinSignal();
    } catch (error) {
      logger.debug('[PredictionAggregator] Polymarket fetch failed', { error });
      return null;
    }
  }

  private static async fetchDelphiPredictions(): Promise<PredictionMarket[]> {
    try {
      const { DelphiMarketService } = await import('./DelphiMarketService');
      const predictions = await DelphiMarketService.getRelevantMarkets(['BTC', 'ETH', 'CRO']);
      // Only return high-impact predictions
      return predictions.filter(p => p.impact === 'HIGH' || p.impact === 'MODERATE').slice(0, 5);
    } catch (error) {
      logger.debug('[PredictionAggregator] Delphi fetch failed', { error });
      return [];
    }
  }

  private static async fetchCryptoComData(): Promise<{
    btc: { price: number; change24h: number; volume: number } | null;
    eth: { price: number; change24h: number; volume: number } | null;
  }> {
    try {
      const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) throw new Error('Crypto.com API unavailable');
      
      const data = await response.json();
      const tickers = data.result?.data || [];
      
      const btcTicker = tickers.find((t: Record<string, string>) => t.i === 'BTC_USDT');
      const ethTicker = tickers.find((t: Record<string, string>) => t.i === 'ETH_USDT');

      return {
        btc: btcTicker ? {
          price: parseFloat(btcTicker.a || '0'),
          change24h: parseFloat(btcTicker.c || '0') * 100,
          volume: parseFloat(btcTicker.v || '0') * parseFloat(btcTicker.a || '0'),
        } : null,
        eth: ethTicker ? {
          price: parseFloat(ethTicker.a || '0'),
          change24h: parseFloat(ethTicker.c || '0') * 100,
          volume: parseFloat(ethTicker.v || '0') * parseFloat(ethTicker.a || '0'),
        } : null,
      };
    } catch (error) {
      logger.debug('[PredictionAggregator] Crypto.com fetch failed', { error });
      return { btc: null, eth: null };
    }
  }

  /**
   * Approximate funding rate sentiment from existing signals
   * In a real system, this would fetch from perpetual exchanges
   */
  private static approximateFundingRateSentiment(
    existingSources: PredictionSource[]
  ): PredictionSource | null {
    if (existingSources.length < 2) return null;

    // Average direction from short-term sources
    const shortTermSources = existingSources.filter(s => s.type === 'short_term');
    if (shortTermSources.length === 0) return null;

    const avgDirection = shortTermSources.reduce((sum, s) => {
      return sum + (s.direction === 'UP' ? 1 : s.direction === 'DOWN' ? -1 : 0);
    }, 0) / shortTermSources.length;

    // Strong bullish sentiment = likely positive funding (shorts pay longs)
    // Strong bearish sentiment = likely negative funding (longs pay shorts)
    const direction: 'UP' | 'DOWN' | 'NEUTRAL' = 
      avgDirection > 0.3 ? 'UP' : avgDirection < -0.3 ? 'DOWN' : 'NEUTRAL';

    return {
      name: 'Funding Rate Proxy',
      type: 'on_chain',
      direction,
      confidence: 50 + Math.abs(avgDirection) * 30,
      probability: 50 + avgDirection * 25,
      weight: 0.10,
      rawData: { avgDirection, sourceCount: shortTermSources.length },
      fetchedAt: Date.now(),
    };
  }
}

// Export singleton getter
export function getPredictionAggregator(): typeof PredictionAggregatorService {
  return PredictionAggregatorService;
}
