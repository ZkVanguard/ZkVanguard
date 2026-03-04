/**
 * Database-backed state store for cron jobs & price hooks
 * 
 * Replaces in-memory Maps/variables that reset on Vercel cold starts.
 * Uses a generic key-value table with JSONB values for flexibility.
 * 
 * State keys stored:
 * - "heartbeat:lastCheck"          → number (timestamp ms)
 * - "poolCheck:lastCheck"          → number (timestamp ms)
 * - "priceAlert:requestCounter"    → number
 * - "priceAlert:lastAlert:{asset}" → number (timestamp ms)
 * - "poolNav:peak:{poolId}"        → number (peak NAV $)
 * - "poolNav:lastHedge:{poolId}"   → number (timestamp ms)
 * - "rebalance:lastHedge:{id}"     → number (timestamp ms)
 * - "rebalance:peakValue:{id}"     → number (peak portfolio value $)
 */

import { query, queryOne } from './postgres';
import { logger } from '@/lib/utils/logger';

// ─── Table Setup ─────────────────────────────────────────────────────────────

let tableInitialized = false;

async function ensureTable(): Promise<void> {
  if (tableInitialized) return;

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS cron_state (
        key         VARCHAR(255) PRIMARY KEY,
        value       JSONB NOT NULL DEFAULT '{}',
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    tableInitialized = true;
  } catch (error: any) {
    logger.warn('[CronState] Could not create cron_state table — DB may be unavailable', {
      error: error?.message,
    });
  }
}

// ─── Core Helpers ────────────────────────────────────────────────────────────

/**
 * Get a value from the cron state store.
 * Returns null if key doesn't exist or DB is unavailable.
 */
export async function getCronState<T = unknown>(key: string): Promise<T | null> {
  try {
    await ensureTable();
    const row = await queryOne<{ value: T }>(
      'SELECT value FROM cron_state WHERE key = $1',
      [key],
    );
    return row?.value ?? null;
  } catch (error: any) {
    logger.warn(`[CronState] Failed to get "${key}":`, { error: error?.message });
    return null;
  }
}

/**
 * Get a value with a default fallback (never returns null).
 */
export async function getCronStateOr<T>(key: string, defaultValue: T): Promise<T> {
  const value = await getCronState<T>(key);
  return value ?? defaultValue;
}

/**
 * Set (upsert) a value in the cron state store.
 */
export async function setCronState<T = unknown>(key: string, value: T): Promise<void> {
  try {
    await ensureTable();
    await query(
      `INSERT INTO cron_state (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(value)],
    );
  } catch (error: any) {
    logger.warn(`[CronState] Failed to set "${key}":`, { error: error?.message });
  }
}

/**
 * Delete a key from the cron state store.
 */
export async function deleteCronState(key: string): Promise<void> {
  try {
    await ensureTable();
    await query('DELETE FROM cron_state WHERE key = $1', [key]);
  } catch (error: any) {
    logger.warn(`[CronState] Failed to delete "${key}":`, { error: error?.message });
  }
}

/**
 * Get multiple keys matching a prefix (e.g. "poolNav:peak:*").
 * Returns a Map of key → value.
 */
export async function getCronStateByPrefix<T = unknown>(prefix: string): Promise<Map<string, T>> {
  const result = new Map<string, T>();
  try {
    await ensureTable();
    const rows = await query<{ key: string; value: T }>(
      'SELECT key, value FROM cron_state WHERE key LIKE $1',
      [`${prefix}%`],
    );
    for (const row of rows) {
      result.set(row.key, row.value);
    }
  } catch (error: any) {
    logger.warn(`[CronState] Failed to get prefix "${prefix}":`, { error: error?.message });
  }
  return result;
}

// ─── Typed Convenience Helpers ──────────────────────────────────────────────

/** Get a numeric timestamp (ms). Returns 0 if missing. */
export async function getTimestamp(key: string): Promise<number> {
  return getCronStateOr<number>(key, 0);
}

/** Set a numeric timestamp (ms). */
export async function setTimestamp(key: string, ts: number = Date.now()): Promise<void> {
  return setCronState(key, ts);
}

/** Get a numeric value (e.g. peak NAV, counter). Returns defaultValue if missing. */
export async function getNumber(key: string, defaultValue: number = 0): Promise<number> {
  return getCronStateOr<number>(key, defaultValue);
}

/** Set a numeric value. */
export async function setNumber(key: string, value: number): Promise<void> {
  return setCronState(key, value);
}

// ─── Pre-defined Key Builders ───────────────────────────────────────────────

export const CronKeys = {
  // PriceAlertWebhook
  heartbeatLastCheck: 'heartbeat:lastCheck',
  poolCheckLastCheck: 'poolCheck:lastCheck',
  requestCounter: 'priceAlert:requestCounter',
  priceAlertLastAlert: (asset: string) => `priceAlert:lastAlert:${asset}`,

  // Pool NAV Monitor
  poolNavPeak: (poolId: string) => `poolNav:peak:${poolId}`,
  poolNavLastHedge: (poolId: string) => `poolNav:lastHedge:${poolId}`,

  // Auto-Rebalance
  rebalanceLastHedge: (portfolioId: number) => `rebalance:lastHedge:${portfolioId}`,
  rebalancePeakValue: (portfolioId: number) => `rebalance:peakValue:${portfolioId}`,
} as const;
