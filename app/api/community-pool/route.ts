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
  calculatePoolNAV,
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
  'function getMemberCount() view returns (uint256)',
  'function memberList(uint256) view returns (address)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinTime)',
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
 * Fetch ALL on-chain members and their positions
 */
async function getAllOnChainMembers() {
  try {
    const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
    const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
    
    const memberCount = await pool.getMemberCount();
    const count = Number(memberCount);
    logger.info(`[CommunityPool API] On-chain member count: ${count}`);
    
    const members = [];
    for (let i = 0; i < count; i++) {
      const addr = await pool.memberList(i);
      const memberData = await pool.members(addr);
      
      members.push({
        walletAddress: addr.toLowerCase(),
        shares: parseFloat(ethers.formatUnits(memberData.shares, 18)),
        depositedUSD: parseFloat(ethers.formatUnits(memberData.depositedUSD, 6)),
        joinTime: Number(memberData.joinTime),
      });
    }
    
    return members;
  } catch (err) {
    logger.error('[CommunityPool API] Failed to fetch all on-chain members:', err);
    return null;
  }
}

/**
 * Find user in on-chain members by searching the member list
 * This handles cases where the user's wallet address checksum differs from on-chain storage
 */
async function findOnChainMember(userAddress: string) {
  const normalizedUser = userAddress.toLowerCase();
  const members = await getAllOnChainMembers();
  
  if (!members) return null;
  
  const found = members.find(m => m.walletAddress.toLowerCase() === normalizedUser);
  if (found) {
    const onChainPool = await getOnChainPoolData();
    const totalShares = onChainPool?.totalShares || members.reduce((sum, m) => sum + m.shares, 0);
    
    return {
      walletAddress: found.walletAddress,
      shares: found.shares,
      valueUSD: found.depositedUSD, // Use deposited value
      percentage: totalShares > 0 ? (found.shares / totalShares) * 100 : 0,
      isMember: found.shares > 0,
      onChain: true,
    };
  }
  
  return null;
}


