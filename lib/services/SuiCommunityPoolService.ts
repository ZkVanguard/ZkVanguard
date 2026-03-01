/**
 * SUI Community Pool Service
 * 
 * Mirrors CommunityPoolOnChainService for Cronos, wrapping the deployed
 * rwa_manager.move contract on SUI for:
 * - Portfolio creation & management
 * - Deposit/withdraw operations
 * - Pool stats and member positions
 * - AI allocation decisions
 * 
 * Uses the deployed RWA Manager state object on SUI testnet.
 * 
 * @see contracts/sui/sources/rwa_manager.move
 */

import { logger } from '@/lib/utils/logger';

// ============================================
// DEPLOYED CONTRACT ADDRESSES
// ============================================

const SUI_POOL_DEPLOYMENTS = {
  testnet: {
    packageId: '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a',
    rwaManagerState: '0x65638c3c5a5af66c33bf06f57230f8d9972d3a5507138974dce11b1e46e85c97',
    paymentRouterState: '0x1fba1a6a0be32f5d678da2910b99900f74af680531563fd7274d5059e1420678',
    rpcUrl: 'https://fullnode.testnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/testnet',
  },
  mainnet: {
    packageId: '',
    rwaManagerState: '',
    paymentRouterState: '',
    rpcUrl: 'https://fullnode.mainnet.sui.io:443',
    explorerUrl: 'https://suiscan.xyz/mainnet',
  },
} as const;

// ============================================
// TYPES
// ============================================

export interface SuiPoolStats {
  totalPortfolios: number;
  totalValueLocked: bigint;    // In MIST
  totalValueLockedUsd: number;
  memberCount: number;
  avgPortfolioSize: number;
}

export interface SuiPortfolio {
  portfolioId: string;
  owner: string;
  totalValue: bigint;
  targetYield: number;         // Basis points (e.g., 800 = 8%)
  riskTolerance: number;       // 0-100
  isActive: boolean;
  lastRebalance: number;
  allocations: SuiAllocation[];
}

export interface SuiAllocation {
  assetType: string;
  amount: bigint;
  percentage: number;
}

export interface SuiMemberPosition {
  address: string;
  portfolioIds: string[];
  totalValue: bigint;
  totalValueUsd: number;
  portfolioCount: number;
}

export interface SuiDepositParams {
  portfolioId: string;
  amount: bigint;              // In MIST
}

export interface SuiWithdrawParams {
  portfolioId: string;
  amount: bigint;
}

export interface SuiCreatePortfolioParams {
  targetYield: number;         // Basis points
  riskTolerance: number;       // 0-100
  initialDeposit: bigint;      // In MIST
}

export interface SuiRebalanceParams {
  portfolioId: string;
  newAllocations: number[];    // Basis points per asset
  reasoning: string;
}

export interface SuiPoolTransactionResult {
  success: boolean;
  digest?: string;
  portfolioId?: string;
  error?: string;
}

// ============================================
// SUI COMMUNITY POOL SERVICE
// ============================================

export class SuiCommunityPoolService {
  private network: keyof typeof SUI_POOL_DEPLOYMENTS;
  private config: (typeof SUI_POOL_DEPLOYMENTS)[keyof typeof SUI_POOL_DEPLOYMENTS];

  constructor(network: keyof typeof SUI_POOL_DEPLOYMENTS = 'testnet') {
    this.network = network;
    this.config = SUI_POOL_DEPLOYMENTS[network];
    logger.info('[SuiPool] Initialized', { network });
  }

  // ============================================
  // TRANSACTION BUILDERS
  // ============================================

  /**
   * Build transaction to create a new portfolio
   */
  buildCreatePortfolioTransaction(params: SuiCreatePortfolioParams): {
    target: string;
    arguments: unknown[];
    coinAmount: bigint;
  } {
    return {
      target: `${this.config.packageId}::rwa_manager::create_portfolio`,
      arguments: [
        this.config.rwaManagerState,
        params.targetYield,
        params.riskTolerance,
        // Coin object will be split from gas in frontend
        '0x6', // Clock
      ],
      coinAmount: params.initialDeposit,
    };
  }

  /**
   * Build transaction to deposit into a portfolio
   */
  buildDepositTransaction(params: SuiDepositParams): {
    target: string;
    arguments: unknown[];
    coinAmount: bigint;
  } {
    return {
      target: `${this.config.packageId}::rwa_manager::deposit`,
      arguments: [
        this.config.rwaManagerState,
        params.portfolioId,
        // Coin will be split in frontend
        '0x6',
      ],
      coinAmount: params.amount,
    };
  }

  /**
   * Build transaction to withdraw from a portfolio
   */
  buildWithdrawTransaction(params: SuiWithdrawParams): {
    target: string;
    arguments: unknown[];
  } {
    return {
      target: `${this.config.packageId}::rwa_manager::withdraw`,
      arguments: [
        this.config.rwaManagerState,
        params.portfolioId,
        params.amount.toString(),
        '0x6',
      ],
    };
  }

  /**
   * Build transaction to rebalance a portfolio (admin/AI only)
   */
  buildRebalanceTransaction(params: SuiRebalanceParams): {
    target: string;
    arguments: unknown[];
  } {
    return {
      target: `${this.config.packageId}::rwa_manager::rebalance`,
      arguments: [
        this.config.rwaManagerState,
        params.portfolioId,
        params.newAllocations,
        new TextEncoder().encode(params.reasoning),
        '0x6',
      ],
    };
  }

  // ============================================
  // READ OPERATIONS (via SUI RPC)
  // ============================================

