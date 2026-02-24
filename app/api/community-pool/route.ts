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
import { ethers } from 'ethers';
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
import { resetNavHistory, savePoolStateToDb, saveUserSharesToDb, deleteUserSharesFromDb } from '@/lib/db/community-pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// On-chain contract addresses
const COMMUNITY_POOL_ADDRESS = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B';
const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';

// Minimal ABI for reading pool stats
const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function getMemberPosition(address member) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)',
  'function calculateTotalNAV() view returns (uint256)',
  'function totalShares() view returns (uint256)',
];

/**
 * Fetch on-chain pool data
 */
async function getOnChainPoolData() {
  try {
    const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
    const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
    
    const stats = await pool.getPoolStats();
    
    // Format values (shares are 18 decimals, NAV/price are 6 decimals USDC)
    const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
    const totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
    const memberCount = Number(stats._memberCount);
    const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
    
    return {
      totalValueUSD: totalNAV,
      totalShares,
      sharePrice,
      totalMembers: memberCount,
      allocations: {
        BTC: { percentage: Number(stats._allocations[0]) / 100 },
        ETH: { percentage: Number(stats._allocations[1]) / 100 },
        CRO: { percentage: Number(stats._allocations[2]) / 100 },
        SUI: { percentage: Number(stats._allocations[3]) / 100 },
      },
      onChain: true,
    };
  } catch (err) {
    logger.error('[CommunityPool API] On-chain fetch error:', err);
    return null;
  }
}

/**
 * Fetch on-chain user position
 */
async function getOnChainUserPosition(userAddress: string) {
  try {
    const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
    const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
    
    const pos = await pool.getMemberPosition(userAddress);
    
    return {
      walletAddress: userAddress,
      shares: parseFloat(ethers.formatUnits(pos.shares, 18)),
      valueUSD: parseFloat(ethers.formatUnits(pos.valueUSD, 6)),
      percentage: parseFloat(ethers.formatUnits(pos.percentage, 2)),
      isMember: pos.shares > 0n,
      onChain: true,
    };
  } catch (err) {
    logger.error('[CommunityPool API] On-chain user fetch error:', err);
    return null;
  }
}


