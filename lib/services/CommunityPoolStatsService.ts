/**
 * Community Pool Stats Service (Single Source of Truth)
 * 
 * ARCHITECTURE:
 * - ALL stats come from on-chain contract (totalShares, NAV, sharePrice, allocations)
 * - DB read-through cache: checks DB first if updated < 60s ago (shared across serverless instances)
 * - In-memory caching (60s) for performance during high concurrency (per-instance)
 * - After RPC fetch, writes to DB so other instances can use cached data
 * 
 * Cache Layers (priority order):
 * 1. In-memory cache (60s TTL) - fastest, per-instance
 * 2. DB cache (checks updated_at < 60s) - shared across instances/serverless
 * 3. On-chain RPC - source of truth, updates DB after fetch
 * 
 * This is the SINGLE SOURCE OF TRUTH for all pool statistics.
 * Other services (CommunityPoolService, AutoHedgingService, etc.) delegate here.
 */

import { ethers, type BrowserProvider, type JsonRpcProvider } from 'ethers';
import { logger } from '../utils/logger';
import { isMainnet } from '../utils/network';
import { getMarketDataService } from './RealMarketDataService';
import { getPoolStateFromDb, savePoolStateToDb } from '../db/community-pool';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

// Contract addresses (single source of truth)
const POOL_CONFIG = {
  mainnet: {
    rpcUrl: process.env.CRONOS_MAINNET_RPC || 'https://evm.cronos.org/',
    poolAddress: '', // Set when deployed
    chainId: 25,
  },
  testnet: {
    rpcUrl: process.env.CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org',
    poolAddress: '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30', // V3 Proxy
    chainId: 338,
  },
} as const;

// Minimal ABI for reading stats
const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function getMemberPosition(address member) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)',
  'function calculateTotalNAV() view returns (uint256)',
  'function getNavPerShare() view returns (uint256)',
  'function getMemberCount() view returns (uint256)',
  'function memberList(uint256 index) view returns (address)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinTime)',
  'function isMember(address) view returns (bool)',
  'function targetAllocationBps(uint256) view returns (uint256)',
  'function totalShares() view returns (uint256)',
  'function assetBalances(uint256) view returns (uint256)',
];

// Asset indices (matching contract)
const ASSET_INDEX = {
  BTC: 0,
  ETH: 1,
  SUI: 2,
  CRO: 3,
} as const;
type AssetSymbol = keyof typeof ASSET_INDEX;

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface PoolStats {
  // Core stats (from on-chain)
  totalShares: number;
  totalNAV: number;           // In USD (6 decimals precision)
  sharePrice: number;         // NAV per share
  memberCount: number;
  
  // Allocations (target BPS from on-chain, converted to %)
  allocations: {
    BTC: { percentage: number; targetBps: number };
    ETH: { percentage: number; targetBps: number };
    SUI: { percentage: number; targetBps: number };
    CRO: { percentage: number; targetBps: number };
  };
  
  // On-chain asset balances (if held)
  assetBalances: {
    BTC: number;
    ETH: number;
    SUI: number;
    CRO: number;
  };
  
  // Metadata
  lastUpdated: number;
  source: 'on-chain';
  chainId: number;
}

export interface MemberPosition {
  walletAddress: string;
  shares: number;
  valueUSD: number;
  percentage: number;
  isMember: boolean;
  depositedUSD: number;
  withdrawnUSD: number;
  joinedAt: number | null;
  source: 'on-chain';
}

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY CACHE (performance only, NOT persistent)
// ═══════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const statsCache = new Map<string, CacheEntry<PoolStats>>();
const memberCache = new Map<string, CacheEntry<MemberPosition>>();
const pendingRequests = new Map<string, Promise<unknown>>();

const STATS_CACHE_TTL = 60_000;        // 60 seconds
const MEMBER_CACHE_TTL = 30_000;       // 30 seconds
const DB_FRESHNESS_TTL = 60_000;       // 60 seconds - DB considered fresh if updated within this window

/**
 * Deduplicated fetch with in-memory caching
 */
async function cachedFetch<T>(
  cacheKey: string,
  cache: Map<string, CacheEntry<T>>,
  fetcher: () => Promise<T>,
  ttlMs: number
): Promise<T> {
  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }
  
  // Check pending request (prevent thundering herd)
  const pending = pendingRequests.get(cacheKey) as Promise<T> | undefined;
  if (pending) {
    return pending;
  }
  
  // Fetch with deduplication
  const request = fetcher()
    .then(result => {
      cache.set(cacheKey, { data: result, expiresAt: Date.now() + ttlMs });
      return result;
    })
    .finally(() => {
      pendingRequests.delete(cacheKey);
    });
  
  pendingRequests.set(cacheKey, request);
  return request;
}

