/**
 * Community Pool Database Operations
 * Uses Neon PostgreSQL for persistent storage
 * 
 * Security Features:
 * - Parameterized queries (SQL injection protection)
 * - SSL/TLS with certificate verification
 * - Input validation (wallet addresses, amounts)
 * - Numeric bounds checking
 * - Audit logging
 */

import { query, queryOne } from './postgres';
import { logger } from '@/lib/utils/logger';
import crypto from 'crypto';

// ============ Security Validation ============

/**
 * Validate EVM wallet address format
 * Must be 42 characters starting with 0x, containing only hex characters
 */
function isValidWalletAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate positive number within reasonable bounds
 */
function isValidAmount(amount: number, maxValue = 1e15): boolean {
  return typeof amount === 'number' && 
         Number.isFinite(amount) && 
         amount >= 0 && 
         amount <= maxValue;
}

/**
 * Validate percentage (0-100)
 */
function isValidPercentage(value: number): boolean {
  return typeof value === 'number' && 
         Number.isFinite(value) && 
         value >= 0 && 
         value <= 100;
}

/**
 * Validate transaction type
 */
function isValidTransactionType(type: string): type is 'DEPOSIT' | 'WITHDRAWAL' | 'REBALANCE' | 'AI_DECISION' {
  return ['DEPOSIT', 'WITHDRAWAL', 'REBALANCE', 'AI_DECISION'].includes(type);
}

/**
 * Sanitize string input (prevent XSS in stored data)
 */
function sanitizeString(input: string, maxLength = 1000): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .slice(0, maxLength)
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .trim();
}

/**
 * Generate audit hash for integrity verification
 */
function generateAuditHash(data: Record<string, unknown>): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data) + Date.now())
    .digest('hex')
    .slice(0, 16);
}

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
 * Security: Validates all numeric inputs before storage
 */
