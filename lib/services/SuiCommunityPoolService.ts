/**
 * SUI Community Pool Service
 * 
 * Provides integration with the SUI Community Pool Move contract for:
 * - Pool state queries
 * - Deposit/withdraw operations
 * - Member position queries
 * - NAV calculations
 * 
 * Uses @mysten/sui SDK for blockchain interactions.
 * This is the SUI equivalent of CommunityPoolService.ts (Cronos/EVM).
 * 
 * @see contracts/sui/sources/community_pool.move
 * @see lib/services/CommunityPoolService.ts (EVM equivalent)
 */

import { logger } from '@/lib/utils/logger';
import { getMarketDataService } from './RealMarketDataService';

// ============================================
// DEPLOYED CONTRACT ADDRESSES
// ============================================

export const SUI_POOL_CONFIG = {
  testnet: {
    packageId: '0xcb37e4ea0109e5c91096c0733821e4b603a5ef8faa995cfcf6c47aa2e325b70c',
    adminCapId: '0xef6d5702f58c020ff4b04e081ddb13c6e493715156ddb1d8123d502655d0e6e6',
    feeManagerCapId: '0x705d008ef94b9efdb6ed5a5c1e02e93a4e638fffe6714c1924537ac653c97af6',
    moduleName: 'community_pool',
    rpcUrl: process.env.SUI_TESTNET_RPC || 'https://fullnode.testnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/testnet',
    // Pool state ID (created via create_pool)
    poolStateId: '0xb9b9c58c8c023723f631455c95c21ad3d3b00ba0fef91e42a90c9f648fa68f56' as string | null,
  },
  mainnet: {
    packageId: (process.env.NEXT_PUBLIC_SUI_MAINNET_PACKAGE_ID || process.env.NEXT_PUBLIC_SUI_PACKAGE_ID || '').trim(),
    adminCapId: (process.env.NEXT_PUBLIC_SUI_MAINNET_ADMIN_CAP || process.env.NEXT_PUBLIC_SUI_ADMIN_CAP || '').trim(),
    feeManagerCapId: (process.env.NEXT_PUBLIC_SUI_MAINNET_FEE_MANAGER_CAP || process.env.NEXT_PUBLIC_SUI_FEE_MANAGER_CAP || '').trim(),
    moduleName: 'community_pool',
    rpcUrl: process.env.SUI_MAINNET_RPC || 'https://fullnode.mainnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/mainnet',
    poolStateId: (process.env.NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE || process.env.NEXT_PUBLIC_SUI_COMMUNITY_POOL_STATE || '').trim() || null as string | null,
  },
} as const;

// ============================================
// USDC POOL CONFIG (4-asset AI-managed pool)
// ============================================

/** USDC coin type on SUI networks */
export const SUI_USDC_COIN_TYPE = {
  // Circle native USDC on SUI mainnet
  mainnet: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  // Testnet USDC (use SUI testnet faucet USDC or mock)
  testnet: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
} as const;

export const SUI_USDC_POOL_CONFIG = {
  testnet: {
    packageId: (process.env.NEXT_PUBLIC_SUI_USDC_POOL_PACKAGE_ID || '').trim()
      || '0xcac1e7de082a92ec3db4a4f0766f1a73e9f8c22e50a3dafed6d81dc043bd0ac9',
    moduleName: 'community_pool_usdc',
    rpcUrl: process.env.SUI_TESTNET_RPC || 'https://fullnode.testnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/testnet',
    poolStateId: (process.env.NEXT_PUBLIC_SUI_USDC_POOL_STATE_TESTNET || '').trim()
      || '0x9f77819f91d75833f86259025068da493bb1c7215ed84f39d5ad0f5bc1b40971' as string | null,
    usdcCoinType: SUI_USDC_COIN_TYPE.testnet,
    usdcDecimals: 6,
  },
  mainnet: {
    packageId: (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID || process.env.NEXT_PUBLIC_SUI_USDC_POOL_PACKAGE_ID || '').trim(),
    moduleName: 'community_pool_usdc',
    rpcUrl: process.env.SUI_MAINNET_RPC || 'https://fullnode.mainnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/mainnet',
    poolStateId: (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE || process.env.NEXT_PUBLIC_SUI_USDC_POOL_STATE || '').trim() || null as string | null,
    usdcCoinType: SUI_USDC_COIN_TYPE.mainnet,
    usdcDecimals: 6,
  },
} as const;

/** 4-asset allocation for the USDC pool */
export interface SuiPoolAllocation {
  BTC: number;  // percentage
  ETH: number;
  SUI: number;
  CRO: number;
}

