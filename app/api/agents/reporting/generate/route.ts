import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { readLimiter } from '@/lib/security/rate-limiter';

export const maxDuration = 30;

/**
 * Portfolio Reporting API Route
 * Generates reports using real on-chain data for the caller-supplied address.
 */
export async function POST(request: NextRequest) {
  const rateLimited = readLimiter.check(request);
  if (rateLimited) return rateLimited;

  try {
    const body = await request.json();
    const { address, period } = body;

    if (!address || typeof address !== 'string') {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Fetch on-chain portfolio for the caller-supplied address (previous
    // implementation called getPortfolioData() with no args, which derives
    // its address from SERVER_WALLET_PRIVATE_KEY — every user got the
    // *server wallet's* balances rendered as their 'report').
    const { getMarketDataService } = await import('@/lib/services/market-data/RealMarketDataService');
    const marketData = getMarketDataService();
    const portfolioData = await marketData.getPortfolioData(address);

    if (!portfolioData || !portfolioData.tokens) {
      return NextResponse.json(
        { error: 'No portfolio data available for this address' },
        { status: 404 }
      );
    }

    const positions = portfolioData.tokens.map((t: { symbol: string; balance: string; usdValue: number }) => ({
      asset: t.symbol,
      value: t.usdValue || 0,
      // Historical per-address PnL isn't tracked yet; surface 0 and label
      // the report `snapshot` so consumers don't render fake return %s.
      pnl: 0,
    }));

    return NextResponse.json({
      address,
      period: period || 'daily',
      reportType: 'snapshot',
      totalValue: portfolioData.totalValue || 0,
      profitLoss: 0,
      // Historical per-address PnL isn't tracked yet. Previous
      // implementation multiplied a stub daily-PnL by 2.5 / 8 for weekly /
      // monthly — pure fabrication. Report zeros with an unavailable flag
      // so consumers can render 'Historical P/L: unavailable' honestly.
      performance: {
        daily: 0,
        weekly: 0,
        monthly: 0,
        available: false,
      },
      topPositions: positions.slice(0, 5),
      generatedAt: Date.now(),
      source: 'onchain',
    });
  } catch (error) {
    logger.error('Report generation failed', error);
    return safeErrorResponse(error, 'Report generation');
  }
}
