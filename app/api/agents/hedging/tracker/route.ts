/**
 * Control Hedge PnL Tracker
 * API endpoint to start/stop automatic PnL tracking
 */

import { NextRequest, NextResponse } from 'next/server';
import { hedgePnLTracker } from '@/lib/services/HedgePnLTracker';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/hedging/tracker
 * Check tracker status
 */
export async function GET() {
  const isRunning = hedgePnLTracker.isTrackingActive();

  return NextResponse.json({
    success: true,
    tracking: isRunning,
    message: isRunning ? 'Tracker is running' : 'Tracker is stopped',
  });
}

/**
 * POST /api/agents/hedging/tracker
 * Start or stop tracker
 * 
 * Body: { action: 'start' | 'stop' }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (!action || !['start', 'stop'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Use "start" or "stop"' },
        { status: 400 }
      );
    }

    if (action === 'start') {
      hedgePnLTracker.startTracking();
      logger.info('🚀 PnL tracker started via API');
      
      return NextResponse.json({
        success: true,
        message: 'PnL tracker started',
        tracking: true,
      });
    } else {
      hedgePnLTracker.stopTracking();
      logger.info('⏸️ PnL tracker stopped via API');
      
      return NextResponse.json({
        success: true,
        message: 'PnL tracker stopped',
        tracking: false,
      });
    }

  } catch (error) {
    logger.error('❌ Failed to control tracker', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to control tracker',
      },
      { status: 500 }
    );
  }
}
