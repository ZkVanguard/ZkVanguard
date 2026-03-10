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
 * 
 * SECURITY: deposit/withdraw require wallet auth. Admin actions require CRON_SECRET.
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
import { resetNavHistory, insertInceptionSnapshot, savePoolStateToDb, saveUserSharesToDb, deleteUserSharesFromDb } from '@/lib/db/community-pool';
import { verifyWalletAuth, requireAuth } from '@/lib/security/auth-middleware';
import { mutationLimiter, readLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';

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

// ============================================================================
// HIGH-CONCURRENCY OPTIMIZATIONS
// ============================================================================

// 1. In-memory cache with INCREASED TTLs for community pool data
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const rpcCache = new Map<string, CacheEntry<unknown>>();

// 2. Request deduplication - prevent thundering herd
// When 100 users request the same data simultaneously, only 1 fetch runs
const pendingRequests = new Map<string, Promise<unknown>>();

async function dedupedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number
): Promise<T> {
  // Check cache first
  const cached = getCachedRpc<T>(key);
  if (cached !== null) {
    return cached;
  }
  
  // Check if a request is already in flight
  const pending = pendingRequests.get(key) as Promise<T> | undefined;
  if (pending) {
    logger.debug('[CommunityPool] Deduped request', { key });
    return pending;
  }
  
  // Create new request with cleanup
  const request = fetcher()
    .then(result => {
      setCachedRpc(key, result, ttlMs);
      return result;
    })
    .finally(() => {
      pendingRequests.delete(key);
    });
  
  pendingRequests.set(key, request);
  return request;
}

function getCachedRpc<T>(key: string): T | null {
  const entry = rpcCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    rpcCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCachedRpc<T>(key: string, data: T, ttlMs: number = 30000): void {
  rpcCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// Explicit types for RPC cache to avoid circular ReturnType references
interface PoolDataCache {
  totalValueUSD: number;
  totalShares: number;
  sharePrice: number;
  totalMembers: number;
  allocations: {
    BTC: { percentage: number };
    ETH: { percentage: number };
    CRO: { percentage: number };
    SUI: { percentage: number };
  };
  onChain: boolean;
}

interface UserPositionCache {
  walletAddress: string;
  shares: number;
  valueUSD: number;
  percentage: number;
  isMember: boolean;
  onChain: boolean;
}

// CACHE TTLs - Increased for high concurrency (pool data changes slowly)
const POOL_DATA_TTL = 60_000;       // 60 seconds for pool summary
const USER_POSITION_TTL = 30_000;   // 30 seconds for user positions
const LEADERBOARD_TTL = 120_000;    // 2 minutes for leaderboard

// ============================================================================
// ON-CHAIN TRANSACTION VERIFICATION
// ============================================================================

// CommunityPool event signatures for deposit/withdraw
const DEPOSIT_EVENT_TOPIC = ethers.id('Deposited(address,uint256,uint256)');
const WITHDRAW_EVENT_TOPIC = ethers.id('Withdrawn(address,uint256,uint256,uint256)');

/**
 * Verify that a transaction hash corresponds to a real on-chain deposit
 * to the CommunityPool contract from the claimed wallet.
 * 
 * SECURITY: This prevents fake deposits where someone could call the API
 * with a fabricated txHash and get shares credited without actually depositing.
 * 
 * @param txHash - The transaction hash to verify
 * @param expectedWallet - The wallet address that should have made the deposit
 * @returns Verified deposit amount in USD (from on-chain), or null if invalid
 */
async function verifyOnChainDeposit(
  txHash: string,
  expectedWallet: string
): Promise<{ verified: boolean; amountUSD: number; sharesReceived: number; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
    
    // Fetch transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { verified: false, amountUSD: 0, sharesReceived: 0, error: 'Transaction not found on-chain' };
    }
    
    // Verify transaction was successful
    if (receipt.status !== 1) {
      return { verified: false, amountUSD: 0, sharesReceived: 0, error: 'Transaction failed on-chain' };
    }
    
    // Verify transaction was to the CommunityPool contract
    if (receipt.to?.toLowerCase() !== COMMUNITY_POOL_ADDRESS.toLowerCase()) {
      return { verified: false, amountUSD: 0, sharesReceived: 0, error: 'Transaction not to CommunityPool contract' };
    }
    
    // Find the Deposited event in the logs
    const depositLog = receipt.logs.find(log => 
      log.topics[0] === DEPOSIT_EVENT_TOPIC &&
      log.address.toLowerCase() === COMMUNITY_POOL_ADDRESS.toLowerCase()
    );
    
    if (!depositLog) {
      return { verified: false, amountUSD: 0, sharesReceived: 0, error: 'No Deposited event found in transaction' };
    }
    
    // Decode the event: Deposited(address depositor, uint256 amount, uint256 shares)
    // depositor is indexed (in topics[1])
    const depositorAddress = ethers.getAddress('0x' + depositLog.topics[1].slice(26));
    
    // Verify the depositor matches the expected wallet
    if (depositorAddress.toLowerCase() !== expectedWallet.toLowerCase()) {
      return { 
        verified: false, 
        amountUSD: 0, 
        sharesReceived: 0, 
        error: `Depositor ${depositorAddress} does not match expected ${expectedWallet}` 
      };
    }
    
    // Decode the non-indexed parameters (amount, shares)
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'uint256'],
      depositLog.data
    );
    const amountUSD = parseFloat(ethers.formatUnits(decoded[0], 6)); // USDC has 6 decimals
    const sharesReceived = parseFloat(ethers.formatUnits(decoded[1], 18)); // Shares have 18 decimals
    
    logger.info(`[CommunityPool] Verified on-chain deposit: ${expectedWallet} deposited $${amountUSD}, received ${sharesReceived} shares`);
    
    return { verified: true, amountUSD, sharesReceived };
    
  } catch (error: any) {
    logger.error('[CommunityPool] On-chain deposit verification failed:', error);
    return { verified: false, amountUSD: 0, sharesReceived: 0, error: error.message };
  }
}

