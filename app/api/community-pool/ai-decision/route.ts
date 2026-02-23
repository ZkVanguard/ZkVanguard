/**
 * Community Pool AI Decision Route
 * 
 * Uses AI to analyze REAL market conditions and decide on optimal allocation
 * between BTC, ETH, SUI, and CRO for the community pool.
 * 
 * Data Sources:
 * - Crypto.com Exchange API for live prices and 24h change
 * - Real market indicators, NOT simulated
 * 
 * Endpoints:
 * - GET  /api/community-pool/ai-decision          - Get current AI recommendation
 * - POST /api/community-pool/ai-decision          - Trigger AI analysis and optionally apply
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import {
  applyAIDecision,
  getPoolSummary,
  fetchLivePrices,
} from '@/lib/services/CommunityPoolService';
import {
  getPoolState,
  SUPPORTED_ASSETS,
  SupportedAsset,
} from '@/lib/storage/community-pool-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Real market indicators from Crypto.com API
interface MarketIndicators {
  asset: SupportedAsset;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  volatility: 'low' | 'medium' | 'high';
  trend: 'bullish' | 'bearish' | 'neutral';
  score: number;
}

/**
 * Fetch real market data from Crypto.com Exchange API
 */
async function fetchRealMarketIndicators(): Promise<MarketIndicators[]> {
  const tickerMap: Record<string, SupportedAsset> = {
    'BTC_USDT': 'BTC',
    'ETH_USDT': 'ETH',
    'SUI_USDT': 'SUI',
    'CRO_USDT': 'CRO',
  };
  
  try {
    const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      throw new Error(`Crypto.com API error: ${response.status}`);
    }
    
    const data = await response.json();
    const tickers = data.result?.data || [];
    
    const indicators: MarketIndicators[] = [];
    
    for (const ticker of tickers) {
      const asset = tickerMap[ticker.i];
      if (!asset) continue;
      
      // Real data from API:
      // a = last trade price
      // c = 24h price change percentage
      // v = 24h volume (in base currency)
      // h = 24h high
      // l = 24h low
      const price = parseFloat(ticker.a) || 0;
      const change24h = parseFloat(ticker.c) || 0; // Already percentage
      const volume24h = parseFloat(ticker.v) || 0;
      const high24h = parseFloat(ticker.h) || price;
      const low24h = parseFloat(ticker.l) || price;
      
      // Calculate real volatility from 24h range
      const rangePercent = price > 0 ? ((high24h - low24h) / price) * 100 : 0;
      let volatility: 'low' | 'medium' | 'high';
      if (rangePercent < 3) volatility = 'low';
      else if (rangePercent < 7) volatility = 'medium';
      else volatility = 'high';
      
      // Determine trend based on real 24h change
      let trend: 'bullish' | 'bearish' | 'neutral';
      if (change24h > 2) trend = 'bullish';
      else if (change24h < -2) trend = 'bearish';
      else trend = 'neutral';
      
      // Calculate score (0-100) based on real factors
      let score = 50; // Base score
      score += change24h * 2; // Momentum weight (real 24h change)
      if (volatility === 'low') score += 10;
      else if (volatility === 'high') score -= 5;
      if (trend === 'bullish') score += 10;
      else if (trend === 'bearish') score -= 10;
      
      // Volume factor - higher volume = higher confidence
      // Normalize volume across assets (rough approximation)
      const volumeUSD = volume24h * price;
      if (volumeUSD > 100_000_000) score += 5; // >$100M daily volume
      
      // Clamp score
      score = Math.max(0, Math.min(100, score));
      
      indicators.push({
        asset,
        price,
        change24h,
        volume24h,
        high24h,
        low24h,
        volatility,
        trend,
        score,
      });
      
      logger.debug(`[AI Decision] ${asset} indicators:`, {
        price,
        change24h,
        volatility,
        trend,
        score,
      });
    }
    
    // Ensure all supported assets are included
    for (const asset of SUPPORTED_ASSETS) {
      if (!indicators.find(i => i.asset === asset)) {
        throw new Error(`Missing market data for ${asset}`);
      }
    }
    
    logger.info('[AI Decision] Fetched real market indicators from Crypto.com', {
      assets: indicators.map(i => i.asset),
    });
    
    return indicators;
    
  } catch (error) {
    logger.error('[AI Decision] Failed to fetch real market data:', error);
    throw new Error('Unable to fetch real market data. AI decisions require live market data.');
  }
}

