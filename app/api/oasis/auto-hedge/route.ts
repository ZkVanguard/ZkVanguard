import { NextRequest, NextResponse } from 'next/server';
import { getOasisAutoHedgingAdapter } from '@/lib/services/OasisAutoHedgingAdapter';
import { logger } from '@/lib/utils/logger';
import { requireAuth, requireAdminAuth } from '@/lib/security/auth-middleware';
import { readLimiter, mutationLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export const maxDuration = 15;
/**
 * Oasis Auto-Hedging API
 * 
 * Manages the automated hedging service for Oasis Sapphire portfolios.
 * 
 * GET — status, risk assessment, active hedges (rate-limited)
 * POST — enable/disable auto-hedging for an address (requires auth)
 * 
 * SECURITY: POST requires authentication. start/stop require admin auth.
 */

export async function GET(request: NextRequest) {
  const limited = readLimiter.check(request);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';
    const address = searchParams.get('address');

    const adapter = getOasisAutoHedgingAdapter();

    let result;

    switch (action) {
      case 'status':
        result = adapter.getStatus();
        break;

      case 'hedges':
        result = adapter.getActiveHedges();
        break;

      case 'risk': {
        if (!address) {
          return NextResponse.json(
            { error: 'address parameter required for risk assessment' },
            { status: 400 },
          );
        }
        result = await adapter.assessRisk(address);
        break;
      }

      case 'last-risk': {
        if (!address) {
          return NextResponse.json(
            { error: 'address parameter required' },
            { status: 400 },
          );
        }
        result = adapter.getLastRisk(address) || { message: 'No risk assessment available' };
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      action,
      chain: 'oasis-sapphire',
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return safeErrorResponse(error, 'oasis/auto-hedge GET');
  }
}

export async function POST(request: NextRequest) {
  // Rate limit mutations
  const limited = mutationLimiter.check(request);
  if (limited) return limited;

  // SECURITY: Require auth for all POST actions
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { action, ownerAddress, enabled, riskThreshold, maxLeverage, allowedAssets } = body;

    const adapter = getOasisAutoHedgingAdapter();

    switch (action) {
      case 'enable': {
        if (!ownerAddress) {
          return NextResponse.json(
            { error: 'ownerAddress required' },
            { status: 400 },
          );
        }

        adapter.enableForAddress({
          ownerAddress,
          enabled: enabled !== false,
          riskThreshold: riskThreshold || 5,
          maxLeverage: maxLeverage || 3,
          allowedAssets: allowedAssets || ['ROSE', 'BTC', 'ETH'],
        });

        // Start the adapter if not already running
        await adapter.start();

        return NextResponse.json({
          success: true,
          action: 'enable',
          chain: 'oasis-sapphire',
          data: adapter.getStatus(),
        });
      }

      case 'disable': {
        if (!ownerAddress) {
          return NextResponse.json(
            { error: 'ownerAddress required' },
            { status: 400 },
          );
        }
        adapter.disableForAddress(ownerAddress);
        return NextResponse.json({
          success: true,
          action: 'disable',
          chain: 'oasis-sapphire',
          data: adapter.getStatus(),
        });
      }

      case 'start': {
        // SECURITY: start/stop are admin-only operations
        const adminCheck = requireAdminAuth(request);
        if (adminCheck !== true) return adminCheck;
        await adapter.start();
        return NextResponse.json({
          success: true,
          action: 'start',
          data: adapter.getStatus(),
        });
      }

      case 'stop': {
        // SECURITY: start/stop are admin-only operations
        const adminCheck = requireAdminAuth(request);
        if (adminCheck !== true) return adminCheck;
        adapter.stop();
        return NextResponse.json({
          success: true,
          action: 'stop',
          data: adapter.getStatus(),
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return safeErrorResponse(error, 'oasis/auto-hedge POST');
  }
}