export interface SuiUsdcPoolStats extends SuiPoolStats {
  /** Pool value in USDC (6 decimals on-chain) */
  totalNAVUsdc: number;
  /** Share price in USDC */
  sharePriceUsdc: number;
  /** Current 4-asset allocation */
  allocation: SuiPoolAllocation;
  /** Whether the USDC pool is deployed */
  isUsdcPool: boolean;
}

type SuiNetworkType = 'testnet' | 'mainnet';

// SUI uses 9 decimals (MIST)
const SUI_DECIMALS = 9;
const SHARE_DECIMALS = 9;
const CLOCK_OBJECT_ID = '0x6';

// ============================================
// TYPES
// ============================================

export interface SuiPoolStats {
  totalNAV: number;            // In SUI
  totalNAVUsd: number;         // In USD
  totalShares: number;
  sharePrice: number;          // NAV per share
  sharePriceUsd: number;
  memberCount: number;
  managementFeeBps: number;
  performanceFeeBps: number;
  paused: boolean;
  allTimeHighNav: number;
  createdAt: number;
  poolStateId: string | null;
}

export interface SuiMemberPosition {
  address: string;
  shares: number;
  depositedSui: number;
  withdrawnSui: number;
  joinedAt: number;
  lastDepositAt: number;
  highWaterMark: number;
  valueSui: number;
  valueUsd: number;
  percentage: number;
  isMember: boolean;
}

export interface SuiAllocation {
  assetType: string;
  amount: bigint;
  percentage: number;
}

export interface SuiDepositParams {
  amountSui: number;           // In SUI (will be converted to MIST)
}

export interface SuiWithdrawParams {
  shares: number;              // Shares to burn
}

export interface SuiTransactionResult {
  success: boolean;
  txDigest?: string;
  sharesReceived?: number;
  amountSui?: number;
  sharePrice?: number;
  error?: string;
  explorerUrl?: string;
}

// ============================================
// IN-MEMORY CACHE (matches EVM CommunityPoolStatsService)
// ============================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const suiStatsCache = new Map<string, CacheEntry<unknown>>();
const suiPendingRequests = new Map<string, Promise<unknown>>();

const SUI_STATS_TTL = 60_000;    // 60s pool stats
const SUI_MEMBER_TTL = 30_000;   // 30s member positions
const SUI_MEMBERS_TTL = 120_000; // 2m all members (leaderboard)

/**
 * Deduplicated fetch with in-memory caching.
 * Prevents thundering herd: 100 concurrent users = 1 RPC call.
 */
async function suiCachedFetch<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttlMs: number
): Promise<T> {
  const cached = suiStatsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data as T;
  }

  const pending = suiPendingRequests.get(cacheKey) as Promise<T> | undefined;
  if (pending) return pending;

  const request = fetcher()
    .then(result => {
      suiStatsCache.set(cacheKey, { data: result, expiresAt: Date.now() + ttlMs });
      return result;
    })
    .finally(() => {
      suiPendingRequests.delete(cacheKey);
    });

  suiPendingRequests.set(cacheKey, request);
  return request;
}

// ============================================
// SUI COMMUNITY POOL SERVICE
// ============================================

export class SuiCommunityPoolService {
  private network: SuiNetworkType;
  private config: (typeof SUI_POOL_CONFIG)[SuiNetworkType];
  private cachedPoolStateId: string | null = null;

  constructor(network: SuiNetworkType = 'testnet') {
    this.network = network;
    this.config = SUI_POOL_CONFIG[network];
    logger.info('[SuiCommunityPool] Initialized', { network, packageId: this.config.packageId });
  }

  /** Clear all SUI caches (call after deposit/withdraw) */
  clearCaches(): void {
    suiStatsCache.clear();
    suiPendingRequests.clear();
    logger.info('[SuiCommunityPool] Caches cleared');
  }

  // ============================================
  // POOL STATE DISCOVERY
  // ============================================

