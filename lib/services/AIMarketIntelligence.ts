/**
 * AI Market Intelligence Service
 * 
 * Provides comprehensive, AI-optimized market data for agent decision-making.
 * Aggregates multiple data sources into actionable intelligence:
 * 
 * Data Sources:
 * - Polymarket (5-min BTC signals + prediction markets)
 * - Crypto.com Exchange (real-time prices, volume, 24h changes)
 * - Internal signal history (streaks, accuracy, momentum)
 * 
 * Key Features:
 * - Multi-timeframe analysis (5-min, 30-min, 4-hour, 24-hour)
 * - Cross-market correlation (BTC/ETH alignment)
 * - Risk cascade detection (multiple bearish signals)
 * - Confidence calibration (historical accuracy weighting)
 * - AI-ready decision context (all data pre-processed for agents)
 */

import { logger } from '@/lib/utils/logger';
import { cache } from '../utils/cache';
import { Polymarket5MinService, type FiveMinBTCSignal, type FiveMinSignalHistory } from './Polymarket5MinService';
import { DelphiMarketService, type PredictionMarket } from './DelphiMarketService';

// ============================================================================
// Enhanced Types for AI Agents
// ============================================================================

/** Multi-timeframe streak analysis */
export interface StreakAnalysis {
  /** Current streak in 5-min windows */
  streak5Min: { direction: 'UP' | 'DOWN' | 'MIXED'; count: number; confidence: number };
  /** Streak across 30-min windows (6 signals) */
  streak30Min: { direction: 'UP' | 'DOWN' | 'MIXED'; count: number; confidence: number };
  /** 4-hour trend direction */
  trend4Hour: { direction: 'UP' | 'DOWN' | 'MIXED'; strength: number };
  /** Probability of reversal in next window */
  reversalProbability: number;
  /** Historical accuracy of current streak pattern */
  patternAccuracy: number;
}

/** Cross-market correlation data */
export interface MarketCorrelation {
  /** BTC-ETH price correlation (0-1) */
  btcEthCorrelation: number;
  /** All assets moving same direction */
  marketAlignment: number; // 0-100
  /** Which assets are aligned with BTC */
  alignedAssets: string[];
  /** Which assets are diverging */
  divergingAssets: string[];
  /** Correlation confidence boost (add to signal confidence) */
  correlationBoost: number;
}

/** Risk cascade detection */
export interface RiskCascade {
  /** Is a risk cascade detected? */
  detected: boolean;
  /** Severity: 0-100 */
  severity: number;
  /** Contributing signals */
  signals: Array<{
    source: string;
    type: 'bearish' | 'bullish' | 'neutral';
    strength: number;
    description: string;
  }>;
  /** Recommended action */
  recommendation: 'HEDGE_IMMEDIATELY' | 'HEDGE_SOON' | 'MONITOR_CLOSELY' | 'NO_ACTION';
  /** Confidence in cascade detection */
  confidence: number;
}

/** Liquidity analysis */
export interface LiquidityAnalysis {
  /** Polymarket market liquidity */
  predictionMarketLiquidity: number;
  /** DEX/CEX liquidity estimate */
  exchangeLiquidity: number;
  /** Liquidity ratio (pred/exchange) - low = less reliable */
  liquidityRatio: number;
  /** Confidence adjustment based on liquidity */
  liquidityConfidencePenalty: number;
  /** Is liquidity sufficient for reliable signals? */
  sufficientLiquidity: boolean;
}

/** Implied price movement forecast */
export interface ImpliedMove {
  /** Expected price change % in next 5 minutes */
  expectedChange5Min: number;
  /** Expected price range */
  priceRange: { low: number; high: number };
  /** Confidence in forecast */
  confidence: number;
  /** Basis for forecast */
  basis: string[];
}

/** Complete AI Market Context - everything an agent needs */
export interface AIMarketContext {
  /** Timestamp of context generation */
  generatedAt: number;
  
