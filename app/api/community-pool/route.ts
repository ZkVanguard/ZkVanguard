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
  getPoolStats as getUnifiedPoolStats,
  getMemberPosition as getUnifiedMemberPosition,
  clearCaches as clearStatsCaches,
} from '@/lib/services/CommunityPoolStatsService';
import {
  getUserShares,
  getPoolHistory,
  getTopShareholders,
  SUPPORTED_ASSETS,
  getUserTransactionCounts,
} from '@/lib/storage/community-pool-storage';
import { resetNavHistory, insertInceptionSnapshot, savePoolStateToDb, saveUserSharesToDb, deleteUserSharesFromDb, getUserSharesFromDb } from '@/lib/db/community-pool';
import { verifyWalletAuth, requireAuth } from '@/lib/security/auth-middleware';
import { mutationLimiter, readLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { POOL_CHAIN_CONFIGS, getCommunityPoolAddress } from '@/lib/contracts/community-pool-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Multi-chain configuration
type NetworkType = 'testnet' | 'mainnet';
type ChainKey = 'ethereum' | 'cronos' | 'hedera' | 'sepolia' | 'sui';

interface ChainConfig {
  rpcUrl: string;
  poolAddress: string;
  chainKey: ChainKey;
  network: NetworkType;
  assets: string[]; // Chain-specific assets (e.g., ['BTC', 'ETH', 'USDT'] for Sepolia)
}

/**
 * Get RPC URL and pool address for a given chain/network
 * Falls back to Sepolia testnet (primary live chain) if invalid
 */
function getChainConfig(chain?: string | null, network?: string | null): ChainConfig {
  const chainKey = (chain as ChainKey) || 'sepolia';
  const networkType: NetworkType = network === 'mainnet' ? 'mainnet' : 'testnet';
  
  const config = POOL_CHAIN_CONFIGS[chainKey];
  if (!config) {
    // Fallback to Sepolia testnet (primary live chain)
    const fallbackConfig = POOL_CHAIN_CONFIGS['sepolia'];
    return {
      rpcUrl: fallbackConfig?.rpcUrls?.testnet || 'https://sepolia.drpc.org',
      poolAddress: getCommunityPoolAddress('sepolia', 'testnet'),
      chainKey: 'sepolia',
      network: 'testnet',
      assets: fallbackConfig?.assets || ['BTC', 'ETH', 'SUI', 'CRO'],
    };
  }
  
  const rpcUrl = networkType === 'mainnet' ? config.rpcUrls.mainnet : config.rpcUrls.testnet;
  const poolAddress = networkType === 'mainnet' 
    ? config.contracts.mainnet.communityPool 
    : config.contracts.testnet.communityPool;
  
  return { rpcUrl, poolAddress, chainKey, network: networkType, assets: config.assets };
}

// Legacy constant for default chain (Cronos testnet)
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
  allocations: Record<string, { percentage: number }>;
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
// Event: Deposited(address indexed member, uint256 amountUSD, uint256 sharesReceived, uint256 sharePrice, uint256 timestamp)
const DEPOSIT_EVENT_TOPIC = ethers.id('Deposited(address,uint256,uint256,uint256,uint256)');
// Event: Withdrawn(address indexed member, uint256 sharesBurned, uint256 amountUSD, uint256 sharePrice, uint256 timestamp)
const WITHDRAW_EVENT_TOPIC = ethers.id('Withdrawn(address,uint256,uint256,uint256,uint256)');

/**
 * Verify that a transaction hash corresponds to a real on-chain deposit
 * to the CommunityPool contract from the claimed wallet.
 * 
 * SECURITY: This prevents fake deposits where someone could call the API
 * with a fabricated txHash and get shares credited without actually depositing.
 * 
 * @param txHash - The transaction hash to verify
 * @param expectedWallet - The wallet address that should have made the deposit
 * @param chainConfig - Chain configuration for RPC and contract address
 * @returns Verified deposit amount in USD (from on-chain), or null if invalid
 */
async function verifyOnChainDeposit(
  txHash: string,
  expectedWallet: string,
  chainConfig: ChainConfig = getChainConfig()
): Promise<{ verified: boolean; amountUSD: number; sharesReceived: number; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const poolAddress = chainConfig.poolAddress;
    
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
    if (receipt.to?.toLowerCase() !== poolAddress.toLowerCase()) {
      return { verified: false, amountUSD: 0, sharesReceived: 0, error: 'Transaction not to CommunityPool contract' };
    }
    
    // Find the Deposited event in the logs
    const depositLog = receipt.logs.find(log => 
      log.topics[0] === DEPOSIT_EVENT_TOPIC &&
      log.address.toLowerCase() === poolAddress.toLowerCase()
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
    
    // Decode the non-indexed parameters: amountUSD, sharesReceived, sharePrice, timestamp
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'uint256', 'uint256', 'uint256'],
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
  expectedWallet: string,
  chainConfig: ChainConfig = getChainConfig()
): Promise<{ verified: boolean; amountUSD: number; sharesBurned: number; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const poolAddress = chainConfig.poolAddress;
    
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'Transaction not found on-chain' };
    }
    
    if (receipt.status !== 1) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'Transaction failed on-chain' };
    }
    
    if (receipt.to?.toLowerCase() !== poolAddress.toLowerCase()) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'Transaction not to CommunityPool contract' };
    }
    
    // Find the Withdrawn event: Withdrawn(address member, uint256 shares, uint256 amountOut, uint256 fee)
    const withdrawLog = receipt.logs.find(log => 
      log.topics[0] === WITHDRAW_EVENT_TOPIC &&
      log.address.toLowerCase() === poolAddress.toLowerCase()
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
    
    // Decode: sharesBurned, amountUSD, sharePrice, timestamp (4 non-indexed params)
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'uint256', 'uint256', 'uint256'],
      withdrawLog.data
    );
    const sharesBurned = parseFloat(ethers.formatUnits(decoded[0], 18));
    // amountUSD is in 6 decimals (USDC)
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
 * Fetch on-chain pool data (SINGLE SOURCE OF TRUTH)
 * 
 * Multi-chain support:
 * - For Cronos: uses CommunityPoolStatsService (with caching)
 * - For other chains: fetches directly from that chain's RPC
 * 
 * @param chainConfig - Optional chain configuration. If not provided, uses Cronos testnet.
 */
