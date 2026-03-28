import { NextRequest, NextResponse } from 'next/server';
import { getMarketDataMCPClient } from '@/lib/services/market-data-mcp';
import { safeErrorResponse } from '@/lib/security/safe-error';

// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

/**
 * Market Data API via Crypto.com MCP Server
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'BTC';
    const symbols = searchParams.get('symbols')?.split(',');

    const mcpClient = getMarketDataMCPClient();
    await mcpClient.connect();

    if (symbols && symbols.length > 0) {
      // Multiple symbols
      const prices = await mcpClient.getMultiplePrices(symbols);
      return NextResponse.json({
        success: true,
        data: prices,
        mcpPowered: true,
        demoMode: mcpClient.isDemoMode(),
        timestamp: new Date().toISOString(),
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
        },
      });
    } else {
      // Single symbol
      const price = await mcpClient.getPrice(symbol);
      return NextResponse.json({
        success: true,
        data: price,
        mcpPowered: true,
        demoMode: mcpClient.isDemoMode(),
        timestamp: new Date().toISOString(),
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
        },
      });
    }
  } catch (error) {
    console.error('Market data fetch failed:', error);
    return safeErrorResponse(error, 'Market data fetch');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbols, action = 'price' } = body;

    if (!symbols || !Array.isArray(symbols)) {
      return NextResponse.json(
        { error: 'Symbols array is required' },
        { status: 400 }
      );
    }

    const mcpClient = getMarketDataMCPClient();
    await mcpClient.connect();

    switch (action) {
      case 'price': {
        const prices = await mcpClient.getMultiplePrices(symbols);
        return NextResponse.json({
          success: true,
          action: 'price',
          data: prices,
          mcpPowered: true,
          demoMode: mcpClient.isDemoMode(),
          timestamp: new Date().toISOString(),
        });
      }
      case 'ticker': {
        const tickers = await Promise.all(
          symbols.map(symbol => mcpClient.getTicker(symbol))
        );
        return NextResponse.json({
          success: true,
          action: 'ticker',
          data: tickers,
          mcpPowered: true,
          demoMode: mcpClient.isDemoMode(),
          timestamp: new Date().toISOString(),
        });
      }
      case 'ohlcv': {
        const { timeframe = '1h', limit: rawLimit = 100 } = body;
        const limit = Math.min(Number(rawLimit) || 100, 500);
        const ohlcvData = await Promise.all(
          symbols.map(symbol => mcpClient.getOHLCV(symbol, timeframe, limit))
        );
        return NextResponse.json({
          success: true,
          action: 'ohlcv',
          data: ohlcvData,
          mcpPowered: true,
          demoMode: mcpClient.isDemoMode(),
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
    console.error('Market data operation failed:', error);
    return safeErrorResponse(error, 'Market data operation');
  }
}