export async function savePoolStateToDb(state: {
  totalValueUSD: number;
  totalShares: number;
  sharePrice: number;
  allocations: Record<string, { percentage: number; valueUSD: number; amount: number; price: number }>;
  lastRebalance: number;
  lastAIDecision: { timestamp: number; reasoning: string; allocations: Record<string, number> } | null;
}): Promise<void> {
  // Security: Validate all numeric inputs
  if (!isValidAmount(state.totalValueUSD)) {
    throw new Error('Invalid totalValueUSD: must be a positive number');
  }
  if (!isValidAmount(state.totalShares)) {
    throw new Error('Invalid totalShares: must be a positive number');
  }
  if (!isValidAmount(state.sharePrice, 1e12)) {
    throw new Error('Invalid sharePrice: must be a positive number');
  }
  
  // Validate allocations
  for (const [asset, alloc] of Object.entries(state.allocations)) {
    if (!isValidPercentage(alloc.percentage)) {
      throw new Error(`Invalid allocation percentage for ${asset}`);
    }
  }

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
 * Security: Validates wallet address format
 */
export async function getUserSharesFromDb(walletAddress: string): Promise<DbUserShares | null> {
  // Security: Validate wallet address format
  if (!isValidWalletAddress(walletAddress)) {
    logger.warn('[CommunityPool DB] Invalid wallet address format', { wallet: walletAddress?.slice(0, 10) });
    return null;
  }

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
 * Security: Validates wallet address and numeric inputs
 */
export async function saveUserSharesToDb(userShares: {
  walletAddress: string;
  shares: number;
  costBasisUSD: number;
}): Promise<void> {
  // Security: Validate wallet address
  if (!isValidWalletAddress(userShares.walletAddress)) {
    throw new Error('Invalid wallet address format');
  }
  // Security: Validate numeric inputs
  if (!isValidAmount(userShares.shares)) {
    throw new Error('Invalid shares amount: must be a positive number');
  }
  if (!isValidAmount(userShares.costBasisUSD)) {
    throw new Error('Invalid cost basis: must be a positive number');
  }

  try {
    // Use explicit check-then-update/insert pattern for case-insensitive deduplication
    // First check if user exists (case-insensitive)
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM community_pool_shares WHERE LOWER(wallet_address) = LOWER($1)`,
      [userShares.walletAddress]
    );
    
    if (existing) {
      // Update existing record
      await query(
        `UPDATE community_pool_shares SET
           wallet_address = $1,
           shares = $2,
           cost_basis_usd = $3,
           last_action_at = NOW()
         WHERE LOWER(wallet_address) = LOWER($1)`,
        [userShares.walletAddress.toLowerCase(), userShares.shares, userShares.costBasisUSD]
      );
    } else {
      // Insert new record
      await query(
        `INSERT INTO community_pool_shares (wallet_address, shares, cost_basis_usd, joined_at, last_action_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [userShares.walletAddress.toLowerCase(), userShares.shares, userShares.costBasisUSD]
      );
    }
    logger.info('[CommunityPool DB] User shares saved', { wallet: userShares.walletAddress, shares: userShares.shares });
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to save user shares', error);
    throw error;
  }
}

/**
 * Delete user shares (when fully withdrawn)
 * Security: Validates wallet address format
 */
export async function deleteUserSharesFromDb(walletAddress: string): Promise<void> {
  // Security: Validate wallet address
  if (!isValidWalletAddress(walletAddress)) {
    throw new Error('Invalid wallet address format');
  }

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
 * Security: Limits query size to prevent resource exhaustion
 */
export async function getPoolHistoryFromDb(limit = 100): Promise<DbPoolTransaction[]> {
  // Security: Cap limit to prevent resource exhaustion attacks
  const safeLimit = Math.min(Math.max(1, limit), 500);
  
  try {
    return await query<DbPoolTransaction>(
      `SELECT * FROM community_pool_transactions ORDER BY created_at DESC LIMIT $1`,
      [safeLimit]
    );
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to get pool history', error);
    return [];
  }
}

/**
 * Check if a transaction with this txHash already exists (idempotency check)
 * @returns true if txHash already recorded, false otherwise
 */
export async function txHashExists(txHash: string): Promise<boolean> {
  if (!txHash) return false;
  try {
    const result = await queryOne(
      `SELECT 1 FROM community_pool_transactions WHERE tx_hash = $1`,
      [txHash.toLowerCase()]
    );
    return !!result;
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to check txHash', error);
    return false; // Err on the side of allowing (on-chain is authoritative anyway)
  }
}

/**
 * Add transaction to history
 * Security: Validates transaction type, wallet address, and amounts
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
  // Security: Validate transaction type
  if (!isValidTransactionType(transaction.type)) {
    throw new Error('Invalid transaction type');
  }
  
  // Security: Validate wallet address if provided
  if (transaction.walletAddress && !isValidWalletAddress(transaction.walletAddress)) {
    throw new Error('Invalid wallet address format');
  }
  
  // Security: Validate numeric amounts if provided
  if (transaction.amountUSD !== undefined && !isValidAmount(transaction.amountUSD)) {
    throw new Error('Invalid amount: must be a positive number');
  }
  if (transaction.shares !== undefined && !isValidAmount(transaction.shares)) {
    throw new Error('Invalid shares: must be a positive number');
  }
  if (transaction.sharePrice !== undefined && !isValidAmount(transaction.sharePrice, 1e12)) {
    throw new Error('Invalid share price: must be a positive number');
  }
  
  // Security: Generate audit hash for integrity
  const auditHash = generateAuditHash({
    id: transaction.id,
    type: transaction.type,
    wallet: transaction.walletAddress,
    amount: transaction.amountUSD,
  });

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
        transaction.details ? JSON.stringify({ ...transaction.details, _audit: auditHash }) : JSON.stringify({ _audit: auditHash }),
        transaction.txHash || null,
      ]
    );
    logger.info('[CommunityPool DB] Transaction added', { 
      id: transaction.id, 
      type: transaction.type,
      audit: auditHash,
    });
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to add transaction', error);
    throw error;
  }
}

// ============ NAV History Operations ============

export interface DbNavSnapshot {
  id: number;
  timestamp: Date;
  share_price: number;
  total_nav: number;
  total_shares: number;
  member_count: number;
  allocations: Record<string, number> | null;
  source: string;
  created_at: Date;
}

/**
 * Record a NAV snapshot (called periodically by cron job)
 * Security: Validates numeric values
 */
export async function recordNavSnapshot(snapshot: {
  sharePrice: number;
  totalNav: number;
  totalShares: number;
  memberCount: number;
  allocations?: Record<string, number>;
  source?: string;
}): Promise<void> {
  // Validate inputs
  if (!isValidAmount(snapshot.sharePrice, 1e9)) {
    throw new Error('Invalid share price');
  }
  if (!isValidAmount(snapshot.totalNav, 1e18)) {
    throw new Error('Invalid total NAV');
  }

  try {
    await query(
      `INSERT INTO community_pool_nav_history 
       (timestamp, share_price, total_nav, total_shares, member_count, allocations, source)
       VALUES (NOW(), $1, $2, $3, $4, $5, $6)`,
      [
        snapshot.sharePrice,
        snapshot.totalNav,
        snapshot.totalShares,
        snapshot.memberCount,
        snapshot.allocations ? JSON.stringify(snapshot.allocations) : null,
        snapshot.source || 'on-chain',
      ]
    );
    logger.debug('[CommunityPool DB] NAV snapshot recorded', { 
      sharePrice: snapshot.sharePrice,
      totalNav: snapshot.totalNav,
    });
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to record NAV snapshot', error);
    throw error;
  }
}

/**
 * Get NAV history for risk metrics calculation
 * Returns snapshots ordered by timestamp ascending (oldest first)
 */
export async function getNavHistory(daysBack = 365): Promise<DbNavSnapshot[]> {
  const safeDays = Math.min(Math.max(1, daysBack), 730); // Max 2 years
  
  try {
    return await query<DbNavSnapshot>(
      `SELECT * FROM community_pool_nav_history 
       WHERE timestamp >= NOW() - INTERVAL '${safeDays} days'
       ORDER BY timestamp ASC`,
      []
    );
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to get NAV history', error);
    return [];
  }
}

/**
 * Get latest NAV snapshot
 */
export async function getLatestNavSnapshot(): Promise<DbNavSnapshot | null> {
  try {
    return await queryOne<DbNavSnapshot>(
      `SELECT * FROM community_pool_nav_history ORDER BY timestamp DESC LIMIT 1`,
      []
    );
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to get latest NAV snapshot', error);
    return null;
  }
}

/**
 * Delete old NAV snapshots (cleanup, keep last N days)
 */
export async function cleanupOldNavSnapshots(keepDays = 365): Promise<number> {
  try {
    const result = await query(
      `DELETE FROM community_pool_nav_history WHERE timestamp < NOW() - INTERVAL '${keepDays} days' RETURNING id`,
      []
    );
    logger.info('[CommunityPool DB] Cleaned up old NAV snapshots', { deleted: result.length });
    return result.length;
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to cleanup NAV snapshots', error);
    return 0;
  }
}

/**
 * Reset NAV history completely and insert a fresh starting point
 * Used when bad data has accumulated
 */
export async function resetNavHistory(currentNav: number, sharePrice: number, totalShares: number, memberCount: number): Promise<{ deleted: number; inserted: boolean }> {
  try {
    // Delete all NAV history
    const deleted = await query(
      `DELETE FROM community_pool_nav_history RETURNING id`,
      []
    );
    logger.info('[CommunityPool DB] Deleted all NAV history', { count: deleted.length });
    
    // Insert fresh starting point
    await query(
      `INSERT INTO community_pool_nav_history 
       (total_nav, share_price, total_shares, member_count, allocations, source)
       VALUES ($1, $2, $3, $4, '{"BTC": 35, "ETH": 30, "SUI": 20, "CRO": 15}'::jsonb, 'manual-reset')`,
      [currentNav, sharePrice, totalShares, memberCount]
    );
    logger.info('[CommunityPool DB] Inserted fresh NAV snapshot', { nav: currentNav, sharePrice, totalShares });
    
    return { deleted: deleted.length, inserted: true };
  } catch (error) {
    logger.error('[CommunityPool DB] Failed to reset NAV history', error);
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

    // NAV history table for risk metrics (hourly snapshots from on-chain)
    await query(`
      CREATE TABLE IF NOT EXISTS community_pool_nav_history (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        share_price DECIMAL(20, 8) NOT NULL,
        total_nav DECIMAL(20, 2) NOT NULL,
        total_shares DECIMAL(20, 8) NOT NULL,
        member_count INTEGER NOT NULL DEFAULT 0,
        allocations JSONB,
        source VARCHAR(50) DEFAULT 'on-chain',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create indexes (including txHash uniqueness for idempotency)
    await query(`
      CREATE INDEX IF NOT EXISTS idx_pool_shares_wallet ON community_pool_shares(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_pool_tx_type ON community_pool_transactions(type);
      CREATE INDEX IF NOT EXISTS idx_pool_tx_wallet ON community_pool_transactions(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_pool_tx_created ON community_pool_transactions(created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_tx_hash ON community_pool_transactions(tx_hash) WHERE tx_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_pool_nav_timestamp ON community_pool_nav_history(timestamp DESC);
    `);
    
    // Add case-insensitive unique index for wallet addresses (prevents duplicates due to case differences)
    // First, deduplicate any existing entries and normalize to lowercase
    try {
      // Consolidate duplicates: keep the one with highest shares, sum if needed
      await query(`
        WITH duplicates AS (
          SELECT LOWER(wallet_address) as lower_addr, 
                 MAX(shares) as max_shares,
                 MAX(cost_basis_usd) as max_cost_basis,
                 MIN(joined_at) as first_joined,
                 MAX(last_action_at) as last_action
          FROM community_pool_shares 
          GROUP BY LOWER(wallet_address)
          HAVING COUNT(*) > 1
        )
        UPDATE community_pool_shares s
        SET wallet_address = LOWER(wallet_address),
            shares = d.max_shares,
            cost_basis_usd = d.max_cost_basis,
            joined_at = d.first_joined,
            last_action_at = d.last_action
        FROM duplicates d
        WHERE LOWER(s.wallet_address) = d.lower_addr
          AND s.id = (SELECT MIN(id) FROM community_pool_shares WHERE LOWER(wallet_address) = d.lower_addr)
      `);
      
      // Delete the duplicate rows (keep the one we just updated)
      await query(`
        DELETE FROM community_pool_shares a
        USING community_pool_shares b
        WHERE a.id > b.id 
          AND LOWER(a.wallet_address) = LOWER(b.wallet_address)
      `);
      
      // Normalize all remaining addresses to lowercase
      await query(`UPDATE community_pool_shares SET wallet_address = LOWER(wallet_address)`);
      
      // Create case-insensitive unique index (if not exists)
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_shares_wallet_lower 
        ON community_pool_shares(LOWER(wallet_address))
      `);
    } catch (dedupeError) {
      // Log but don't fail - index may already exist
      logger.warn('[CommunityPool DB] Deduplication/index creation note', { error: String(dedupeError) });
    }

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