// ═══════════════════════════════════════════════════════════════
// CORE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get network configuration
 */
function getConfig() {
  const mainnetMode = isMainnet();
  return mainnetMode ? POOL_CONFIG.mainnet : POOL_CONFIG.testnet;
}

/**
 * Get pool contract instance
 */
function getPoolContract(provider: JsonRpcProvider | BrowserProvider) {
  const config = getConfig();
  if (!config.poolAddress) {
    throw new Error('CommunityPool not deployed on this network');
  }
  return new ethers.Contract(config.poolAddress, POOL_ABI, provider);
}

/**
 * Get pool statistics - with DB read-through cache
 * 
 * Cache layers (in priority order):
 * 1. In-memory cache (60s TTL) - fastest, per-instance
 * 2. DB cache (checks updated_at < 60s) - shared across instances/serverless
 * 3. On-chain RPC - source of truth, updates DB after fetch
 * 
 * This is the SINGLE SOURCE OF TRUTH for pool stats.
 * All other services should call this instead of implementing their own.
 */
export async function getPoolStats(): Promise<PoolStats> {
  const config = getConfig();
  const cacheKey = `pool-stats-${config.chainId}`;
  
  // Layer 1: Check in-memory cache first
  const cachedEntry = statsCache.get(cacheKey);
  if (cachedEntry && Date.now() < cachedEntry.expiresAt) {
    return cachedEntry.data;
  }
  
  // Check pending request (prevent thundering herd)
  const pending = pendingRequests.get(cacheKey) as Promise<PoolStats> | undefined;
  if (pending) {
    return pending;
  }
  
  // Create a single request that all concurrent callers will share
  const request = (async (): Promise<PoolStats> => {
    // Layer 2: Check DB cache (shared across serverless instances)
    try {
      const dbState = await getPoolStateFromDb();
      if (dbState && dbState.updated_at) {
        const dbAge = Date.now() - new Date(dbState.updated_at).getTime();
        if (dbAge < DB_FRESHNESS_TTL) {
          // DB is fresh, convert to PoolStats format
          const allocations = dbState.allocations || {};
          const result: PoolStats = {
            totalShares: dbState.total_shares,
            totalNAV: dbState.total_value_usd,
            sharePrice: dbState.share_price,
            memberCount: 0, // DB doesn't store member count, will be filled on next RPC fetch
            allocations: {
              BTC: { percentage: allocations.BTC?.percentage ?? 0, targetBps: (allocations.BTC?.percentage ?? 0) * 100 },
              ETH: { percentage: allocations.ETH?.percentage ?? 0, targetBps: (allocations.ETH?.percentage ?? 0) * 100 },
              SUI: { percentage: allocations.SUI?.percentage ?? 0, targetBps: (allocations.SUI?.percentage ?? 0) * 100 },
              CRO: { percentage: allocations.CRO?.percentage ?? 0, targetBps: (allocations.CRO?.percentage ?? 0) * 100 },
            },
            assetBalances: {
              BTC: allocations.BTC?.amount ?? 0,
              ETH: allocations.ETH?.amount ?? 0,
              SUI: allocations.SUI?.amount ?? 0,
              CRO: allocations.CRO?.amount ?? 0,
            },
            lastUpdated: new Date(dbState.updated_at).getTime(),
            source: 'on-chain', // Still considered on-chain as DB is synced from chain
            chainId: config.chainId,
          };
          
          logger.info('[PoolStats] Served from DB cache', { ageMs: dbAge, totalNAV: result.totalNAV });
          
          // Store in in-memory cache for this instance
          statsCache.set(cacheKey, { data: result, expiresAt: Date.now() + STATS_CACHE_TTL });
          return result;
        }
      }
    } catch (dbErr) {
      logger.warn('[PoolStats] DB cache check failed, falling back to RPC', { err: dbErr });
    }
    
    // Layer 3: Fetch from on-chain RPC
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const pool = getPoolContract(provider);
    
    // Fetch all data in parallel
    const [stats, nav, navPerShare, ...allocBps] = await Promise.all([
      pool.getPoolStats(),
      pool.calculateTotalNAV(),
      pool.getNavPerShare(),
      pool.targetAllocationBps(ASSET_INDEX.BTC),
      pool.targetAllocationBps(ASSET_INDEX.ETH),
      pool.targetAllocationBps(ASSET_INDEX.SUI),
      pool.targetAllocationBps(ASSET_INDEX.CRO),
    ]);
    
    // Parse values
    const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
    
    // Deduplicate member count (contract memberList has duplicate entries)
    // OPTIMIZATION: batch memberList calls in parallel chunks of 5
    const rawMemberCount = Number(stats._memberCount);
    let memberCount = rawMemberCount;
    try {
      const uniqueAddresses = new Set<string>();
      const BATCH_SIZE = 5;

      for (let batchStart = 0; batchStart < rawMemberCount; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, rawMemberCount);
        const indices = Array.from({ length: batchEnd - batchStart }, (_, k) => batchStart + k);
        const addrs = await Promise.all(indices.map(i => pool.memberList(i)));
        for (const addr of addrs) {
          uniqueAddresses.add(addr.toLowerCase());
        }
      }

      memberCount = uniqueAddresses.size;
      if (memberCount !== rawMemberCount) {
        logger.info(`[PoolStats] Deduplicated members: ${rawMemberCount} raw -> ${memberCount} unique`);
      }
    } catch (err) {
      logger.warn('[PoolStats] Failed to deduplicate members, using raw count', { err });
    }
    
    // NAV and sharePrice from dedicated functions (more accurate)
    const totalNAV = parseFloat(ethers.formatUnits(nav, 6));
    const sharePrice = parseFloat(ethers.formatUnits(navPerShare, 6));

    // MAINNET SANITY CHECK: Reject obviously wrong values
    // Max pool size $10B — anything above indicates a decimal conversion bug
    const MAX_REASONABLE_NAV = 10_000_000_000; // $10B
    const MAX_REASONABLE_SHARE_PRICE = 1_000_000; // $1M per share
    if (totalNAV > MAX_REASONABLE_NAV || sharePrice > MAX_REASONABLE_SHARE_PRICE) {
      logger.error('[PoolStats] SANITY CHECK FAILED — values exceed reasonable bounds', {
        rawNav: nav.toString(),
        rawNavPerShare: navPerShare.toString(),
        parsedTotalNAV: totalNAV,
        parsedSharePrice: sharePrice,
        maxReasonableNAV: MAX_REASONABLE_NAV,
        maxReasonableSharePrice: MAX_REASONABLE_SHARE_PRICE,
      });
      // Return safe zero-state instead of crashing — frontend will show "loading" or "no data"
      return {
        totalShares: 0,
        totalNAV: 0,
        sharePrice: 1.0,
        memberCount: 0,
        allocations: {
          BTC: { percentage: 0, targetBps: 0 },
          ETH: { percentage: 0, targetBps: 0 },
          SUI: { percentage: 0, targetBps: 0 },
          CRO: { percentage: 0, targetBps: 0 },
        },
        assetBalances: { BTC: 0, ETH: 0, SUI: 0, CRO: 0 },
        lastUpdated: Date.now(),
        source: 'on-chain',
        chainId: config.chainId,
        error: 'Sanity check failed — on-chain values exceed reasonable bounds',
      } as PoolStats;
    }
    
    // Allocations (BPS to percentage)
    const btcBps = Number(allocBps[0]);
    const ethBps = Number(allocBps[1]);
    const suiBps = Number(allocBps[2]);
    const croBps = Number(allocBps[3]);
    
    // Try to get asset balances (may be 0 if not traded yet)
    let assetBalances = { BTC: 0, ETH: 0, SUI: 0, CRO: 0 };
    try {
      const [btcBal, ethBal, suiBal, croBal] = await Promise.all([
        pool.assetBalances(ASSET_INDEX.BTC),
        pool.assetBalances(ASSET_INDEX.ETH),
        pool.assetBalances(ASSET_INDEX.SUI),
        pool.assetBalances(ASSET_INDEX.CRO),
      ]);
      assetBalances = {
        BTC: parseFloat(ethers.formatUnits(btcBal, 8)),   // BTC has 8 decimals
        ETH: parseFloat(ethers.formatUnits(ethBal, 18)),  // ETH has 18 decimals
        SUI: parseFloat(ethers.formatUnits(suiBal, 9)),   // SUI has 9 decimals
        CRO: parseFloat(ethers.formatUnits(croBal, 8)),   // CRO has 8 decimals
      };
    } catch (err) {
      logger.debug('[PoolStats] Failed to fetch asset balances (may not be held)', { err });
    }
    
    const result: PoolStats = {
      totalShares,
      totalNAV,
      sharePrice,
      memberCount,
      allocations: {
        BTC: { percentage: btcBps / 100, targetBps: btcBps },
        ETH: { percentage: ethBps / 100, targetBps: ethBps },
        SUI: { percentage: suiBps / 100, targetBps: suiBps },
        CRO: { percentage: croBps / 100, targetBps: croBps },
      },
      assetBalances,
      lastUpdated: Date.now(),
      source: 'on-chain',
      chainId: config.chainId,
    };
    
    logger.info('[PoolStats] Fetched from on-chain RPC', {
      totalNAV: result.totalNAV,
      sharePrice: result.sharePrice,
      totalShares: result.totalShares,
      memberCount: result.memberCount,
    });
    
    // Update DB cache asynchronously (don't block the response)
    savePoolStateToDb({
      totalValueUSD: result.totalNAV,
      totalShares: result.totalShares,
      sharePrice: result.sharePrice,
      allocations: {
        BTC: { percentage: btcBps / 100, valueUSD: 0, amount: assetBalances.BTC, price: 0 },
        ETH: { percentage: ethBps / 100, valueUSD: 0, amount: assetBalances.ETH, price: 0 },
        SUI: { percentage: suiBps / 100, valueUSD: 0, amount: assetBalances.SUI, price: 0 },
        CRO: { percentage: croBps / 100, valueUSD: 0, amount: assetBalances.CRO, price: 0 },
      },
      lastRebalance: Date.now(),
      lastAIDecision: null,
    }).catch(err => {
      logger.warn('[PoolStats] Failed to update DB cache', { err });
    });
    
    // Store in in-memory cache
    statsCache.set(cacheKey, { data: result, expiresAt: Date.now() + STATS_CACHE_TTL });
    
    return result;
  })();
  
  // Register pending request for deduplication
  pendingRequests.set(cacheKey, request);
  
  // Cleanup pending request after completion
  request.finally(() => {
    pendingRequests.delete(cacheKey);
  });
  
  return request;
}