/**
 * AI-based allocation decision using REAL market data
 * Uses live 24h price changes, volatility, and diversification principles
 */
async function generateAIAllocation(marketConditions?: {
  riskScore?: number;
  drawdownPercent?: number;
  volatility?: number;
  currentAllocations?: Record<string, number>;
}): Promise<{
  allocations: Record<SupportedAsset, number>;
  reasoning: string;
  confidence: number;
  indicators: MarketIndicators[];
  shouldRebalance: boolean;
}> {
  // Fetch REAL market indicators from Crypto.com
  const indicators = await fetchRealMarketIndicators();
  
  // Calculate allocations based on real scores
  const totalScore = indicators.reduce((sum, i) => sum + i.score, 0);
  
  // Sort by score for deterministic allocation
  const sortedIndicators = [...indicators].sort((a, b) => b.score - a.score);
  
  let allocations: Record<SupportedAsset, number> = {} as any;
  let remainingPercentage = 100;
  
  for (let i = 0; i < sortedIndicators.length; i++) {
    const indicator = sortedIndicators[i];
    if (i === sortedIndicators.length - 1) {
      // Last asset gets remaining percentage
      allocations[indicator.asset] = remainingPercentage;
    } else {
      // Calculate percentage based on score, with min 10% for diversification
      let percentage = Math.round((indicator.score / totalScore) * 100);
      percentage = Math.max(10, Math.min(40, percentage)); // 10-40% range for any single asset
      allocations[indicator.asset] = percentage;
      remainingPercentage -= percentage;
    }
  }
  
  // Generate reasoning with real data
  const topAsset = sortedIndicators[0];
  const bottomAsset = sortedIndicators[sortedIndicators.length - 1];
  
  // Calculate confidence based on real data quality
  // Higher confidence when assets show clear trends (not neutral) and lower volatility
  const clearTrends = indicators.filter(i => i.trend !== 'neutral').length;
  const avgVolatility = indicators.filter(i => i.volatility === 'high').length;
  let confidence = 60 + (clearTrends * 8) - (avgVolatility * 5);
  confidence = Math.max(50, Math.min(95, confidence));
  
  const reasoning = `AI Allocation Decision (${new Date().toISOString().split('T')[0]}):

**LIVE Market Analysis (Crypto.com):**
${indicators.map(i => `- ${i.asset}: $${i.price.toLocaleString()} (${i.change24h > 0 ? '+' : ''}${i.change24h.toFixed(2)}% 24h) - ${i.trend} trend, ${i.volatility} volatility [HIGH: $${i.high24h.toLocaleString()} / LOW: $${i.low24h.toLocaleString()}]`).join('\n')}

**Recommendation:**
- Overweight ${topAsset.asset} (${allocations[topAsset.asset]}%) due to ${topAsset.trend} momentum and ${topAsset.volatility} volatility profile (score: ${topAsset.score.toFixed(1)})
- Underweight ${bottomAsset.asset} (${allocations[bottomAsset.asset]}%) showing ${bottomAsset.trend} signals (score: ${bottomAsset.score.toFixed(1)})
- Maintain diversification across all 4 assets to reduce portfolio risk

**Risk Assessment:** ${topAsset.volatility === 'high' ? 'Elevated' : 'Moderate'} risk environment
**Confidence Level:** ${Math.round(confidence)}% (based on trend clarity and market conditions)
**Data Source:** Real-time Crypto.com Exchange API`;
  
  // Determine if rebalancing should occur
  // Check if current allocations exist and calculate drift
  let shouldRebalance = false;
  if (marketConditions?.currentAllocations) {
    const drifts = SUPPORTED_ASSETS.map(asset => {
      const current = marketConditions.currentAllocations![asset] || 0;
      const proposed = allocations[asset] || 0;
      return Math.abs(proposed - current);
    });
    const maxDrift = Math.max(...drifts);
    // Rebalance if max drift > 5% OR risk score >= 6
    shouldRebalance = maxDrift > 5 || (marketConditions.riskScore ?? 0) >= 6;
  } else {
    // Default: suggest rebalance if confidence is high
    shouldRebalance = confidence >= 75;
  }
  
  return { allocations, reasoning, confidence, indicators, shouldRebalance };
}

