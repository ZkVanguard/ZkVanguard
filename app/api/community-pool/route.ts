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
import { logger } from '@/lib/utils/logger';
import {
  deposit,
  withdraw,
  getPoolSummary,
  fetchLivePrices,
  calculatePoolNAV,
} from '@/lib/services/CommunityPoolService';
import { clearCaches as clearStatsCaches } from '@/lib/services/CommunityPoolStatsService';
import {
  getUserShares,
  getPoolHistory,
  getUserTransactionCounts,
} from '@/lib/storage/community-pool-storage';
import { resetNavHistory, insertInceptionSnapshot, savePoolStateToDb, saveUserSharesToDb, deleteUserSharesFromDb, getUserSharesFromDb } from '@/lib/db/community-pool';
import { requireAuth } from '@/lib/security/auth-middleware';
import { mutationLimiter, readLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { POOL_CHAIN_CONFIGS } from '@/lib/contracts/community-pool-config';

// Extracted modules
import { getChainConfig } from '@/lib/community-pool/chain-config';
import { clearRpcCaches } from '@/lib/community-pool/cache';
import { verifyOnChainDeposit, verifyOnChainWithdraw } from '@/lib/community-pool/on-chain-verifier';
import {
  getOnChainPoolData,
  getOnChainUserPosition,
  getAllOnChainMembers,
  cachedJsonResponse,
  buildAllocationsForDb,
} from '@/lib/community-pool/on-chain-reader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  
  // Multi-chain support: parse chain and network params
  const chainParam = searchParams.get('chain');
  const networkParam = searchParams.get('network');
  const chainConfig = getChainConfig(chainParam, networkParam);
  
  // SUI chain requires different handling (not EVM-compatible)
  if (chainConfig.chainKey === 'sui') {
    return NextResponse.json({
      success: false,
      error: 'SUI chain requires the SUI-specific API endpoint',
      hint: 'Use /api/sui/community-pool for SUI chain operations',
    }, { status: 400 });
  }
  
  const chainKey = chainConfig.chainKey;

  try {
    // Get user's position
    if (userAddress) {
      // SUI addresses (0x + 64 hex) passed to EVM chains → return empty early
      if (/^0x[a-fA-F0-9]{64}$/.test(userAddress) && (chainConfig.chainKey as string) !== 'sui') {
        return NextResponse.json({
          success: true,
          user: {
            walletAddress: userAddress,
            shares: 0,
            valueUSD: 0,
            percentage: 0,
            isMember: false,
            depositCount: 0,
            withdrawalCount: 0,
          },
          pool: null,
          source: 'none',
          message: 'SUI wallet detected — use /api/sui/community-pool for SUI deposits',
        });
      }

      // Get transaction counts for user (used in multiple responses)
      const txCounts = await getUserTransactionCounts(userAddress);
      
      // Try DB first (faster for UI) unless forceOnChain
      // DB storage is now chain-aware and works for all chains
      if (!forceOnChain) {
        try {
          const userShares = await getUserSharesFromDb(userAddress, chainKey);
          if (userShares && userShares.shares > 0) {
            const onChainPool = await getOnChainPoolData(chainConfig);
            const poolData = onChainPool || await getPoolSummary(chainKey);
            
            return NextResponse.json({
              success: true,
              user: {
                walletAddress: userShares.wallet_address,
                shares: userShares.shares,
                valueUSD: userShares.shares * (poolData?.sharePrice || 1),
                percentage: poolData?.totalShares > 0 ? (userShares.shares / poolData.totalShares) * 100 : 0,
                isMember: true,
                depositCount: txCounts.depositCount,
                withdrawalCount: txCounts.withdrawalCount,
              },
              pool: poolData,
              source: 'db',
            });
          }
        } catch (dbError) {
          logger.warn('[CommunityPool API] DB user lookup failed, falling back to on-chain');
        }
      }
      
      // Fallback: Try on-chain via getMemberPosition (use chainConfig for correct chain)
      let onChainUser = await getOnChainUserPosition(userAddress, chainConfig);
      const onChainPool = await getOnChainPoolData(chainConfig);
      
      // Removed expensive member list iteration fallback.
      // Trusted source is getMemberPosition directly.
      
      if (onChainUser && onChainUser.shares > 0 && onChainPool) {
        return NextResponse.json({
          success: true,
          user: {
            ...onChainUser,
            depositCount: txCounts.depositCount,
            withdrawalCount: txCounts.withdrawalCount,
          },
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
            depositCount: txCounts.depositCount,
            withdrawalCount: txCounts.withdrawalCount,
          },
          pool: onChainPool,
          source: 'onchain',
        });
      }
      
      // Fallback to local storage (only if on-chain fails AND we're on the default chain)
      // Non-default chains (Sepolia, Hedera, etc.) should only use on-chain data
      if (chainKey === 'cronos') {
        try {
          const userShares = await getUserShares(userAddress, chainKey);
          const poolSummary = await getPoolSummary(chainKey);
          
          if (!userShares) {
            return NextResponse.json({
              success: true,
              user: {
                walletAddress: userAddress,
                shares: 0,
                valueUSD: 0,
                percentage: 0,
                isMember: false,
                depositCount: txCounts.depositCount,
                withdrawalCount: txCounts.withdrawalCount,
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
              depositCount: txCounts.depositCount || userShares.deposits.length,
              withdrawalCount: txCounts.withdrawalCount || userShares.withdrawals.length,
            },
            pool: poolSummary,
            source: 'local',
          });
        } catch (dbError) {
          // Database unavailable - return not found response
          logger.warn('[CommunityPool API] DB fallback failed, user not found on-chain', { userAddress });
        }
      }
      
      // For non-default chains or when DB fails, return user not found
      return NextResponse.json({
          success: true,
          user: {
            walletAddress: userAddress,
            shares: 0,
            valueUSD: 0,
            percentage: 0,
            isMember: false,
            depositCount: 0,
            withdrawalCount: 0,
          },
          pool: null,
          source: 'none',
          warning: 'User not found on-chain or in database',
        });
    }
    
    // Sync local storage with on-chain data for a specific user
    if (action === 'sync' && userAddress) {
      const onChainUser = await getOnChainUserPosition(userAddress, chainConfig);
      const onChainPool = await getOnChainPoolData(chainConfig);
      
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
      let localUser = await getUserShares(userAddress, chainKey);
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
      const localPool = await getPoolState(chainKey);
      localPool.totalShares = onChainPool.totalShares;
      localPool.totalValueUSD = onChainPool.totalValueUSD;
      localPool.sharePrice = onChainPool.sharePrice;
      await savePoolState(localPool, chainKey);
      
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
      const history = await getPoolHistory(limit, chainKey);
      
      return NextResponse.json({
        success: true,
        history,
        count: history.length,
      });
    }
    
    // Get leaderboard - ALWAYS use on-chain as authoritative source
    // DB is a cache that can have stale data or ghost entries
    if (action === 'leaderboard') {
      const limit = parseInt(searchParams.get('limit') || '10');
      
      // On-chain is authoritative - always use it
      const onChainMembers = await getAllOnChainMembers(chainConfig);
      if (onChainMembers && onChainMembers.length > 0) {
        // Filter to only active members (shares > 0)
        const activeMembers = onChainMembers.filter(m => m.shares > 0);
        const totalShares = activeMembers.reduce((sum, m) => sum + m.shares, 0);
        const leaderboard = activeMembers
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
          count: activeMembers.length, // Count of ACTIVE members, not historical
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
      const onChainData = await getOnChainPoolData(chainConfig);
      const marketNAV = await calculatePoolNAV(chainConfig.chainKey);
      
      // Use market-adjusted values but on-chain member count
      const nav = marketNAV.totalValueUSD;
      const sharePrice = marketNAV.sharePrice;
      const totalShares = onChainData?.totalShares || (nav > 0 ? nav / sharePrice : 0);
      const memberCount = onChainData?.totalMembers || 1;
      
      // Reset with market-adjusted values
      const allocPct: Record<string, number> = {};
      for (const [asset, data] of Object.entries(marketNAV.allocations)) {
        allocPct[asset] = data.percentage;
      }
      const result = await resetNavHistory(
        nav,
        sharePrice,
        totalShares,
        memberCount,
        allocPct
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
      const onChainPool = await getOnChainPoolData(chainConfig);
      
      if (onChainPool && onChainPool.totalShares > 0) {
        // Get deduplicated member count (contract memberList has duplicates)
        const onChainMembers = await getAllOnChainMembers(chainConfig);
        const uniqueActiveMembers = onChainMembers?.filter(m => m.shares > 0).length ?? onChainPool.totalMembers ?? 0;
        
        // Check if pool has actual asset holdings or just USDT
        // If all allocations are 0 or assetBalances are 0, pool is holding USDT
        const hasTargetAllocations = 
          (onChainPool.allocations.BTC?.percentage || 0) > 0 || 
          (onChainPool.allocations.ETH?.percentage || 0) > 0;
        
        // Determine actual holdings vs target allocations
        // Pool accepts USDT deposits, may or may not have hedged into assets
        const actualHoldings = hasTargetAllocations 
          ? onChainPool.allocations  // Show target allocations when hedging is active
          : { USDT: { percentage: 100 } };  // Show USDT when not hedged
        
        // On-chain contract is the authoritative source - use it directly
        // Dedupe supported assets (Sepolia config already includes USDT)
        const supportedAssets = [...new Set([...chainConfig.assets, 'USDT'])];
        
        // Get native USDT token address for this chain from full config
        const fullChainConfig = POOL_CHAIN_CONFIGS[chainConfig.chainKey];
        const networkKey = chainConfig.network as 'testnet' | 'mainnet';
        const usdtAddress = fullChainConfig?.contracts?.[networkKey]?.usdt || fullChainConfig?.contracts?.testnet?.usdt || null;
        
        return cachedJsonResponse({
          success: true,
          pool: {
            totalValueUSD: onChainPool.totalValueUSD,
            totalShares: onChainPool.totalShares,
            sharePrice: onChainPool.sharePrice,
            memberCount: uniqueActiveMembers,
            allocations: onChainPool.allocations,  // Target allocations from contract
            actualHoldings,  // What the pool is actually holding
            depositAsset: 'USDT',  // Pool accepts USDT via Tether WDK
            depositTokenAddress: usdtAddress,  // Native USDT contract address
            lastAIDecision: null,
            performance: { day: null, week: null, month: null },
          },
          supportedAssets,  // Deduplicated chain assets + USDT
          timestamp: Date.now(),
          source: 'onchain',
        }, 30); // CDN cache for 30 seconds
      }
    } catch (e) {
      logger.warn('[CommunityPool API] On-chain pool summary failed', { error: e });
    }
    
    // Final fallback: Local calculated NAV (for when on-chain has no value)
    try {
      const summary = await getPoolSummary(chainConfig.chainKey);
      
      // Get native USDT token address for this chain from full config
      const fullChainConfig = POOL_CHAIN_CONFIGS[chainConfig.chainKey];
      const networkKey = chainConfig.network as 'testnet' | 'mainnet';
      const usdtAddress = fullChainConfig?.contracts?.[networkKey]?.usdt || fullChainConfig?.contracts?.testnet?.usdt || null;
      
      return NextResponse.json({
        success: true,
        pool: {
          ...summary,
          memberCount: summary.totalMembers, // Map to frontend expected field name
          depositAsset: 'USDT',
          depositTokenAddress: usdtAddress,  // Native USDT contract address
        },
        supportedAssets: chainConfig.assets,
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
  
  // Multi-chain support: parse chain and network params
  const chainParam = searchParams.get('chain');
  const networkParam = searchParams.get('network');
  const chainConfig = getChainConfig(chainParam, networkParam);
  
  // SUI chain requires different handling (not EVM-compatible)
  if (chainConfig.chainKey === 'sui') {
    return NextResponse.json({
      success: false,
      error: 'SUI chain requires the SUI-specific API endpoint',
      hint: 'Use /api/sui/community-pool for SUI chain operations',
    }, { status: 400 });
  }
  
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
        const verification = await verifyOnChainDeposit(txHash, walletAddress, chainConfig);
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
        
        const result = await deposit(walletAddress, verifiedAmount, txHash, chainConfig.chainKey);
        
        if (!result.success) {
          return NextResponse.json(
            { success: false, error: result.error },
            { status: 400 }
          );
        }
        
        // CRITICAL: Sync from on-chain immediately after deposit
        // On-chain is authoritative - overwrite any local calculation errors
        try {
          const onChainUser = await getOnChainUserPosition(walletAddress, chainConfig);
          const onChainPool = await getOnChainPoolData(chainConfig);
          
          if (onChainUser && onChainPool) {
            await saveUserSharesToDb({
              walletAddress: walletAddress.toLowerCase(),
              shares: onChainUser.shares,
              costBasisUSD: onChainUser.valueUSD,
              chain: chainConfig.chainKey,
            });
            
            await savePoolStateToDb({
              totalValueUSD: onChainPool.totalValueUSD,
              totalShares: onChainPool.totalShares,
              sharePrice: onChainPool.sharePrice,
              allocations: buildAllocationsForDb(onChainPool),
              lastRebalance: Date.now(),
              lastAIDecision: null,
              chain: chainConfig.chainKey,
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
        const verification = await verifyOnChainWithdraw(txHash, walletAddress, chainConfig);
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
        
        const result = await withdraw(walletAddress, verifiedShares, txHash, undefined, chainConfig.chainKey);
        
        if (!result.success) {
          return NextResponse.json(
            { success: false, error: result.error },
            { status: 400 }
          );
        }
        
        // CRITICAL: Sync from on-chain immediately after withdrawal
        // On-chain is authoritative - overwrite any local calculation errors
        try {
          const onChainUser = await getOnChainUserPosition(walletAddress, chainConfig);
          const onChainPool = await getOnChainPoolData(chainConfig);
          
          if (onChainPool) {
            await savePoolStateToDb({
              totalValueUSD: onChainPool.totalValueUSD,
              totalShares: onChainPool.totalShares,
              sharePrice: onChainPool.sharePrice,
              allocations: buildAllocationsForDb(onChainPool),
              lastRebalance: Date.now(),
              lastAIDecision: null,
              chain: chainConfig.chainKey,
            });
          }
          
          if (onChainUser && onChainUser.shares > 0) {
            // User still has shares - update with chain info
            await saveUserSharesToDb({
              walletAddress: walletAddress.toLowerCase(),
              shares: onChainUser.shares,
              costBasisUSD: onChainUser.valueUSD,
              chain: chainConfig.chainKey,
            });
          } else {
            // User fully withdrew - delete from DB for this chain
            await deleteUserSharesFromDb(walletAddress, chainConfig.chainKey);
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
        const onChainData = await getOnChainPoolData(chainConfig);
        if (!onChainData) {
          return NextResponse.json({ success: false, error: 'Failed to fetch on-chain data' }, { status: 500 });
        }
        
        // Build allocations with required fields
        const allocations = buildAllocationsForDb(onChainData);
        
        // Update pool state in DB
        await savePoolStateToDb({
          totalValueUSD: onChainData.totalValueUSD,
          totalShares: onChainData.totalShares,
          sharePrice: onChainData.sharePrice,
          allocations,
          lastRebalance: Date.now(),
          lastAIDecision: null,
          chain: chainConfig.chainKey,
        });
        
        // CRITICAL: Sync ALL on-chain members to database
        const onChainMembers = await getAllOnChainMembers(chainConfig);
        const syncedMembers: string[] = [];
        
        if (onChainMembers && onChainMembers.length > 0) {
          logger.info(`[CommunityPool API] Syncing ${onChainMembers.length} on-chain members to database`);
          
          for (const member of onChainMembers) {
            await saveUserSharesToDb({
              walletAddress: member.walletAddress,
              shares: member.shares,
              costBasisUSD: member.depositedUSD,
              chain: chainConfig.chainKey,
            });
            syncedMembers.push(member.walletAddress);
            logger.info(`[CommunityPool API] Synced member ${member.walletAddress}: ${member.shares} shares`);
          }
        }
        
        // Reset NAV history with correct values
        const syncAllocPct: Record<string, number> = {};
        if (onChainData.allocations) {
          for (const [asset, data] of Object.entries(onChainData.allocations)) {
            syncAllocPct[asset] = (data as { percentage: number }).percentage;
          }
        }
        const resetResult = await resetNavHistory(
          onChainData.totalValueUSD,
          onChainData.sharePrice,
          onChainData.totalShares,
          onChainData.totalMembers,
          syncAllocPct
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
        
        await deleteUserSharesFromDb(walletAddress.toLowerCase(), chainConfig.chainKey);
        
        return NextResponse.json({
          success: true,
          message: `Deleted user ${walletAddress} from database for chain ${chainConfig.chainKey}`,
        });
      }
      
      case 'full-reset': {
        // Admin only - COMPLETE reset of all pool data to match on-chain V3 contract
        // Use this when stats are corrupted and need to start fresh
        const cronSecret = request.headers.get('x-cron-secret');
        const expectedSecret = process.env.CRON_SECRET;
        
        if (!cronSecret || cronSecret !== expectedSecret) {
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        
        logger.info('[CommunityPool API] Starting full reset to on-chain V3 state');
        
        // Step 1: Get current on-chain data from V3 contract
        const onChainData = await getOnChainPoolData(chainConfig);
        if (!onChainData) {
          return NextResponse.json({ success: false, error: 'Failed to fetch on-chain data' }, { status: 500 });
        }
        
        // Step 2: Get all on-chain members
        const onChainMembers = await getAllOnChainMembers(chainConfig);
        if (!onChainMembers) {
          return NextResponse.json({ success: false, error: 'Failed to fetch on-chain members' }, { status: 500 });
        }
        
        // Step 3: Clear all user shares from database for this chain (removes stale/duplicate entries)
        const { query: dbQuery } = await import('@/lib/db/postgres');
        const deletedUsers = await dbQuery('DELETE FROM community_pool_shares WHERE chain = $1 RETURNING wallet_address', [chainConfig.chainKey]);
        logger.info(`[CommunityPool API] Deleted ${deletedUsers.length} users from database for chain ${chainConfig.chainKey}`);
        
        // Step 4: Re-sync only valid on-chain members
        const syncedMembers: { address: string; shares: number }[] = [];
        const activeMembers = onChainMembers.filter(m => m.shares > 0);
        
        for (const member of activeMembers) {
          await saveUserSharesToDb({
            walletAddress: member.walletAddress.toLowerCase(),
            shares: member.shares,
            costBasisUSD: member.depositedUSD,
            chain: chainConfig.chainKey,
          });
          syncedMembers.push({ address: member.walletAddress, shares: member.shares });
          logger.info(`[CommunityPool API] Synced member: ${member.walletAddress} (${member.shares} shares)`);
        }
        
        // Step 5: Build proper allocations object
        const allocations = buildAllocationsForDb(onChainData);
        
        // Step 6: Update pool state
        await savePoolStateToDb({
          totalValueUSD: onChainData.totalValueUSD,
          totalShares: onChainData.totalShares,
          sharePrice: onChainData.sharePrice,
          allocations,
          lastRebalance: Date.now(),
          lastAIDecision: null,
          chain: chainConfig.chainKey,
        });
        
        // Step 7: Reset NAV history completely with fresh on-chain data
        const resetAllocPct: Record<string, number> = {};
        for (const [asset, data] of Object.entries(allocations)) {
          resetAllocPct[asset] = data.percentage;
        }
        const navReset = await resetNavHistory(
          onChainData.totalValueUSD,
          onChainData.sharePrice,
          onChainData.totalShares,
          activeMembers.length,
          resetAllocPct
        );
        
        // Step 8: Clear all in-memory caches
        clearStatsCaches();
        clearRpcCaches();
        
        logger.info('[CommunityPool API] Full reset completed successfully');
        
        return NextResponse.json({
          success: true,
          message: 'Full reset completed - all data now matches on-chain V3 contract',
          summary: {
            deletedStaleUsers: deletedUsers.length,
            syncedActiveMembers: syncedMembers.length,
            navHistoryDeleted: navReset.deleted,
            poolState: {
              totalValueUSD: onChainData.totalValueUSD,
              totalShares: onChainData.totalShares,
              sharePrice: onChainData.sharePrice,
              memberCount: activeMembers.length,
              allocations: {
                BTC: onChainData.allocations.BTC.percentage,
                ETH: onChainData.allocations.ETH.percentage,
                SUI: onChainData.allocations.SUI.percentage,
                CRO: onChainData.allocations.CRO.percentage,
              },
            },
            members: syncedMembers,
          },
          timestamp: new Date().toISOString(),
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