async function getOnChainPoolData(chainConfig?: ChainConfig): Promise<PoolDataCache | null> {
  const config = chainConfig || getChainConfig();
  const cacheKey = `onchain-pool-${config.chainKey}-${config.network}`;
  
  // Check in-memory cache first
  const cached = getCachedRpc<PoolDataCache>(cacheKey);
  if (cached) return cached;
  
  try {
    // For Cronos testnet, use the unified stats service (has extra caching)
    if (config.chainKey === 'cronos' && config.network === 'testnet') {
      const stats = await getUnifiedPoolStats();
      
      // Use actual on-chain allocations for BTC/ETH/SUI/CRO hedging
      // The pool accepts USDT deposits but allocates to multiple assets
      const allocations: Record<string, { percentage: number }> = {
        BTC: { percentage: stats.allocations.BTC.percentage },
        ETH: { percentage: stats.allocations.ETH.percentage },
        SUI: { percentage: stats.allocations.SUI.percentage },
        CRO: { percentage: stats.allocations.CRO.percentage },
      };
      
      // Check if hedging is active (has non-zero allocations)
      const hasHedging = stats.allocations.BTC.percentage > 0 || stats.allocations.ETH.percentage > 0;
      const actualHoldings = hasHedging 
        ? allocations  // Show target allocations when hedging
        : { USDT: { percentage: 100 } };  // Show USDT when not hedged
      
      const result = {
        totalValueUSD: stats.totalNAV,
        totalShares: stats.totalShares,
        sharePrice: stats.sharePrice,
        totalMembers: stats.memberCount,
        allocations,
        actualHoldings,
        depositAsset: 'USDT',
        onChain: true,
      };
      setCachedRpc(cacheKey, result, POOL_DATA_TTL);
      return result;
    }
    
    // For other chains, fetch directly from on-chain
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const pool = new ethers.Contract(config.poolAddress, POOL_ABI, provider);
    
    // Extended ABI for fallback methods
    const FALLBACK_ABI = [
      'function totalShares() view returns (uint256)',
      'function depositToken() view returns (address)',
    ];
    const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
    
    let totalShares = 0;
    let totalNAV = 0;
    let sharePrice = 1.0;
    let rawMemberCount = 0;
    let allocations: number[] = []; // Populated from on-chain getPoolStats
    
    // Try getPoolStats first
    try {
      const [stats, memberCount] = await Promise.all([
        pool.getPoolStats(),
        pool.getMemberCount(),
      ]);
      
      totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
      totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6)); // USDC decimals
      // Use the contract's _sharePrice (6 decimals, accounts for virtual offsets)
      sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
      rawMemberCount = Number(memberCount);
      allocations = (stats._allocations || [0, 0, 0, 0]).map((a: bigint) => Number(a) / 100);
      
      logger.info(`[CommunityPool] getPoolStats succeeded for ${config.chainKey}`, {
        totalShares, totalNAV, rawMemberCount
      });
    } catch (statsError) {
      // Fallback: Read totalShares and USDT balance directly
      logger.warn(`[CommunityPool] getPoolStats failed for ${config.chainKey}, using fallback`, { 
        error: statsError instanceof Error ? statsError.message.substring(0, 100) : String(statsError)
      });
      
      try {
        const poolFallback = new ethers.Contract(config.poolAddress, FALLBACK_ABI, provider);
        
        // Get total shares
        const rawShares = await poolFallback.totalShares();
        totalShares = parseFloat(ethers.formatUnits(rawShares, 18));
        
        // Get deposit token (USDT) address and its balance as TVL
        const fullChainConfig = POOL_CHAIN_CONFIGS[config.chainKey];
        const networkKey = config.network as 'testnet' | 'mainnet';
        const usdtAddress = fullChainConfig?.contracts?.[networkKey]?.usdt;
        
        if (usdtAddress) {
          const usdt = new ethers.Contract(usdtAddress, ERC20_ABI, provider);
          const usdtBalance = await usdt.balanceOf(config.poolAddress);
          totalNAV = parseFloat(ethers.formatUnits(usdtBalance, 6)); // USDT has 6 decimals
        }
        
        // Calculate share price with virtual offset (matching contract's ERC-4626 formula)
        // VIRTUAL_ASSETS = 1e6 ($1), VIRTUAL_SHARES = 1e18 (1 share)
        const VIRTUAL_ASSETS = 1; // 1e6 in 6-decimal = $1
        const VIRTUAL_SHARES = 1; // 1e18 in 18-decimal = 1 share
        sharePrice = (totalNAV + VIRTUAL_ASSETS) / (totalShares + VIRTUAL_SHARES);
        
        // Try to get member count
        try {
          const mc = await pool.getMemberCount();
          rawMemberCount = Number(mc);
        } catch {
          rawMemberCount = 1; // Minimum 1 member if we can't read
        }
        
        logger.info(`[CommunityPool] Fallback succeeded for ${config.chainKey}`, {
          totalShares, totalNAV, sharePrice, rawMemberCount
        });
      } catch (fallbackError) {
        logger.error(`[CommunityPool] Fallback also failed for ${config.chainKey}`, { 
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        });
        return null;
      }
    }
    
    // Simplification: Trust the contract's member count to avoid 
    // N+1 query performance issues. Deduplication should happen 
    // off-chain or via graph indexing if precision is critical.
    const uniqueMemberCount = rawMemberCount;
    
    // Parse allocations from contract (BPS to percentage)
    // allocations array populated from on-chain getPoolStats, empty if unavailable
    const btcAlloc = allocations[0] || 0;
    const ethAlloc = allocations[1] || 0;
    const suiAlloc = allocations[2] || 0;
    const croAlloc = allocations[3] || 0;
    
    // Check if pool has diversified allocations or is holding just USDT
    const hasAllocations = btcAlloc > 0 || ethAlloc > 0 || suiAlloc > 0 || croAlloc > 0;
    
    let allocationResult: Record<string, { percentage: number }>;
    
    if (hasAllocations) {
      // Multi-asset pool: use on-chain target allocations
      allocationResult = {
        BTC: { percentage: btcAlloc },
        ETH: { percentage: ethAlloc },
        SUI: { percentage: suiAlloc },
        CRO: { percentage: croAlloc },
      };
    } else {
      // No allocations set - pool is holding USDT only
      allocationResult = {};
      for (const asset of config.assets) {
        if (asset === 'USDT') {
          allocationResult[asset] = { percentage: 100 };
        } else {
          allocationResult[asset] = { percentage: 0 };
        }
      }
    }
    
    const result = {
      totalValueUSD: totalNAV,
      totalShares,
      sharePrice,
      totalMembers: uniqueMemberCount,
      allocations: allocationResult,
      onChain: true,
    };
    
    logger.info(`[CommunityPool] Fetched on-chain data for ${config.chainKey}:${config.network}`, {
      totalValueUSD: result.totalValueUSD,
      totalShares: result.totalShares,
      memberCount: result.totalMembers,
    });
    
    setCachedRpc(cacheKey, result, POOL_DATA_TTL);
    return result;
  } catch (err) {
    logger.error(`[CommunityPool API] On-chain stats error for ${config.chainKey}:`, err);
    return null;
  }
}

