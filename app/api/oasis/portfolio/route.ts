import { NextRequest, NextResponse } from 'next/server';
import { getOasisPortfolioManager } from '@/lib/services/oasis/OasisPortfolioManager';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { readLimiter } from '@/lib/security/rate-limiter';

export const runtime = 'nodejs';
export const maxDuration = 15;

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
  const limited = readLimiter.check(request);
  if (limited) return limited;

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
    return safeErrorResponse(error, 'Oasis portfolio');
  }
}
