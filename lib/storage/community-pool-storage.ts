/**
 * Community Pool Storage Layer
 * 
 * Provides persistent storage for community pool data using Neon PostgreSQL
 * - Pool state (total assets, share price, allocations)
 * - User shares (deposits, withdrawals, ownership)
 * - Transaction history
 */

import { logger } from '../utils/logger';
import {
  getPoolStateFromDb,
  savePoolStateToDb,
  getAllUserSharesFromDb,
  getUserSharesFromDb,
  saveUserSharesToDb,
  deleteUserSharesFromDb,
  getPoolHistoryFromDb,
  addPoolTransactionToDb,
  initCommunityPoolTables,
  DbPoolState,
  DbUserShares,
  DbPoolTransaction,
} from '../db/community-pool';

// Initialize tables on first import
let tablesInitialized = false;
async function ensureTablesInitialized() {
  if (!tablesInitialized) {
    try {
      await initCommunityPoolTables();
      tablesInitialized = true;
    } catch (error) {
      logger.error('[CommunityPool] Failed to initialize tables', error);
      // Continue anyway - tables might already exist
      tablesInitialized = true;
    }
  }
}

// Supported assets
export const SUPPORTED_ASSETS = ['BTC', 'ETH', 'SUI', 'CRO'] as const;
export type SupportedAsset = typeof SUPPORTED_ASSETS[number];

// Types
export interface PoolState {
  totalValueUSD: number;
  totalShares: number;
  sharePrice: number; // USD per share
  allocations: Record<SupportedAsset, {
    percentage: number;
    valueUSD: number;
    amount: number;
    price: number;
  }>;
  lastRebalance: number;
  lastAIDecision: {
    timestamp: number;
    reasoning: string;
    allocations: Record<SupportedAsset, number>;
  } | null;
  createdAt: number;
  updatedAt: number;
}

export interface UserShares {
  walletAddress: string;
  shares: number;
  valueUSD: number;
  percentage: number; // Ownership percentage of pool
  deposits: {
    timestamp: number;
    amountUSD: number;
    sharesReceived: number;
    sharePrice: number;
    txHash?: string;
  }[];
  withdrawals: {
    timestamp: number;
    sharesBurned: number;
    amountUSD: number;
    sharePrice: number;
    txHash?: string;
  }[];
  joinedAt: number;
  updatedAt: number;
}

export interface PoolTransaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'REBALANCE' | 'AI_DECISION';
  walletAddress?: string;
  amountUSD?: number;
  shares?: number;
  sharePrice?: number;
  details?: any;
  timestamp: number;
  txHash?: string;
}

/**
 * Get initial pool state
 */
