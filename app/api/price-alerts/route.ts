/**
 * Price Alert Status & Manual Trigger API
 * 
 * GET: View current price alert status
 * POST: Manually trigger monitoring (hedge, heartbeat, pool-nav)
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  getPriceAlertStatus, 
  manualTriggerHedgeCheck,
  forceHeartbeat,
  triggerPoolNavUpdate,
} from '@/lib/services/PriceAlertWebhook';
import { logger } from '@/lib/utils/logger';

export const dynamic = 'force-dynamic';

/**
 * GET: Get current price alert status
 */
export async function GET() {
  const status = getPriceAlertStatus();
  
  return NextResponse.json({
    success: true,
    priceAlerts: {
      system: 'webhook-trigger',
      mode: 'event-driven (no cron jobs)',
      description: 'All monitoring triggers from price API activity and heartbeats',
      thresholds: {
        hedgeCheck: '2% move in 1h → Check hedge positions',
        stopLossCheck: '5% move in 1h → Trigger stop-loss/take-profit',
        emergency: '10% move → Emergency liquidation guard',
      },
      heartbeat: 'Every 4h or 100 price requests → Full monitoring cycle',
      ...status,
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST: Manually trigger monitoring
 * Body: { action: 'hedge' | 'heartbeat' | 'pool-nav', asset?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action = 'hedge', asset } = body;
    
    let message = '';
    
    switch (action) {
      case 'hedge':
        logger.info(`[PriceAlerts API] Manual hedge check triggered${asset ? ` for ${asset}` : ''}`);
        await manualTriggerHedgeCheck(asset);
        message = `Hedge check triggered${asset ? ` for ${asset}` : ' for all assets'}`;
        break;
        
      case 'heartbeat':
        logger.info('[PriceAlerts API] Manual heartbeat triggered');
        await forceHeartbeat();
        message = 'Full monitoring heartbeat triggered (hedge + liquidation + pool-nav)';
        break;
        
      case 'pool-nav':
        logger.info('[PriceAlerts API] Manual pool NAV update triggered');
        await triggerPoolNavUpdate();
        message = 'Pool NAV monitoring triggered';
        break;
        
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}. Use: hedge, heartbeat, or pool-nav` },
          { status: 400 }
        );
    }
    
    return NextResponse.json({
      success: true,
      action,
      message,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('[PriceAlerts API] Error:', { error: error?.message });
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to trigger monitoring' },
      { status: 500 }
    );
  }
}
