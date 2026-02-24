/**
 * Auto-Rebalance Storage Layer
 * 
 * Provides persistent storage for auto-rebalance configurations
 * Uses PostgreSQL database for Vercel compatibility
 * 
 * Storage: Neon PostgreSQL (same as community-pool)
 * 
 * Usage:
 * ```ts
 * const configs = await getAutoRebalanceConfigs();
 * await saveAutoRebalanceConfig(config);
 * ```
 */

import { logger } from '../utils/logger';
import { query, queryOne } from '../db/postgres';
import fs from 'fs/promises';
import path from 'path';

// Fallback storage paths for local dev
const STORAGE_DIR = path.join(process.cwd(), 'deployments');
const CONFIG_FILE = path.join(STORAGE_DIR, 'auto-rebalance-configs.json');
const REBALANCE_HISTORY_FILE = path.join(STORAGE_DIR, 'rebalance-history.json');

// Function to check if we should use database (checked at runtime, not module load)
function shouldUseDatabase(): boolean {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const isVercel = Boolean(process.env.VERCEL);
  return hasDb || isVercel; // Always use DB on Vercel (file system is read-only)
}

// Types
export interface LossProtectionConfig {
  enabled: boolean;
  mode?: 'entry' | 'drawdown' | 'both';
  lossThresholdPercent: number;
  drawdownThresholdPercent?: number;
  action: 'hedge' | 'sell_to_stable';
  hedgeRatio: number;
  maxHedgeLeverage: number;
  cooldownHours?: number;
}

export interface AutoRebalanceConfig {
  portfolioId: number;
  walletAddress: string;
  enabled: boolean;
  threshold: number;
  frequency: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  autoApprovalEnabled: boolean;
  autoApprovalThreshold: number;
  targetAllocations?: Record<string, number>;
  lossProtection?: LossProtectionConfig;
  createdAt: number;
  updatedAt: number;
}

export interface RebalanceHistory {
  portfolioId: number;
  timestamp: number;
  drift: number;
  txHash: string;
  actions: any[];
  cost: number;
}

/**
 * Initialize storage directory
 */
