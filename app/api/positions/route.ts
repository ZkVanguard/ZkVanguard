import { NextRequest, NextResponse } from 'next/server';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';
import { cryptocomExchangeService } from '@/lib/services/CryptocomExchangeService';

// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

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

    console.log(`[Positions API] Fetching positions for ${address}`);
    
    const marketData = getMarketDataService();
    const portfolioData = await marketData.getPortfolioData(address);
    
    console.log(`[Positions API] Found ${portfolioData.tokens.length} tokens, total value: $${portfolioData.totalValue}`);
    
    // Get prices with 24h change for each token - PARALLEL for speed
    // Using multi-source fallback: Crypto.com Exchange API → MCP → VVS → Cache → Mock
    const pricePromises = portfolioData.tokens.map(async (token) => {
      try {
        const priceData = await marketData.getTokenPrice(token.symbol);
        console.log(`📊 [Positions API] ${token.symbol}: $${priceData.price} from [${priceData.source}]`);
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
    
    // Sort by USD value descending
    positionsWithPrices.sort((a, b) => parseFloat(b.balanceUSD) - parseFloat(a.balanceUSD));
    
    // Check Exchange API health
    const exchangeHealthy = await cryptocomExchangeService.healthCheck();
    console.log(`🏥 [Positions API] Crypto.com Exchange API: ${exchangeHealthy ? '🟢 HEALTHY' : '🔴 DOWN'}`);
    
    return NextResponse.json({
      address: portfolioData.address,
      totalValue: portfolioData.totalValue,
      positions: positionsWithPrices,
      lastUpdated: portfolioData.lastUpdated,
      health: {
        exchangeAPI: exchangeHealthy,
        timestamp: Date.now(),
      },
    });
  } catch (error: any) {
    console.error('[Positions API] Error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to fetch positions', details: error?.message },
      { status: 500 }
    );
  }
}
