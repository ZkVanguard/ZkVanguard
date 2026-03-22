import { Pool } from 'pg';
import { logger } from '@/lib/utils/logger';

// PostgreSQL connection pool
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    // Support both Neon serverless and local PostgreSQL
    let connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zkvanguard';
    
    // Remove channel_binding parameter if present (not supported by pg module)
    connectionString = connectionString.replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?');
    
    // Ensure sslmode=verify-full for security (replaces require/prefer modes)
    if (connectionString.includes('neon.tech')) {
      connectionString = connectionString.replace(/sslmode=require|sslmode=prefer/g, 'sslmode=verify-full');
      if (!connectionString.includes('sslmode=')) {
        connectionString += (connectionString.includes('?') ? '&' : '?') + 'sslmode=verify-full';
      }
    }
    
    const isNeon = connectionString.includes('neon.tech');
    
    pool = new Pool({
      connectionString,
      ssl: isNeon ? { rejectUnauthorized: true } : undefined,
      max: isNeon ? 10 : 20, // Neon free tier has connection limits
      idleTimeoutMillis: isNeon ? 10000 : 30000,
      connectionTimeoutMillis: isNeon ? 5000 : 2000,
    });

    pool.on('error', (err) => {
      logger.error('PostgreSQL pool error', err, { component: 'postgres' });
    });
  }

  return pool;
}

export async function query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query(text, params);
  return result.rows;
}

export async function queryOne<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ── Centralized DB readiness ──

let _dbReady = false;
let _dbInitPromise: Promise<void> | null = null;

/**
 * Quick check: is the DB reachable? (3s timeout)
 * Returns false if no DATABASE_URL is set or connection fails.
 */
export async function isDbAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL && !process.env.VERCEL) return false;
  try {
    await Promise.race([
      query('SELECT 1'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DB ping timeout')), 3000)
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure ALL application tables exist (idempotent, runs once).
 * Safely no-ops if the DB is unreachable.
 */
export async function ensureAllTables(): Promise<boolean> {
  if (_dbReady) return true;

  // Deduplicate concurrent callers
  if (_dbInitPromise) {
    await _dbInitPromise;
    return _dbReady;
  }

  _dbInitPromise = (async () => {
    const reachable = await isDbAvailable();
    if (!reachable) {
      logger.warn('[DB] Database unreachable — skipping table init');
      return;
    }

    try {
      // Lazy-import to avoid circular deps at module load
      const { initCommunityPoolTables } = await import('./community-pool');
      const { ensureHedgesTable } = await import('./hedges');

      await Promise.all([
        initCommunityPoolTables(),
        ensureHedgesTable(),
      ]);
      _dbReady = true;
      logger.info('[DB] All tables initialized');
    } catch (e) {
      logger.error('[DB] Table init failed (non-fatal)', { error: e });
    }
  })();

  await _dbInitPromise;
  _dbInitPromise = null;
  return _dbReady;
}
