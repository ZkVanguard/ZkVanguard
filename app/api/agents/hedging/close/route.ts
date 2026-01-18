/**
 * Close Hedge Position
 * API endpoint for closing active hedge positions
 */

import { NextRequest, NextResponse } from 'next/server';
import { closeHedge, getHedgeByOrderId } from '@/lib/db/hedges';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/hedging/close
 * Close a hedge position
 * 
 * Body:
 * - orderId: The order ID to close
 * - realizedPnl: Final PnL at close (optional)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, realizedPnl } = body;

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'Missing orderId' },
        { status: 400 }
      );
    }

    logger.info('🔒 Closing hedge position', { orderId, realizedPnl });

    // Check if hedge exists
    const hedge = await getHedgeByOrderId(orderId);
    
    if (!hedge) {
      return NextResponse.json(
        { success: false, error: 'Hedge not found' },
        { status: 404 }
      );
    }

    if (hedge.status !== 'active') {
      return NextResponse.json(
        { success: false, error: `Hedge is already ${hedge.status}` },
        { status: 400 }
      );
    }

    // Close the hedge
    const finalPnl = realizedPnl ?? Number(hedge.current_pnl);
    await closeHedge(orderId, finalPnl, 'closed');

    logger.info('✅ Hedge closed successfully', { 
      orderId, 
      finalPnl: finalPnl.toFixed(2) 
    });

    return NextResponse.json({
      success: true,
      message: 'Hedge closed successfully',
      orderId,
      finalPnl,
    });

  } catch (error) {
    logger.error('❌ Failed to close hedge', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to close hedge',
      },
      { status: 500 }
    );
  }
}
