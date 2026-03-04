import { NextRequest, NextResponse } from 'next/server';
import { getOasisPortfolioManager } from '@/lib/services/OasisPortfolioManager';
import { logger } from '@/lib/utils/logger';

// Force dynamic rendering (uses request.url)
export const dynamic = 'force-dynamic';

/**
 * Oasis On-Chain Portfolio API
 * 
 * Manages portfolios on Oasis Sapphire using the RWAManager contract.
 * 
 * @see app/api/portfolio/onchain/route.ts (Cronos equivalent)
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'summary';
    const address = searchParams.get('address');

    const manager = getOasisPortfolioManager();
    await manager.initialize(address || undefined);

    let result;

    switch (action) {
      case 'summary':
        result = await manager.getSummary();
        break;

      case 'positions':
        result = manager.getPositions();
        break;

      case 'risk':
        result = await manager.getRiskMetrics();
        break;

      case 'balance': {
        const balance = await manager.getRoseBalance();
        result = {
          rose: {
            raw: balance.raw,
            formatted: balance.formatted,
            symbol: 'ROSE',
            decimals: 18,
          },
        };
        break;
      }

      case 'contracts':
        result = manager.getContractAddresses();
        break;

      case 'count': {
        const count = await manager.getPortfolioCount();
        result = { portfolioCount: count };
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      action,
      chain: 'oasis-sapphire',
      network: process.env.NEXT_PUBLIC_OASIS_NETWORK || 'testnet',
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[OasisPortfolioAPI] Error', { error: String(error) });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        chain: 'oasis-sapphire',
      },
      { status: 500 },
    );
  }
}