/**
 * Get member position - ALWAYS from on-chain
 */
export async function getMemberPosition(walletAddress: string): Promise<MemberPosition> {
  const config = getConfig();
  const normalizedAddr = walletAddress.toLowerCase();
  const cacheKey = `member-${normalizedAddr}-${config.chainId}`;
  
  return cachedFetch(cacheKey, memberCache, async () => {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const pool = getPoolContract(provider);
    
    const [position, memberData, isMember] = await Promise.all([
      pool.getMemberPosition(walletAddress),
      pool.members(walletAddress),
      pool.isMember(walletAddress),
    ]);
    
    return {
      walletAddress,
      shares: parseFloat(ethers.formatUnits(position.shares, 18)),
      valueUSD: parseFloat(ethers.formatUnits(position.valueUSD, 6)),
      percentage: parseFloat(ethers.formatUnits(position.percentage, 2)),
      isMember,
      depositedUSD: parseFloat(ethers.formatUnits(memberData.depositedUSD, 6)),
      withdrawnUSD: parseFloat(ethers.formatUnits(memberData.withdrawnUSD, 6)),
      joinedAt: memberData.joinTime > 0 ? Number(memberData.joinTime) * 1000 : null,
      source: 'on-chain',
    };
  }, MEMBER_CACHE_TTL);
}

