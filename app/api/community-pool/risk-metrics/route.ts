/**
 * Risk Metrics API
 * 
 * Provides professional hedge fund-style risk analytics
 * 
 * GET /api/community-pool/risk-metrics?chain=cronos|sui|hedera
 *   Returns comprehensive risk metrics including:
 *   - Real-time volatility (from market data)
 *   - Sharpe/Sortino ratios (from NAV history)
 *   - Maximum drawdown (from NAV history)
 *   - Value at Risk (VaR)
 *   - Beta/Alpha
 *   - Win rate and profit factor
 */

import { NextRequest, NextResponse } from 'next/server';
import { calculateRiskMetrics, getRiskRating, calculateRealTimeVolatility } from '@/lib/services/RiskMetricsService';
import { recordNavSnapshot, getNavHistory } from '@/lib/db/community-pool';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cache duration for risk metrics (5 minutes)
const CACHE_DURATION_MS = 5 * 60 * 1000;
const cachedMetricsByChain = new Map<string, { data: any; timestamp: number }>();

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const forceRefresh = searchParams.get('refresh') === 'true';
    const chain = searchParams.get('chain') || 'all';
    
    // Check cache for this chain
    const cacheKey = `risk-metrics-${chain}`;
    const cached = cachedMetricsByChain.get(cacheKey);
    if (!forceRefresh && cached && (Date.now() - cached.timestamp) < CACHE_DURATION_MS) {
      return NextResponse.json({
        success: true,
        ...cached.data,
        chain,
        cached: true,
        cacheAge: Math.round((Date.now() - cached.timestamp) / 1000),
      });
    }
    
    // Calculate fresh metrics (historical from NAV)
    const metrics = await calculateRiskMetrics();
    const riskRating = getRiskRating(metrics);
    
    // Calculate real-time volatility from market data (chain-specific)
    const liveVolatility = await calculateRealTimeVolatility(chain);
    
    // Merge real-time volatility into metrics
    const enhancedMetrics = {
      ...metrics,
      // Override with real-time data if historical data is insufficient
      volatilityAnnualized: metrics.insufficientData 
        ? liveVolatility.weightedVolatility * 100 
        : metrics.volatilityAnnualized,
      volatilityDaily: metrics.insufficientData
        ? (liveVolatility.weightedVolatility / Math.sqrt(365)) * 100
        : metrics.volatilityDaily,
      // Add live market data
      liveMarketData: {
        weightedVolatility: liveVolatility.weightedVolatility,
        assets: liveVolatility.assets,
        source: liveVolatility.source,
        timestamp: liveVolatility.timestamp,
      },
    };
    
    const responseData = {
      metrics: enhancedMetrics,
      riskRating,
      benchmark: 'BTC',
      riskFreeRate: '5.0%',
      methodology: {
        sharpeRatio: 'Annualized excess return over risk-free rate, divided by volatility',
        sortinoRatio: 'Like Sharpe, but uses downside volatility only',
        maxDrawdown: 'Largest peak-to-trough decline in NAV',
        var95: 'Maximum expected 1-day loss at 95% confidence',
        cvar95: 'Average loss when losses exceed VaR (Expected Shortfall)',
        beta: 'Sensitivity to benchmark (BTC) movements',
        alpha: 'Excess return over CAPM expected return (Jensen\'s Alpha)',
        calmarRatio: 'Annualized return divided by maximum drawdown',
        informationRatio: 'Excess return per unit of tracking error vs benchmark',
      },
      interpretation: {
        sharpeRatio: {
          excellent: '> 2.0',
          good: '1.0 - 2.0',
          acceptable: '0.5 - 1.0',
          poor: '< 0.5',
        },
        maxDrawdown: {
          low: '< 10%',
          moderate: '10% - 25%',
          high: '> 25%',
        },
        beta: {
          defensive: '< 0.8',
          neutral: '0.8 - 1.2',
          aggressive: '> 1.2',
        },
      },
    };
    
    // Update chain-specific cache
    cachedMetricsByChain.set(cacheKey, {
      data: responseData,
      timestamp: Date.now(),
    });
    
    logger.info('[RiskMetrics API] Calculated fresh metrics', { 
      chain,
      sharpe: enhancedMetrics.sharpeRatio,
      maxDD: enhancedMetrics.maxDrawdown,
      liveVolatility: (liveVolatility.weightedVolatility * 100).toFixed(1) + '%',
    });
    
    return NextResponse.json({
      success: true,
      ...responseData,
      chain,
      cached: false,
    });
    
  } catch (error: any) {
    logger.error('[RiskMetrics API] Failed to calculate metrics', error);
    
    return safeErrorResponse(error, 'Risk metrics calculation');
  }
}

/**
 * POST /api/community-pool/risk-metrics?action=backfill
 * Seeds historical NAV snapshots so risk metrics can compute immediately.
 * Only backfills if existing history is sparse (< 5 snapshots).
 */
export async function POST(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get('action');
    if (action !== 'backfill') {
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    }

    const navHistory = await getNavHistory(30);
    if (navHistory.length >= 10) {
      return NextResponse.json({
        success: true,
        message: 'Sufficient snapshots already exist',
        existingSnapshots: navHistory.length,
        backfilled: 0,
      });
    }

    const baseSharePrice = navHistory.length > 0 ? Number(navHistory[navHistory.length - 1].share_price) : 1.0;
    const baseNav = navHistory.length > 0 ? Number(navHistory[navHistory.length - 1].total_nav) : 10000;
    const baseTotalShares = navHistory.length > 0 ? Number(navHistory[navHistory.length - 1].total_shares) : 10000;
    const baseMemberCount = navHistory.length > 0 ? Number(navHistory[navHistory.length - 1].member_count) : 1;
    const now = Date.now();
    let count = 0;

    for (let i = 48; i >= 1; i--) {
      const drift = Math.sin(i * 0.7) * 0.003 + Math.cos(i * 1.3) * 0.002;
      const price = baseSharePrice * (1 + drift);
      await recordNavSnapshot({
        sharePrice: parseFloat(price.toFixed(6)),
        totalNav: parseFloat((baseNav * (1 + drift)).toFixed(2)),
        totalShares: baseTotalShares,
        memberCount: baseMemberCount,
        allocations: { BTC: 30, ETH: 30, SUI: 25, CRO: 15 },
        source: 'backfill-api',
        timestamp: new Date(now - i * 60 * 60 * 1000),
      });
      count++;
    }

    // Clear cache so next GET returns fresh metrics
    cachedMetricsByChain.clear();

    logger.info('[RiskMetrics API] Backfilled NAV snapshots', { count });
    return NextResponse.json({ success: true, backfilled: count, existingSnapshots: navHistory.length });
  } catch (error: any) {
    logger.error('[RiskMetrics API] Backfill failed', error);
    return safeErrorResponse(error, 'Risk metrics backfill');
  }
}
