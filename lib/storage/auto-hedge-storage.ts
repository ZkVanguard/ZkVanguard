/**
 * Auto-Hedge Storage Layer
 * 
 * Provides persistent storage for auto-hedge configurations
 * Uses PostgreSQL database for production (Vercel)
 * Falls back to JSON file for local development
 * 
 * This enables automatic configuration of hedging for any portfolio
 * without hardcoded values or manual registration on each deployment.
 */

import { logger } from '../utils/logger';
import { query, queryOne } from '../db/postgres';
import fs from 'fs/promises';
import path from 'path';

// File fallback for local dev (Vercel uses read-only filesystem)
const STORAGE_DIR = path.join(process.cwd(), 'deployments');
const CONFIG_FILE = path.join(STORAGE_DIR, 'auto-hedge-configs.json');

// Check if we should use database (runtime check, not module load)
function shouldUseDatabase(): boolean {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const isVercel = Boolean(process.env.VERCEL);
  return hasDb || isVercel;
}

/**
 * Auto-Hedge Configuration
 * - portfolioId: Portfolio ID from RWAManager
 * - walletAddress: Owner wallet address
 * - enabled: Whether auto-hedging is active
 * - riskThreshold: Risk score (1-10) that triggers hedging
 * - maxLeverage: Maximum leverage for hedges
 * - allowedAssets: Assets that can be hedged (empty = all)
 * - riskTolerance: On-chain risk tolerance (0-100), maps to riskThreshold
 */
export interface AutoHedgeConfig {
  portfolioId: number;
  walletAddress: string;
  enabled: boolean;
  riskThreshold: number; // 1-10 scale
  maxLeverage: number;
  allowedAssets: string[];
  riskTolerance?: number; // 0-100 from on-chain
  createdAt: number;
  updatedAt: number;
}

/**
 * Initialize storage directory for file fallback
 */
