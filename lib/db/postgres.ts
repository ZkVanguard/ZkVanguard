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
    // Supports Neon serverless, Aiven, and local PostgreSQL.
    // Prefer DATABASE_POOL_URL (Neon pooler endpoint, port 6543) for high concurrency,
    // fall back to DATABASE_URL (direct connection).
    let connectionString = process.env.DATABASE_POOL_URL
      || process.env.DATABASE_URL
      || 'postgresql://postgres:postgres@localhost:5432/zkvanguard';

    // Remove channel_binding parameter if present (not supported by pg module)
    connectionString = connectionString.replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?');

    const isNeon = connectionString.includes('neon.tech');
    const isAiven = connectionString.includes('aivencloud.com');

    // Ensure sslmode=verify-full for Neon (replaces require/prefer modes)
    if (isNeon) {
      connectionString = connectionString.replace(/sslmode=require|sslmode=prefer/g, 'sslmode=verify-full');
      if (!connectionString.includes('sslmode=')) {
        connectionString += (connectionString.includes('?') ? '&' : '?') + 'sslmode=verify-full';
      }
    }

    // Any URL declaring sslmode=require (or providers we know enforce SSL) needs ssl on the pool.
    const requiresSsl = isNeon || isAiven || /sslmode=(require|verify-full|verify-ca)/.test(connectionString);
    // Neon pooler (port 6543) supports up to 10,000 connections
    const isPooler = connectionString.includes(':6543') || connectionString.includes('-pooler.');

    // For non-Neon providers (e.g. Aiven) strip `sslmode` from the URL so pg-connection-string
    // doesn't turn it into `ssl: true` (strict verify) and override the explicit ssl config below.
    if (requiresSsl && !isNeon) {
      connectionString = connectionString.replace(/([?&])sslmode=[^&]+/g, '$1').replace(/[?&]$/, '');
    }

    pool = new Pool({
      connectionString,
      // Neon uses verify-full (rejectUnauthorized: true). Aiven needs SSL but we don't
      // ship its CA cert here, so allow the unverified chain (still encrypted in transit).
      ssl: requiresSsl
        ? (isNeon ? { rejectUnauthorized: true } : { rejectUnauthorized: false })
        : undefined,
      // With Neon pooler: can safely use 25 connections per serverless instance.
      // Aiven plan caps at connection_limit=20 total across the whole project
      // — every Vercel instance shares that budget, so per-instance max=10 saturates
      // with 2 cold-start instances. max=4 leaves room for ~4 instances + scripts.
      max: isPooler ? 25 : (isAiven ? 4 : (isNeon ? 8 : 20)),
      min: isNeon ? 1 : (isAiven ? 0 : 2),
      // Aiven: release idle connections aggressively so cold-start fan-out doesn't pin them.
      idleTimeoutMillis: isNeon ? 8000 : (isAiven ? 5000 : 20000),
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
