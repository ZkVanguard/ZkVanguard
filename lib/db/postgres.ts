import { Pool, PoolClient } from 'pg';
import { logger } from '@/lib/utils/logger';

// PostgreSQL connection pool
let pool: Pool | null = null;

// Pool metrics for monitoring
let _poolMetrics = { queries: 0, errors: 0, slowQueries: 0 };

export function getPoolMetrics() {
  const p = pool;
  return {
    ..._poolMetrics,
    totalConnections: p?.totalCount ?? 0,
    idleConnections: p?.idleCount ?? 0,
    waitingClients: p?.waitingCount ?? 0,
  };
}

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
      // Aggressive connection reuse: keep fewer idle, recycle faster
      max: isNeon ? 8 : 20,                  // Leave 2 slots for admin on Neon (limit 10)
      min: isNeon ? 1 : 2,                   // Keep warm connections ready
      idleTimeoutMillis: isNeon ? 8000 : 20000,   // Faster idle reclaim
      connectionTimeoutMillis: isNeon ? 5000 : 3000,
      // Statement timeout: kill queries that run too long (protects pool from hangs)
      statement_timeout: 15000,              // 15s max per query
      query_timeout: 20000,                  // 20s max including queue wait
      // Allow queued clients to fail fast instead of waiting forever
      allowExitOnIdle: isNeon,               // Release all connections when idle on serverless
    });

    pool.on('error', (err) => {
      _poolMetrics.errors++;
      logger.error('PostgreSQL pool error', err, { component: 'postgres' });
    });

    pool.on('connect', (client: PoolClient) => {
      // Set per-connection statement timeout as a safety net
      client.query('SET statement_timeout = 15000').catch(() => {});
    });
  }

  return pool;
}

const SLOW_QUERY_MS = 2000;

export async function query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  const p = getPool();
  _poolMetrics.queries++;
  const start = Date.now();
  try {
    const result = await p.query(text, params);
    const duration = Date.now() - start;
    if (duration > SLOW_QUERY_MS) {
      _poolMetrics.slowQueries++;
      logger.warn(`[DB] Slow query (${duration}ms): ${text.slice(0, 80)}`, { component: 'postgres', duration });
    }
    return result.rows;
  } catch (err) {
    _poolMetrics.errors++;
    throw err;
  }
}

export async function queryOne<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

/**
 * Execute multiple queries in a single transaction for atomicity + performance.
 * Reduces round-trips to the database.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
