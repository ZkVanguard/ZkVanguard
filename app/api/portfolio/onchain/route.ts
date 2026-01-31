import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';

// Force dynamic rendering (uses request.url)
export const dynamic = 'force-dynamic';

/**
 * On-Chain Portfolio API
 * Fetches real portfolio data from Cronos blockchain
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let address = searchParams.get('address');
    
    // If no address provided, use server wallet
    if (!address) {
      const pk = process.env.PRIVATE_KEY || 
                 process.env.AGENT_PRIVATE_KEY || 
                 process.env.SERVER_WALLET_PRIVATE_KEY;
      
      if (pk) {
        const wallet = new ethers.Wallet(pk);
        address = wallet.address;
      }
    }

    if (!address) {
      return NextResponse.json(
        { error: 'No wallet address provided and no server wallet configured' },
        { status: 400 }
      );
    }

    // Fetch real on-chain data
    const marketData = getMarketDataService();
    const portfolioData = await marketData.getPortfolioData(address);

    // Transform to standard portfolio format
    const positions = portfolioData.tokens.map(token => ({
      symbol: token.symbol,
      amount: parseFloat(token.balance),
      currentPrice: token.usdValue / parseFloat(token.balance),
      value: token.usdValue,
      averageCost: token.usdValue / parseFloat(token.balance), // Assume bought at current price
      pnl: 0,
      pnlPercentage: 0,
      lastUpdated: portfolioData.lastUpdated,
    }));

    return NextResponse.json({
      success: true,
      portfolio: {
        address,
        totalValue: portfolioData.totalValue,
        cash: 0, // On-chain doesn't have "cash" concept
        positions,
        totalPnl: 0,
        totalPnlPercentage: 0,
      },
      source: 'onchain',
      network: 'cronos-testnet',
      lastUpdated: portfolioData.lastUpdated,
    });
  } catch (error) {
    console.error('On-chain portfolio error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch on-chain portfolio', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
