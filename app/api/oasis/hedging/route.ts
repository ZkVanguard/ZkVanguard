import { NextRequest, NextResponse } from 'next/server';
import { getOasisOnChainHedgeService } from '@/lib/services/OasisOnChainHedgeService';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * Oasis Hedging API
 * 
 * Read hedge data from HedgeExecutor contract on Oasis Sapphire.
 * 
 * @see app/api/agents/hedging/onchain/route.ts (Cronos equivalent)
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';

    const service = getOasisOnChainHedgeService();

    let result;

    switch (action) {
      case 'status': {
        const count = await service.getHedgeCount();
        const contracts = service.getContractAddresses();
        result = {
          hedgeCount: count,
          contracts,
          network: process.env.NEXT_PUBLIC_OASIS_NETWORK || 'testnet',
        };
        break;
      }

      case 'hedge': {
        const id = searchParams.get('id');
        if (!id) {
          return NextResponse.json({ error: 'id parameter required' }, { status: 400 });
        }
        result = await service.getHedge(parseInt(id, 10));
        break;
      }

      case 'commitment': {
        const owner = searchParams.get('owner');
        const salt = searchParams.get('salt');
        if (!owner || !salt) {
          return NextResponse.json(
            { error: 'owner and salt parameters required' },
            { status: 400 },
          );
        }
        result = service.generateCommitment(owner, salt);
        break;
      }

      case 'contracts':
        result = service.getContractAddresses();
        break;

      case 'explorer': {
        const txHash = searchParams.get('txHash');
        if (!txHash) {
          return NextResponse.json({ error: 'txHash parameter required' }, { status: 400 });
        }
        result = { url: service.getExplorerUrl(txHash) };
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
    logger.error('[OasisHedgingAPI] Error', { error: String(error) });
    return safeErrorResponse(error, 'Oasis hedging');
  }
}