/**
 * Force refresh stats (bypasses cache)
 */
export async function refreshPoolStats(): Promise<PoolStats> {
  const config = getConfig();
  const cacheKey = `pool-stats-${config.chainId}`;
  statsCache.delete(cacheKey);
  return getPoolStats();
}

/**
 * Force refresh member position (bypasses cache)
 */
export async function refreshMemberPosition(walletAddress: string): Promise<MemberPosition> {
  const config = getConfig();
  const normalizedAddr = walletAddress.toLowerCase();
  const cacheKey = `member-${normalizedAddr}-${config.chainId}`;
  memberCache.delete(cacheKey);
  return getMemberPosition(walletAddress);
}

/**
 * Clear all caches (useful after deposits/withdrawals)
 */
export function clearCaches(): void {
  statsCache.clear();
  memberCache.clear();
  pendingRequests.clear();
  logger.info('[PoolStats] All caches cleared');
}

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE EXPORTS (for backward compatibility)
// ═══════════════════════════════════════════════════════════════

/**
 * Get pool summary (alias for getPoolStats with formatted output)
 */
export async function getPoolSummary() {
  const stats = await getPoolStats();
  return {
    totalValueUSD: stats.totalNAV,
    totalShares: stats.totalShares,
    sharePrice: stats.sharePrice,
    totalMembers: stats.memberCount,
    allocations: {
      BTC: stats.allocations.BTC.percentage,
      ETH: stats.allocations.ETH.percentage,
      SUI: stats.allocations.SUI.percentage,
      CRO: stats.allocations.CRO.percentage,
    },
    onChain: true,
    lastUpdated: stats.lastUpdated,
  };
}

/**
 * Get user shares (alias for getMemberPosition)
 */
export async function getUserShares(walletAddress: string) {
  const pos = await getMemberPosition(walletAddress);
  return {
    walletAddress: pos.walletAddress,
    shares: pos.shares,
    valueUSD: pos.valueUSD,
    percentage: pos.percentage,
    isMember: pos.isMember,
  };
}
