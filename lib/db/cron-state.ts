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

  // Cluster-wide cron singleton (replaces per-instance `lastSuccessfulRunTimestamp`)
  cronLastRun: (cronId: string) => `cron:lastRun:${cronId}`,
  // Cluster-wide circuit breaker (replaces per-instance `globalThis.__suiDailyLossHalted`)
  cronHaltUntil: (cronId: string) => `cron:haltUntil:${cronId}`,
  cronHaltReason: (cronId: string) => `cron:haltReason:${cronId}`,
} as const;

// ─── CAS-based singleton + halt helpers ─────────────────────────────────────
// Vercel runs N parallel instances; module-scope or globalThis state is
// per-instance and provides NO duplicate-fire safety on cold starts. These
// helpers use Postgres atomic Compare-And-Swap so exactly one instance can
// claim a run window across the entire fleet. Fail-CLOSED on any DB error
// — when in doubt we skip rather than risk a duplicate hedge.

/**
 * Atomically claim the next cron run window. Returns true ONLY if
 * `now - lastRun >= minIntervalMs` AND the CAS update succeeded.
 *
 * Fails CLOSED: any DB error returns claimed=false (skip this run) so we
 * never fire twice on infrastructure flapping.
 */
export async function tryClaimCronRun(
  cronId: string,
  minIntervalMs: number,
  now: number = Date.now(),
): Promise<{ claimed: boolean; lastRunMs: number; reason?: string }> {
  const key = CronKeys.cronLastRun(cronId);
  try {
    await ensureTable();
    // Insert a baseline row if missing (idempotent).
    await query(
      `INSERT INTO cron_state (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(0)],
    );

    const rows = await query<{ value: unknown }>(
      `SELECT value FROM cron_state WHERE key = $1`,
      [key],
    );
    const prev = Number(rows[0]?.value ?? 0);
    if (prev > 0 && now - prev < minIntervalMs) {
      return { claimed: false, lastRunMs: prev, reason: 'rate-limit' };
    }

    // CAS: only update if the row still has the value we read. Postgres JSONB
    // equality on numbers via `value::text = $3::text` is exact for our use.
    const updated = await query<{ key: string }>(
      `UPDATE cron_state
         SET value = $2, updated_at = NOW()
       WHERE key = $1 AND value::text = $3::text
       RETURNING key`,
      [key, JSON.stringify(now), JSON.stringify(prev)],
    );
    if (updated.length !== 1) {
      return { claimed: false, lastRunMs: prev, reason: 'cas-lost' };
    }
    return { claimed: true, lastRunMs: now };
  } catch (error: any) {
    logger.warn('[CronState] tryClaimCronRun failed — failing closed', {
      cronId, error: error?.message,
    });
    return { claimed: false, lastRunMs: 0, reason: 'db-error' };
  }
}

/**
 * Persist a cluster-wide halt for `cronId` until `untilMs` (absolute UTC ms).
 * Subsequent calls extend the halt to MAX(existing, new) and preserve the
 * earliest reason for audit clarity.
 */
export async function setCronHalt(
  cronId: string,
  untilMs: number,
  reason: string,
): Promise<void> {
  await Promise.all([
    setNumber(CronKeys.cronHaltUntil(cronId), untilMs),
    setCronState(CronKeys.cronHaltReason(cronId), reason),
  ]);
}

/**
 * Returns the active halt for `cronId`, or null if none. Halts older than
 * `now` are considered expired. Fails CLOSED: DB read failures return a
 * short synthetic halt so we never blindly trade through a broken DB.
 */
export async function getCronHalt(
  cronId: string,
  now: number = Date.now(),
): Promise<{ untilMs: number; reason: string } | null> {
  try {
    const [until, reason] = await Promise.all([
      getNumber(CronKeys.cronHaltUntil(cronId), 0),
      getCronStateOr<string>(CronKeys.cronHaltReason(cronId), 'unspecified'),
    ]);
    if (until <= now) return null;
    return { untilMs: until, reason };
  } catch (error: any) {
    logger.warn('[CronState] getCronHalt failed — returning short synthetic halt', {
      cronId, error: error?.message,
    });
    return { untilMs: now + 60_000, reason: 'db-read-failed' };
  }
}

/** UTC end-of-day epoch ms — typical horizon for a daily-loss halt. */
export function endOfUtcDayMs(now: number = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}