  /**
   * Get overall pool statistics
   */
  async getPoolStats(): Promise<SuiPoolStats> {
    try {
      const stateData = await this.fetchObjectFields(this.config.rwaManagerState);

      if (!stateData) {
        return {
          totalPortfolios: 0,
          totalValueLocked: 0n,
          totalValueLockedUsd: 0,
          memberCount: 0,
          avgPortfolioSize: 0,
        };
      }

      const totalPortfolios = Number(stateData.portfolio_count || 0);
      const totalValueLocked = BigInt(String(stateData.total_value_locked || '0'));
      const suiPrice = 2.50; // Fallback; use real price in production
      const tvlUsd = Number(totalValueLocked) / 1e9 * suiPrice;

      return {
        totalPortfolios,
        totalValueLocked,
        totalValueLockedUsd: tvlUsd,
        memberCount: Number(stateData.member_count || totalPortfolios),
        avgPortfolioSize: totalPortfolios > 0 ? tvlUsd / totalPortfolios : 0,
      };
    } catch (error) {
      logger.error('[SuiPool] Failed to get pool stats', { error });
      return {
        totalPortfolios: 0,
        totalValueLocked: 0n,
        totalValueLockedUsd: 0,
        memberCount: 0,
        avgPortfolioSize: 0,
      };
    }
  }

  /**
   * Get portfolio details by ID
   */
  async getPortfolio(portfolioId: string): Promise<SuiPortfolio | null> {
    try {
      const fields = await this.fetchObjectFields(portfolioId);
      if (!fields) return null;

      return {
        portfolioId,
        owner: fields.owner as string,
        totalValue: BigInt(String(fields.total_value || '0')),
        targetYield: Number(fields.target_yield || 0),
        riskTolerance: Number(fields.risk_tolerance || 50),
        isActive: fields.is_active as boolean ?? true,
        lastRebalance: Number(fields.last_rebalance || 0),
        allocations: this.parseAllocations(fields.allocations),
      };
    } catch (error) {
      logger.error('[SuiPool] Failed to get portfolio', { portfolioId, error });
      return null;
    }
  }

  /**
   * Get all portfolios owned by an address
   */
  async getPortfoliosByOwner(ownerAddress: string): Promise<SuiPortfolio[]> {
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getOwnedObjects',
          params: [
            ownerAddress,
            {
              filter: {
                StructType: `${this.config.packageId}::rwa_manager::Portfolio`,
              },
              options: { showContent: true },
            },
          ],
        }),
      });

      const data = await response.json();
      const objects = data.result?.data || [];

      return objects.map((obj: Record<string, unknown>) => {
        const objData = obj as { data?: { objectId?: string; content?: { fields?: Record<string, unknown> } } };
        const fields = objData.data?.content?.fields || {};
        return {
          portfolioId: objData.data?.objectId || '',
          owner: ownerAddress,
          totalValue: BigInt(String(fields.total_value || '0')),
          targetYield: Number(fields.target_yield || 0),
          riskTolerance: Number(fields.risk_tolerance || 50),
          isActive: fields.is_active as boolean ?? true,
          lastRebalance: Number(fields.last_rebalance || 0),
          allocations: this.parseAllocations(fields.allocations),
        } as SuiPortfolio;
      });
    } catch (error) {
      logger.error('[SuiPool] Failed to get portfolios by owner', { ownerAddress, error });
      return [];
    }
  }

  /**
   * Get member position summary
   */
  async getMemberPosition(ownerAddress: string): Promise<SuiMemberPosition> {
    const portfolios = await this.getPortfoliosByOwner(ownerAddress);
    const totalValue = portfolios.reduce((sum, p) => sum + p.totalValue, 0n);
    const suiPrice = 2.50;

    return {
      address: ownerAddress,
      portfolioIds: portfolios.map(p => p.portfolioId),
      totalValue,
      totalValueUsd: Number(totalValue) / 1e9 * suiPrice,
      portfolioCount: portfolios.length,
    };
  }

  // ============================================
  // PAYMENT ROUTING
  // ============================================

  /**
   * Build transaction to route a payment via PaymentRouter
   */
  buildPaymentTransaction(
    amount: bigint,
    recipient: string,
    reference?: string,
  ): {
    target: string;
    arguments: unknown[];
    coinAmount: bigint;
  } {
    return {
      target: `${this.config.packageId}::payment_router::route_payment`,
      arguments: [
        this.config.paymentRouterState,
        recipient,
        reference ? new TextEncoder().encode(reference) : [],
        '0x6',
      ],
      coinAmount: amount,
    };
  }

  // ============================================
  // HELPERS
  // ============================================

  /**
   * Fetch object fields from SUI RPC
   */
  private async fetchObjectFields(objectId: string): Promise<Record<string, unknown> | null> {
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
      logger.error('[SuiPool] Failed to fetch object', { objectId, error });
      return null;
    }
  }

  /**
   * Parse allocation data from Move struct
   */
  private parseAllocations(allocData: unknown): SuiAllocation[] {
    if (!allocData || !Array.isArray(allocData)) return [];
    return allocData.map((a: Record<string, unknown>) => ({
      assetType: String(a.asset_type || ''),
      amount: BigInt(String(a.amount || '0')),
      percentage: Number(a.percentage || 0),
    }));
  }

  /**
   * Get deployment config
   */
  getDeploymentConfig() {
    return { ...this.config };
  }
}

// ============================================
// SINGLETON
// ============================================

let suiPoolServiceInstance: SuiCommunityPoolService | null = null;

export function getSuiCommunityPoolService(
  network: keyof typeof SUI_POOL_DEPLOYMENTS = 'testnet'
): SuiCommunityPoolService {
  if (!suiPoolServiceInstance || suiPoolServiceInstance['network'] !== network) {
    suiPoolServiceInstance = new SuiCommunityPoolService(network);
  }
  return suiPoolServiceInstance;
}
