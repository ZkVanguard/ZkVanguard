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
    rpcUrl: 'https://fullnode.testnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/testnet',
    // Pool state ID (created via create_pool)
    poolStateId: '0xb9b9c58c8c023723f631455c95c21ad3d3b00ba0fef91e42a90c9f648fa68f56' as string | null,
  },
  mainnet: {
    packageId: '',
    adminCapId: '',
    feeManagerCapId: '',
    moduleName: 'community_pool',
    rpcUrl: 'https://fullnode.mainnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/mainnet',
    poolStateId: null as string | null,
  },
} as const;

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
   * Get pool statistics from on-chain state
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
  }

  /**
   * Get member position from pool state
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
  }

  /**
   * Get all members (for leaderboard)
   */
  async getAllMembers(): Promise<SuiMemberPosition[]> {
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

      const members: SuiMemberPosition[] = [];

      for (const field of fields) {
        const memberAddress = field.name?.value;
        if (!memberAddress) continue;

        try {
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
              members.push({
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
              });
            }
          }
        } catch (err) {
          logger.debug('[SuiCommunityPool] Failed to fetch member:', memberAddress);
        }
      }

      return members.sort((a, b) => b.shares - a.shares);
    } catch (err) {
      logger.error('[SuiCommunityPool] Failed to fetch all members:', err);
      return [];
    }
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
   * Get deployment config
   */
  getDeploymentConfig() {
    return { ...this.config, network: this.network };
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
// SINGLETON
// ============================================

let testnetServiceInstance: SuiCommunityPoolService | null = null;
let mainnetServiceInstance: SuiCommunityPoolService | null = null;

export function getSuiCommunityPoolService(
  network: SuiNetworkType = 'testnet'
): SuiCommunityPoolService {
  if (network === 'mainnet') {
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