/**
 * Verify that a transaction hash corresponds to a real on-chain withdrawal
 * from the CommunityPool contract by the claimed wallet.
 */
async function verifyOnChainWithdraw(
  txHash: string,
  expectedWallet: string
): Promise<{ verified: boolean; amountUSD: number; sharesBurned: number; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
    
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'Transaction not found on-chain' };
    }
    
    if (receipt.status !== 1) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'Transaction failed on-chain' };
    }
    
    if (receipt.to?.toLowerCase() !== COMMUNITY_POOL_ADDRESS.toLowerCase()) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'Transaction not to CommunityPool contract' };
    }
    
    // Find the Withdrawn event: Withdrawn(address member, uint256 shares, uint256 amountOut, uint256 fee)
    const withdrawLog = receipt.logs.find(log => 
      log.topics[0] === WITHDRAW_EVENT_TOPIC &&
      log.address.toLowerCase() === COMMUNITY_POOL_ADDRESS.toLowerCase()
    );
    
    if (!withdrawLog) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'No Withdrawn event found in transaction' };
    }
    
    const memberAddress = ethers.getAddress('0x' + withdrawLog.topics[1].slice(26));
    
    if (memberAddress.toLowerCase() !== expectedWallet.toLowerCase()) {
      return { 
        verified: false, 
        amountUSD: 0, 
        sharesBurned: 0, 
        error: `Withdrawer ${memberAddress} does not match expected ${expectedWallet}` 
      };
    }
    
    // Decode: shares, amountOut, fee
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'uint256', 'uint256'],
      withdrawLog.data
    );
    const sharesBurned = parseFloat(ethers.formatUnits(decoded[0], 18));
    const amountUSD = parseFloat(ethers.formatUnits(decoded[1], 6));
    
    logger.info(`[CommunityPool] Verified on-chain withdrawal: ${expectedWallet} withdrew $${amountUSD}, burned ${sharesBurned} shares`);
    
    return { verified: true, amountUSD, sharesBurned };
    
  } catch (error: any) {
    logger.error('[CommunityPool] On-chain withdrawal verification failed:', error);
    return { verified: false, amountUSD: 0, sharesBurned: 0, error: error.message };
  }
}

/**
 * Create a JSON response with CDN cache headers for Vercel Edge Cache
 * s-maxage: CDN caches for specified seconds
 * stale-while-revalidate: serves stale while fetching fresh in background
 */
function cachedJsonResponse(data: unknown, cdnTtlSeconds: number = 30) {
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': `s-maxage=${cdnTtlSeconds}, stale-while-revalidate=${cdnTtlSeconds * 2}`,
    },
  });
}

/**
 * Fetch on-chain pool data with request deduplication
 * TTL: 60 seconds (pool data changes slowly)
 * 
 * IMPORTANT: Uses market-adjusted NAV and share price from calculatePoolNAV()
 * The on-chain contract only holds USDC (no actual trading), so on-chain NAV = USDC balance
 * We use virtual holdings × live prices for accurate market-based valuation
 */