function getInitialPoolState(): PoolState {
  const now = Date.now();
  return {
    totalValueUSD: 0,
    totalShares: 0,
    sharePrice: 1.0, // Start at $1 per share
    allocations: {
      BTC: { percentage: 35, valueUSD: 0, amount: 0, price: 0 },
      ETH: { percentage: 30, valueUSD: 0, amount: 0, price: 0 },
      SUI: { percentage: 20, valueUSD: 0, amount: 0, price: 0 },
      CRO: { percentage: 15, valueUSD: 0, amount: 0, price: 0 },
    },
    lastRebalance: now,
    lastAIDecision: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Convert DB row to PoolState
 */
function dbToPoolState(db: DbPoolState): PoolState {
  return {
    totalValueUSD: Number(db.total_value_usd),
    totalShares: Number(db.total_shares),
    sharePrice: Number(db.share_price),
    allocations: db.allocations as PoolState['allocations'],
    lastRebalance: new Date(db.last_rebalance).getTime(),
    lastAIDecision: db.last_ai_decision,
    createdAt: new Date(db.created_at).getTime(),
    updatedAt: new Date(db.updated_at).getTime(),
  };
}

/**
 * Get pool state from Neon PostgreSQL
 */
export async function getPoolState(): Promise<PoolState> {
  await ensureTablesInitialized();
  
  try {
    const dbState = await getPoolStateFromDb();
    if (dbState) {
      return dbToPoolState(dbState);
    }
    return getInitialPoolState();
  } catch (error) {
    logger.error('[CommunityPool] Failed to get pool state from DB', error);
    return getInitialPoolState();
  }
}

/**
 * Save pool state to Neon PostgreSQL
 */
export async function savePoolState(state: PoolState): Promise<void> {
  await ensureTablesInitialized();
  state.updatedAt = Date.now();
  
  try {
    await savePoolStateToDb({
      totalValueUSD: state.totalValueUSD,
      totalShares: state.totalShares,
      sharePrice: state.sharePrice,
      allocations: state.allocations,
      lastRebalance: state.lastRebalance,
      lastAIDecision: state.lastAIDecision,
    });
  } catch (error) {
    logger.error('[CommunityPool] Failed to save pool state to DB', error);
    throw error;
  }
}

/**
 * Get all user shares from Neon PostgreSQL
 */
export async function getAllUserShares(): Promise<UserShares[]> {
  await ensureTablesInitialized();
  
  try {
    const dbShares = await getAllUserSharesFromDb();
    const poolState = await getPoolState();
    
    return dbShares.map(db => ({
      walletAddress: db.wallet_address,
      shares: Number(db.shares),
      valueUSD: Number(db.shares) * poolState.sharePrice,
      percentage: poolState.totalShares > 0 ? (Number(db.shares) / poolState.totalShares) * 100 : 0,
      deposits: [], // Historical deposits not stored in simplified schema
      withdrawals: [], // Historical withdrawals not stored in simplified schema
      joinedAt: new Date(db.joined_at).getTime(),
      updatedAt: new Date(db.last_action_at).getTime(),
    }));
  } catch (error) {
    logger.error('[CommunityPool] Failed to get all user shares from DB', error);
    return [];
  }
}

/**
 * Get user shares by wallet address
 */
export async function getUserShares(walletAddress: string): Promise<UserShares | null> {
  await ensureTablesInitialized();
  
  try {
    const dbShares = await getUserSharesFromDb(walletAddress);
    if (!dbShares) return null;
    
    const poolState = await getPoolState();
    return {
      walletAddress: dbShares.wallet_address,
      shares: Number(dbShares.shares),
      valueUSD: Number(dbShares.shares) * poolState.sharePrice,
      percentage: poolState.totalShares > 0 ? (Number(dbShares.shares) / poolState.totalShares) * 100 : 0,
      deposits: [],
      withdrawals: [],
      joinedAt: new Date(dbShares.joined_at).getTime(),
      updatedAt: new Date(dbShares.last_action_at).getTime(),
    };
  } catch (error) {
    logger.error('[CommunityPool] Failed to get user shares from DB', error);
    return null;
  }
}

/**
 * Save user shares to Neon PostgreSQL
 */
export async function saveUserShares(userShares: UserShares): Promise<void> {
  await ensureTablesInitialized();
  
  try {
    // Calculate cost basis from deposits
    const costBasis = userShares.deposits.reduce((sum, d) => sum + d.amountUSD, 0) -
                      userShares.withdrawals.reduce((sum, w) => sum + w.amountUSD, 0);
    
    if (userShares.shares <= 0) {
      // Delete user if no shares remaining
      await deleteUserSharesFromDb(userShares.walletAddress);
    } else {
      await saveUserSharesToDb({
        walletAddress: userShares.walletAddress,
        shares: userShares.shares,
        costBasisUSD: Math.max(0, costBasis),
      });
    }
  } catch (error) {
    logger.error('[CommunityPool] Failed to save user shares to DB', error);
    throw error;
  }
}

/**
 * Get pool transaction history from Neon PostgreSQL
 */
export async function getPoolHistory(limit: number = 50): Promise<PoolTransaction[]> {
  await ensureTablesInitialized();
  
  try {
    const dbHistory = await getPoolHistoryFromDb(limit);
    return dbHistory.map(db => ({
      id: db.transaction_id,
      type: db.type,
      walletAddress: db.wallet_address || undefined,
      amountUSD: db.amount_usd ? Number(db.amount_usd) : undefined,
      shares: db.shares ? Number(db.shares) : undefined,
      sharePrice: db.share_price ? Number(db.share_price) : undefined,
      details: db.details || undefined,
      timestamp: new Date(db.created_at).getTime(),
      txHash: db.tx_hash || undefined,
    }));
  } catch (error) {
    logger.error('[CommunityPool] Failed to get pool history from DB', error);
    return [];
  }
}

/**
 * Add transaction to pool history in Neon PostgreSQL
 */
export async function addPoolTransaction(tx: Omit<PoolTransaction, 'id'>): Promise<PoolTransaction> {
  await ensureTablesInitialized();
  
  const transaction: PoolTransaction = {
    ...tx,
    id: `pool-tx-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  };

  try {
    await addPoolTransactionToDb({
      id: transaction.id,
      type: transaction.type,
      walletAddress: transaction.walletAddress,
      amountUSD: transaction.amountUSD,
      shares: transaction.shares,
      sharePrice: transaction.sharePrice,
      details: transaction.details,
      txHash: transaction.txHash,
    });
    return transaction;
  } catch (error) {
    logger.error('[CommunityPool] Failed to add transaction to DB', error);
    throw error;
  }
}

/**
 * Calculate user ownership percentage
 */
export function calculateOwnership(userShares: number, totalShares: number): number {
  if (totalShares === 0) return 0;
  return (userShares / totalShares) * 100;
}

/**
 * Get top shareholders
 */
export async function getTopShareholders(limit: number = 10): Promise<{ address: string; shares: number; percentage: number }[]> {
  const allShares = await getAllUserShares();
  const poolState = await getPoolState();
  
  return allShares
    .filter(u => u.shares > 0)
    .sort((a, b) => b.shares - a.shares)
    .slice(0, limit)
    .map(u => ({
      address: u.walletAddress,
      shares: u.shares,
      percentage: calculateOwnership(u.shares, poolState.totalShares),
    }));
}