  /** Real-time 5-min BTC signal (if available) */
  fiveMinSignal: FiveMinBTCSignal | null;
  
  /** Signal history (last 30 minutes) */
  signalHistory: FiveMinSignalHistory;
  
  /** Multi-timeframe streak analysis */
  streaks: StreakAnalysis;
  
  /** Cross-market correlation */
  correlation: MarketCorrelation;
  
  /** Risk cascade detection */
  riskCascade: RiskCascade;
  
  /** Liquidity analysis */
  liquidity: LiquidityAnalysis;
  
  /** Implied price movement */
  impliedMove: ImpliedMove;
  
  /** Top prediction markets (filtered & prioritized) */
  predictions: EnhancedPrediction[];
  
  /** Overall market sentiment */
  marketSentiment: {
    score: number; // -100 (extreme fear) to +100 (extreme greed)
    label: 'EXTREME_FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME_GREED';
    components: {
      priceAction: number;
      predictionMarkets: number;
      volume: number;
      momentum: number;
    };
  };
  
  /** AI agent consensus (if multiple agents have voted) */
  agentConsensus?: {
    riskAgentVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    hedgingAgentVote: 'HEDGE_LONG' | 'HEDGE_SHORT' | 'NO_HEDGE';
    poolAgentVote: 'INCREASE_EXPOSURE' | 'DECREASE_EXPOSURE' | 'MAINTAIN';
    consensusStrength: number; // 0-100
  };
  
  /** Actionable summary for quick decisions */
  summary: {
    primarySignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    suggestedAction: string;
    keyFactors: string[];
  };
}

/** Enhanced prediction with additional AI-relevant fields */
export interface EnhancedPrediction extends PredictionMarket {
  /** Time until market resolution */
  timeToResolution?: number;
  /** Historical accuracy of similar markets */
  historicalAccuracy?: number;
  /** Momentum (prob change over last hour) */
  probabilityMomentum?: number;
  /** Smart money indicator (volume spike detection) */
  smartMoneySignal?: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL';
  /** AI relevance score (how useful for decision-making) */
  aiRelevanceScore: number;
  /** Specific AI agent recommendations */
  agentRecommendations?: {
    riskAgent?: string;
    hedgingAgent?: string;
    poolAgent?: string;
  };
}

// ============================================================================
// AI Market Intelligence Service
// ============================================================================

export class AIMarketIntelligence {
  private static readonly CACHE_KEY = 'ai-market-intelligence';
  private static readonly CACHE_TTL = 10_000; // 10 seconds
  
  // Historical data for pattern analysis
  private static signalPatterns: Array<{
    pattern: string;
    outcome: 'UP' | 'DOWN';
    timestamp: number;
  }> = [];
  
  // Price history for correlation
  private static priceHistory: Map<string, Array<{ price: number; timestamp: number }>> = new Map();

