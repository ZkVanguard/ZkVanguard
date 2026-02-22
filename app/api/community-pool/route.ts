/**
 * Community Pool API
 * 
 * Endpoints:
 * - GET  /api/community-pool              - Get pool summary
 * - GET  /api/community-pool?user=0x...   - Get user's shares and position
 * - POST /api/community-pool?action=deposit    - Deposit USDC
 * - POST /api/community-pool?action=withdraw   - Withdraw by burning shares
 * - GET  /api/community-pool?action=history    - Get pool transaction history
 * - GET  /api/community-pool?action=leaderboard - Get top shareholders
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import {
  deposit,
  withdraw,
  getPoolSummary,
  fetchLivePrices,
} from '@/lib/services/CommunityPoolService';
import {
  getUserShares,
  getPoolHistory,
  getTopShareholders,
  SUPPORTED_ASSETS,
} from '@/lib/storage/community-pool-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET - Fetch pool info
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  const userAddress = searchParams.get('user');
  
  try {
    // Get user's position
    if (userAddress) {
      const userShares = await getUserShares(userAddress);
      const poolSummary = await getPoolSummary();
      
      if (!userShares) {
        return NextResponse.json({
          success: true,
          user: {
            walletAddress: userAddress,
            shares: 0,
            valueUSD: 0,
            percentage: 0,
            isMember: false,
          },
          pool: poolSummary,
        });
      }
      
      return NextResponse.json({
        success: true,
        user: {
          walletAddress: userShares.walletAddress,
          shares: userShares.shares,
          valueUSD: userShares.shares * poolSummary.sharePrice,
          percentage: userShares.percentage,
          isMember: true,
          joinedAt: userShares.joinedAt,
          totalDeposited: userShares.deposits.reduce((sum, d) => sum + d.amountUSD, 0),
          totalWithdrawn: userShares.withdrawals.reduce((sum, w) => sum + w.amountUSD, 0),
          depositCount: userShares.deposits.length,
          withdrawalCount: userShares.withdrawals.length,
        },
        pool: poolSummary,
      });
    }
    
    // Get transaction history
    if (action === 'history') {
      const limit = parseInt(searchParams.get('limit') || '50');
      const history = await getPoolHistory(limit);
      
      return NextResponse.json({
        success: true,
        history,
        count: history.length,
      });
    }
    
    // Get leaderboard
    if (action === 'leaderboard') {
      const limit = parseInt(searchParams.get('limit') || '10');
      const leaderboard = await getTopShareholders(limit);
      
      return NextResponse.json({
        success: true,
        leaderboard,
        count: leaderboard.length,
      });
    }
    
    // Get live prices
    if (action === 'prices') {
      const prices = await fetchLivePrices();
      return NextResponse.json({
        success: true,
        prices,
        timestamp: Date.now(),
      });
    }
    
    // Default: Get pool summary
    const summary = await getPoolSummary();
    
    return NextResponse.json({
      success: true,
      pool: summary,
      supportedAssets: SUPPORTED_ASSETS,
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    logger.error('[CommunityPool API] GET error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST - Deposit or withdraw
 */
export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  
  try {
    const body = await request.json();
    const { walletAddress, amount, shares, txHash } = body;
    
    if (!walletAddress) {
      return NextResponse.json(
        { success: false, error: 'walletAddress required' },
        { status: 400 }
      );
    }
    
    switch (action) {
      case 'deposit': {
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { success: false, error: 'Valid deposit amount required' },
            { status: 400 }
          );
        }
        
        const result = await deposit(walletAddress, amount, txHash);
        
        if (!result.success) {
          return NextResponse.json(
            { success: false, error: result.error },
            { status: 400 }
          );
        }
        
        return NextResponse.json({
          success: true,
          message: `Deposited $${amount.toLocaleString()} and received ${result.sharesReceived.toFixed(4)} shares`,
          deposit: {
            amountUSD: amount,
            sharesReceived: result.sharesReceived,
            sharePrice: result.sharePrice,
            newTotalShares: result.newTotalShares,
            ownershipPercentage: result.ownershipPercentage,
          },
          txHash,
        });
      }
      
      case 'withdraw': {
        if (!shares || shares <= 0) {
          return NextResponse.json(
            { success: false, error: 'Valid share amount required' },
            { status: 400 }
          );
        }
        
        const result = await withdraw(walletAddress, shares, txHash);
        
        if (!result.success) {
          return NextResponse.json(
            { success: false, error: result.error },
            { status: 400 }
          );
        }
        
        return NextResponse.json({
          success: true,
          message: `Burned ${result.sharesBurned.toFixed(4)} shares and received $${result.amountUSD.toFixed(2)}`,
          withdrawal: {
            sharesBurned: result.sharesBurned,
            amountUSD: result.amountUSD,
            sharePrice: result.sharePrice,
            remainingShares: result.remainingShares,
          },
          txHash,
        });
      }
      
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action. Use: deposit, withdraw' },
          { status: 400 }
        );
    }
    
  } catch (error: any) {
    logger.error('[CommunityPool API] POST error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