/**
 * Fetch on-chain user position (SINGLE SOURCE OF TRUTH)
 * 
 * Now accepts chainConfig to query the correct chain's contract.
 * For default chain (cronos), uses CommunityPoolStatsService.
 * For other chains, queries the contract directly.
 */
async function getOnChainUserPosition(userAddress: string, chainConfig?: ChainConfig): Promise<UserPositionCache | null> {
  try {
    // Non-EVM addresses (e.g. SUI 64-hex) cannot be queried against EVM contracts
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      return null;
    }

    // For cronos (default), use the unified service for better caching
    if (!chainConfig || chainConfig.chainKey === 'cronos') {
      const pos = await getUnifiedMemberPosition(userAddress);
      return {
        walletAddress: pos.walletAddress,
        shares: pos.shares,
        valueUSD: pos.valueUSD,
        percentage: pos.percentage,
        isMember: pos.isMember,
        onChain: true,
      };
    }
    
    // For other chains, query the contract directly
    const cacheKey = `user-pos-${chainConfig.chainKey}-${chainConfig.network}-${userAddress.toLowerCase()}`;
    
    return dedupedFetch<UserPositionCache | null>(
      cacheKey,
      async () => {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
        const pool = new ethers.Contract(chainConfig.poolAddress, POOL_ABI, provider);
        
        // Get pool stats for share price calculation
        const poolData = await getOnChainPoolData(chainConfig);
        if (!poolData) return null;
        
        // Get user's member data
        const memberData = await pool.members(userAddress);
        const shares = parseFloat(ethers.formatUnits(memberData.shares, 18));
        
        if (shares === 0) {
          return {
            walletAddress: userAddress,
            shares: 0,
            valueUSD: 0,
            percentage: 0,
            isMember: false,
            onChain: true,
          };
        }
        
        const valueUSD = shares * poolData.sharePrice;
        const percentage = poolData.totalShares > 0 ? (shares / poolData.totalShares) * 100 : 0;
        
        return {
          walletAddress: userAddress,
          shares,
          valueUSD,
          percentage,
          isMember: true,
          onChain: true,
        };
      },
      USER_POSITION_TTL
    );
  } catch (err) {
    logger.error('[CommunityPool API] On-chain user position error:', err);
    return null;
  }
}