/**
 * GET - Fetch pool info
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  const userAddress = searchParams.get('user');
  const forceOnChain = searchParams.get('source') === 'onchain';
  
  try {
    // Get user's position
    if (userAddress) {
      // Try DB first (faster for UI) unless forceOnChain
      if (!forceOnChain) {
        try {
          const userShares = await getUserShares(userAddress);
          if (userShares && userShares.shares > 0) {
            const onChainPool = await getOnChainPoolData();
            const poolData = onChainPool || await getPoolSummary();
            
            return NextResponse.json({
              success: true,
              user: {
                walletAddress: userShares.walletAddress,
                shares: userShares.shares,
                valueUSD: userShares.shares * (poolData?.sharePrice || 1),
                percentage: poolData?.totalShares > 0 ? (userShares.shares / poolData.totalShares) * 100 : 0,
                isMember: true,
              },
              pool: poolData,
              source: 'db',
            });
          }
        } catch (dbError) {
          logger.warn('[CommunityPool API] DB user lookup failed, falling back to on-chain');
        }
      }
      
      // Fallback: Try on-chain via getMemberPosition
      let onChainUser = await getOnChainUserPosition(userAddress);
      const onChainPool = await getOnChainPoolData();
      
      // If getMemberPosition returned 0 shares, try searching the member list
      // This handles checksum mismatches between connected wallet and on-chain storage
      if (onChainUser && onChainUser.shares === 0) {
        const memberSearch = await findOnChainMember(userAddress);
        if (memberSearch && memberSearch.shares > 0) {
          logger.info(`[CommunityPool API] Found user ${userAddress} via member list search: ${memberSearch.shares} shares`);
          onChainUser = memberSearch;
        }
      }
      
      if (onChainUser && onChainUser.shares > 0 && onChainPool) {
        return NextResponse.json({
          success: true,
          user: onChainUser,
          pool: onChainPool,
          source: 'onchain',
        });
      }
      
      // User not found on-chain with shares > 0
      // Return not a member with on-chain pool data
      if (onChainPool) {
        return NextResponse.json({
          success: true,
          user: {
            walletAddress: userAddress,
            shares: 0,
            valueUSD: 0,
            percentage: 0,
            isMember: false,
          },
          pool: onChainPool,
          source: 'onchain',
        });
      }
      
      // Fallback to local storage (only if on-chain fails)
      try {
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
      } catch (dbError) {
        // Database unavailable - return not found response
        logger.warn('[CommunityPool API] DB fallback failed, user not found on-chain', { userAddress });
        return NextResponse.json({
          success: true,
          user: {
            walletAddress: userAddress,
            shares: 0,
            valueUSD: 0,
            percentage: 0,
            isMember: false,
          },
          pool: null,
          source: 'none',
          warning: 'User not found on-chain or in database',
        });
      }
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
      const forceOnChain = searchParams.get('source') === 'onchain';
      
      // Try DB first (faster for UI)
      if (!forceOnChain) {
        try {
          const leaderboard = await getTopShareholders(limit);
          if (leaderboard && leaderboard.length > 0) {
            return NextResponse.json({
              success: true,
              leaderboard,
              count: leaderboard.length,
              source: 'db',
            });
          }
        } catch (dbError) {
          logger.warn('[CommunityPool API] DB leaderboard failed, falling back to on-chain');
        }
      }
      
      // Fallback: On-chain (authoritative but slower)
      const onChainMembers = await getAllOnChainMembers();
      if (onChainMembers && onChainMembers.length > 0) {
        const totalShares = onChainMembers.reduce((sum, m) => sum + m.shares, 0);
        const leaderboard = onChainMembers
          .sort((a, b) => b.shares - a.shares)
          .slice(0, limit)
          .map(m => ({
            walletAddress: m.walletAddress,
            shares: m.shares,
            percentage: totalShares > 0 ? (m.shares / totalShares) * 100 : 0,
          }));
        
        return NextResponse.json({
          success: true,
          leaderboard,
          count: leaderboard.length,
          source: 'onchain',
        });
      }
      
      return NextResponse.json({
        success: true,
        leaderboard: [],
        count: 0,
        source: 'none',
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
      
      // Use market-adjusted NAV (virtual holdings × current prices)
      // This ensures reset starts with accurate market values
      const onChainData = await getOnChainPoolData();
      const marketNAV = await calculatePoolNAV();
      
      // Use market-adjusted values but on-chain member count
      const nav = marketNAV.totalValueUSD;
      const sharePrice = marketNAV.sharePrice;
      const totalShares = onChainData?.totalShares || (nav > 0 ? nav / sharePrice : 0);
      const memberCount = onChainData?.totalMembers || 1;
      
      // Reset with market-adjusted values
      const result = await resetNavHistory(
        nav,
        sharePrice,
        totalShares,
        memberCount
      );
      
      return NextResponse.json({
        success: true,
        message: 'NAV history reset with market-adjusted values',
        deleted: result.deleted,
        newSnapshot: {
          nav,
          sharePrice,
          totalMembers: memberCount,
        },
      });
    }
    
    // Default: Get pool summary
    // Use market-adjusted NAV (virtual holdings × current prices) for accurate display
    // On-chain provides member count and share structure, DB provides virtual holdings
    try {
      const onChainPool = await getOnChainPoolData();
      
      // Try to get market-adjusted NAV (needs DB for virtual holdings)
      let useMarketNav = false;
      let marketNAV = null;
      try {
        marketNAV = await calculatePoolNAV();
        useMarketNav = true;
      } catch (dbError) {
        logger.warn('[CommunityPool API] Market-adjusted NAV unavailable (no DB), using on-chain only');
      }
      
      if (onChainPool && onChainPool.totalShares > 0) {
        // Blend on-chain structure with market-adjusted NAV if available
        if (useMarketNav && marketNAV) {
          const marketSharePrice = marketNAV.totalValueUSD / onChainPool.totalShares;
          
          return NextResponse.json({
            success: true,
            pool: {
              totalValueUSD: marketNAV.totalValueUSD,
              totalShares: onChainPool.totalShares,
              sharePrice: marketSharePrice,
              totalMembers: onChainPool.totalMembers,
              allocations: marketNAV.allocations,
              lastAIDecision: null,
              performance: { day: null, week: null, month: null },
            },
            supportedAssets: SUPPORTED_ASSETS,
            timestamp: Date.now(),
            source: 'market-adjusted',
          });
        }
        
        // Pure on-chain fallback (no market adjustment)
        return NextResponse.json({
          success: true,
          pool: onChainPool,
          supportedAssets: SUPPORTED_ASSETS,
          timestamp: Date.now(),
          source: 'onchain',
        });
      }
    } catch (e) {
      logger.warn('[CommunityPool API] Pool summary failed', { error: e });
    }
    
    // Final fallback: Local calculated NAV (for when on-chain has no value)
    try {
      const summary = await getPoolSummary();
      
      return NextResponse.json({
        success: true,
        pool: summary,
        supportedAssets: SUPPORTED_ASSETS,
        timestamp: Date.now(),
        source: 'calculated',
      });
    } catch (e) {
      logger.error('[CommunityPool API] All pool summary fallbacks failed');
      return NextResponse.json({
        success: false,
        error: 'Unable to retrieve pool data',
      }, { status: 500 });
    }
    
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
    
    // Admin actions like sync-from-chain and delete-user don't require walletAddress upfront
    const adminActions = ['sync-from-chain', 'delete-user'];
    if (!walletAddress && !adminActions.includes(action || '')) {
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
        
        // CRITICAL: Sync from on-chain immediately after deposit
        // On-chain is authoritative - overwrite any local calculation errors
        try {
          const onChainUser = await getOnChainUserPosition(walletAddress);
          const onChainPool = await getOnChainPoolData();
          
          if (onChainUser && onChainPool) {
            // Save on-chain user state directly to DB
            await saveUserSharesToDb({
              walletAddress: walletAddress.toLowerCase(),
              shares: onChainUser.shares,
              costBasisUSD: onChainUser.valueUSD,
            });
            
            // Update pool state in DB
            const allocations: Record<string, { percentage: number; valueUSD: number; amount: number; price: number }> = {
              BTC: { percentage: onChainPool.allocations.BTC.percentage, valueUSD: 0, amount: 0, price: 0 },
              ETH: { percentage: onChainPool.allocations.ETH.percentage, valueUSD: 0, amount: 0, price: 0 },
              CRO: { percentage: onChainPool.allocations.CRO.percentage, valueUSD: 0, amount: 0, price: 0 },
              SUI: { percentage: onChainPool.allocations.SUI.percentage, valueUSD: 0, amount: 0, price: 0 },
            };
            
            await savePoolStateToDb({
              totalValueUSD: onChainPool.totalValueUSD,
              totalShares: onChainPool.totalShares,
              sharePrice: onChainPool.sharePrice,
              allocations,
              lastRebalance: Date.now(),
              lastAIDecision: null,
            });
            
            logger.info(`[CommunityPool] Post-deposit on-chain sync: ${walletAddress} has ${onChainUser.shares} shares`);
          }
        } catch (syncError) {
          logger.error('[CommunityPool] Post-deposit on-chain sync failed (non-fatal)', syncError);
          // Continue - local calculation was already saved
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
        
        // CRITICAL: Sync from on-chain immediately after withdrawal
        // On-chain is authoritative - overwrite any local calculation errors
        try {
          const onChainUser = await getOnChainUserPosition(walletAddress);
          const onChainPool = await getOnChainPoolData();
          
          if (onChainPool) {
            // Update pool state in DB
            const allocations: Record<string, { percentage: number; valueUSD: number; amount: number; price: number }> = {
              BTC: { percentage: onChainPool.allocations.BTC.percentage, valueUSD: 0, amount: 0, price: 0 },
              ETH: { percentage: onChainPool.allocations.ETH.percentage, valueUSD: 0, amount: 0, price: 0 },
              CRO: { percentage: onChainPool.allocations.CRO.percentage, valueUSD: 0, amount: 0, price: 0 },
              SUI: { percentage: onChainPool.allocations.SUI.percentage, valueUSD: 0, amount: 0, price: 0 },
            };
            
            await savePoolStateToDb({
              totalValueUSD: onChainPool.totalValueUSD,
              totalShares: onChainPool.totalShares,
              sharePrice: onChainPool.sharePrice,
              allocations,
              lastRebalance: Date.now(),
              lastAIDecision: null,
            });
          }
          
          if (onChainUser && onChainUser.shares > 0) {
            // User still has shares - update
            await saveUserSharesToDb({
              walletAddress: walletAddress.toLowerCase(),
              shares: onChainUser.shares,
              costBasisUSD: onChainUser.valueUSD,
            });
          } else {
            // User fully withdrew - delete from DB
            await deleteUserSharesFromDb(walletAddress);
          }
          
          logger.info(`[CommunityPool] Post-withdraw on-chain sync: ${walletAddress} has ${onChainUser?.shares || 0} shares`);
        } catch (syncError) {
          logger.error('[CommunityPool] Post-withdraw on-chain sync failed (non-fatal)', syncError);
          // Continue - local calculation was already saved
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
        
        // CRITICAL: Sync ALL on-chain members to database
        const onChainMembers = await getAllOnChainMembers();
        const syncedMembers: string[] = [];
        
        if (onChainMembers && onChainMembers.length > 0) {
          logger.info(`[CommunityPool API] Syncing ${onChainMembers.length} on-chain members to database`);
          
          for (const member of onChainMembers) {
            await saveUserSharesToDb({
              walletAddress: member.walletAddress,
              shares: member.shares,
              costBasisUSD: member.depositedUSD,
            });
            syncedMembers.push(member.walletAddress);
            logger.info(`[CommunityPool API] Synced member ${member.walletAddress}: ${member.shares} shares`);
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
          syncedMembers,
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
