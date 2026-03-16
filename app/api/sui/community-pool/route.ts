/**
 * SUI Community Pool API
 * 
 * Endpoints:
 * - GET  /api/sui/community-pool              - Get pool summary
 * - GET  /api/sui/community-pool?user=0x...   - Get user's position
 * - GET  /api/sui/community-pool?action=members - Get all members
 * - GET  /api/sui/community-pool?action=contract - Get contract info
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { getSuiCommunityPoolService } from '@/lib/services/SuiCommunityPoolService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type NetworkType = 'testnet' | 'mainnet';

function getNetwork(request: NextRequest): NetworkType {
  const url = new URL(request.url);
  const network = url.searchParams.get('network');
  return network === 'mainnet' ? 'mainnet' : 'testnet';
}

// ============================================================================
// GET Handler
// ============================================================================

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const user = url.searchParams.get('user');
    const network = getNetwork(request);
    
    logger.info('[SUI-API] Request', { action, user, network });
    
    const service = getSuiCommunityPoolService(network);
    
    // Get contract info
    if (action === 'contract') {
      const info = service.getContractInfo();
      return NextResponse.json({
        success: true,
        data: info,
        chain: 'sui',
        network,
      });
    }
    
    // Get all members
    if (action === 'members') {
      const members = await service.getAllMembers();
      return NextResponse.json({
        success: true,
        data: {
          members,
          count: members.length,
        },
        chain: 'sui',
        network,
      });
    }
    
    // Get specific user's position
    if (user) {
      const position = await service.getMemberPosition(user);
      const stats = await service.getPoolStats();
      
      // Calculate percentage of pool
      const percentage = stats.totalShares > 0 && position.shares > 0
        ? (position.shares / stats.totalShares) * 100
        : 0;
      
      return NextResponse.json({
        success: true,
        data: {
          address: position.address,
          shares: position.shares.toFixed(4),
          valueSui: position.valueSui.toFixed(4),
          valueUsd: position.valueUsd.toFixed(2),
          percentage: percentage.toFixed(4),
          joinedAt: position.joinedAt,
          depositedSui: position.depositedSui.toFixed(4),
          withdrawnSui: position.withdrawnSui.toFixed(4),
          isMember: position.isMember,
        },
        pool: {
          totalShares: stats.totalShares.toFixed(4),
          totalNAV: stats.totalNAV.toFixed(4),
          totalNAVUsd: stats.totalNAVUsd.toFixed(2),
          memberCount: stats.memberCount,
          sharePrice: stats.sharePrice.toFixed(6),
        },
        chain: 'sui',
        network,
        duration: Date.now() - startTime,
      });
    }
    
    // Default: Get pool summary
    const stats = await service.getPoolStats();
    
    return NextResponse.json({
      success: true,
      data: {
        totalShares: stats.totalShares.toFixed(4),
        totalNAV: stats.totalNAV.toFixed(4),
        totalNAVUsd: stats.totalNAVUsd.toFixed(2),
        sharePrice: stats.sharePrice.toFixed(6),
        sharePriceUsd: stats.sharePriceUsd.toFixed(6),
        memberCount: stats.memberCount,
        managementFeeBps: stats.managementFeeBps,
        performanceFeeBps: stats.performanceFeeBps,
        paused: stats.paused,
        poolStateId: stats.poolStateId,
      },
      chain: 'sui',
      network,
      duration: Date.now() - startTime,
    });
    
  } catch (error) {
    logger.error('[SUI-API] Error', { error });
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      {
        success: false,
        error: message,
        chain: 'sui',
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST Handler - Deposit/Withdraw params
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const network = getNetwork(request);
    
    const body = await request.json();
    const service = getSuiCommunityPoolService(network);
    
    logger.info('[SUI-API] POST request', { action, network, body });
    
    // Build deposit transaction params
    if (action === 'deposit') {
      const { amount } = body;
      if (!amount) {
        return NextResponse.json(
          { success: false, error: 'Amount required (in MIST or SUI)' },
          { status: 400 }
        );
      }
      
      // Fetch pool stats first to ensure poolStateId is cached
      await service.getPoolStats();
      
      // Convert from MIST (string/bigint) to SUI (number)
      // 1 SUI = 1,000,000,000 MIST (9 decimals)
      const amountMist = BigInt(amount);
      const amountSui = Number(amountMist) / 1_000_000_000;
      
      const params = service.buildDepositParams(amountSui);
      
      return NextResponse.json({
        success: true,
        data: {
          target: params.target,
          poolStateId: params.poolStateId,
          amountMist: params.amountMist.toString(),
          clockId: params.clockId,
        },
        chain: 'sui',
        network,
      });
    }
    
    // Build withdraw transaction params
    if (action === 'withdraw') {
      const { shares } = body;
      if (!shares) {
        return NextResponse.json(
          { success: false, error: 'Shares required (scaled by 10^18)' },
          { status: 400 }
        );
      }
      
      // Fetch pool stats first to ensure poolStateId is cached
      await service.getPoolStats();
      
      // Convert from scaled shares (10^18) to shares (number)
      const sharesScaled = BigInt(shares);
      const sharesNum = Number(sharesScaled) / 1e18;
      
      const params = service.buildWithdrawParams(sharesNum);
      
      return NextResponse.json({
        success: true,
        data: {
          target: params.target,
          poolStateId: params.poolStateId,
          sharesScaled: params.sharesScaled.toString(),
          clockId: params.clockId,
        },
        chain: 'sui',
        network,
      });
    }
    
    return NextResponse.json(
      { success: false, error: 'Invalid action. Use deposit or withdraw' },
      { status: 400 }
    );
    
  } catch (error) {
    logger.error('[SUI-API] POST Error', { error });
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { success: false, error: message, chain: 'sui' },
      { status: 500 }
    );
  }
}
