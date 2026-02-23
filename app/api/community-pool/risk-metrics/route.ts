/**
 * Risk Metrics API
 * 
 * Provides professional hedge fund-style risk analytics
 * 
 * GET /api/community-pool/risk-metrics
 *   Returns comprehensive risk metrics including:
 *   - Sharpe/Sortino ratios
 *   - Maximum drawdown
 *   - Value at Risk (VaR)
 *   - Beta/Alpha
 *   - Win rate and profit factor
 */

import { NextRequest, NextResponse } from 'next/server';
import { calculateRiskMetrics, getRiskRating } from '@/lib/services/RiskMetricsService';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cache duration for risk metrics (5 minutes)
const CACHE_DURATION_MS = 5 * 60 * 1000;
let cachedMetrics: { data: any; timestamp: number } | null = null;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const forceRefresh = searchParams.get('refresh') === 'true';
    
    // Check cache
    if (!forceRefresh && cachedMetrics && (Date.now() - cachedMetrics.timestamp) < CACHE_DURATION_MS) {
      return NextResponse.json({
        success: true,
        ...cachedMetrics.data,
        cached: true,
        cacheAge: Math.round((Date.now() - cachedMetrics.timestamp) / 1000),
      });
    }
    
    // Calculate fresh metrics
    const metrics = await calculateRiskMetrics();
    const riskRating = getRiskRating(metrics);
    
    const responseData = {
      metrics,
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
    
    // Update cache
    cachedMetrics = {
      data: responseData,
      timestamp: Date.now(),
    };
    
    logger.info('[RiskMetrics API] Calculated fresh metrics', { 
      sharpe: metrics.sharpeRatio,
      maxDD: metrics.maxDrawdown,
      beta: metrics.beta,
    });
    
    return NextResponse.json({
      success: true,
      ...responseData,
      cached: false,
    });
    
  } catch (error: any) {
    logger.error('[RiskMetrics API] Failed to calculate metrics', error);
    
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