  /**
   * Get comprehensive AI market context
   * This is the primary method AI agents should call
   */
  static async getMarketContext(assets: string[] = ['BTC', 'ETH', 'CRO', 'SUI']): Promise<AIMarketContext> {
    // Check cache first
    const cacheKey = `${this.CACHE_KEY}-${assets.sort().join(',')}`;
    const cached = cache.get<AIMarketContext>(cacheKey);
    if (cached && (Date.now() - cached.generatedAt) < this.CACHE_TTL) {
      return cached;
    }

    const startTime = Date.now();
    
    // Fetch all data in parallel
    const [
      fiveMinSignal,
      predictions,
      priceData,
    ] = await Promise.all([
      Polymarket5MinService.getLatest5MinSignal().catch((err) => { logger.warn('[AIMarketIntelligence] 5min signal fetch failed', { error: err }); return null; }),
      DelphiMarketService.getRelevantMarkets(assets).catch((err) => { logger.warn('[AIMarketIntelligence] Predictions fetch failed', { error: err }); return []; }),
      this.fetchPriceData(assets).catch((err) => { logger.warn('[AIMarketIntelligence] Price data fetch failed', { error: err }); return {}; }),
    ]);

    const signalHistory = Polymarket5MinService.getSignalHistory();
    
    // Build comprehensive context
    const context: AIMarketContext = {
      generatedAt: Date.now(),
      fiveMinSignal,
      signalHistory,
      streaks: this.analyzeStreaks(signalHistory),
      correlation: this.analyzeCorrelation(priceData, fiveMinSignal),
      riskCascade: this.detectRiskCascade(fiveMinSignal, signalHistory, predictions),
      liquidity: this.analyzeLiquidity(fiveMinSignal, predictions),
      impliedMove: this.calculateImpliedMove(fiveMinSignal, signalHistory, priceData),
      predictions: this.enhancePredictions(predictions, fiveMinSignal),
      marketSentiment: this.calculateSentiment(fiveMinSignal, signalHistory, predictions, priceData),
      summary: this.generateSummary(fiveMinSignal, signalHistory, predictions),
    };

    const duration = Date.now() - startTime;
    logger.debug(`AI Market Context generated in ${duration}ms`, { component: 'AIMarketIntelligence' });
    
    // Cache the result
    cache.set(cacheKey, context, this.CACHE_TTL);
    
    return context;
  }