async function getOnChainPoolData(): Promise<PoolDataCache | null> {
  return dedupedFetch<PoolDataCache | null>(
    'pool-data',
    async () => {
      try {
        const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
        const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
        
        // Get on-chain data (totalShares, memberCount) - these are authoritative
        const stats = await pool.getPoolStats();
        const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
        const memberCount = Number(stats._memberCount);
        
        // Get market-adjusted NAV and share price from calculatePoolNAV()
        // This uses virtual holdings × live prices for accurate valuation
        // Without this, share price would be stuck at $1.00 (USDC only)
        const marketData = await calculatePoolNAV();
        const marketNAV = marketData.totalValueUSD;
        const marketSharePrice = marketData.sharePrice;
        const marketAllocations = marketData.allocations;
        
        return {
          totalValueUSD: marketNAV,
          totalShares,
          sharePrice: marketSharePrice,
          totalMembers: memberCount,
          allocations: {
            BTC: { percentage: marketAllocations.BTC?.percentage || Number(stats._allocations[0]) / 100 },
            ETH: { percentage: marketAllocations.ETH?.percentage || Number(stats._allocations[1]) / 100 },
            CRO: { percentage: marketAllocations.CRO?.percentage || Number(stats._allocations[2]) / 100 },
            SUI: { percentage: marketAllocations.SUI?.percentage || Number(stats._allocations[3]) / 100 },
          },
          onChain: true,
        };
      } catch (err) {
        logger.error('[CommunityPool API] On-chain fetch error:', err);
        return null;
      }
    },
    POOL_DATA_TTL
  );
}

/**
 * Fetch on-chain user position with request deduplication
 * TTL: 30 seconds per user
 */
async function getOnChainUserPosition(userAddress: string): Promise<UserPositionCache | null> {
  const normalizedAddr = userAddress.toLowerCase();
  
  return dedupedFetch<UserPositionCache | null>(
    `user-pos-${normalizedAddr}`,
    async () => {
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
    },
    USER_POSITION_TTL
  );
}

/**
 * Fetch ALL on-chain members and their positions with request deduplication
 * TTL: 120 seconds (expensive query)
 */
