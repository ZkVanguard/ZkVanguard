/**
 * Shared Community Pool Types
 *
 * Canonical type definitions used across all chain-specific pool services
 * (Cronos, SUI, Oasis, Hedera, WDK). Each chain service maps its
 * native on-chain data into these shared types for the dashboard,
 * cron jobs, and risk engine.
 */

// ─── Core Asset Types ────────────────────────────────────────────────────────

/** The 4 pool assets managed by AI allocation */
export type PoolAsset = 'BTC' | 'ETH' | 'SUI' | 'CRO';

export const POOL_ASSETS: readonly PoolAsset[] = ['BTC', 'ETH', 'SUI', 'CRO'] as const;

/** Default target allocation (basis points, sums to 10000) */
export const DEFAULT_ALLOCATION_BPS: Record<PoolAsset, number> = {
  BTC: 3000,
  ETH: 3000,
  SUI: 2000,
  CRO: 2000,
};

// ─── Pool Stats (chain-agnostic) ─────────────────────────────────────────────

export interface PoolAllocation {
  BTC: number;
  ETH: number;
  SUI: number;
  CRO: number;
}

/** Unified pool stats returned by any chain's pool service */
export interface UnifiedPoolStats {
  /** Total pool NAV in USD */
  totalNAV: number;
  /** Total shares outstanding */
  totalShares: number;
  /** NAV per share in USD */
  sharePrice: number;
  /** Number of depositors */
  memberCount: number;
  /** Current allocation percentages per asset */
  allocations: PoolAllocation;
  /** Chain identifier */
  chain: ChainKey;
  /** When stats were last refreshed (epoch ms) */
  lastUpdated: number;
}

/** Unified member position across all chains */
export interface UnifiedMemberPosition {
  walletAddress: string;
  shares: number;
  valueUSD: number;
  percentage: number;
  isMember: boolean;
  depositedUSD: number;
  withdrawnUSD: number;
  joinedAt: number | null;
}

// ─── Transaction Types ───────────────────────────────────────────────────────

export type PoolTransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'REBALANCE' | 'AI_DECISION';

export interface PoolTransaction {
  id: string;
  type: PoolTransactionType;
  walletAddress?: string;
  amountUSD?: number;
  shares?: number;
  sharePrice?: number;
  timestamp: number;
  txHash?: string;
  chain: ChainKey;
}

// ─── Deposit/Withdraw Results ────────────────────────────────────────────────

export interface DepositResult {
  success: boolean;
  txHash?: string;
  sharesReceived?: number;
  sharePrice?: number;
  error?: string;
  explorerUrl?: string;
}

export interface WithdrawResult {
  success: boolean;
  txHash?: string;
  amountWithdrawn?: number;
  sharesBurned?: number;
  error?: string;
  explorerUrl?: string;
}

// ─── Chain Configuration ─────────────────────────────────────────────────────

/** Supported chain identifiers */
export type ChainKey = 'cronos' | 'sui' | 'oasis' | 'hedera' | 'wdk';

/** Per-chain pool configuration */
export interface ChainPoolConfig {
  chain: ChainKey;
  chainId?: number;
  rpcUrl: string;
  poolAddress: string;
  depositToken: string;
  depositTokenDecimals: number;
  explorerUrl: string;
  /** Minimum deposit in deposit token's smallest unit */
  minDepositRaw: bigint;
  /** Maximum slippage in basis points for swaps */
  maxSlippageBps: number;
}

// ─── Cron Job Result (shared across all chain crons) ─────────────────────────

export interface CronStepResult {
  step: string;
  success: boolean;
  duration?: number;
  details?: string;
  error?: string;
}

export interface CronResult {
  success: boolean;
  chain: ChainKey;
  timestamp: string;
  steps: CronStepResult[];
  poolStats?: {
    totalNAV: number;
    sharePrice: number;
    memberCount: number;
  };
  rebalance?: {
    executed: boolean;
    tradesAttempted: number;
    tradesSucceeded: number;
    reason?: string;
  };
  error?: string;
  durationMs: number;
}

// ─── NAV Snapshot (for DB recording) ─────────────────────────────────────────

export interface NavSnapshot {
  chain: ChainKey;
  totalNAV: number;
  sharePrice: number;
  memberCount: number;
  allocations: PoolAllocation;
  timestamp: number;
}

// ─── Rebalance Plan ──────────────────────────────────────────────────────────

export interface SwapQuote {
  asset: PoolAsset;
  amountIn: bigint;
  expectedOut: bigint;
  minAmountOut: bigint;
  canSwap: boolean;
  error?: string;
}

export interface RebalancePlan {
  chain: ChainKey;
  targetAllocations: PoolAllocation;
  currentAllocations: PoolAllocation;
  quotes: SwapQuote[];
  totalValueToRebalance: number;
  timestamp: number;
}

// ─── Pool Constants ──────────────────────────────────────────────────────────

/** Virtual shares/assets for initial share price calculation (prevents division by zero) */
export const VIRTUAL_SHARES = 1;
export const VIRTUAL_ASSETS_USD = 1;

/** Minimum trade size in USD */
export const MIN_TRADE_USD = 1;

/** Base pool fee rates (basis points) */
export const DEFAULT_MANAGEMENT_FEE_BPS = 100;  // 1%
export const DEFAULT_PERFORMANCE_FEE_BPS = 1000; // 10%