  /**
   * Get or discover the pool state ID from PoolCreated events
   */
  async getPoolStateId(): Promise<string | null> {
    if (this.cachedPoolStateId) {
      return this.cachedPoolStateId;
    }

    if (this.config.poolStateId) {
      this.cachedPoolStateId = this.config.poolStateId;
      return this.cachedPoolStateId;
    }

    // Search for PoolCreated event
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_queryEvents',
          params: [{
            MoveEventType: `${this.config.packageId}::${this.config.moduleName}::PoolCreated`,
          }, null, 1, true], // descending order, limit 1
        }),
      });

      const data = await response.json();
      const events = data.result?.data || [];

      if (events.length > 0) {
        const event = events[0].parsedJson;
        this.cachedPoolStateId = event?.pool_id;
        logger.info('[SuiCommunityPool] Found pool state ID:', { poolStateId: this.cachedPoolStateId });
        return this.cachedPoolStateId;
      }
    } catch (err) {
      logger.error('[SuiCommunityPool] Failed to query pool events:', err);
    }

    return null;
  }

  // ============================================
  // READ OPERATIONS
  // ============================================

  /**
   * Get pool statistics from on-chain state.
   * Cached for 60s with request deduplication.
   */
  async getPoolStats(): Promise<SuiPoolStats> {
    const poolStateId = await this.getPoolStateId();
    
    const defaultStats: SuiPoolStats = {
      totalNAV: 0,
      totalNAVUsd: 0,
      totalShares: 0,
      sharePrice: 1.0,
      sharePriceUsd: 0,
      memberCount: 0,
      managementFeeBps: 50,
      performanceFeeBps: 1000,
      paused: false,
      allTimeHighNav: 1.0,
      createdAt: 0,
      poolStateId,
    };

    if (!poolStateId) {
      logger.warn('[SuiCommunityPool] No pool state found - pool may need to be created');
      return defaultStats;
    }

    const cacheKey = `sui-pool-stats-${this.network}`;
    return suiCachedFetch(cacheKey, async () => {
      try {
        const fields = await this.fetchObjectFields(poolStateId);
        if (!fields) return defaultStats;

        // Parse balance - can be direct string or nested Balance<SUI> struct
        const balanceValue = typeof fields.balance === 'string' 
          ? fields.balance 
          : (fields.balance?.fields?.value || fields.balance?.value || '0');
        const totalNAV = Number(balanceValue) / Math.pow(10, SUI_DECIMALS);
        const totalShares = Number(fields.total_shares || 0) / Math.pow(10, SHARE_DECIMALS);
        
        // Calculate share price
        const sharePrice = totalShares > 0 ? totalNAV / totalShares : 1.0;

        // MAINNET SANITY CHECK: Reject obviously wrong SUI amounts  
        // Max 10B SUI (total supply is ~10B)
        if (totalNAV > 10_000_000_000 || sharePrice > 1_000_000) {
          logger.error('[SuiCommunityPool] SANITY CHECK FAILED', {
            rawBalance: balanceValue, totalNAV, totalShares, sharePrice,
          });
          return defaultStats;
        }

        // Get SUI price for USD conversion
        let suiPrice = 0;
        try {
          const svc = getMarketDataService();
          const priceData = await svc.getTokenPrice('SUI');
          suiPrice = priceData.price;
        } catch (e) {
          logger.warn('[SuiCommunityPool] Failed to fetch SUI price:', { error: e });
        }

        return {
          totalNAV,
          totalNAVUsd: totalNAV * suiPrice,
          totalShares,
          sharePrice,
          sharePriceUsd: sharePrice * suiPrice,
          memberCount: Number(fields.member_count || 0),
          managementFeeBps: Number(fields.management_fee_bps || 50),
          performanceFeeBps: Number(fields.performance_fee_bps || 1000),
          paused: fields.paused || false,
          allTimeHighNav: Number(fields.all_time_high_nav_per_share || 1e9) / 1e9,
          createdAt: Number(fields.created_at || 0),
          poolStateId,
        };
      } catch (err) {
        logger.error('[SuiCommunityPool] Failed to fetch pool stats:', err);
        return defaultStats;
      }
    }, SUI_STATS_TTL);
  }

  /**
   * Get member position from pool state.
   * Cached for 30s with request deduplication.
   */
  async getMemberPosition(address: string): Promise<SuiMemberPosition> {
    const defaultPosition: SuiMemberPosition = {
      address,
      shares: 0,
      depositedSui: 0,
      withdrawnSui: 0,
      joinedAt: 0,
      lastDepositAt: 0,
      highWaterMark: 0,
      valueSui: 0,
      valueUsd: 0,
      percentage: 0,
      isMember: false,
    };

    const poolStateId = await this.getPoolStateId();
    if (!poolStateId) return defaultPosition;

    const cacheKey = `sui-member-${this.network}-${address.toLowerCase()}`;
    return suiCachedFetch(cacheKey, async () => {
    try {
      const stats = await this.getPoolStats();
      const poolFields = await this.fetchObjectFields(poolStateId);
      
      if (!poolFields) return defaultPosition;

      // Get members table ID
      const membersTableId = poolFields.members?.fields?.id?.id;
      if (!membersTableId) {
        logger.warn('[SuiCommunityPool] Members table not found');
        return defaultPosition;
      }

      // Query dynamic field for this address
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getDynamicFieldObject',
          params: [membersTableId, { type: 'address', value: address }],
        }),
      });

      const data = await response.json();
      const memberFields = data.result?.data?.content?.fields?.value?.fields ||
                          data.result?.data?.content?.fields;

      if (!memberFields || !memberFields.shares) {
        return defaultPosition; // Member not found
      }

      const shares = Number(memberFields.shares || 0) / Math.pow(10, SHARE_DECIMALS);
      const valueSui = shares * stats.sharePrice;

      // Get SUI price
      let suiPrice = 0;
      try {
        const svc = getMarketDataService();
        const priceData = await svc.getTokenPrice('SUI');
        suiPrice = priceData.price;
      } catch {
        // Use 0
      }

      return {
        address,
        shares,
        depositedSui: Number(memberFields.deposited_sui || 0) / Math.pow(10, SUI_DECIMALS),
        withdrawnSui: Number(memberFields.withdrawn_sui || 0) / Math.pow(10, SUI_DECIMALS),
        joinedAt: Number(memberFields.joined_at || 0),
        lastDepositAt: Number(memberFields.last_deposit_at || 0),
        highWaterMark: Number(memberFields.high_water_mark || 0) / 1e9,
        valueSui,
        valueUsd: valueSui * suiPrice,
        percentage: stats.totalShares > 0 ? (shares / stats.totalShares) * 100 : 0,
        isMember: shares > 0,
      };
    } catch (err) {
      logger.error('[SuiCommunityPool] Failed to fetch member position:', err);
      return defaultPosition;
    }
    }, SUI_MEMBER_TTL);
  }

  /**
   * Get all members (for leaderboard).
   * Cached for 2m. Parallelized RPC calls.
   */
  async getAllMembers(): Promise<SuiMemberPosition[]> {
    const cacheKey = `sui-all-members-${this.network}`;
    return suiCachedFetch(cacheKey, async () => {
    const poolStateId = await this.getPoolStateId();
    if (!poolStateId) return [];

    try {
      const stats = await this.getPoolStats();
      const poolFields = await this.fetchObjectFields(poolStateId);
      
      if (!poolFields) return [];

      const membersTableId = poolFields.members?.fields?.id?.id;
      if (!membersTableId) return [];

      // Get all dynamic fields (members)
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getDynamicFields',
          params: [membersTableId, null, 100], // limit 100
        }),
      });

      const data = await response.json();
      const fields = data.result?.data || [];

      // Get SUI price once
      let suiPrice = 0;
      try {
        const svc = getMarketDataService();
        const priceData = await svc.getTokenPrice('SUI');
        suiPrice = priceData.price;
      } catch {
        // Use 0
      }

      // Parallelize member fetches in batches of 5 (avoid rate limiting)
      const BATCH_SIZE = 5;
      const memberAddresses = fields.map((f: any) => f.name?.value).filter(Boolean) as string[];
      const members: SuiMemberPosition[] = [];

      for (let i = 0; i < memberAddresses.length; i += BATCH_SIZE) {
        const batch = memberAddresses.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (memberAddress) => {
            const memberRes = await fetch(this.config.rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'suix_getDynamicFieldObject',
                params: [membersTableId, { type: 'address', value: memberAddress }],
              }),
            });

            const memberData = await memberRes.json();
            const memberFields = memberData.result?.data?.content?.fields?.value?.fields ||
                                memberData.result?.data?.content?.fields;

            if (memberFields && memberFields.shares) {
              const shares = Number(memberFields.shares || 0) / Math.pow(10, SHARE_DECIMALS);
              const valueSui = shares * stats.sharePrice;

              if (shares > 0) {
                return {
                  address: memberAddress,
                  shares,
                  depositedSui: Number(memberFields.deposited_sui || 0) / Math.pow(10, SUI_DECIMALS),
                  withdrawnSui: Number(memberFields.withdrawn_sui || 0) / Math.pow(10, SUI_DECIMALS),
                  joinedAt: Number(memberFields.joined_at || 0),
                  lastDepositAt: Number(memberFields.last_deposit_at || 0),
                  highWaterMark: Number(memberFields.high_water_mark || 0) / 1e9,
                  valueSui,
                  valueUsd: valueSui * suiPrice,
                  percentage: stats.totalShares > 0 ? (shares / stats.totalShares) * 100 : 0,
                  isMember: true,
                } as SuiMemberPosition;
              }
            }
            return null;
          })
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            members.push(result.value);
          }
        }
      }

      return members.sort((a, b) => b.shares - a.shares);
    } catch (err) {
      logger.error('[SuiCommunityPool] Failed to fetch all members:', err);
      return [];
    }
    }, SUI_MEMBERS_TTL);
  }

  // ============================================
  // TRANSACTION BUILDERS (for frontend signing)
  // ============================================

  /**
   * Build deposit transaction data for frontend
   * Returns the Move call parameters - frontend will construct Transaction
   */
  buildDepositParams(amountSui: number): {
    target: string;
    poolStateId: string | null;
    amountMist: bigint;
    clockId: string;
  } {
    const amountMist = BigInt(Math.floor(amountSui * Math.pow(10, SUI_DECIMALS)));
    return {
      target: `${this.config.packageId}::${this.config.moduleName}::deposit`,
      poolStateId: this.cachedPoolStateId,
      amountMist,
      clockId: CLOCK_OBJECT_ID,
    };
  }

  /**
   * Build withdraw transaction data for frontend
   */
  buildWithdrawParams(sharesToBurn: number): {
    target: string;
    poolStateId: string | null;
    sharesScaled: bigint;
    clockId: string;
  } {
    const sharesScaled = BigInt(Math.floor(sharesToBurn * Math.pow(10, SHARE_DECIMALS)));
    return {
      target: `${this.config.packageId}::${this.config.moduleName}::withdraw`,
      poolStateId: this.cachedPoolStateId,
      sharesScaled,
      clockId: CLOCK_OBJECT_ID,
    };
  }

  /**
   * Build create portfolio transaction (compatible with test interface)
   * Uses rwa_manager module for RWA portfolio management
   */
  buildCreatePortfolioTransaction(params: {
    targetYield: number;
    riskTolerance: number;
    initialDeposit: bigint;
  }): {
    target: string;
    coinAmount: bigint;
    typeArgs: string[];
    arguments: (string | number | bigint)[];
  } {
    const rwaPackageId = '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a';
    return {
      target: `${rwaPackageId}::rwa_manager::create_portfolio`,
      coinAmount: params.initialDeposit,
      typeArgs: ['0x2::sui::SUI'],
      arguments: [params.targetYield, params.riskTolerance, params.initialDeposit],
    };
  }

  /**
   * Build deposit transaction (compatible with test interface)
   */
  buildDepositTransaction(params: {
    portfolioId: string;
    amount: bigint;
  }): {
    target: string;
    typeArgs: string[];
    arguments: (string | bigint)[];
  } {
    const rwaPackageId = '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a';
    return {
      target: `${rwaPackageId}::rwa_manager::deposit`,
      typeArgs: ['0x2::sui::SUI'],
      arguments: [params.portfolioId, params.amount],
    };
  }

  /**
   * Build withdraw transaction (compatible with test interface)
   */
  buildWithdrawTransaction(params: {
    portfolioId: string;
    amount: bigint;
  }): {
    target: string;
    typeArgs: string[];
    arguments: (string | bigint)[];
  } {
    const rwaPackageId = '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a';
    return {
      target: `${rwaPackageId}::rwa_manager::withdraw`,
      typeArgs: ['0x2::sui::SUI'],
      arguments: [params.portfolioId, params.amount],
    };
  }

  /**
   * Build rebalance transaction (compatible with test interface)
   */
  buildRebalanceTransaction(params: {
    portfolioId: string;
    newAllocations: number[];
    reasoning: string;
  }): {
    target: string;
    typeArgs: string[];
    arguments: (string | number[] | string)[];
  } {
    const rwaPackageId = '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a';
    return {
      target: `${rwaPackageId}::rwa_manager::rebalance`,
      typeArgs: [],
      arguments: [params.portfolioId, params.newAllocations, params.reasoning],
    };
  }

  /**
   * Build payment transaction (compatible with test interface)
   */
  buildPaymentTransaction(
    amount: bigint,
    recipient: string,
    invoiceId: string,
  ): {
    target: string;
    typeArgs: string[];
    arguments: (string | bigint)[];
  } {
    const rwaPackageId = '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a';
    return {
      target: `${rwaPackageId}::payment_router::route_payment`,
      typeArgs: ['0x2::sui::SUI'],
      arguments: [amount, recipient, invoiceId],
    };
  }

  /**
   * Get deployment config (compatible with test interface)
   */
  getDeploymentConfig(): {
    packageId: string;
    rwaManagerState: string;
    network: SuiNetworkType;
  } {
    return {
      packageId: '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a',
      rwaManagerState: '0x65638c3c5a5af66c33bf06f57230f8d9972d3a5507138974dce11b1e46e85c97',
      network: this.network,
    };
  }

  // ============================================
  // HELPERS
  // ============================================

  /**
   * Fetch object fields from SUI RPC
   */
  private async fetchObjectFields(objectId: string): Promise<Record<string, any> | null> {
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sui_getObject',
          params: [objectId, { showContent: true }],
        }),
      });

      const data = await response.json();
      return data.result?.data?.content?.fields || null;
    } catch (error) {
      logger.error('[SuiCommunityPool] Failed to fetch object:', { objectId, error });
      return null;
    }
  }

  /**
   * Get explorer URL for a transaction
   */
  getExplorerUrl(txDigest: string): string {
    return `${this.config.explorerUrl}/tx/${txDigest}`;
  }

  /**
   * Get the contract addresses for frontend
   */
  getContractInfo() {
    return {
      packageId: this.config.packageId,
      moduleName: this.config.moduleName,
      poolStateId: this.cachedPoolStateId,
      adminCapId: this.config.adminCapId,
      feeManagerCapId: this.config.feeManagerCapId,
      network: this.network,
      rpcUrl: this.config.rpcUrl,
      explorerUrl: this.config.explorerUrl,
    };
  }
}