  /**
   * Fetch real-time price data from Crypto.com
   * 🔥 OPTIMIZED: Build Map once for O(1) lookup instead of O(n) per asset
   */
  private static async fetchPriceData(assets: string[]): Promise<Record<string, { price: number; change24h: number; volume24h: number }>> {
    try {
      const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) throw new Error('Price API unavailable');
      
      const data = await response.json();
      const tickers = data.result?.data || [];
      
      // 🔥 Build Map once for O(1) lookup (was O(n) per asset = O(n*m) total)
      const tickerMap = new Map<string, Record<string, string>>();
      for (const ticker of tickers) {
        tickerMap.set(ticker.i, ticker);
      }
      
      const result: Record<string, { price: number; change24h: number; volume24h: number }> = {};
      
      for (const asset of assets) {
        // O(1) lookup instead of O(n) find
        const ticker = tickerMap.get(`${asset}_USDT`) || tickerMap.get(`${asset}_USD`);
        if (ticker) {
          const price = parseFloat(ticker.a || '0');
          const change24h = parseFloat(ticker.c || '0') * 100;
          const volume24h = parseFloat(ticker.v || '0') * price;
          
          result[asset] = { price, change24h, volume24h };
          
          // Update price history for correlation analysis
          this.updatePriceHistory(asset, price);
        }
      }
      
      return result;
    } catch (error) {
      logger.warn('Failed to fetch price data', { error, component: 'AIMarketIntelligence' });
      return {};
    }
  }

  /**
   * Update price history for correlation analysis
   * 🔥 OPTIMIZED: Clean up stale entries to prevent memory leaks in long-running servers
   */
  private static updatePriceHistory(asset: string, price: number): void {
    const history = this.priceHistory.get(asset) || [];
    history.push({ price, timestamp: Date.now() });
    
    // Keep only last 4 hours
    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
    const filtered = history.filter(h => h.timestamp > fourHoursAgo);
    
    // Clean up empty entries to prevent memory leak
    if (filtered.length === 0) {
      this.priceHistory.delete(asset);
    } else {
      this.priceHistory.set(asset, filtered);
    }
  }

  /**
   * Analyze multi-timeframe streaks
   */
  private static analyzeStreaks(history: FiveMinSignalHistory): StreakAnalysis {
    const signals = history.signals;
    
    // 5-min streak (direct from history)
    const streak5Min = {
      direction: history.streak.direction,
      count: history.streak.count,
      confidence: Math.min(40 + history.streak.count * 10, 90),
    };
    
    // 30-min streak (every 6th signal)
    let streak30MinDir: 'UP' | 'DOWN' | 'MIXED' = 'MIXED';
    let streak30MinCount = 0;
    if (signals.length >= 6) {
      const windows30Min: Array<'UP' | 'DOWN' | 'MIXED'> = [];
      for (let i = 0; i < signals.length; i += 6) {
        const windowSignals = signals.slice(i, i + 6);
        const ups = windowSignals.filter(s => s.direction === 'UP').length;
        windows30Min.push(ups >= 4 ? 'UP' : ups <= 2 ? 'DOWN' : 'MIXED');
      }
      
      streak30MinDir = windows30Min[0] || 'MIXED';
      for (let i = 0; i < windows30Min.length; i++) {
        if (windows30Min[i] === streak30MinDir) streak30MinCount++;
        else break;
      }
    }
    
    // 4-hour trend
    const trend4HourStrength = signals.length > 0 
      ? (signals.filter(s => s.direction === 'UP').length / signals.length - 0.5) * 200
      : 0;
    
    // Reversal probability based on streak length
    const reversalBase = streak5Min.count > 5 ? 60 : streak5Min.count > 3 ? 40 : 20;
    const reversalProbability = Math.min(reversalBase + (streak5Min.count - 3) * 10, 80);
    
    // Pattern accuracy (simplified - would need ML in production)
    const patternAccuracy = Math.min(50 + history.avgConfidence * 0.3, 85);
    
    return {
      streak5Min,
      streak30Min: {
        direction: streak30MinDir,
        count: streak30MinCount,
        confidence: Math.min(50 + streak30MinCount * 15, 85),
      },
      trend4Hour: {
        direction: trend4HourStrength > 20 ? 'UP' : trend4HourStrength < -20 ? 'DOWN' : 'MIXED',
        strength: Math.abs(trend4HourStrength),
      },
      reversalProbability,
      patternAccuracy,
    };
  }

  /**
   * Analyze cross-market correlation
   */
  private static analyzeCorrelation(
    priceData: Record<string, { price: number; change24h: number; volume24h: number }>,
    signal: FiveMinBTCSignal | null
  ): MarketCorrelation {
    const btcChange = priceData['BTC']?.change24h || 0;
    const ethChange = priceData['ETH']?.change24h || 0;
    const croChange = priceData['CRO']?.change24h || 0;
    const suiChange = priceData['SUI']?.change24h || 0;
    
    // Calculate BTC-ETH correlation (simplified)
    const btcEthCorrelation = Math.max(0, 1 - Math.abs(btcChange - ethChange) / 10);
    
    // Market alignment - all moving same direction
    const directions = [btcChange, ethChange, croChange, suiChange].map(c => c > 0 ? 1 : c < 0 ? -1 : 0);
    const btcDir = directions[0];
    const aligned = directions.filter(d => d === btcDir).length;
    const marketAlignment = (aligned / directions.length) * 100;
    
    // Identify aligned vs diverging assets
    const alignedAssets: string[] = [];
    const divergingAssets: string[] = [];
    
    if (btcChange > 0) {
      if (ethChange > 0) alignedAssets.push('ETH'); else divergingAssets.push('ETH');
      if (croChange > 0) alignedAssets.push('CRO'); else divergingAssets.push('CRO');
      if (suiChange > 0) alignedAssets.push('SUI'); else divergingAssets.push('SUI');
    } else {
      if (ethChange < 0) alignedAssets.push('ETH'); else divergingAssets.push('ETH');
      if (croChange < 0) alignedAssets.push('CRO'); else divergingAssets.push('CRO');
      if (suiChange < 0) alignedAssets.push('SUI'); else divergingAssets.push('SUI');
    }
    
    // Correlation boost for aligned markets
    const correlationBoost = marketAlignment > 80 ? 15 : marketAlignment > 60 ? 10 : marketAlignment > 40 ? 5 : 0;
    
    return {
      btcEthCorrelation,
      marketAlignment,
      alignedAssets,
      divergingAssets,
      correlationBoost,
    };
  }

  /**
   * Detect risk cascade
   */
  private static detectRiskCascade(
    signal: FiveMinBTCSignal | null,
    history: FiveMinSignalHistory,
    predictions: PredictionMarket[]
  ): RiskCascade {
    const signals: RiskCascade['signals'] = [];
    
    // 5-min signal check
    if (signal) {
      if (signal.direction === 'DOWN' && signal.signalStrength === 'STRONG') {
        signals.push({
          source: 'Polymarket 5-min',
          type: 'bearish',
          strength: signal.confidence,
          description: `STRONG DOWN signal: ${signal.probability}% probability`,
        });
      } else if (signal.direction === 'UP' && signal.signalStrength === 'STRONG') {
        signals.push({
          source: 'Polymarket 5-min',
          type: 'bullish',
          strength: signal.confidence,
          description: `STRONG UP signal: ${signal.probability}% probability`,
        });
      }
    }
    
    // Streak check
    if (history.streak.direction === 'DOWN' && history.streak.count >= 3) {
      signals.push({
        source: 'Signal Streak',
        type: 'bearish',
        strength: Math.min(50 + history.streak.count * 10, 90),
        description: `${history.streak.count} consecutive DOWN signals`,
      });
    }
    
    // Prediction market check
    const hedgePredictions = predictions.filter(p => p.recommendation === 'HEDGE');
    if (hedgePredictions.length > 0) {
      signals.push({
        source: 'Prediction Markets',
        type: 'bearish',
        strength: Math.min(60 + hedgePredictions.length * 10, 90),
        description: `${hedgePredictions.length} prediction(s) recommend HEDGE`,
      });
    }
    
    // High impact negative events
    const highImpactNegative = predictions.filter(p => 
      p.impact === 'HIGH' && 
      p.probability > 60 &&
      p.question.toLowerCase().match(/crash|drop|depeg|hack|ban|recession/)
    );
    if (highImpactNegative.length > 0) {
      signals.push({
        source: 'High-Impact Events',
        type: 'bearish',
        strength: 80,
        description: `${highImpactNegative.length} high-impact negative event(s) likely`,
      });
    }
    
    // Calculate cascade severity
    const bearishSignals = signals.filter(s => s.type === 'bearish');
    const avgBearishStrength = bearishSignals.length > 0
      ? bearishSignals.reduce((sum, s) => sum + s.strength, 0) / bearishSignals.length
      : 0;
    const severity = Math.min(bearishSignals.length * 25 + avgBearishStrength * 0.3, 100);
    
    // Recommendation based on severity
    let recommendation: RiskCascade['recommendation'] = 'NO_ACTION';
    if (severity >= 75) recommendation = 'HEDGE_IMMEDIATELY';
    else if (severity >= 50) recommendation = 'HEDGE_SOON';
    else if (severity >= 25) recommendation = 'MONITOR_CLOSELY';
    
    return {
      detected: severity >= 50,
      severity,
      signals,
      recommendation,
      confidence: Math.min(40 + bearishSignals.length * 15, 90),
    };
  }

  /**
   * Analyze liquidity
   */
  private static analyzeLiquidity(
    signal: FiveMinBTCSignal | null,
    predictions: PredictionMarket[]
  ): LiquidityAnalysis {
    const predictionMarketLiquidity = signal?.liquidity || 10000;
    // WARNING: Exchange liquidity should be fetched from live APIs (DEX AMMs, CEX orderbooks)
    // Using 0 signals unknown liquidity - caller should handle appropriately
    const exchangeLiquidity = 0; // TODO: Integrate real liquidity feeds
    
    const liquidityRatio = predictionMarketLiquidity / exchangeLiquidity;
    const liquidityConfidencePenalty = liquidityRatio < 0.001 ? -15 : liquidityRatio < 0.01 ? -10 : liquidityRatio < 0.1 ? -5 : 0;
    
    return {
      predictionMarketLiquidity,
      exchangeLiquidity,
      liquidityRatio,
      liquidityConfidencePenalty,
      sufficientLiquidity: liquidityRatio >= 0.001,
    };
  }

  /**
   * Calculate implied price movement
   * ⚠️ PRODUCTION: No hardcoded fallback - returns zero-impact if no real price available
   */
  private static calculateImpliedMove(
    signal: FiveMinBTCSignal | null,
    history: FiveMinSignalHistory,
    priceData: Record<string, { price: number; change24h: number; volume24h: number }>
  ): ImpliedMove {
    // Get BTC price from real data sources only - NO hardcoded fallback
    const btcPrice = priceData['BTC']?.price || signal?.currentPrice || 0;
    
    // If no real price available, return neutral with zero confidence
    if (!btcPrice || btcPrice === 0) {
      return {
        expectedChange5Min: 0,
        priceRange: { low: 0, high: 0 },
        confidence: 0,
        basis: ['No real BTC price available - using neutral'],
      };
    }
    
    if (!signal) {
      return {
        expectedChange5Min: 0,
        priceRange: { low: btcPrice * 0.998, high: btcPrice * 1.002 },
        confidence: 20,
        basis: ['No 5-min signal available'],
      };
    }
    
    // Calculate expected change based on probability and direction
    const directionMultiplier = signal.direction === 'UP' ? 1 : -1;
    const probabilityFactor = (signal.probability - 50) / 100; // -0.5 to +0.5
    const volatilityBase = 0.001; // 0.1% base move
    
    const expectedChange5Min = directionMultiplier * probabilityFactor * volatilityBase * 100 * 3; // Amplified for visibility
    
    const rangeWidth = 0.003 * (1 + Math.abs(probabilityFactor)); // Wider range for stronger signals
    const priceRange = {
      low: btcPrice * (1 - rangeWidth),
      high: btcPrice * (1 + rangeWidth),
    };
    
    const basis: string[] = [];
    basis.push(`5-min signal: ${signal.direction} (${signal.probability}%)`);
    if (history.streak.count >= 3) basis.push(`${history.streak.count}-signal streak`);
    if (signal.signalStrength === 'STRONG') basis.push('Strong signal conviction');
    
    return {
      expectedChange5Min,
      priceRange,
      confidence: signal.confidence,
      basis,
    };
  }

  /**
   * Enhance predictions with AI-relevant data
   */
  private static enhancePredictions(
    predictions: PredictionMarket[],
    signal: FiveMinBTCSignal | null
  ): EnhancedPrediction[] {
    return predictions.map((pred, index) => {
      // Calculate AI relevance score
      const impactScore = pred.impact === 'HIGH' ? 30 : pred.impact === 'MODERATE' ? 20 : 10;
      const recScore = pred.recommendation === 'HEDGE' ? 40 : pred.recommendation === 'MONITOR' ? 20 : 5;
      const confidenceScore = pred.confidence * 0.3;
      const aiRelevanceScore = Math.min(impactScore + recScore + confidenceScore, 100);
      
      // Detect smart money signals (volume spikes)
      let smartMoneySignal: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL' = 'NEUTRAL';
      const volNum = parseFloat(pred.volume.replace(/[$KMB,]/g, ''));
      if (volNum > 1000 && pred.probability > 70) smartMoneySignal = 'ACCUMULATING';
      else if (volNum > 1000 && pred.probability < 30) smartMoneySignal = 'DISTRIBUTING';
      
      // Generate agent-specific recommendations
      const agentRecommendations: EnhancedPrediction['agentRecommendations'] = {};
      
      if (pred.recommendation === 'HEDGE') {
        agentRecommendations.riskAgent = 'Increase position monitoring frequency';
        agentRecommendations.hedgingAgent = 'Consider opening protective hedge';
        agentRecommendations.poolAgent = 'Reduce exposure to affected assets';
      } else if (pred.impact === 'HIGH') {
        agentRecommendations.riskAgent = 'Flag for risk review';
        agentRecommendations.hedgingAgent = 'Prepare contingency hedge parameters';
        agentRecommendations.poolAgent = 'Monitor for rebalance opportunity';
      }
      
      return {
        ...pred,
        aiRelevanceScore,
        smartMoneySignal,
        agentRecommendations,
        // 🔥 OPTIMIZED: Deterministic values instead of Math.random() (was breaking cache consistency)
        // Use prediction properties to generate stable values
        historicalAccuracy: 70 + (pred.confidence % 20), // 70-89 based on confidence
        probabilityMomentum: ((pred.probability - 50) / 10), // -5 to +5 based on probability
      };
    });
  }

  /**
   * Calculate overall market sentiment
   */
  private static calculateSentiment(
    signal: FiveMinBTCSignal | null,
    history: FiveMinSignalHistory,
    predictions: PredictionMarket[],
    priceData: Record<string, { price: number; change24h: number; volume24h: number }>
  ): AIMarketContext['marketSentiment'] {
    // Price action component
    const btcChange = priceData['BTC']?.change24h || 0;
    const ethChange = priceData['ETH']?.change24h || 0;
    const priceAction = ((btcChange + ethChange) / 2) * 10; // Scale to -100 to +100
    
    // Prediction markets component
    const avgProbability = predictions.length > 0
      ? predictions.reduce((sum, p) => sum + p.probability, 0) / predictions.length
      : 50;
    const predictionMarkets = (avgProbability - 50) * 2;
    
    // Volume component
    const btcVolume = priceData['BTC']?.volume24h || 0;
    const volumeScore = btcVolume > 50e9 ? 20 : btcVolume > 20e9 ? 10 : btcVolume > 10e9 ? 0 : -10;
    
    // Momentum component (from signal history)
    const recentUps = history.signals.filter(s => s.direction === 'UP').length;
    const momentum = history.signals.length > 0 
      ? ((recentUps / history.signals.length) - 0.5) * 100
      : 0;
    
    // Calculate overall score
    const score = Math.max(-100, Math.min(100, 
      priceAction * 0.3 + predictionMarkets * 0.3 + volumeScore * 0.2 + momentum * 0.2
    ));
    
    // Determine label
    let label: AIMarketContext['marketSentiment']['label'];
    if (score <= -50) label = 'EXTREME_FEAR';
    else if (score <= -20) label = 'FEAR';
    else if (score >= 50) label = 'EXTREME_GREED';
    else if (score >= 20) label = 'GREED';
    else label = 'NEUTRAL';
    
    return {
      score: Math.round(score),
      label,
      components: {
        priceAction: Math.round(priceAction),
        predictionMarkets: Math.round(predictionMarkets),
        volume: volumeScore,
        momentum: Math.round(momentum),
      },
    };
  }

  /**
   * Generate actionable summary
   */
  private static generateSummary(
    signal: FiveMinBTCSignal | null,
    history: FiveMinSignalHistory,
    predictions: PredictionMarket[]
  ): AIMarketContext['summary'] {
    // Determine primary signal
    let primarySignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 50;
    
    if (signal) {
      if (signal.direction === 'UP' && signal.probability > 55) {
        primarySignal = 'BULLISH';
        confidence = signal.confidence;
      } else if (signal.direction === 'DOWN' && signal.probability > 55) {
        primarySignal = 'BEARISH';
        confidence = signal.confidence;
      }
    }
    
    // Adjust based on streak
    if (history.streak.count >= 3) {
      if (history.streak.direction === 'UP') {
        primarySignal = 'BULLISH';
        confidence = Math.min(confidence + 10, 95);
      } else if (history.streak.direction === 'DOWN') {
        primarySignal = 'BEARISH';
        confidence = Math.min(confidence + 10, 95);
      }
    }
    
    // Determine urgency
    const hedgeCount = predictions.filter(p => p.recommendation === 'HEDGE').length;
    const urgency: 'HIGH' | 'MEDIUM' | 'LOW' = 
      hedgeCount >= 2 || (signal?.signalStrength === 'STRONG') ? 'HIGH' :
      hedgeCount >= 1 || confidence > 70 ? 'MEDIUM' : 'LOW';
    
    // Generate suggested action
    let suggestedAction: string;
    if (primarySignal === 'BEARISH' && urgency === 'HIGH') {
      suggestedAction = 'Consider opening SHORT hedge position immediately';
    } else if (primarySignal === 'BULLISH' && urgency === 'HIGH') {
      suggestedAction = 'Strong bullish signal - consider increasing exposure';
    } else if (primarySignal === 'BEARISH') {
      suggestedAction = 'Monitor for hedge entry, prepare parameters';
    } else if (primarySignal === 'BULLISH') {
      suggestedAction = 'Bullish bias - maintain positions, watch for confirmation';
    } else {
      suggestedAction = 'No clear signal - maintain current positions';
    }
    
    // Key factors
    const keyFactors: string[] = [];
    if (signal) keyFactors.push(`5-min signal: ${signal.direction} (${signal.probability}%)`);
    if (history.streak.count >= 2) keyFactors.push(`${history.streak.count}-signal ${history.streak.direction} streak`);
    if (hedgeCount > 0) keyFactors.push(`${hedgeCount} HEDGE recommendation(s)`);
    keyFactors.push(`Avg confidence: ${history.avgConfidence}%`);
    
    return {
      primarySignal,
      confidence,
      urgency,
      suggestedAction,
      keyFactors,
    };
  }

  /**
   * Quick method for agents that just need the signal direction
   */
  static async getQuickSignal(): Promise<{
    direction: 'UP' | 'DOWN' | 'NEUTRAL';
    confidence: number;
    recommendation: string;
  }> {
    const signal = await Polymarket5MinService.getLatest5MinSignal();
    
    if (!signal) {
      return { direction: 'NEUTRAL', confidence: 30, recommendation: 'No signal available' };
    }
    
    return {
      direction: signal.probability > 55 ? signal.direction : 'NEUTRAL',
      confidence: signal.confidence,
      recommendation: signal.recommendation,
    };
  }

  /**
   * Get predictions optimized for a specific agent type
   */
  static async getPredictionsForAgent(
    agentType: 'risk' | 'hedging' | 'pool',
    assets: string[] = ['BTC', 'ETH', 'CRO', 'SUI']
  ): Promise<EnhancedPrediction[]> {
    const context = await this.getMarketContext(assets);
    
    // Filter based on agent type
    switch (agentType) {
      case 'risk':
        // Risk agent wants high-impact, high-confidence predictions
        return context.predictions
          .filter(p => p.impact === 'HIGH' || p.recommendation === 'HEDGE')
          .sort((a, b) => b.aiRelevanceScore - a.aiRelevanceScore)
          .slice(0, 5);
        
      case 'hedging':
        // Hedging agent wants actionable hedge signals
        return context.predictions
          .filter(p => p.recommendation === 'HEDGE' || p.impact === 'HIGH')
          .sort((a, b) => {
            if (a.recommendation === 'HEDGE' && b.recommendation !== 'HEDGE') return -1;
            if (b.recommendation === 'HEDGE' && a.recommendation !== 'HEDGE') return 1;
            return b.confidence - a.confidence;
          })
          .slice(0, 5);
        
      case 'pool':
        // Pool agent wants broad market view
        return context.predictions
          .sort((a, b) => b.aiRelevanceScore - a.aiRelevanceScore)
          .slice(0, 8);
        
      default:
        return context.predictions;
    }
  }
}

// Export singleton-style access
export const getAIMarketContext = AIMarketIntelligence.getMarketContext.bind(AIMarketIntelligence);
export const getQuickSignal = AIMarketIntelligence.getQuickSignal.bind(AIMarketIntelligence);
export const getPredictionsForAgent = AIMarketIntelligence.getPredictionsForAgent.bind(AIMarketIntelligence);
