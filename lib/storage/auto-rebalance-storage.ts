/**
 * Auto-Rebalance Storage Layer
 * 
 * Provides persistent storage for auto-rebalance configurations
 * Compatible with Vercel serverless environment
 * 
 * Storage options (in order of preference):
 * 1. Vercel KV (Redis) - If available
 * 2. File-based (JSON) - Fallback for development
 * 
 * Usage:
 * ```ts
 * const configs = await getAutoRebalanceConfigs();
 * await saveAutoRebalanceConfig(config);
 * ```
 */

import { logger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';

// Storage paths
const STORAGE_DIR = path.join(process.cwd(), 'deployments');
const CONFIG_FILE = path.join(STORAGE_DIR, 'auto-rebalance-configs.json');
const REBALANCE_HISTORY_FILE = path.join(STORAGE_DIR, 'rebalance-history.json');

// Vercel KV client (disabled - using file-based storage for free tier)
let kv: any = null;

// File-based storage is sufficient for auto-rebalance configs
logger.info('[Storage] Using file-based storage (optimized for free tier)');

// Types
export interface AutoRebalanceConfig {
  portfolioId: number;
  walletAddress: string;
  enabled: boolean;
  threshold: number;
  frequency: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  autoApprovalEnabled: boolean;
  autoApprovalThreshold: number;
  targetAllocations?: Record<string, number>;
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
  if (kv) {
    try {
      const configs = await kv.get('auto-rebalance:configs');
      return configs || [];
    } catch (error) {
      logger.error('[Storage] Error reading from KV:', error);
      return [];
    }
  } else {
    // File-based fallback
    try {
      await ensureStorageDir();
      const data = await fs.readFile(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet
        return [];
      }
      logger.error('[Storage] Error reading config file:', error);
      return [];
    }
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
 * Save auto-rebalance configuration
 */
export async function saveAutoRebalanceConfig(config: AutoRebalanceConfig): Promise<void> {
  config.updatedAt = Date.now();
  
  if (kv) {
    try {
      const configs = await getAutoRebalanceConfigs();
      const existingIndex = configs.findIndex(c => c.portfolioId === config.portfolioId);
      
      if (existingIndex >= 0) {
        configs[existingIndex] = config;
      } else {
        configs.push(config);
      }
      
      await kv.set('auto-rebalance:configs', configs);
      logger.info(`[Storage] Saved config for portfolio ${config.portfolioId} to KV`);
    } catch (error) {
      logger.error('[Storage] Error saving to KV:', error);
      throw error;
    }
  } else {
    // File-based fallback
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
}

/**
 * Delete auto-rebalance configuration
 */
export async function deleteAutoRebalanceConfig(portfolioId: number): Promise<void> {
  if (kv) {
    try {
      const configs = await getAutoRebalanceConfigs();
      const filtered = configs.filter(c => c.portfolioId !== portfolioId);
      await kv.set('auto-rebalance:configs', filtered);
      logger.info(`[Storage] Deleted config for portfolio ${portfolioId} from KV`);
    } catch (error) {
      logger.error('[Storage] Error deleting from KV:', error);
      throw error;
    }
  } else {
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
}

/**
 * Get last rebalance timestamp for a portfolio
 */
export async function getLastRebalance(portfolioId: number): Promise<number | null> {
  if (kv) {
    try {
      const timestamp = await kv.get(`auto-rebalance:last:${portfolioId}`);
      return timestamp || null;
    } catch (error) {
      logger.error('[Storage] Error reading last rebalance from KV:', error);
      return null;
    }
  } else {
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
}

/**
 * Save last rebalance timestamp
 */
export async function saveLastRebalance(portfolioId: number, timestamp: number): Promise<void> {
  if (kv) {
    try {
      await kv.set(`auto-rebalance:last:${portfolioId}`, timestamp);
      logger.info(`[Storage] Saved last rebalance for portfolio ${portfolioId} to KV`);
    } catch (error) {
      logger.error('[Storage] Error saving last rebalance to KV:', error);
      throw error;
    }
  } else {
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
}

/**
 * Get rebalance history for a portfolio
 */
export async function getRebalanceHistory(portfolioId: number, limit: number = 10): Promise<RebalanceHistory[]> {
  if (kv) {
    try {
      const history = await kv.get(`auto-rebalance:history:${portfolioId}`);
      return (history || []).slice(0, limit);
    } catch (error) {
      logger.error('[Storage] Error reading history from KV:', error);
      return [];
    }
  } else {
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
}

/**
 * Add entry to rebalance history
 */
export async function addRebalanceHistory(entry: RebalanceHistory): Promise<void> {
  if (kv) {
    try {
      const history = await getRebalanceHistory(entry.portfolioId, 100);
      history.unshift(entry);
      await kv.set(`auto-rebalance:history:${entry.portfolioId}`, history.slice(0, 100));
      logger.info(`[Storage] Added rebalance history for portfolio ${entry.portfolioId} to KV`);
    } catch (error) {
      logger.error('[Storage] Error saving history to KV:', error);
      throw error;
    }
  } else {
    // File-based fallback
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
}

/**
 * Clear all storage (for testing)
 */
export async function clearAllStorage(): Promise<void> {
  if (kv) {
    try {
      await kv.del('auto-rebalance:configs');
      logger.info('[Storage] Cleared all KV storage');
    } catch (error) {
      logger.error('[Storage] Error clearing KV:', error);
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
