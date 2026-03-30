import { NextRequest, NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { requireAuth } from '@/lib/security/auth-middleware';
import { mutationLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';

export const runtime = 'nodejs';

// SECURITY: Demo routes are DISABLED in production to prevent unauthenticated hedge execution
const ALLOWED_MARKETS = ['BTC-USD-PERP', 'ETH-USD-PERP', 'CRO-USD-PERP'];
const MAX_NOTIONAL_VALUE = 100_000; // $100k max per demo trade
const MAX_LEVERAGE = 10;

/**
 * Live Moonlander Hedging Demo API
 * Executes real perpetual futures hedge via HedgingAgent
 * SECURITY: Requires authentication + rate limiting. Disabled in production.
 */
export async function POST(request: NextRequest) {
  // SECURITY: Block in production — demo routes must not execute real trades
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: 'Demo endpoints are disabled in production' },
      { status: 403 }
    );
  }

  // Rate limit
  const limited = mutationLimiter.check(request);
  if (limited) return limited;

  // Require authentication
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { 
      market = 'BTC-USD-PERP',
      side = 'SHORT',
      notionalValue = '1000',
      leverage = 2 
    } = body;

    // Input validation
    if (!ALLOWED_MARKETS.includes(market)) {
      return NextResponse.json(
        { success: false, error: `Invalid market. Allowed: ${ALLOWED_MARKETS.join(', ')}` },
        { status: 400 }
      );
    }
    if (!['LONG', 'SHORT'].includes(side)) {
      return NextResponse.json(
        { success: false, error: 'Side must be LONG or SHORT' },
        { status: 400 }
      );
    }
    const numNotional = parseFloat(notionalValue);
    if (!isFinite(numNotional) || numNotional <= 0 || numNotional > MAX_NOTIONAL_VALUE) {
      return NextResponse.json(
        { success: false, error: `notionalValue must be between 0 and ${MAX_NOTIONAL_VALUE}` },
        { status: 400 }
      );
    }
    const numLeverage = Number(leverage);
    if (!isFinite(numLeverage) || numLeverage < 1 || numLeverage > MAX_LEVERAGE) {
      return NextResponse.json(
        { success: false, error: `leverage must be between 1 and ${MAX_LEVERAGE}` },
        { status: 400 }
      );
    }

    const orchestrator = getAgentOrchestrator();
    
    // Execute real hedge via HedgingAgent + MoonlanderClient
    const result = await orchestrator.executeHedge({
      market,
      side: side as 'LONG' | 'SHORT',
      notionalValue,
      leverage: numLeverage,
    });

    if (result.success) {
      const data = result.data as Record<string, unknown>;
      return NextResponse.json({
        success: true,
        hedge: {
          orderId: data.orderId,
          market: data.market,
          side: data.side,
          size: data.size,
          filledSize: data.filledSize,
          avgFillPrice: data.avgFillPrice,
          status: data.status,
        },
        agentId: result.agentId,
        executionTime: result.executionTime,
        platform: 'Moonlander',
        live: true,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { 
        success: false,
        error: 'Hedge execution failed',
      },
      { status: 500 }
    );
  } catch (error) {
    return safeErrorResponse(error, 'demo/moonlander-hedge');
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'Live Moonlander Hedging Demo operational',
    features: [
      'Real perpetual futures execution',
      'AI-driven hedge analysis',
      'Automatic position management',
      'Stop-loss & take-profit orders',
    ],
    markets: ['BTC-USD-PERP', 'ETH-USD-PERP', 'CRO-USD-PERP'],
  });
}
