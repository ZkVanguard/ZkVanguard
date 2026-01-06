import { NextRequest, NextResponse } from 'next/server';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';

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
    
    // Get prices with 24h change for each token
    const positionsWithPrices = [];
    
    for (const token of portfolioData.tokens) {
      try {
        const priceData = await marketData.getTokenPrice(token.symbol);
        positionsWithPrices.push({
          symbol: token.symbol,
          balance: token.balance,
          usdValue: token.usdValue,
          price: priceData.price,
          change24h: priceData.change24h,
          token: token.token,
        });
      } catch {
        positionsWithPrices.push({
          symbol: token.symbol,
          balance: token.balance,
          usdValue: token.usdValue,
          price: token.usdValue / parseFloat(token.balance || '1'),
          change24h: 0,
          token: token.token,
        });
      }
    }
    
    // Sort by USD value descending
    positionsWithPrices.sort((a, b) => b.usdValue - a.usdValue);
    
    return NextResponse.json({
      address: portfolioData.address,
      totalValue: portfolioData.totalValue,
      positions: positionsWithPrices,
      lastUpdated: portfolioData.lastUpdated,
    });
  } catch (error: any) {
    console.error('[Positions API] Error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to fetch positions', details: error?.message },
      { status: 500 }
    );
  }
}
