import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { cryptocomExchangeService } from '@/lib/services/CryptocomExchangeService';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';
import { getCachedPrice, getCachedPrices, upsertPrices } from '@/lib/db/prices';
import { recordPriceUpdate } from '@/lib/services/PriceAlertWebhook';

// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

/**
 * Enhanced Market Data API using Crypto.com Exchange API
 * Supports both single and batch price queries
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const symbols = searchParams.get('symbols')?.split(',').map(s => s.trim());
    const source = searchParams.get('source') || 'auto'; // 'auto', 'exchange', 'fallback'

    // Batch request
    if (symbols && symbols.length > 0) {
      logger.info(`[Market Data API] Fetching batch prices for: ${symbols.join(', ')}`);
      
      if (source === 'exchange') {
        // Direct from Exchange API
        const prices = await cryptocomExchangeService.getBatchPrices(symbols);
        
        // ═══ WEBHOOK TRIGGER: Check each asset for significant moves ═══
        Object.entries(prices).forEach(([sym, price]) => {
          recordPriceUpdate(sym, price);
        });
        
        return NextResponse.json({
          success: true,
          data: Object.entries(prices).map(([sym, price]) => ({
            symbol: sym,
            price,
            source: 'cryptocom-exchange',
          })),
          source: 'cryptocom-exchange',
          timestamp: new Date().toISOString(),
        }, {
          headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' },
        });
      } else {
        // Use fallback system (auto)
        const marketData = getMarketDataService();
        const pricePromises = symbols.map(sym => marketData.getTokenPrice(sym));
        const prices = await Promise.all(pricePromises);
        
        // ═══ WEBHOOK TRIGGER: Check each asset for significant moves ═══
        prices.forEach(p => {
          recordPriceUpdate(p.symbol, p.price);
        });
        
        return NextResponse.json({
          success: true,
          data: prices.map(p => ({
            symbol: p.symbol,
            price: p.price,
            change24h: p.change24h,
            volume24h: p.volume24h,
            source: p.source,
          })),
          source: 'multi-source-fallback',
          timestamp: new Date().toISOString(),
        }, {
          headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' },
        });
      }
    }

    // Single symbol request
    if (!symbol) {
      return NextResponse.json(
        { error: 'Either symbol or symbols parameter is required' },
        { status: 400 }
      );
    }

    // ═══ DB-FIRST: Check cache before hitting Crypto.com ═══
    if (source === 'auto') {
      const cached = await getCachedPrice(symbol, 30_000);
      if (cached) {
        logger.info(`[Market Data API] Cache HIT for ${symbol}`);
        return NextResponse.json({
          success: true,
          data: {
            symbol: cached.symbol,
            price: cached.price,
            change24h: cached.change_24h,
            volume24h: cached.volume_24h,
            source: 'db-cache',
          },
          source: 'db-cache',
          timestamp: new Date().toISOString(),
        }, {
          headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' },
        });
      }
      logger.info(`[Market Data API] Cache MISS for ${symbol} — fetching from Crypto.com`);
    }

    logger.info(`[Market Data API] Fetching price for ${symbol} (source: ${source})`);

    if (source === 'exchange') {
      // Direct from Exchange API with full market data
      const marketData = await cryptocomExchangeService.getMarketData(symbol);
      // Cache in DB for other routes
      upsertPrices([{
        symbol: marketData.symbol,
        price: marketData.price,
        change24h: marketData.change24h,
        volume24h: marketData.volume24h,
        source: marketData.source,
      }]).catch(() => {});
      
      // ═══ WEBHOOK TRIGGER: Check for significant price moves ═══
      recordPriceUpdate(marketData.symbol, marketData.price);
      
      return NextResponse.json({
        success: true,
        data: {
          symbol: marketData.symbol,
          price: marketData.price,
          change24h: marketData.change24h,
          volume24h: marketData.volume24h,
          high24h: marketData.high24h,
          low24h: marketData.low24h,
          source: marketData.source,
        },
        source: 'cryptocom-exchange',
        timestamp: new Date().toISOString(),
      });
    } else {
      // Use fallback system (auto)
      const marketData = getMarketDataService();
      const price = await marketData.getTokenPrice(symbol);
      // Cache in DB
      upsertPrices([{
        symbol: price.symbol,
        price: price.price,
        change24h: price.change24h,
        volume24h: price.volume24h,
        source: price.source,
      }]).catch(() => {});
      
      // ═══ WEBHOOK TRIGGER: Check for significant price moves ═══
      recordPriceUpdate(price.symbol, price.price);
      
      return NextResponse.json({
        success: true,
        data: {
          symbol: price.symbol,
          price: price.price,
          change24h: price.change24h,
          volume24h: price.volume24h,
          source: price.source,
        },
        source: 'multi-source-fallback',
        timestamp: new Date().toISOString(),
      }, {
        headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' },
      });
    }
  } catch (error: unknown) {
    logger.error('[Market Data API] Error', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to fetch market data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
      
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbols, action = 'prices' } = body;

    if (!symbols || !Array.isArray(symbols)) {
      return NextResponse.json(
        { error: 'Symbols array is required' },
        { status: 400 }
      );
    }

    logger.info(`[Market Data API] POST request for ${symbols.length} symbols, action: ${action}`);

    switch (action) {
      case 'prices': {
        // Batch price fetch using Exchange API
        const prices = await cryptocomExchangeService.getBatchPrices(symbols);
        return NextResponse.json({
          success: true,
          action: 'prices',
          data: prices,
          source: 'cryptocom-exchange',
          timestamp: new Date().toISOString(),
        });
      }

      case 'market-data': {
        // Full market data for each symbol
        const dataPromises = symbols.map(sym => 
          cryptocomExchangeService.getMarketData(sym).catch((err: unknown) => ({
            symbol: sym,
            error: err instanceof Error ? err.message : 'Unknown error',
          }))
        );
        const marketData = await Promise.all(dataPromises);
        
        return NextResponse.json({
          success: true,
          action: 'market-data',
          data: marketData,
          source: 'cryptocom-exchange',
          timestamp: new Date().toISOString(),
        });
      }

      case 'tickers': {
        // Get all available tickers
        const tickers = await cryptocomExchangeService.getAllTickers();
        return NextResponse.json({
          success: true,
          action: 'tickers',
          data: {
            count: tickers.length,
            tickers: tickers.slice(0, 100), // Limit to first 100 for response size
          },
          source: 'cryptocom-exchange',
          timestamp: new Date().toISOString(),
        });
      }

      default: {
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
      }
    }
  } catch (error: unknown) {
    logger.error('[Market Data API] POST error', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to process request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