/**
 * GET - Get current AI recommendation without applying
 */
export async function GET() {
  try {
    const poolSummary = await getPoolSummary();
    const { allocations, reasoning, confidence, indicators, shouldRebalance } = await generateAIAllocation();
    
    // Calculate what would change
    const currentAllocations = poolSummary.allocations;
    const changes = SUPPORTED_ASSETS.map(asset => ({
      asset,
      currentPercent: currentAllocations[asset].percentage,
      proposedPercent: allocations[asset],
      change: allocations[asset] - currentAllocations[asset].percentage,
    }));
    
    return NextResponse.json({
      success: true,
      recommendation: {
        allocations,
        shouldRebalance,
        reasoning,
        confidence: Math.round(confidence),
        indicators,
        changes,
      },
      currentPool: poolSummary,
      timestamp: Date.now(),
      note: 'This is a recommendation. Use POST to apply the decision.',
    });
    
  } catch (error: any) {
    logger.error('[CommunityPool AI] GET error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST - Generate and optionally apply AI decision
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { apply = false, cronSecret, marketConditions } = body;
    
    // If applying changes, verify authorization
    if (apply) {
      const validSecret = process.env.CRON_SECRET;
      if (validSecret && cronSecret !== validSecret) {
        // Check if it's from an authorized source
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${validSecret}`) {
          return NextResponse.json(
            { success: false, error: 'Unauthorized to apply AI decisions' },
            { status: 401 }
          );
        }
      }
    }
    
    const { allocations, reasoning, confidence, indicators, shouldRebalance } = await generateAIAllocation(marketConditions);
    
    if (!apply) {
      // Just return the recommendation
      const poolSummary = await getPoolSummary();
      const changes = SUPPORTED_ASSETS.map(asset => ({
        asset,
        currentPercent: poolSummary.allocations[asset].percentage,
        proposedPercent: allocations[asset],
        change: allocations[asset] - poolSummary.allocations[asset].percentage,
      }));
      
      return NextResponse.json({
        success: true,
        recommendation: {
          allocations,
          shouldRebalance,
          reasoning,
          confidence: Math.round(confidence),
          indicators,
          changes,
        },
        applied: false,
        message: 'Recommendation generated. Set apply:true to execute.',
      });
    }
    
    // Apply the AI decision
    const result = await applyAIDecision(allocations, reasoning);
    
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }
    
    // Calculate changes from previous and new allocations
    const changes = SUPPORTED_ASSETS.map(asset => ({
      asset,
      previousPercent: result.previousAllocations[asset],
      newPercent: result.newAllocations[asset],
      change: result.newAllocations[asset] - result.previousAllocations[asset],
    }));
    
    return NextResponse.json({
      success: true,
      applied: true,
      message: 'AI allocation decision applied successfully',
      result: {
        previousAllocations: result.previousAllocations,
        newAllocations: result.newAllocations,
        trades: result.trades,
        changes,
      },
      reasoning,
      confidence: Math.round(confidence),
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    logger.error('[CommunityPool AI] POST error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
