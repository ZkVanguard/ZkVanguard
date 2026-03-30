import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { cryptocomExchangeService } from '@/lib/services/CryptocomExchangeService';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';
import { getCachedPrice, getCachedPrices, upsertPrices } from '@/lib/db/prices';
import { recordPriceUpdate } from '@/lib/services/PriceAlertWebhook';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { validatePrice, seedPrice } from '@/lib/security/price-circuit-breaker';
import { batchPriceCoalescer, priceCoalescer } from '@/lib/utils/request-coalescer';
import { readLimiter } from '@/lib/security/rate-limiter';

export const runtime = 'nodejs';

// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

/**
 * Enhanced Market Data API using Crypto.com Exchange API
 * Supports both single and batch price queries
 */
export async function GET(request: NextRequest) {
  const limited = readLimiter.check(request);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const symbols = searchParams.get('symbols')?.split(',').map(s => s.trim());
    const source = searchParams.get('source') || 'auto'; // 'auto', 'exchange', 'fallback'

    // Batch request
    if (symbols && symbols.length > 0) {
      logger.info(`[Market Data API] Fetching batch prices for: ${symbols.join(', ')}`);
      
      if (source === 'exchange') {
        // Direct from Exchange API — coalesced to deduplicate concurrent requests
        const cacheKey = `exchange:${symbols.sort().join(',')}`;
        const prices = await batchPriceCoalescer.get(cacheKey, () =>
          cryptocomExchangeService.getBatchPrices(symbols)
        );
        
        // ═══ CIRCUIT BREAKER: Validate prices before use ═══
        const validatedPrices: Record<string, number> = {};
        Object.entries(prices).forEach(([sym, price]) => {
          const result = validatePrice(sym, price);
          if (result.accepted) {
            validatedPrices[sym] = price;
            recordPriceUpdate(sym, price);
          }
        });
        
        return NextResponse.json({
          success: true,
          data: Object.entries(validatedPrices).map(([sym, price]) => ({
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
        
        // ═══ CIRCUIT BREAKER + WEBHOOK TRIGGER ═══
        const validatedPrices = prices.filter(p => {
          const result = validatePrice(p.symbol, p.price);
          if (result.accepted) {
            recordPriceUpdate(p.symbol, p.price);
            return true;
          }
          return false;
        });
        
        return NextResponse.json({
          success: true,
          data: validatedPrices.map(p => ({
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
    // Use fast timeout to prevent serverless cold start issues
    if (source === 'auto') {
      try {
        const cached = await Promise.race([
          getCachedPrice(symbol, 30_000),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)) // 2s timeout
        ]);
        if (cached) {
          // Seed circuit breaker with known-good cached price
          seedPrice(cached.symbol, cached.price);
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
      } catch (cacheError) {
        logger.warn(`[Market Data API] DB cache timeout/error for ${symbol}, proceeding to fetch`);
      }
      logger.info(`[Market Data API] Cache MISS for ${symbol} — fetching from Crypto.com`);
    }

    logger.info(`[Market Data API] Fetching price for ${symbol} (source: ${source})`);

    if (source === 'exchange') {
      // Direct from Exchange API with full market data — coalesced
      const marketData = await priceCoalescer.get(`exchange:${symbol}`, async () => {
        const md = await cryptocomExchangeService.getMarketData(symbol);
        return { symbol: md.symbol, price: md.price, change24h: md.change24h, volume24h: md.volume24h, source: md.source };
      });
      
      // ═══ CIRCUIT BREAKER: Validate before accepting ═══
      const cbResult = validatePrice(marketData.symbol, marketData.price);
      if (!cbResult.accepted) {
        logger.warn(`[Market Data API] Circuit breaker rejected ${symbol}: ${cbResult.reason}`);
        return NextResponse.json(
          { success: false, error: `Price rejected: ${cbResult.reason}` },
          { status: 422 }
        );
      }
      
      // Cache in DB for other routes
      upsertPrices([{
        symbol: marketData.symbol,
        price: marketData.price,
        change24h: marketData.change24h,
        volume24h: marketData.volume24h,
        source: marketData.source,
      }]).catch(() => {});
      
      recordPriceUpdate(marketData.symbol, marketData.price);
      
      return NextResponse.json({
        success: true,
        data: {
          symbol: marketData.symbol,
          price: marketData.price,
          change24h: marketData.change24h,
          volume24h: marketData.volume24h,
          source: marketData.source,
        },
        source: 'cryptocom-exchange',
        timestamp: new Date().toISOString(),
      });
    } else {
      // Use fallback system (auto) with timeout
      const marketData = getMarketDataService();
      
      // Race with 8s timeout to prevent Vercel function timeout
      const price = await Promise.race([
        marketData.getTokenPrice(symbol),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Price fetch timeout')), 8000))
      ]);
      
      if (!price) {
        throw new Error('Price fetch returned null');
      }
      
      // ═══ CIRCUIT BREAKER: Validate before accepting ═══
      const cbResult = validatePrice(price.symbol, price.price);
      if (!cbResult.accepted) {
        logger.warn(`[Market Data API] Circuit breaker rejected ${symbol}: ${cbResult.reason}`);
        return NextResponse.json(
          { success: false, error: `Price rejected: ${cbResult.reason}` },
          { status: 422 }
        );
      }
      
      // Cache in DB (fire and forget)
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
    
    // Return error — do NOT return stale hardcoded prices as if they are valid
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    
    logger.error(`[Market Data API] All price sources failed for ${symbol || 'unknown'}`, { error });
    
    return NextResponse.json({
      success: false,
      error: 'All price sources unavailable',
      symbol: symbol?.toUpperCase(),
      timestamp: new Date().toISOString(),
    }, { 
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
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
    return safeErrorResponse(error, 'Price data operation');
  }
}
