import { NextRequest, NextResponse } from 'next/server';
import { getOasisPoolStats, getOasisMemberPosition } from '@/lib/services/OasisCommunityPoolService';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * Oasis Community Pool API
 * 
 * Reads community pool state from the CommunityPool contract on Oasis Sapphire.
 * 
 * @see app/api/community-pool/route.ts (Cronos equivalent)
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'stats';
    const address = searchParams.get('address');

    let result;

    switch (action) {
      case 'stats':
        result = await getOasisPoolStats();
        break;

      case 'position': {
        if (!address) {
          return NextResponse.json(
            { error: 'address parameter required for position query' },
            { status: 400 },
          );
        }
        result = await getOasisMemberPosition(address);
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
    logger.error('[OasisCommunityPoolAPI] Error', { error: String(error) });
    return safeErrorResponse(error, 'Oasis community pool');
  }
}