// ============================================
// USDC POOL SERVICE (4-asset AI-managed)
// ============================================

const USDC_DECIMALS = 6;

export class SuiUsdcPoolService {
  private network: SuiNetworkType;
  private config: (typeof SUI_USDC_POOL_CONFIG)[SuiNetworkType];
  private fallbackService: SuiCommunityPoolService;
  private cachedUsdcPoolStateId: string | null = null;

  constructor(network: SuiNetworkType = 'testnet') {
    this.network = network;
    this.config = SUI_USDC_POOL_CONFIG[network];
    // Fallback to SUI-native pool until USDC pool is deployed
    this.fallbackService = new SuiCommunityPoolService(network);
    logger.info('[SuiUsdcPool] Initialized', { network, packageId: this.config.packageId || '(pending deploy)' });
  }

  /** Check if USDC pool contract is deployed */
  isDeployed(): boolean {
    return !!this.config.packageId;
  }

  /** Clear all caches */
  clearCaches(): void {
    suiStatsCache.clear();
    suiPendingRequests.clear();
    this.fallbackService.clearCaches();
  }

  /** Get or discover USDC pool state ID */
  async getPoolStateId(): Promise<string | null> {
    if (this.cachedUsdcPoolStateId) return this.cachedUsdcPoolStateId;
    if (this.config.poolStateId) {
      this.cachedUsdcPoolStateId = this.config.poolStateId;
      return this.cachedUsdcPoolStateId;
    }

    // If USDC pool not deployed, no pool state
    if (!this.config.packageId) return null;

    // Search for UsdcPoolCreated event
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_queryEvents',
          params: [{
            MoveEventType: `${this.config.packageId}::${this.config.moduleName}::UsdcPoolCreated`,
          }, null, 1, true],
        }),
      });
      const data = await response.json();
      const events = data.result?.data || [];
      if (events.length > 0) {
        this.cachedUsdcPoolStateId = events[0].parsedJson?.pool_id;
        return this.cachedUsdcPoolStateId;
      }
    } catch (err) {
      logger.error('[SuiUsdcPool] Failed to query pool events:', err);
    }

    return null;
  }

  /**
   * Get USDC pool stats with 4-asset allocation.
   * Falls back to SUI-native pool if USDC pool not deployed.
   */
  async getPoolStats(): Promise<SuiUsdcPoolStats> {
    // If USDC pool not yet deployed, use SUI-native pool with USD overlay
    if (!this.isDeployed()) {
      return this.getStatsFromFallback();
    }

    const poolStateId = await this.getPoolStateId();
    if (!poolStateId) {
      return this.getStatsFromFallback();
    }

    const cacheKey = `sui-usdc-pool-stats-${this.network}`;
    return suiCachedFetch(cacheKey, async () => {
      try {
        const fields = await this.fetchObjectFields(poolStateId);
        if (!fields) return this.getStatsFromFallback();

        const balanceValue = typeof fields.balance === 'string'
          ? fields.balance
          : (fields.balance?.fields?.value || fields.balance?.value || '0');
        const totalNAVUsdc = Number(balanceValue) / Math.pow(10, USDC_DECIMALS);
        const totalShares = Number(fields.total_shares || 0) / Math.pow(10, USDC_DECIMALS);
        const sharePriceUsdc = totalShares > 0 ? totalNAVUsdc / totalShares : 1.0;

        // MAINNET SANITY CHECK: Reject obviously wrong values
        const MAX_REASONABLE_NAV = 10_000_000_000; // $10B
        if (totalNAVUsdc > MAX_REASONABLE_NAV || sharePriceUsdc > 1_000_000) {
          logger.error('[SuiUsdcPool] SANITY CHECK FAILED — values exceed reasonable bounds', {
            rawBalance: balanceValue,
            totalNAVUsdc,
            totalShares,
            sharePriceUsdc,
          });
          return this.getStatsFromFallback();
        }

        // Parse 4-asset allocation from on-chain
        const alloc = fields.current_allocation?.fields || {};
        const allocation: SuiPoolAllocation = {
          BTC: Number(alloc.btc_bps || 3000) / 100,
          ETH: Number(alloc.eth_bps || 3000) / 100,
          SUI: Number(alloc.sui_bps || 2000) / 100,
          CRO: Number(alloc.cro_bps || 2000) / 100,
        };

        return {
          totalNAV: totalNAVUsdc,
          totalNAVUsd: totalNAVUsdc, // USDC ≈ USD
          totalNAVUsdc,
          totalShares,
          sharePrice: sharePriceUsdc,
          sharePriceUsd: sharePriceUsdc,
          sharePriceUsdc,
          memberCount: Number(fields.member_count || 0),
          managementFeeBps: Number(fields.management_fee_bps || 50),
          performanceFeeBps: Number(fields.performance_fee_bps || 1000),
          paused: fields.paused || false,
          allTimeHighNav: Number(fields.all_time_high_nav_per_share || 1e6) / 1e6,
          createdAt: Number(fields.created_at || 0),
          poolStateId,
          allocation,
          isUsdcPool: true,
        };
      } catch (err) {
        logger.error('[SuiUsdcPool] Failed to fetch pool stats:', err);
        return this.getStatsFromFallback();
      }
    }, SUI_STATS_TTL);
  }

  /** Get stats from SUI-native pool with USDC overlay */
  private async getStatsFromFallback(): Promise<SuiUsdcPoolStats> {
    const base = await this.fallbackService.getPoolStats();
    return {
      ...base,
      totalNAVUsdc: base.totalNAVUsd,
      sharePriceUsdc: base.sharePriceUsd,
      allocation: { BTC: 30, ETH: 30, SUI: 20, CRO: 20 },
      isUsdcPool: false,
    };
  }

  /** Get member position (USDC-denominated) */
  async getMemberPosition(address: string): Promise<SuiMemberPosition> {
    if (!this.isDeployed()) {
      return this.fallbackService.getMemberPosition(address);
    }

    const poolStateId = await this.getPoolStateId();
    if (!poolStateId) {
      return this.fallbackService.getMemberPosition(address);
    }

    const defaultPosition: SuiMemberPosition = {
      address,
      shares: 0,
      depositedSui: 0,
      withdrawnSui: 0,
      joinedAt: 0,
      lastDepositAt: 0,
      highWaterMark: 0,
      valueSui: 0,
      valueUsd: 0,
      percentage: 0,
      isMember: false,
    };

    const cacheKey = `sui-usdc-member-${this.network}-${address.toLowerCase()}`;
    return suiCachedFetch(cacheKey, async () => {
      try {
        const stats = await this.getPoolStats();
        const fields = await this.fetchObjectFields(poolStateId!);
        if (!fields) return defaultPosition;

        const membersTableId = fields.members?.fields?.id?.id;
        if (!membersTableId) return defaultPosition;

        const response = await fetch(this.config.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'suix_getDynamicFieldObject',
            params: [membersTableId, { type: 'address', value: address }],
          }),
        });
        const data = await response.json();
        const memberFields = data.result?.data?.content?.fields?.value?.fields ||
                            data.result?.data?.content?.fields;

        if (!memberFields?.shares) return defaultPosition;

        const shares = Number(memberFields.shares || 0) / Math.pow(10, USDC_DECIMALS);
        const valueUsdc = shares * stats.sharePriceUsdc;

        return {
          address,
          shares,
          depositedSui: Number(memberFields.deposited_usdc || 0) / Math.pow(10, USDC_DECIMALS),
          withdrawnSui: Number(memberFields.withdrawn_usdc || 0) / Math.pow(10, USDC_DECIMALS),
          joinedAt: Number(memberFields.joined_at || 0),
          lastDepositAt: Number(memberFields.last_deposit_at || 0),
          highWaterMark: Number(memberFields.high_water_mark || 0) / 1e6,
          valueSui: valueUsdc, // In USDC context, valueSui = valueUsdc
          valueUsd: valueUsdc,
          percentage: stats.totalShares > 0 ? (shares / stats.totalShares) * 100 : 0,
          isMember: shares > 0,
        };
      } catch (err) {
        logger.error('[SuiUsdcPool] Failed to fetch member:', err);
        return defaultPosition;
      }
    }, SUI_MEMBER_TTL);
  }

  /** Get all members */
  async getAllMembers(): Promise<SuiMemberPosition[]> {
    // Delegate to fallback for now — member structure is compatible
    return this.fallbackService.getAllMembers();
  }

  /**
   * Build USDC deposit transaction params.
   * The frontend must find a USDC coin object to split.
   */
  buildDepositParams(amountUsdc: number): {
    target: string;
    poolStateId: string | null;
    amountRaw: bigint;
    clockId: string;
    usdcCoinType: string;
    typeArg: string;
  } {
    const amountRaw = BigInt(Math.floor(amountUsdc * Math.pow(10, USDC_DECIMALS)));
    const pkg = this.config.packageId || this.fallbackService.getDeploymentConfig().packageId;
    const mod = this.config.moduleName;
    
    return {
      target: `${pkg}::${mod}::deposit`,
      poolStateId: this.cachedUsdcPoolStateId || this.config.poolStateId,
      amountRaw,
      clockId: CLOCK_OBJECT_ID,
      usdcCoinType: this.config.usdcCoinType,
      typeArg: this.config.usdcCoinType,
    };
  }

  /** Build USDC withdraw transaction params */
  buildWithdrawParams(sharesToBurn: number): {
    target: string;
    poolStateId: string | null;
    sharesScaled: bigint;
    clockId: string;
    typeArg: string;
  } {
    const sharesScaled = BigInt(Math.floor(sharesToBurn * Math.pow(10, USDC_DECIMALS)));
    const pkg = this.config.packageId || this.fallbackService.getDeploymentConfig().packageId;
    const mod = this.config.moduleName;

    return {
      target: `${pkg}::${mod}::withdraw`,
      poolStateId: this.cachedUsdcPoolStateId || this.config.poolStateId,
      sharesScaled,
      clockId: CLOCK_OBJECT_ID,
      typeArg: this.config.usdcCoinType,
    };
  }

  /** Fetch object fields from SUI RPC */
  private async fetchObjectFields(objectId: string): Promise<Record<string, any> | null> {
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sui_getObject',
          params: [objectId, { showContent: true }],
        }),
      });
      const data = await response.json();
      return data.result?.data?.content?.fields || null;
    } catch (error) {
      logger.error('[SuiUsdcPool] Failed to fetch object:', { objectId, error });
      return null;
    }
  }

  /** Get contract info for frontend */
  getContractInfo() {
    return {
      packageId: this.config.packageId,
      moduleName: this.config.moduleName,
      poolStateId: this.cachedUsdcPoolStateId,
      usdcCoinType: this.config.usdcCoinType,
      network: this.network,
      rpcUrl: this.config.rpcUrl,
      explorerUrl: this.config.explorerUrl,
      isUsdcPool: true,
    };
  }

  getExplorerUrl(txDigest: string): string {
    return `${this.config.explorerUrl}/tx/${txDigest}`;
  }
}

