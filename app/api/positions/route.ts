import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';
import { cryptocomExchangeService } from '@/lib/services/CryptocomExchangeService';
import { readLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { getCached, setCached } from '@/lib/db/ui-cache';

export const runtime = 'nodejs';

export const maxDuration = 10;
// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

// Two-tier cache: In-memory (fast) + DB (survives cold starts)
// LRU eviction to prevent memory bloat across many users
const MAX_POSITIONS_CACHE = 500;
const positionsCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

async function getDbCachedPositions(address: string): Promise<unknown | null> {
  try {
    return await getCached('portfolio', `positions:${address.toLowerCase()}`);
  } catch {
    return null;
  }
}

async function setAllPositionsCaches(address: string, data: unknown): Promise<void> {
  // LRU: evict oldest entries if at capacity
  if (positionsCache.size >= MAX_POSITIONS_CACHE && !positionsCache.has(address)) {
    const firstKey = positionsCache.keys().next().value;
    if (firstKey !== undefined) positionsCache.delete(firstKey);
  }
  positionsCache.delete(address); // refresh LRU position
  positionsCache.set(address, { data, timestamp: Date.now() });
  setCached('portfolio', `positions:${address.toLowerCase()}`, data, CACHE_TTL).catch(err => logger.warn('Positions cache write failed', { error: String(err) }));
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = readLimiter.check(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    
    if (!address) {
      return NextResponse.json(
        { error: 'Address parameter is required' },
        { status: 400 }
      );
    }

    // Check cache first (two-tier: memory → DB)
    const memCached = positionsCache.get(address);
    if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
      logger.info(`[Positions API] Memory cache HIT for ${address}`);
      return NextResponse.json(memCached.data);
    }
    
    // Tier 2: DB cache (survives cold starts)
    const dbCached = await getDbCachedPositions(address);
    if (dbCached) {
      positionsCache.set(address, { data: dbCached, timestamp: Date.now() });
      logger.info(`[Positions API] DB cache HIT (cold start recovery) for ${address}`);
      return NextResponse.json(dbCached);
    }

    logger.info(`[Positions API] Cache MISS - fetching positions for ${address}`);
    const startTime = Date.now();
    
    const marketData = getMarketDataService();
    const portfolioDataStart = Date.now();
    const portfolioData = await marketData.getPortfolioData(address);
    logger.info(`[Positions API] Portfolio data fetched in ${Date.now() - portfolioDataStart}ms`);
    
    logger.info(`[Positions API] Found ${portfolioData.tokens.length} tokens, total value: $${portfolioData.totalValue}`);
    
    // Get extended prices with 24h high/low for volatility calculation - SINGLE BATCH
    // Using multi-source fallback: Crypto.com Exchange API → MCP → VVS → Cache → Mock
    const pricesStart = Date.now();
    const symbols = portfolioData.tokens.map(t => t.symbol);
    const extendedPrices = await marketData.getExtendedPrices(symbols);
    
    const positionsWithPrices = portfolioData.tokens.map((token) => {
      const priceData = extendedPrices.get(token.symbol.toUpperCase());
      
      if (priceData && priceData.price > 0) {
        // Calculate real volatility from 24h price range
        // Intraday volatility = (high - low) / price (annualized ≈ × √252)
        const range = priceData.high24h - priceData.low24h;
        const intradayVol = priceData.price > 0 ? range / priceData.price : 0;
        const annualizedVol = intradayVol * Math.sqrt(252); // Annualize
        
        logger.info(`[Positions API] ${token.symbol}: $${priceData.price} vol=${(annualizedVol * 100).toFixed(1)}% from [${priceData.source}]`);
        
        return {
          symbol: token.symbol,
          balance: token.balance,
          balanceUSD: token.usdValue.toFixed(2),
          price: priceData.price.toFixed(2),
          change24h: priceData.change24h,
          high24h: priceData.high24h,
          low24h: priceData.low24h,
          volatility: annualizedVol, // Real volatility from market data
          token: token.token,
          source: priceData.source,
        };
      }
      
      // Fallback with default volatility
      logger.info(`[Positions API] ${token.symbol}: fallback (no market data)`);
      return {
        symbol: token.symbol,
        balance: token.balance,
        balanceUSD: token.usdValue.toFixed(2),
        price: (token.usdValue / parseFloat(token.balance || '1')).toFixed(2),
        change24h: 0,
        high24h: 0,
        low24h: 0,
        volatility: 0.30, // Default 30% for unknown tokens
        token: token.token,
        source: 'fallback',
      };
    });
    logger.info(`[Positions API] All prices fetched in ${Date.now() - pricesStart}ms`);
    
    // Sort by USD value descending
    positionsWithPrices.sort((a, b) => parseFloat(b.balanceUSD) - parseFloat(a.balanceUSD));
    
    // Check Exchange API health (don't await - run in parallel)
    const exchangeHealthPromise = cryptocomExchangeService.healthCheck();
    
    const response = {
      address: portfolioData.address,
      totalValue: portfolioData.totalValue,
      positions: positionsWithPrices,
      lastUpdated: portfolioData.lastUpdated,
      health: {
        exchangeAPI: await exchangeHealthPromise,
        timestamp: Date.now(),
      },
    };

    // Cache the response (two-tier: memory + DB)
    await setAllPositionsCaches(address, response);
    logger.info(`[Positions API] Cached positions (memory + DB) for ${address}`);
    logger.info(`[Positions API] Total request time: ${Date.now() - startTime}ms`);
    
    // Return with SWR cache headers for smooth UI
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
        'Vary': 'Accept-Encoding',
      },
    });
  } catch (error: unknown) {
    return safeErrorResponse(error, 'Positions fetch');
  }
}