async function ensureStorageDir() {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

/**
 * Get all auto-rebalance configurations
 */
export async function getAutoRebalanceConfigs(): Promise<AutoRebalanceConfig[]> {
  if (shouldUseDatabase()) {
    try {
      // Ensure table exists
      await ensureAutoRebalanceTable();
      
      const result = await query(`SELECT * FROM auto_rebalance_configs WHERE enabled = true`);
      return result.rows.map(row => ({
        portfolioId: row.portfolio_id,
        walletAddress: row.wallet_address,
        enabled: row.enabled,
        threshold: row.threshold,
        frequency: row.frequency,
        autoApprovalEnabled: row.auto_approval_enabled,
        autoApprovalThreshold: row.auto_approval_threshold,
        targetAllocations: row.target_allocations,
        lossProtection: row.loss_protection,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      }));
    } catch (error) {
      logger.error('[Storage] Error reading from database:', error);
      // Fallback to file
    }
  }
  
  // File-based fallback for local dev
  try {
    await ensureStorageDir();
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    logger.error('[Storage] Error reading config file:', error);
    return [];
  }
}

/**
 * Get configuration for a specific portfolio
 */
export async function getAutoRebalanceConfig(portfolioId: number): Promise<AutoRebalanceConfig | null> {
  const configs = await getAutoRebalanceConfigs();
  return configs.find(c => c.portfolioId === portfolioId) || null;
}

/**
 * Ensure auto_rebalance_configs table exists
 */
async function ensureAutoRebalanceTable(): Promise<void> {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS auto_rebalance_configs (
        portfolio_id INTEGER PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        threshold NUMERIC DEFAULT 2,
        frequency TEXT DEFAULT 'DAILY',
        auto_approval_enabled BOOLEAN DEFAULT true,
        auto_approval_threshold NUMERIC DEFAULT 200000000,
        target_allocations JSONB,
        loss_protection JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (error) {
    // Table might already exist
    logger.debug('[Storage] Auto-rebalance table check:', error);
  }
}

/**
 * Save auto-rebalance configuration
 */
export async function saveAutoRebalanceConfig(config: AutoRebalanceConfig): Promise<void> {
  config.updatedAt = Date.now();
  
  const useDb = shouldUseDatabase();
  logger.info(`[Storage] saveAutoRebalanceConfig called. useDatabase=${useDb}, VERCEL=${process.env.VERCEL}, DATABASE_URL=${process.env.DATABASE_URL ? 'set' : 'missing'}`);
  
  if (useDb) {
    try {
      await ensureAutoRebalanceTable();
      
      await query(`
        INSERT INTO auto_rebalance_configs 
        (portfolio_id, wallet_address, enabled, threshold, frequency, auto_approval_enabled, auto_approval_threshold, target_allocations, loss_protection, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        ON CONFLICT (portfolio_id) 
        DO UPDATE SET
          wallet_address = EXCLUDED.wallet_address,
          enabled = EXCLUDED.enabled,
          threshold = EXCLUDED.threshold,
          frequency = EXCLUDED.frequency,
          auto_approval_enabled = EXCLUDED.auto_approval_enabled,
          auto_approval_threshold = EXCLUDED.auto_approval_threshold,
          target_allocations = EXCLUDED.target_allocations,
          loss_protection = EXCLUDED.loss_protection,
          updated_at = NOW()
      `, [
        config.portfolioId,
        config.walletAddress,
        config.enabled,
        config.threshold,
        config.frequency,
        config.autoApprovalEnabled,
        config.autoApprovalThreshold,
        JSON.stringify(config.targetAllocations || null),
        JSON.stringify(config.lossProtection || null),
      ]);
      
      logger.info(`[Storage] Saved config for portfolio ${config.portfolioId} to database`);
      return;
    } catch (error) {
      logger.error('[Storage] Error saving to database:', error);
      // On Vercel (read-only FS), don't fallback to file - throw instead
      if (process.env.VERCEL) {
        throw error;
      }
      // Fallback to file for local dev only
    }
  }
  
  // File-based fallback (local dev only)
  // On Vercel, file system is read-only - throw error instead
  if (process.env.VERCEL) {
    logger.error('[Storage] Cannot use file fallback on Vercel (read-only FS). Database query failed.');
    throw new Error('Database save failed and file fallback not available on Vercel');
  }
  
  try {
    await ensureStorageDir();
    const configs = await getAutoRebalanceConfigs();
    const existingIndex = configs.findIndex(c => c.portfolioId === config.portfolioId);
    
    if (existingIndex >= 0) {
      configs[existingIndex] = config;
    } else {
      configs.push(config);
    }
    
    await fs.writeFile(CONFIG_FILE, JSON.stringify(configs, null, 2), 'utf-8');
    logger.info(`[Storage] Saved config for portfolio ${config.portfolioId} to file`);
  } catch (error) {
    logger.error('[Storage] Error saving config file:', error);
    throw error;
  }
}

/**
 * Delete auto-rebalance configuration
 */
export async function deleteAutoRebalanceConfig(portfolioId: number): Promise<void> {
  if (shouldUseDatabase()) {
    try {
      await query('DELETE FROM auto_rebalance_configs WHERE portfolio_id = $1', [portfolioId]);
      logger.info(`[Storage] Deleted config for portfolio ${portfolioId} from database`);
      return;
    } catch (error) {
      logger.error('[Storage] Error deleting from database:', error);
      // Fallback to file
    }
  }
  
  // File-based fallback
  try {
    const configs = await getAutoRebalanceConfigs();
    const filtered = configs.filter(c => c.portfolioId !== portfolioId);
    await fs.writeFile(CONFIG_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
    logger.info(`[Storage] Deleted config for portfolio ${portfolioId} from file`);
  } catch (error) {
    logger.error('[Storage] Error deleting config file:', error);
    throw error;
  }
}

/**
 * Get last rebalance timestamp for a portfolio
 */
export async function getLastRebalance(portfolioId: number): Promise<number | null> {
  if (shouldUseDatabase()) {
    try {
      const result = await query(
        'SELECT last_rebalance FROM auto_rebalance_last WHERE portfolio_id = $1',
        [portfolioId]
      );
      if (result.rows.length > 0) {
        return result.rows[0].last_rebalance;
      }
      return null;
    } catch (error) {
      logger.debug('[Storage] Error reading last rebalance from database (table may not exist):', error);
      // Fallback to file
    }
  }
  
  // File-based fallback
  try {
    await ensureStorageDir();
    const data = await fs.readFile(REBALANCE_HISTORY_FILE, 'utf-8');
    const history: Record<string, number> = JSON.parse(data);
    return history[portfolioId] || null;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    logger.error('[Storage] Error reading rebalance history:', error);
    return null;
  }
}

/**
 * Save last rebalance timestamp
 */
export async function saveLastRebalance(portfolioId: number, timestamp: number): Promise<void> {
  if (shouldUseDatabase()) {
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS auto_rebalance_last (
          portfolio_id INTEGER PRIMARY KEY,
          last_rebalance BIGINT NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      
      await query(`
        INSERT INTO auto_rebalance_last (portfolio_id, last_rebalance, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (portfolio_id) 
        DO UPDATE SET last_rebalance = EXCLUDED.last_rebalance, updated_at = NOW()
      `, [portfolioId, timestamp]);
      
      logger.info(`[Storage] Saved last rebalance for portfolio ${portfolioId} to database`);
      return;
    } catch (error) {
      logger.error('[Storage] Error saving last rebalance to database:', error);
      // Fallback to file
    }
  }
  
  // File-based fallback
  try {
    await ensureStorageDir();
    let history: Record<string, number> = {};
    
    try {
      const data = await fs.readFile(REBALANCE_HISTORY_FILE, 'utf-8');
      history = JSON.parse(data);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    history[portfolioId] = timestamp;
    await fs.writeFile(REBALANCE_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    logger.info(`[Storage] Saved last rebalance for portfolio ${portfolioId} to file`);
  } catch (error) {
    logger.error('[Storage] Error saving rebalance history:', error);
    throw error;
  }
}

/**
 * Get rebalance history for a portfolio
 */
export async function getRebalanceHistory(portfolioId: number, limit: number = 10): Promise<RebalanceHistory[]> {
  if (shouldUseDatabase()) {
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS auto_rebalance_history (
          id SERIAL PRIMARY KEY,
          portfolio_id INTEGER NOT NULL,
          timestamp BIGINT NOT NULL,
          type TEXT,
          action TEXT,
          allocations JSONB,
          drift_percent NUMERIC,
          gas_cost_usd NUMERIC,
          success BOOLEAN DEFAULT true
        )
      `);
      
      const result = await query(
        'SELECT * FROM auto_rebalance_history WHERE portfolio_id = $1 ORDER BY timestamp DESC LIMIT $2',
        [portfolioId, limit]
      );
      return result.rows.map((row: any) => ({
        portfolioId: row.portfolio_id,
        timestamp: row.timestamp,
        type: row.type,
        action: row.action,
        allocations: row.allocations,
        driftPercent: row.drift_percent,
        gasCostUsd: row.gas_cost_usd,
        success: row.success,
      }));
    } catch (error) {
      logger.debug('[Storage] Error reading history from database:', error);
      return [];
    }
  }
  
  // File-based fallback
  const historyFile = path.join(STORAGE_DIR, `rebalance-history-${portfolioId}.json`);
  try {
    const data = await fs.readFile(historyFile, 'utf-8');
    const history: RebalanceHistory[] = JSON.parse(data);
    return history.slice(0, limit);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    logger.error('[Storage] Error reading history file:', error);
    return [];
  }
}

/**
 * Add entry to rebalance history
 */
export async function addRebalanceHistory(entry: RebalanceHistory): Promise<void> {
  if (shouldUseDatabase()) {
    try {
      await query(`
        INSERT INTO auto_rebalance_history (portfolio_id, timestamp, type, action, allocations, drift_percent, gas_cost_usd, success)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        entry.portfolioId,
        entry.timestamp,
        entry.type || 'rebalance',
        entry.action || 'auto',
        JSON.stringify(entry.allocations || null),
        entry.driftPercent || 0,
        entry.gasCostUsd || 0,
        entry.success !== false,
      ]);
      logger.info(`[Storage] Added rebalance history for portfolio ${entry.portfolioId} to database`);
      return;
    } catch (error) {
      logger.error('[Storage] Error saving history to database:', error);
      if (process.env.VERCEL) throw error;
    }
  }
  
  // File-based fallback
  if (process.env.VERCEL) {
    throw new Error('Database save failed and file fallback not available on Vercel');
  }
  
  const historyFile = path.join(STORAGE_DIR, `rebalance-history-${entry.portfolioId}.json`);
  try {
    await ensureStorageDir();
    const history = await getRebalanceHistory(entry.portfolioId, 100);
    history.unshift(entry);
    await fs.writeFile(historyFile, JSON.stringify(history.slice(0, 100), null, 2), 'utf-8');
    logger.info(`[Storage] Added rebalance history for portfolio ${entry.portfolioId} to file`);
  } catch (error) {
    logger.error('[Storage] Error saving history file:', error);
    throw error;
  }
}

/**
 * Clear all storage (for testing)
 */
export async function clearAllStorage(): Promise<void> {
  if (shouldUseDatabase()) {
    try {
      await query('DELETE FROM auto_rebalance_configs');
      await query('DELETE FROM auto_rebalance_history');
      await query('DELETE FROM auto_rebalance_last');
      logger.info('[Storage] Cleared all database tables');
    } catch (error) {
      logger.error('[Storage] Error clearing database:', error);
    }
  } else {
    try {
      await fs.unlink(CONFIG_FILE);
      await fs.unlink(REBALANCE_HISTORY_FILE);
      logger.info('[Storage] Cleared all file storage');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error('[Storage] Error clearing files:', error);
      }
    }
  }
}
