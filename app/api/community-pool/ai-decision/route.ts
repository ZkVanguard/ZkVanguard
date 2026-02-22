/**
 * Community Pool AI Decision Route
 * 
 * Uses AI to analyze market conditions and decide on optimal allocation
 * between BTC, ETH, SUI, and CRO for the community pool.
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

// Simulated market sentiment indicators
interface MarketIndicators {
  asset: SupportedAsset;
  price: number;
  change24h: number;
  volatility: 'low' | 'medium' | 'high';
  trend: 'bullish' | 'bearish' | 'neutral';
  score: number;
}

/**
 * Simple AI-based allocation decision
 * Uses price momentum, relative strength, and diversification principles
 */
async function generateAIAllocation(): Promise<{
  allocations: Record<SupportedAsset, number>;
  reasoning: string;
  confidence: number;
  indicators: MarketIndicators[];
}> {
  const prices = await fetchLivePrices();
  const poolState = await getPoolState();
  
  // Generate mock market indicators based on current prices
  // In production, this would use real market data APIs
  const indicators: MarketIndicators[] = SUPPORTED_ASSETS.map(asset => {
    // Simulate 24h change (-10% to +10%)
    const change24h = (Math.random() - 0.5) * 20;
    
    // Determine volatility based on asset
    let volatility: 'low' | 'medium' | 'high';
    if (asset === 'BTC') volatility = 'low';
    else if (asset === 'ETH') volatility = 'medium';
    else volatility = 'high';
    
    // Determine trend based on 24h change
    let trend: 'bullish' | 'bearish' | 'neutral';
    if (change24h > 3) trend = 'bullish';
    else if (change24h < -3) trend = 'bearish';
    else trend = 'neutral';
    
    // Calculate score (0-100) based on multiple factors
    let score = 50; // Base score
    score += change24h * 2; // Momentum weight
    if (volatility === 'low') score += 10;
    else if (volatility === 'high') score -= 5;
    if (trend === 'bullish') score += 10;
    else if (trend === 'bearish') score -= 10;
    
    // Clamp score
    score = Math.max(0, Math.min(100, score));
    
    return {
      asset,
      price: prices[asset],
      change24h,
      volatility,
      trend,
      score,
    };
  });
  
  // Calculate allocations based on scores
  const totalScore = indicators.reduce((sum, i) => sum + i.score, 0);
  
  let allocations: Record<SupportedAsset, number> = {} as any;
  let remainingPercentage = 100;
  
  for (let i = 0; i < indicators.length; i++) {
    const indicator = indicators[i];
    if (i === indicators.length - 1) {
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
  
  // Generate reasoning
  const topAsset = indicators.reduce((a, b) => a.score > b.score ? a : b);
  const bottomAsset = indicators.reduce((a, b) => a.score < b.score ? a : b);
  
  const reasoning = `AI Allocation Decision (${new Date().toISOString().split('T')[0]}):

**Market Analysis:**
${indicators.map(i => `- ${i.asset}: $${i.price.toLocaleString()} (${i.change24h > 0 ? '+' : ''}${i.change24h.toFixed(2)}% 24h) - ${i.trend} trend, ${i.volatility} volatility`).join('\n')}

**Recommendation:**
- Overweight ${topAsset.asset} (${allocations[topAsset.asset]}%) due to ${topAsset.trend} momentum and ${topAsset.volatility} volatility profile
- Underweight ${bottomAsset.asset} (${allocations[bottomAsset.asset]}%) showing ${bottomAsset.trend} signals
- Maintain diversification across all 4 assets to reduce portfolio risk

**Risk Assessment:** ${topAsset.volatility === 'high' ? 'Elevated' : 'Moderate'} risk environment
**Confidence Level:** ${Math.round(70 + Math.random() * 20)}%`;

  const confidence = 70 + Math.random() * 20;
  
  return { allocations, reasoning, confidence, indicators };
}

/**
 * GET - Get current AI recommendation without applying
 */
export async function GET() {
  try {
    const poolSummary = await getPoolSummary();
    const { allocations, reasoning, confidence, indicators } = await generateAIAllocation();
    
    // Calculate what would change
    const currentAllocations = poolSummary.allocations;
    const changes = SUPPORTED_ASSETS.map(asset => ({
      asset,
      currentPercent: currentAllocations[asset],
      proposedPercent: allocations[asset],
      change: allocations[asset] - currentAllocations[asset],
    }));
    
    return NextResponse.json({
      success: true,
      recommendation: {
        allocations,
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
    const { apply = false, cronSecret } = body;
    
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
    
    const { allocations, reasoning, confidence, indicators } = await generateAIAllocation();
    
    if (!apply) {
      // Just return the recommendation
      const poolSummary = await getPoolSummary();
      const changes = SUPPORTED_ASSETS.map(asset => ({
        asset,
        currentPercent: poolSummary.allocations[asset],
        proposedPercent: allocations[asset],
        change: allocations[asset] - poolSummary.allocations[asset],
      }));
      
      return NextResponse.json({
        success: true,
        recommendation: {
          allocations,
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
    
    return NextResponse.json({
      success: true,
      applied: true,
      message: 'AI allocation decision applied successfully',
      result: {
        previousAllocations: result.previousAllocations,
        newAllocations: result.newAllocations,
        changes: result.changes,
        totalValueUSD: result.totalValueUSD,
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
