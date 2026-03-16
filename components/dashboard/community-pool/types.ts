/**
 * Community Pool Types
 * Centralized type definitions for the CommunityPool component family
 */

export interface PoolAllocation {
  BTC: number;
  ETH: number;
  SUI: number;
  CRO: number;
}

export interface PoolSummary {
  totalValueUSD: number;
  totalShares: number;
  sharePrice: number;  // For EVM: USD, For SUI: native SUI price
  sharePriceUSD?: number; // For SUI: converted to USD
  totalNAV?: number;  // Native asset NAV (SUI tokens for SUI chain)
  memberCount: number;
  allocations: PoolAllocation;
  aiLastUpdate: string | null;
  aiReasoning: string | null;
}

export interface UserPosition {
  walletAddress: string;
  shares: number;
  valueUSD: number;
  valueSUI?: number;  // SUI chain: value in native SUI tokens
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

export type TxStatus = 'idle' | 'approving' | 'approved' | 'depositing' | 'withdrawing' | 'complete';

export type ChainKey = 'cronos' | 'arbitrum' | 'sui';

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