/**
 * Fetch ALL on-chain members and their positions with request deduplication
 * TTL: 120 seconds (expensive query)
 * NOTE: Contract memberList may have duplicate entries - we deduplicate by address
 */
async function getAllOnChainMembers(chainConfig: ChainConfig = getChainConfig()) {
  // Include chain in cache key to avoid mixing data between chains
  const cacheKey = `all-members-${chainConfig.chainKey}-${chainConfig.network}`;
  
  return dedupedFetch<Array<{
    walletAddress: string;
    shares: number;
    depositedUSD: number;
    joinTime: number;
  }> | null>(
    cacheKey,
    async () => {
      try {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
        const pool = new ethers.Contract(chainConfig.poolAddress, POOL_ABI, provider);
        
        const memberCount = await pool.getMemberCount();
        const count = Number(memberCount);
        logger.info(`[CommunityPool API] On-chain member count (raw) for ${chainConfig.chainKey}: ${count}`);
        
        // Use a Map to deduplicate by address (contract memberList has duplicates)
        // OPTIMIZATION: Batch all member lookups in parallel chunks of 5
        const memberMap = new Map<string, {
          walletAddress: string;
          shares: number;
          depositedUSD: number;
          joinTime: number;
        }>();

        const BATCH_SIZE = 5;
        for (let batchStart = 0; batchStart < count; batchStart += BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + BATCH_SIZE, count);
          const indices = Array.from({ length: batchEnd - batchStart }, (_, k) => batchStart + k);

          // Step 1: Fetch addresses in parallel
          const addrs = await Promise.all(indices.map(i => pool.memberList(i)));

          // Step 2: Filter already-seen, fetch member data in parallel
          const newAddrs = addrs.filter(addr => !memberMap.has(addr.toLowerCase()));
          if (newAddrs.length === 0) continue;

          const memberDatas = await Promise.all(newAddrs.map(addr => pool.members(addr)));

          for (let k = 0; k < newAddrs.length; k++) {
            const normalizedAddr = newAddrs[k].toLowerCase();
            memberMap.set(normalizedAddr, {
              walletAddress: normalizedAddr,
              shares: parseFloat(ethers.formatUnits(memberDatas[k].shares, 18)),
              depositedUSD: parseFloat(ethers.formatUnits(memberDatas[k].depositedUSD, 6)),
              joinTime: Number(memberDatas[k].joinTime),
            });
          }
        }
        
        const members = Array.from(memberMap.values());
        logger.info(`[CommunityPool API] Unique members after deduplication: ${members.length}`);
        
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
async function findOnChainMember(userAddress: string, chainConfig: ChainConfig = getChainConfig()) {
  const normalizedUser = userAddress.toLowerCase();
  const members = await getAllOnChainMembers(chainConfig);
  
  if (!members) return null;
  
  const found = members.find(m => m.walletAddress.toLowerCase() === normalizedUser);
  if (found) {
    const onChainPool = await getOnChainPoolData(chainConfig);
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
    // Get user's position
    if (userAddress) {
      // SUI addresses (0x + 64 hex) passed to EVM chains → return empty early
      if (/^0x[a-fA-F0-9]{64}$/.test(userAddress) && chainConfig.chainKey !== 'sui') {
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
      const chainKey = chainConfig.chainKey;
      
      // Try DB first (faster for UI) unless forceOnChain
      // DB storage is now chain-aware and works for all chains
      if (!forceOnChain) {
        try {
          const userShares = await getUserSharesFromDb(userAddress, chainKey);
          if (userShares && userShares.shares > 0) {
            const onChainPool = await getOnChainPoolData(chainConfig);
            const poolData = onChainPool || await getPoolSummary();
            
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
      const marketNAV = await calculatePoolNAV();
      
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
      const summary = await getPoolSummary();
      
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
          const onChainUser = await getOnChainUserPosition(walletAddress, chainConfig);
          const onChainPool = await getOnChainPoolData(chainConfig);
          
          if (onChainUser && onChainPool) {
            // Save on-chain user state directly to DB with chain info
            await saveUserSharesToDb({
              walletAddress: walletAddress.toLowerCase(),
              shares: onChainUser.shares,
              costBasisUSD: onChainUser.valueUSD,
              chain: chainConfig.chainKey,
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
          const onChainUser = await getOnChainUserPosition(walletAddress, chainConfig);
          const onChainPool = await getOnChainPoolData(chainConfig);
          
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
        const totalNAV = onChainData.totalValueUSD;
        const allocations: Record<string, { percentage: number; valueUSD: number; amount: number; price: number }> = {
          BTC: { 
            percentage: onChainData.allocations.BTC.percentage, 
            valueUSD: totalNAV * onChainData.allocations.BTC.percentage / 100,
            amount: 0,
            price: 0,
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
        
        // Step 6: Update pool state
        await savePoolStateToDb({
          totalValueUSD: onChainData.totalValueUSD,
          totalShares: onChainData.totalShares,
          sharePrice: onChainData.sharePrice,
          allocations,
          lastRebalance: Date.now(),
          lastAIDecision: null,
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
        rpcCache.clear();
        pendingRequests.clear();
        
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