// ============================================
// SINGLETON
// ============================================

let testnetServiceInstance: SuiCommunityPoolService | null = null;
let mainnetServiceInstance: SuiCommunityPoolService | null = null;

export function getSuiCommunityPoolService(
  network?: SuiNetworkType
): SuiCommunityPoolService {
  const net = network || (process.env.SUI_NETWORK as SuiNetworkType) || 'testnet';
  if (net === 'mainnet') {
    if (!mainnetServiceInstance) {
      mainnetServiceInstance = new SuiCommunityPoolService('mainnet');
    }
    return mainnetServiceInstance;
  }
  
  if (!testnetServiceInstance) {
    testnetServiceInstance = new SuiCommunityPoolService('testnet');
  }
  return testnetServiceInstance;
}

// USDC Pool singletons
let testnetUsdcInstance: SuiUsdcPoolService | null = null;
let mainnetUsdcInstance: SuiUsdcPoolService | null = null;

export function getSuiUsdcPoolService(
  network?: SuiNetworkType
): SuiUsdcPoolService {
  const net = network || (process.env.SUI_NETWORK as SuiNetworkType) || 'testnet';
  if (net === 'mainnet') {
    if (!mainnetUsdcInstance) {
      mainnetUsdcInstance = new SuiUsdcPoolService('mainnet');
    }
    return mainnetUsdcInstance;
  }

  if (!testnetUsdcInstance) {
    testnetUsdcInstance = new SuiUsdcPoolService('testnet');
  }
  return testnetUsdcInstance;
}
