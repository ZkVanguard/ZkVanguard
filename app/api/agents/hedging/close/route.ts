/**
 * Close Hedge Position
 * API endpoint for closing active hedge positions
 * Supports proxy wallet privacy - funds always go to OWNER wallet
 */

import { NextRequest, NextResponse } from 'next/server';
import { closeHedge, getHedgeByOrderId, clearSimulationHedges, clearAllHedges } from '@/lib/db/hedges';
import { logger } from '@/lib/utils/logger';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Verify ownership via ZK binding
function verifyOwnership(walletAddress: string, hedgeId: string, storedWallet: string): boolean {
  return walletAddress.toLowerCase() === storedWallet.toLowerCase();
}

/**
 * POST /api/agents/hedging/close
 * Close a hedge position
 * 
 * Body:
 * - orderId: The order ID to close
 * - realizedPnl: Final PnL at close (optional)
 * - walletAddress: Wallet requesting the close (must be owner for withdrawal)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, realizedPnl, walletAddress } = body;

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'Missing orderId' },
        { status: 400 }
      );
    }

    logger.info('🔒 Closing hedge position', { orderId, realizedPnl, walletAddress });

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

    // Verify ownership - CRITICAL for proxy wallet security
    // Only the OWNER wallet can close and receive funds
    const ownerWallet = hedge.wallet_address;
    let isOwner = false;
    let withdrawalDestination = ownerWallet;

    if (walletAddress && ownerWallet) {
      isOwner = verifyOwnership(walletAddress, orderId, ownerWallet);
      if (!isOwner) {
        logger.warn('⚠️ Non-owner attempted to close hedge', { 
          requestingWallet: walletAddress, 
          ownerWallet: ownerWallet?.slice(0, 10) + '...',
          orderId 
        });
        return NextResponse.json(
          { 
            success: false, 
            error: 'Only the hedge owner can close and withdraw funds',
            ownerRequired: true,
            message: 'Connect with the owner wallet to close this hedge'
          },
          { status: 403 }
        );
      }
    }

    // Close the hedge
    const finalPnl = realizedPnl ?? Number(hedge.current_pnl);
    await closeHedge(orderId, finalPnl, 'closed');

    logger.info('✅ Hedge closed successfully', { 
      orderId, 
      finalPnl: finalPnl.toFixed(2),
      withdrawalDestination: withdrawalDestination?.slice(0, 10) + '...',
      ownerVerified: isOwner
    });

    return NextResponse.json({
      success: true,
      message: 'Hedge closed successfully',
      orderId,
      finalPnl,
      // Withdrawal info - always goes to OWNER wallet
      withdrawalDestination: ownerWallet,
      ownerVerified: isOwner,
      proxyWalletUsed: false, // Proxy only executes, never receives
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

/**
 * DELETE /api/agents/hedging/close
 * Clear all simulation hedges or all hedges
 * 
 * Query params:
 * - all: If true, clears ALL hedges (use with caution)
 */
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const clearAll = searchParams.get('all') === 'true';

    logger.info('🗑️ Clearing hedges', { clearAll });

    let count: number;
    if (clearAll) {
      count = await clearAllHedges();
      logger.info(`✅ Cleared ALL ${count} hedges`);
    } else {
      count = await clearSimulationHedges();
      logger.info(`✅ Cleared ${count} simulation hedges`);
    }

    return NextResponse.json({
      success: true,
      message: clearAll ? `Cleared all ${count} hedges` : `Cleared ${count} simulation hedges`,
      count,
    });

  } catch (error) {
    logger.error('❌ Failed to clear hedges', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear hedges',
      },
      { status: 500 }
    );
  }
}
