import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';
import { cryptocomExchangeService } from '@/lib/services/CryptocomExchangeService';

// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

// In-memory cache for positions (30s TTL)
const positionsCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    
    if (!address) {
      return NextResponse.json(
        { error: 'Address parameter is required' },
        { status: 400 }
      );
    }

    // Check cache first
    const cached = positionsCache.get(address);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      logger.info(`[Positions API] Cache HIT for ${address}`);
      return NextResponse.json(cached.data);
    }

    logger.info(`[Positions API] Cache MISS - fetching positions for ${address}`);
    const startTime = Date.now();
    
    const marketData = getMarketDataService();
    const portfolioDataStart = Date.now();
    const portfolioData = await marketData.getPortfolioData(address);
    logger.info(`[Positions API] Portfolio data fetched in ${Date.now() - portfolioDataStart}ms`);
    
    logger.info(`[Positions API] Found ${portfolioData.tokens.length} tokens, total value: $${portfolioData.totalValue}`);
    
    // Get prices with 24h change for each token - PARALLEL for speed
    // Using multi-source fallback: Crypto.com Exchange API → MCP → VVS → Cache → Mock
    const pricesStart = Date.now();
    const pricePromises = portfolioData.tokens.map(async (token) => {
      const tokenStart = Date.now();
      try {
        const priceData = await marketData.getTokenPrice(token.symbol);
        logger.info(`[Positions API] ${token.symbol}: $${priceData.price} from [${priceData.source}] (${Date.now() - tokenStart}ms)`);
        return {
          symbol: token.symbol,
          balance: token.balance,
          balanceUSD: token.usdValue.toFixed(2),
          price: priceData.price.toFixed(2),
          change24h: priceData.change24h,
          token: token.token,
          source: priceData.source,
        };
      } catch {
        logger.info(`[Positions API] ${token.symbol}: fallback (${Date.now() - tokenStart}ms)`);
        return {
          symbol: token.symbol,
          balance: token.balance,
          balanceUSD: token.usdValue.toFixed(2),
          price: (token.usdValue / parseFloat(token.balance || '1')).toFixed(2),
          change24h: 0,
          token: token.token,
          source: 'fallback',
        };
      }
    });
    
    const positionsWithPrices = await Promise.all(pricePromises);
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

    // Cache the response
    positionsCache.set(address, { data: response, timestamp: Date.now() });
    logger.info(`[Positions API] Cached positions for ${address}`);
    logger.info(`[Positions API] Total request time: ${Date.now() - startTime}ms`);
    
    // Return with SWR cache headers for smooth UI
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
        'Vary': 'Accept-Encoding',
      },
    });
  } catch (error: unknown) {
    logger.error('[Positions API] Error', error);
    return NextResponse.json(
      { error: 'Failed to fetch positions', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
