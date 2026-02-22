/**
 * Community Pool Database Operations
 * Uses Neon PostgreSQL for persistent storage
 */

import { query, queryOne } from './postgres';
import { logger } from '@/lib/utils/logger';

// ============ Types ============

export interface DbPoolState {
  id: number;
  total_value_usd: number;
  total_shares: number;
  share_price: number;
  allocations: Record<string, {
    percentage: number;
    valueUSD: number;
    amount: number;
    price: number;
  }>;
  last_rebalance: Date;
  last_ai_decision: {
    timestamp: number;
    reasoning: string;
    allocations: Record<string, number>;
  } | null;
  created_at: Date;
  updated_at: Date;
}

export interface DbUserShares {
  id: number;
  wallet_address: string;
  shares: number;
  cost_basis_usd: number;
  joined_at: Date;
  last_action_at: Date;
}

export interface DbPoolTransaction {
  id: number;
  transaction_id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'REBALANCE' | 'AI_DECISION';
  wallet_address: string | null;
  amount_usd: number | null;
  shares: number | null;
  share_price: number | null;
  details: Record<string, unknown> | null;
  tx_hash: string | null;
  created_at: Date;
}

// ============ Pool State Operations ============

/**
 * Get current pool state (there's only one row)
 */
export async function getPoolStateFromDb(): Promise<DbPoolState | null> {
  try {
    const row = await queryOne<DbPoolState>(
      `SELECT * FROM community_pool_state ORDER BY id DESC LIMIT 1`
    );
    return row;
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to get pool state', error);
    return null;
  }
}

/**
 * Upsert pool state (insert or update)
 */
export async function savePoolStateToDb(state: {
  totalValueUSD: number;
  totalShares: number;
  sharePrice: number;
  allocations: Record<string, { percentage: number; valueUSD: number; amount: number; price: number }>;
  lastRebalance: number;
  lastAIDecision: { timestamp: number; reasoning: string; allocations: Record<string, number> } | null;
}): Promise<void> {
  try {
    // Upsert - update if exists, insert if not
    await query(
      `INSERT INTO community_pool_state (id, total_value_usd, total_shares, share_price, allocations, last_rebalance, last_ai_decision, updated_at)
       VALUES (1, $1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         total_value_usd = $1,
         total_shares = $2,
         share_price = $3,
         allocations = $4,
         last_rebalance = to_timestamp($5 / 1000.0),
         last_ai_decision = $6,
         updated_at = NOW()`,
      [
        state.totalValueUSD,
        state.totalShares,
        state.sharePrice,
        JSON.stringify(state.allocations),
        state.lastRebalance,
        state.lastAIDecision ? JSON.stringify(state.lastAIDecision) : null,
      ]
    );
    logger.info('[CommunityPool DB] Pool state saved');
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to save pool state', error);
    throw error;
  }
}

// ============ User Shares Operations ============

/**
 * Get all user shares
 */
export async function getAllUserSharesFromDb(): Promise<DbUserShares[]> {
  try {
    return await query<DbUserShares>(
      `SELECT * FROM community_pool_shares ORDER BY shares DESC`
    );
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to get all user shares', error);
    return [];
  }
}

/**
 * Get user shares by wallet address
 */
export async function getUserSharesFromDb(walletAddress: string): Promise<DbUserShares | null> {
  try {
    return await queryOne<DbUserShares>(
      `SELECT * FROM community_pool_shares WHERE LOWER(wallet_address) = LOWER($1)`,
      [walletAddress]
    );
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to get user shares', error);
    return null;
  }
}

/**
 * Upsert user shares
 */
