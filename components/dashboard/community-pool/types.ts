/**
 * Community Pool Types
 * Centralized type definitions for the CommunityPool component family
 */

export interface PoolAllocation {
  BTC: number;
  ETH: number;
  SUI: number;
  CRO: number;
  /** USDC bucket — pool balance + idle admin USDC + BlueFin collateral. */
  USDC?: number;
}

export interface PoolSummary {
  totalValueUSD: number;
  totalShares: number;
  sharePrice: number;  // USD per share (1.0 for SUI USDC pool)
  sharePriceUSD?: number; // Legacy: converted to USD
  totalNAV?: number;  // Legacy: native asset NAV
  memberCount: number;
  allocations: PoolAllocation;
  aiLastUpdate: string | null;
  aiReasoning: string | null;
}

export interface UserPosition {
  walletAddress: string;
  shares: number;
  valueUSD: number;
  valueSUI?: number;  // Legacy: kept for compatibility
  percentage: number;
  isMember: boolean;
  joinedAt?: string;
  totalDeposited?: number;
  totalWithdrawn?: number;
  depositCount?: number;
  withdrawalCount?: number;
}

export interface AIRecommendation {
  allocations: PoolAllocation;
  reasoning: string;
  confidence: number;
  changes: AIChange[];
}

export interface AIChange {
  asset: string;
  currentPercent: number;
  proposedPercent: number;
  change: number;
}

export interface LeaderboardEntry {
  walletAddress: string;
  shares: number;
  percentage: number;
  valueUSD?: number;
}

export interface CommunityPoolProps {
  address?: string;
  compact?: boolean;
}

export type TxStatus = 'idle' | 'resetting_approval' | 'signing_permit' | 'approving' | 'approved' | 'depositing' | 'withdrawing' | 'complete';

export type ChainKey = 'ethereum' | 'cronos' | 'hedera' | 'sepolia' | 'sui';

export interface CommunityPoolState {
  poolData: PoolSummary | null;
  userPosition: UserPosition | null;
  aiRecommendation: AIRecommendation | null;
  leaderboard: LeaderboardEntry[];
  loading: boolean;
  error: string | null;
  successMessage: string | null;
  selectedChain: ChainKey;
  suiPoolStateId: string | null;
}

export interface TransactionState {
  txStatus: TxStatus;
  actionLoading: boolean;
  showDeposit: boolean;
  showWithdraw: boolean;
  depositAmount: string;
  withdrawShares: string;
  suiDepositAmount: string;
  suiWithdrawShares: string;
  lastTxHash: string | null;
}