async function ensureStorageDir() {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

/**
 * Ensure auto_hedge_configs table exists (idempotent)
 */
async function ensureAutoHedgeTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS auto_hedge_configs (
        portfolio_id INTEGER PRIMARY KEY,
        wallet_address VARCHAR(42) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        risk_threshold INTEGER NOT NULL DEFAULT 5,
        max_leverage INTEGER NOT NULL DEFAULT 3,
        allowed_assets JSONB DEFAULT '[]',
        risk_tolerance INTEGER DEFAULT 50,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_auto_hedge_enabled ON auto_hedge_configs(enabled);
      CREATE INDEX IF NOT EXISTS idx_auto_hedge_wallet ON auto_hedge_configs(wallet_address);
    `);
    logger.debug('[AutoHedgeStorage] Table ensured');
  } catch (error) {
    logger.error('[AutoHedgeStorage] Error ensuring table', { error });
    throw error;
  }
}

/**
 * Get all enabled auto-hedge configurations
 * Loads from database or file depending on environment
 */
export async function getAutoHedgeConfigs(): Promise<AutoHedgeConfig[]> {
  if (shouldUseDatabase()) {
    try {
      await ensureAutoHedgeTable();
      
      const result = await query(`
        SELECT * FROM auto_hedge_configs WHERE enabled = true
      `);
      
      const configs = result.map((row: any) => ({
        portfolioId: row.portfolio_id as number,
        walletAddress: row.wallet_address as string,
        enabled: row.enabled as boolean,
        riskThreshold: row.risk_threshold as number,
        maxLeverage: row.max_leverage as number,
        allowedAssets: Array.isArray(row.allowed_assets) ? row.allowed_assets : [],
        riskTolerance: row.risk_tolerance as number,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      }));
      
      logger.info('[AutoHedgeStorage] Loaded configs from database', { 
        count: configs.length,
        portfolios: configs.map(c => c.portfolioId)
      });
      
      return configs;
    } catch (error) {
      logger.error('[AutoHedgeStorage] Database error, falling back to file', { error });
      return getConfigsFromFile();
    }
  } else {
    return getConfigsFromFile();
  }
}

/**
 * Get config for a specific portfolio
 */
export async function getAutoHedgeConfig(portfolioId: number): Promise<AutoHedgeConfig | null> {
  if (shouldUseDatabase()) {
    try {
      await ensureAutoHedgeTable();
      
      const row: any = await queryOne(
        `SELECT * FROM auto_hedge_configs WHERE portfolio_id = $1`,
        [portfolioId]
      );
      
      if (!row) return null;
      
      return {
        portfolioId: row.portfolio_id as number,
        walletAddress: row.wallet_address as string,
        enabled: row.enabled as boolean,
        riskThreshold: row.risk_threshold as number,
        maxLeverage: row.max_leverage as number,
        allowedAssets: Array.isArray(row.allowed_assets) ? row.allowed_assets : [],
        riskTolerance: row.risk_tolerance as number,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      };
    } catch (error) {
      logger.error('[AutoHedgeStorage] Error fetching config', { portfolioId, error });
      return null;
    }
  } else {
    const configs = await getConfigsFromFile();
    return configs.find(c => c.portfolioId === portfolioId) || null;
  }
}

/**
 * Save or update auto-hedge configuration
 */
export async function saveAutoHedgeConfig(config: AutoHedgeConfig): Promise<void> {
  if (shouldUseDatabase()) {
    try {
      await ensureAutoHedgeTable();
      
      await query(`
        INSERT INTO auto_hedge_configs (
          portfolio_id, wallet_address, enabled, risk_threshold, 
          max_leverage, allowed_assets, risk_tolerance, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (portfolio_id) DO UPDATE SET
          wallet_address = $2,
          enabled = $3,
          risk_threshold = $4,
          max_leverage = $5,
          allowed_assets = $6,
          risk_tolerance = $7,
          updated_at = CURRENT_TIMESTAMP
      `, [
        config.portfolioId,
        config.walletAddress,
        config.enabled,
        config.riskThreshold,
        config.maxLeverage,
        JSON.stringify(config.allowedAssets),
        config.riskTolerance || 50
      ]);
      
      logger.info('[AutoHedgeStorage] Config saved to database', { 
        portfolioId: config.portfolioId,
        enabled: config.enabled
      });
    } catch (error) {
      logger.error('[AutoHedgeStorage] Error saving to database', { error });
      throw error;
    }
  } else {
    await saveConfigToFile(config);
  }
}

/**
 * Delete auto-hedge configuration
 */
export async function deleteAutoHedgeConfig(portfolioId: number): Promise<void> {
  if (shouldUseDatabase()) {
    try {
      await query(
        `DELETE FROM auto_hedge_configs WHERE portfolio_id = $1`,
        [portfolioId]
      );
      
      logger.info('[AutoHedgeStorage] Config deleted from database', { portfolioId });
    } catch (error) {
      logger.error('[AutoHedgeStorage] Error deleting config', { portfolioId, error });
      throw error;
    }
  } else {
    const configs = await getConfigsFromFile();
    const filtered = configs.filter(c => c.portfolioId !== portfolioId);
    await fs.writeFile(CONFIG_FILE, JSON.stringify(filtered, null, 2));
    logger.info('[AutoHedgeStorage] Config deleted from file', { portfolioId });
  }
}

/**
 * Disable auto-hedging for a portfolio (soft delete)
 */
export async function disableAutoHedge(portfolioId: number): Promise<void> {
  if (shouldUseDatabase()) {
    try {
      await query(
        `UPDATE auto_hedge_configs SET enabled = false, updated_at = CURRENT_TIMESTAMP WHERE portfolio_id = $1`,
        [portfolioId]
      );
      logger.info('[AutoHedgeStorage] Config disabled in database', { portfolioId });
    } catch (error) {
      logger.error('[AutoHedgeStorage] Error disabling config', { portfolioId, error });
      throw error;
    }
  } else {
    const configs = await getConfigsFromFile();
    const config = configs.find(c => c.portfolioId === portfolioId);
    if (config) {
      config.enabled = false;
      config.updatedAt = Date.now();
      await fs.writeFile(CONFIG_FILE, JSON.stringify(configs, null, 2));
      logger.info('[AutoHedgeStorage] Config disabled in file', { portfolioId });
    }
  }
}

// ============================================================================
// FILE FALLBACK FUNCTIONS (for local development)
// ============================================================================

/**
 * Get configs from JSON file
 */
async function getConfigsFromFile(): Promise<AutoHedgeConfig[]> {
  try {
    await ensureStorageDir();
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const configs = JSON.parse(data);
    
    logger.info('[AutoHedgeStorage] Loaded configs from file', { 
      count: configs.length 
    });
    
    return configs;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      logger.info('[AutoHedgeStorage] No config file found, returning empty');
      return [];
    }
    logger.error('[AutoHedgeStorage] Error reading file', { error });
    return [];
  }
}

/**
 * Save config to JSON file
 */
async function saveConfigToFile(config: AutoHedgeConfig): Promise<void> {
  try {
    await ensureStorageDir();
    
    const configs = await getConfigsFromFile();
    const existingIndex = configs.findIndex(c => c.portfolioId === config.portfolioId);
    
    if (existingIndex >= 0) {
      configs[existingIndex] = { ...config, updatedAt: Date.now() };
    } else {
      configs.push({ ...config, createdAt: Date.now(), updatedAt: Date.now() });
    }
    
    await fs.writeFile(CONFIG_FILE, JSON.stringify(configs, null, 2));
    logger.info('[AutoHedgeStorage] Config saved to file', { 
      portfolioId: config.portfolioId 
    });
  } catch (error) {
    logger.error('[AutoHedgeStorage] Error saving to file', { error });
    throw error;
  }
}
