/**
 * Get Real-time Hedge PnL
 * API endpoint for fetching current profit/loss on active hedges using real market data
 */

import { NextRequest, NextResponse } from 'next/server';
import { hedgePnLTracker } from '@/lib/services/HedgePnLTracker';
import { getActiveHedges, getHedgeByOrderId, getActiveHedgesByWallet } from '@/lib/db/hedges';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/hedging/pnl
 * Get real-time PnL for active hedges
 * 
 * Query params:
 * - orderId: Get PnL for specific hedge (optional)
 * - portfolioId: Filter by portfolio (optional)
 * - walletAddress: Filter by wallet address (optional)
 * - summary: Get portfolio summary (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const orderId = searchParams.get('orderId');
    const portfolioId = searchParams.get('portfolioId');
    const walletAddress = searchParams.get('walletAddress');
    const summary = searchParams.get('summary') === 'true';

    logger.info('📊 Fetching hedge PnL', { orderId, portfolioId, walletAddress, summary });

    // Single hedge PnL
    if (orderId) {
      const hedge = await getHedgeByOrderId(orderId);
      
      if (!hedge) {
        return NextResponse.json(
          { success: false, error: 'Hedge not found' },
          { status: 404 }
        );
      }

      if (hedge.status !== 'active') {
        return NextResponse.json({
          success: true,
          hedge: {
            orderId: hedge.order_id,
            status: hedge.status,
            realizedPnL: hedge.realized_pnl,
            message: 'Hedge is not active',
          },
        });
      }

      const pnl = await hedgePnLTracker.getHedgePnL(hedge);

      return NextResponse.json({
        success: true,
        pnl,
      });
    }

    // Portfolio summary
    if (summary) {
      const summaryData = await hedgePnLTracker.getPortfolioPnLSummary(
        portfolioId ? parseInt(portfolioId) : undefined,
        walletAddress || undefined
      );

      return NextResponse.json({
        success: true,
        summary: summaryData,
      });
    }

    // All active hedges with PnL
    let hedges;
    if (walletAddress) {
      hedges = await getActiveHedgesByWallet(walletAddress);
    } else {
      hedges = await getActiveHedges(portfolioId ? parseInt(portfolioId) : undefined);
    }
    
    const pnlUpdates = await Promise.all(
      hedges.map(hedge => hedgePnLTracker.getHedgePnL(hedge))
    );

    return NextResponse.json({
      success: true,
      hedges: pnlUpdates,
      count: pnlUpdates.length,
    });

  } catch (error) {
    logger.error('❌ Failed to fetch hedge PnL', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch PnL',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agents/hedging/pnl
 * Manually trigger PnL update for all active hedges
 */
export async function POST() {
  try {
    logger.info('🔄 Manual PnL update triggered');

    const updates = await hedgePnLTracker.updateAllHedges();

    return NextResponse.json({
      success: true,
      message: `Updated PnL for ${updates.length} hedges`,
      updates,
    });

  } catch (error) {
    logger.error('❌ Manual PnL update failed', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'PnL update failed',
      },
      { status: 500 }
    );
  }
}