export async function saveUserSharesToDb(userShares: {
  walletAddress: string;
  shares: number;
  costBasisUSD: number;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO community_pool_shares (wallet_address, shares, cost_basis_usd, joined_at, last_action_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (wallet_address) DO UPDATE SET
         shares = $2,
         cost_basis_usd = $3,
         last_action_at = NOW()`,
      [userShares.walletAddress.toLowerCase(), userShares.shares, userShares.costBasisUSD]
    );
    logger.info('[CommunityPool DB] User shares saved', { wallet: userShares.walletAddress });
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to save user shares', error);
    throw error;
  }
}

/**
 * Delete user shares (when fully withdrawn)
 */
export async function deleteUserSharesFromDb(walletAddress: string): Promise<void> {
  try {
    await query(
      `DELETE FROM community_pool_shares WHERE LOWER(wallet_address) = LOWER($1)`,
      [walletAddress]
    );
    logger.info('[CommunityPool DB] User shares deleted', { wallet: walletAddress });
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to delete user shares', error);
    throw error;
  }
}

// ============ Transaction History Operations ============

/**
 * Get pool transaction history
 */
export async function getPoolHistoryFromDb(limit = 100): Promise<DbPoolTransaction[]> {
  try {
    return await query<DbPoolTransaction>(
      `SELECT * FROM community_pool_transactions ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to get pool history', error);
    return [];
  }
}

/**
 * Add transaction to history
 */
export async function addPoolTransactionToDb(transaction: {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'REBALANCE' | 'AI_DECISION';
  walletAddress?: string;
  amountUSD?: number;
  shares?: number;
  sharePrice?: number;
  details?: Record<string, unknown>;
  txHash?: string;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO community_pool_transactions 
       (transaction_id, type, wallet_address, amount_usd, shares, share_price, details, tx_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        transaction.id,
        transaction.type,
        transaction.walletAddress?.toLowerCase() || null,
        transaction.amountUSD || null,
        transaction.shares || null,
        transaction.sharePrice || null,
        transaction.details ? JSON.stringify(transaction.details) : null,
        transaction.txHash || null,
      ]
    );
    logger.info('[CommunityPool DB] Transaction added', { id: transaction.id, type: transaction.type });
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to add transaction', error);
    throw error;
  }
}

// ============ Table Initialization ============

/**
 * Initialize community pool tables (run once on startup or via migration)
 */
export async function initCommunityPoolTables(): Promise<void> {
  try {
    // Pool state table (single row)
    await query(`
      CREATE TABLE IF NOT EXISTS community_pool_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        total_value_usd DECIMAL(20, 2) NOT NULL DEFAULT 0,
        total_shares DECIMAL(20, 8) NOT NULL DEFAULT 0,
        share_price DECIMAL(20, 8) NOT NULL DEFAULT 1.0,
        allocations JSONB NOT NULL DEFAULT '{}',
        last_rebalance TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_ai_decision JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT single_row CHECK (id = 1)
      )
    `);

    // User shares table
    await query(`
      CREATE TABLE IF NOT EXISTS community_pool_shares (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(255) NOT NULL UNIQUE,
        shares DECIMAL(20, 8) NOT NULL DEFAULT 0,
        cost_basis_usd DECIMAL(20, 2) NOT NULL DEFAULT 0,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_action_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Transaction history table
    await query(`
      CREATE TABLE IF NOT EXISTS community_pool_transactions (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(255) NOT NULL UNIQUE,
        type VARCHAR(50) NOT NULL,
        wallet_address VARCHAR(255),
        amount_usd DECIMAL(20, 2),
        shares DECIMAL(20, 8),
        share_price DECIMAL(20, 8),
        details JSONB,
        tx_hash VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create indexes
    await query(`
      CREATE INDEX IF NOT EXISTS idx_pool_shares_wallet ON community_pool_shares(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_pool_tx_type ON community_pool_transactions(type);
      CREATE INDEX IF NOT EXISTS idx_pool_tx_wallet ON community_pool_transactions(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_pool_tx_created ON community_pool_transactions(created_at DESC);
    `);

    // Insert initial state if not exists
    await query(`
      INSERT INTO community_pool_state (id, total_value_usd, total_shares, share_price, allocations)
      VALUES (1, 0, 0, 1.0, $1)
      ON CONFLICT (id) DO NOTHING
    `, [JSON.stringify({
      BTC: { percentage: 35, valueUSD: 0, amount: 0, price: 0 },
      ETH: { percentage: 30, valueUSD: 0, amount: 0, price: 0 },
      SUI: { percentage: 20, valueUSD: 0, amount: 0, price: 0 },
      CRO: { percentage: 15, valueUSD: 0, amount: 0, price: 0 },
    })]);

    logger.info('[CommunityPool DB] Tables initialized successfully');
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to initialize tables', error);
    throw error;
  }
}
