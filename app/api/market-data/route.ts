import { NextRequest, NextResponse } from 'next/server';
import { readLimiter } from '@/lib/security/rate-limiter';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { logger } from '@/lib/utils/logger';

// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

export const maxDuration = 15;
/**
 * Market Data API via Crypto.com MCP Server
 */
export async function GET(request: NextRequest) {
  const limited = readLimiter.check(request);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'BTC';
    const symbols = searchParams.get('symbols')?.split(',');

    const marketDataService = getMarketDataService();

    if (symbols && symbols.length > 0) {
      const priceMap = await marketDataService.getTokenPrices(symbols);
      const prices = symbols.map(s => {
        const p = priceMap.get(s);
        return { symbol: s, price: p?.price ?? 0, change24h: p?.change24h ?? 0, volume24h: p?.volume24h ?? 0, timestamp: p?.timestamp ?? Date.now() };
      });
      return NextResponse.json({
        success: true,
        data: prices,
        timestamp: new Date().toISOString(),
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
        },
      });
    } else {
      const price = await marketDataService.getTokenPrice(symbol);
      return NextResponse.json({
        success: true,
        data: { symbol, price: price.price, change24h: price.change24h ?? 0, volume24h: price.volume24h ?? 0, timestamp: price.timestamp ?? Date.now() },
        timestamp: new Date().toISOString(),
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
        },
      });
    }
  } catch (error) {
    logger.error('Market data fetch failed:', error);
    return safeErrorResponse(error, 'Market data fetch');
  }
}

export async function POST(request: NextRequest) {
  const rateLimited = readLimiter.check(request);
  if (rateLimited) return rateLimited;

  try {
    const body = await request.json();
    const { symbols, action = 'price' } = body;

    if (!symbols || !Array.isArray(symbols)) {
      return NextResponse.json(
        { error: 'Symbols array is required' },
        { status: 400 }
      );
    }

    const marketDataService = getMarketDataService();

    switch (action) {
      case 'price': {
        const priceMap = await marketDataService.getTokenPrices(symbols);
        const prices = symbols.map(s => {
          const p = priceMap.get(s);
          return { symbol: s, price: p?.price ?? 0, change24h: p?.change24h ?? 0, volume24h: p?.volume24h ?? 0, timestamp: p?.timestamp ?? Date.now() };
        });
        return NextResponse.json({
          success: true,
          action: 'price',
          data: prices,
          timestamp: new Date().toISOString(),
        });
      }
      case 'ticker': {
        // Ticker (bid/ask) not available from RealMarketDataService — return prices
        const tickerMap = await marketDataService.getTokenPrices(symbols);
        const tickers = symbols.map(s => {
          const p = tickerMap.get(s);
          const price = p?.price ?? 0;
          return { symbol: s, bid: price, ask: price, spread: 0, timestamp: p?.timestamp ?? Date.now() };
        });
        return NextResponse.json({
          success: true,
          action: 'ticker',
          data: tickers,
          timestamp: new Date().toISOString(),
        });
      }
      case 'ohlcv': {
        // OHLCV not available from RealMarketDataService
        logger.warn('market-data: OHLCV not supported, returning empty array');
        return NextResponse.json({
          success: true,
          action: 'ohlcv',
          data: symbols.map(() => []),
          timestamp: new Date().toISOString(),
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error('Market data operation failed:', error);
    return safeErrorResponse(error, 'Market data operation');
  }
}