/**
 * GET - Fetch pool info
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  const userAddress = searchParams.get('user');
  const source = searchParams.get('source'); // 'onchain' to force on-chain
  
  try {
    // Get user's position
    if (userAddress) {
      // Try on-chain first
      const onChainUser = await getOnChainUserPosition(userAddress);
      const onChainPool = await getOnChainPoolData();
      
      if (onChainUser && onChainPool) {
        return NextResponse.json({
          success: true,
          user: onChainUser,
          pool: onChainPool,
          source: 'onchain',
        });
      }
      
      // Fallback to local storage
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
          source: 'local',
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
        source: 'local',
      });
    }
    
    // Sync local storage with on-chain data for a specific user
    if (action === 'sync' && userAddress) {
      const onChainUser = await getOnChainUserPosition(userAddress);
      const onChainPool = await getOnChainPoolData();
      
      if (!onChainUser || !onChainPool) {
        return NextResponse.json({
          success: false,
          error: 'Failed to fetch on-chain data',
        }, { status: 500 });
      }
      
      // Update local storage to match on-chain
      // This is a recovery mechanism - on-chain is always authoritative
      const { saveUserShares, savePoolState, getPoolState, getUserShares } = await import('@/lib/storage/community-pool-storage');
      
      // Sync user position
      let localUser = await getUserShares(userAddress);
      if (!localUser && onChainUser.shares > 0) {
        // User exists on-chain but not locally - create record
        localUser = {
          walletAddress: userAddress,
          shares: onChainUser.shares,
          valueUSD: onChainUser.valueUSD,
          percentage: onChainUser.percentage,
          joinedAt: Date.now(),
          updatedAt: Date.now(),
          deposits: [],
          withdrawals: [],
        };
      } else if (localUser) {
        // Sync shares from on-chain (authoritative)
        localUser.shares = onChainUser.shares;
        localUser.valueUSD = onChainUser.valueUSD;
        localUser.percentage = onChainUser.percentage;
        localUser.updatedAt = Date.now();
      }
      
      if (localUser) {
        await saveUserShares(localUser);
      }
      
      // Sync pool state
      const localPool = await getPoolState();
      localPool.totalShares = onChainPool.totalShares;
      localPool.totalValueUSD = onChainPool.totalValueUSD;
      localPool.sharePrice = onChainPool.sharePrice;
      await savePoolState(localPool);
      
      return NextResponse.json({
        success: true,
        message: 'Synced local storage with on-chain data',
        user: onChainUser,
        pool: onChainPool,
        source: 'onchain',
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
    
    // Reset NAV history (admin only - requires cron secret)
    if (action === 'reset-nav-history') {
      const cronSecret = request.headers.get('x-cron-secret');
      const expectedSecret = process.env.CRON_SECRET;
      
      if (!cronSecret || cronSecret !== expectedSecret) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      
      // Get current real-time NAV data
      const summary = await getPoolSummary();
      
      // Reset with correct values
      const result = await resetNavHistory(
        summary.totalValueUSD,
        summary.sharePrice,
        summary.totalValueUSD / summary.sharePrice, // Calculate totalShares
        summary.totalMembers
      );
      
      return NextResponse.json({
        success: true,
        message: 'NAV history reset',
        deleted: result.deleted,
        newSnapshot: {
          nav: summary.totalValueUSD,
          sharePrice: summary.sharePrice,
          totalMembers: summary.totalMembers,
        },
      });
    }
    
    // Default: Get pool summary
    // Try on-chain first for accurate NAV, fall back to local calculation
    try {
      const onChainPool = await getOnChainPoolData();
      if (onChainPool && onChainPool.totalValueUSD > 0) {
        // On-chain data is authoritative when pool has value
        const livePrices = await fetchLivePrices();
        return NextResponse.json({
          success: true,
          pool: {
            totalValueUSD: onChainPool.totalValueUSD,
            totalShares: onChainPool.totalShares,
            sharePrice: onChainPool.sharePrice,
            totalMembers: onChainPool.totalMembers,
            allocations: {
              BTC: { percentage: onChainPool.allocations.BTC.percentage, valueUSD: onChainPool.totalValueUSD * onChainPool.allocations.BTC.percentage / 100, amount: 0, price: livePrices.BTC },
              ETH: { percentage: onChainPool.allocations.ETH.percentage, valueUSD: onChainPool.totalValueUSD * onChainPool.allocations.ETH.percentage / 100, amount: 0, price: livePrices.ETH },
              CRO: { percentage: onChainPool.allocations.CRO.percentage, valueUSD: onChainPool.totalValueUSD * onChainPool.allocations.CRO.percentage / 100, amount: 0, price: livePrices.CRO },
              SUI: { percentage: onChainPool.allocations.SUI.percentage, valueUSD: onChainPool.totalValueUSD * onChainPool.allocations.SUI.percentage / 100, amount: 0, price: livePrices.SUI },
            },
            lastAIDecision: null,
            performance: { day: null, week: null, month: null },
          },
          supportedAssets: SUPPORTED_ASSETS,
          timestamp: Date.now(),
          source: 'onchain',
        });
      }
    } catch (e) {
      // Fall back to local calculation
    }
    
    // Fallback: Local calculated NAV (for when on-chain has no value)
    const summary = await getPoolSummary();
    
    return NextResponse.json({
      success: true,
      pool: summary,
      supportedAssets: SUPPORTED_ASSETS,
      timestamp: Date.now(),
      source: 'calculated',
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
      
      case 'sync-from-chain': {
        // Admin only - sync database with on-chain state
        const cronSecret = request.headers.get('x-cron-secret');
        const expectedSecret = process.env.CRON_SECRET;
        
        if (!cronSecret || cronSecret !== expectedSecret) {
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        
        // Get on-chain pool data
        const onChainData = await getOnChainPoolData();
        if (!onChainData) {
          return NextResponse.json({ success: false, error: 'Failed to fetch on-chain data' }, { status: 500 });
        }
        
        // Build allocations with required fields
        const totalNAV = onChainData.totalValueUSD;
        const allocations: Record<string, { percentage: number; valueUSD: number; amount: number; price: number }> = {
          BTC: { 
            percentage: onChainData.allocations.BTC.percentage, 
            valueUSD: totalNAV * onChainData.allocations.BTC.percentage / 100,
            amount: 0, // Unknown from on-chain
            price: 0, // Unknown from on-chain
          },
          ETH: { 
            percentage: onChainData.allocations.ETH.percentage, 
            valueUSD: totalNAV * onChainData.allocations.ETH.percentage / 100,
            amount: 0,
            price: 0,
          },
          CRO: { 
            percentage: onChainData.allocations.CRO.percentage, 
            valueUSD: totalNAV * onChainData.allocations.CRO.percentage / 100,
            amount: 0,
            price: 0,
          },
          SUI: { 
            percentage: onChainData.allocations.SUI.percentage, 
            valueUSD: totalNAV * onChainData.allocations.SUI.percentage / 100,
            amount: 0,
            price: 0,
          },
        };
        
        // Update pool state in DB
        await savePoolStateToDb({
          totalValueUSD: onChainData.totalValueUSD,
          totalShares: onChainData.totalShares,
          sharePrice: onChainData.sharePrice,
          allocations,
          lastRebalance: Date.now(),
          lastAIDecision: null,
        });
        
        // Update user shares if wallet address provided 
        if (walletAddress) {
          const onChainUser = await getOnChainUserPosition(walletAddress);
          if (onChainUser) {
            await saveUserSharesToDb({
              walletAddress: walletAddress.toLowerCase(),
              shares: onChainUser.shares,
              costBasisUSD: onChainUser.valueUSD, // Use current value as cost basis
            });
          }
        }
        
        // Reset NAV history with correct values
        const resetResult = await resetNavHistory(
          onChainData.totalValueUSD,
          onChainData.sharePrice,
          onChainData.totalShares,
          onChainData.totalMembers
        );
        
        return NextResponse.json({
          success: true,
          message: 'Database synced with on-chain state',
          onChainData: {
            totalValueUSD: onChainData.totalValueUSD,
            totalShares: onChainData.totalShares,
            sharePrice: onChainData.sharePrice,
            totalMembers: onChainData.totalMembers,
          },
          navHistoryReset: resetResult,
        });
      }
      
      case 'delete-user': {
        // Admin only - delete stale user from database
        const cronSecret = request.headers.get('x-cron-secret');
        const expectedSecret = process.env.CRON_SECRET;
        
        if (!cronSecret || cronSecret !== expectedSecret) {
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        
        if (!walletAddress) {
          return NextResponse.json({ success: false, error: 'walletAddress required' }, { status: 400 });
        }
        
        await deleteUserSharesFromDb(walletAddress.toLowerCase());
        
        return NextResponse.json({
          success: true,
          message: `Deleted user ${walletAddress} from database`,
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