async function getAllOnChainMembers() {
  return dedupedFetch<Array<{
    walletAddress: string;
    shares: number;
    depositedUSD: number;
    joinTime: number;
  }> | null>(
    'all-members',
    async () => {
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
    },
    LEADERBOARD_TTL
  );
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
  // Rate limit read operations
  const limited = readLimiter.check(request);
  if (limited) return limited;

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
            return cachedJsonResponse({
              success: true,
              leaderboard,
              count: leaderboard.length,
              source: 'db',
            }, 60); // CDN cache for 60 seconds
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
        
        return cachedJsonResponse({
          success: true,
          leaderboard,
          count: leaderboard.length,
          source: 'onchain',
        }, 60); // CDN cache for 60 seconds
      }
      
      return cachedJsonResponse({
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
    if (action === 'insert-inception') {
      const cronSecret = request.headers.get('x-cron-secret');
      const expectedSecret = process.env.CRON_SECRET;
      
      if (!cronSecret || cronSecret !== expectedSecret) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      
      // Pool inception was when first member joined (you can adjust this timestamp)
      // Using Feb 24, 2026 as approximate inception based on monitoring gap
      const inceptionTimestamp = new Date('2026-02-24T16:00:00Z');
      const inceptionSharePrice = 1.00;
      const inceptionNav = 450.00; // First deposit amount
      const inceptionShares = inceptionNav / inceptionSharePrice;
      const inceptionMembers = 1;
      
      const inserted = await insertInceptionSnapshot(
        inceptionTimestamp,
        inceptionSharePrice,
        inceptionNav,
        inceptionShares,
        inceptionMembers
      );
      
      return NextResponse.json({
        success: true,
        inserted,
        message: inserted 
          ? 'Inception snapshot added at $1.00 share price' 
          : 'Inception snapshot already exists',
        inceptionData: {
          timestamp: inceptionTimestamp.toISOString(),
          sharePrice: inceptionSharePrice,
          nav: inceptionNav,
          shares: inceptionShares,
        },
      });
    }
    
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
    // ALWAYS use on-chain contract data as source of truth
    // On-chain contract has authoritative NAV, share price, and member count
    try {
      const onChainPool = await getOnChainPoolData();
      
      if (onChainPool && onChainPool.totalShares > 0) {
        // On-chain contract is the authoritative source - use it directly
        return cachedJsonResponse({
          success: true,
          pool: {
            totalValueUSD: onChainPool.totalValueUSD,
            totalShares: onChainPool.totalShares,
            sharePrice: onChainPool.sharePrice,
            memberCount: onChainPool.memberCount ?? onChainPool.totalMembers ?? 0,
            allocations: onChainPool.allocations,
            lastAIDecision: null,
            performance: { day: null, week: null, month: null },
          },
          supportedAssets: SUPPORTED_ASSETS,
          timestamp: Date.now(),
          source: 'onchain',
        }, 30); // CDN cache for 30 seconds
      }
    } catch (e) {
      logger.warn('[CommunityPool API] On-chain pool summary failed', { error: e });
    }
    
    // Final fallback: Local calculated NAV (for when on-chain has no value)
    try {
      const summary = await getPoolSummary();
      
      return NextResponse.json({
        success: true,
        pool: {
          ...summary,
          memberCount: summary.totalMembers, // Map to frontend expected field name
        },
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
    
  } catch (error: unknown) {
    return safeErrorResponse(error, 'community-pool GET');
  }
}

/**
 * POST - Deposit or withdraw
 * SECURITY: deposit/withdraw require wallet auth to verify the caller owns the wallet.
 * Admin actions (sync-from-chain, delete-user) require CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  // Rate limit mutations
  const limited = mutationLimiter.check(request);
  if (limited) return limited;

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

    // SECURITY: For deposit/withdraw, verify the caller owns the wallet.
    // Accepts either wallet signature OR verified on-chain txHash.
    const userActions = ['deposit', 'withdraw'];
    if (userActions.includes(action || '')) {
      const authResult = await requireAuth(request, body);
      if (authResult instanceof NextResponse) return authResult;
      
      // If wallet auth was used, verify the authenticated wallet matches the request
      if (authResult.method === 'wallet' && authResult.identity?.toLowerCase() !== walletAddress?.toLowerCase()) {
        return NextResponse.json(
          { success: false, error: 'Wallet address does not match authenticated wallet' },
          { status: 403 }
        );
      }
    }
    
    switch (action) {
      case 'deposit': {
        // SECURITY: txHash is REQUIRED - must verify on-chain deposit before recording
        if (!txHash) {
          return NextResponse.json(
            { success: false, error: 'Transaction hash (txHash) is required. Deposit must be made on-chain first.' },
            { status: 400 }
          );
        }
        
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { success: false, error: 'Valid deposit amount required' },
            { status: 400 }
          );
        }
        
        // SECURITY: Verify the on-chain deposit before recording
        const verification = await verifyOnChainDeposit(txHash, walletAddress);
        if (!verification.verified) {
          logger.warn(`[CommunityPool] Deposit verification failed: ${verification.error}`, { txHash, walletAddress });
          return NextResponse.json(
            { success: false, error: `On-chain verification failed: ${verification.error}` },
            { status: 400 }
          );
        }
        
        // Use the verified on-chain amount (not the client-provided amount)
        // This prevents amount manipulation attacks
        const verifiedAmount = verification.amountUSD;
        if (Math.abs(verifiedAmount - amount) > 0.01) {
          logger.warn(`[CommunityPool] Amount mismatch: client=${amount}, on-chain=${verifiedAmount}`, { txHash });
          // Use the on-chain amount as source of truth
        }
        
        const result = await deposit(walletAddress, verifiedAmount, txHash);
        
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
        // SECURITY: txHash is REQUIRED - must verify on-chain withdrawal before recording
        if (!txHash) {
          return NextResponse.json(
            { success: false, error: 'Transaction hash (txHash) is required. Withdrawal must be made on-chain first.' },
            { status: 400 }
          );
        }
        
        if (!shares || shares <= 0) {
          return NextResponse.json(
            { success: false, error: 'Valid share amount required' },
            { status: 400 }
          );
        }
        
        // SECURITY: Verify the on-chain withdrawal before recording
        const verification = await verifyOnChainWithdraw(txHash, walletAddress);
        if (!verification.verified) {
          logger.warn(`[CommunityPool] Withdrawal verification failed: ${verification.error}`, { txHash, walletAddress });
          return NextResponse.json(
            { success: false, error: `On-chain verification failed: ${verification.error}` },
            { status: 400 }
          );
        }
        
        // Use the verified on-chain shares burned (not the client-provided shares)
        const verifiedShares = verification.sharesBurned;
        if (Math.abs(verifiedShares - shares) > 0.0001) {
          logger.warn(`[CommunityPool] Shares mismatch: client=${shares}, on-chain=${verifiedShares}`, { txHash });
          // Use the on-chain shares as source of truth
        }
        
        const result = await withdraw(walletAddress, verifiedShares, txHash);
        
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
    
  } catch (error: unknown) {
    return safeErrorResponse(error, 'community-pool POST');
  }
}
