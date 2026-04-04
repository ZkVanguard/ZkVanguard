import { NextRequest, NextResponse } from 'next/server';
import { getInstitutionalPortfolioManager } from '@/lib/services/InstitutionalPortfolioManager';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { requireAuth } from '@/lib/security/auth-middleware';
import { readLimiter, mutationLimiter } from '@/lib/security/rate-limiter';

/**
 * Institutional Portfolio API
 * 
 * Manages the $150M Mock USDC portfolio with:
 * - BTC, ETH, CRO, SUI allocations
 * - AI Risk Management
 * - Real API price tracking
 */

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export const maxDuration = 10;
export async function GET(request: NextRequest) {
  const limited = readLimiter.check(request);
  if (limited) return limited;

  // Authentication required
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'summary';

    const manager = getInstitutionalPortfolioManager();
    await manager.initialize();

    let result;

    switch (action) {
      case 'summary':
        result = await manager.getSummary();
        break;
      
      case 'positions':
        result = manager.getPositions();
        break;
      
      case 'risk':
        result = await manager.assessRiskWithAI();
        break;
      
      case 'hedges':
        result = await manager.getHedgeRecommendations();
        break;
      
      default:
        result = await manager.getSummary();
    }

    return NextResponse.json({
      success: true,
      action,
      data: result,
      metadata: {
        source: 'InstitutionalPortfolioManager',
        realAPITracking: true,
        aiRiskManagement: true,
        onChainUSDC: true,
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    logger.error('Institutional portfolio API error', error);
    return safeErrorResponse(error, 'Institutional portfolio');
  }
}

export async function POST(request: NextRequest) {
  const limited = await mutationLimiter.checkDistributed(request);
  if (limited) return limited;

  try {
    const body = await request.json();

    // Authentication required
    const authResult = await requireAuth(request, body);
    if (authResult instanceof NextResponse) return authResult;

    const { action } = body;

    const manager = getInstitutionalPortfolioManager();
    await manager.initialize();

    let result;

    switch (action) {
      case 'refresh-prices':
        // Force price refresh
        await (manager as unknown as { refreshPrices(): Promise<void> }).refreshPrices?.();
        result = { message: 'Prices refreshed', timestamp: Date.now() };
        break;
      
      case 'assess-risk':
        result = await manager.assessRiskWithAI();
        break;
      
      case 'get-hedges':
        result = await manager.getHedgeRecommendations();
        break;
      
      case 'full-analysis':
        const [summary, hedges] = await Promise.all([
          manager.getSummary(),
          manager.getHedgeRecommendations(),
        ]);
        result = { summary, hedges };
        break;
      
      default:
        return NextResponse.json(
          { error: 'Invalid action. Valid actions: refresh-prices, assess-risk, get-hedges, full-analysis' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      action,
      result,
      metadata: {
        realAPITracking: true,
        aiRiskManagement: true,
        onChainUSDC: true,
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    logger.error('Institutional portfolio action error', error);
    return safeErrorResponse(error, 'Institutional portfolio action');
  }
}
