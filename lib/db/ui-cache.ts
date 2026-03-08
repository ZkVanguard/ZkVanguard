/**
 * UI Cache DB Layer
 * 
 * Generic key-value cache stored in PostgreSQL for site-wide UI optimizations.
 * Stores expensive computation results (AI recommendations, portfolio analysis, etc.)
 * with configurable TTL to avoid redundant API/computation calls.
 * 
 * Benefits:
 * - Survives serverless cold starts (unlike in-memory cache)
 * - Shared across all Vercel function instances
 * - Queryable and debuggable
 * - Automatic expiry via maxAge
 */

import { query, queryOne } from './postgres';
import { logger } from '@/lib/utils/logger';

// Cache entry types for type safety
export type CacheNamespace = 
  | 'recommendations'    // AI hedge recommendations
  | 'portfolio'          // Portfolio data snapshots
  | 'agent-results'      // Multi-agent execution results
  | 'risk-analysis'      // Risk scores and volatility
  | 'market-data'        // Aggregated market data
  | 'user-preferences';  // User settings

export interface CacheEntry<T = unknown> {
  namespace: CacheNamespace;
  key: string;
  value: T;
  created_at: Date;
  expires_at: Date;
  hit_count: number;
}

// Default TTLs by namespace (in milliseconds)
const DEFAULT_TTLS: Record<CacheNamespace, number> = {
  'recommendations': 60_000,      // 1 minute - AI results change with market
  'portfolio': 30_000,            // 30 seconds - balance updates
  'agent-results': 120_000,       // 2 minutes - complex computations
  'risk-analysis': 60_000,        // 1 minute - risk scores
  'market-data': 15_000,          // 15 seconds - prices
  'user-preferences': 300_000,    // 5 minutes - rarely changes
};

let tableInitialized = false;

/**
 * Initialize the UI cache table if it doesn't exist
 */
export async function initUICacheTable(): Promise<void> {
  if (tableInitialized) return;
  
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS ui_cache (
        namespace VARCHAR(50) NOT NULL,
        cache_key VARCHAR(255) NOT NULL,
        value JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        hit_count INTEGER DEFAULT 0,
        PRIMARY KEY (namespace, cache_key)
      );
      
      CREATE INDEX IF NOT EXISTS idx_ui_cache_expires 
        ON ui_cache (expires_at);
      
      CREATE INDEX IF NOT EXISTS idx_ui_cache_namespace 
        ON ui_cache (namespace);
    `);
    tableInitialized = true;
    logger.info('[UICache] Table initialized');
  } catch (error) {
    // Table might already exist - that's fine
    logger.debug('[UICache] Table init (may already exist)', { error });
    tableInitialized = true;
  }
}

/**
 * Get a cached value. Returns null if not found or expired.
 */
export async function getCached<T>(
  namespace: CacheNamespace,
  key: string
): Promise<T | null> {
  try {
    await initUICacheTable();
    
    // Get and increment hit count atomically
    const entry = await queryOne<{ value: T; hit_count: number }>(`
      UPDATE ui_cache 
      SET hit_count = hit_count + 1
      WHERE namespace = $1 
        AND cache_key = $2 
        AND expires_at > NOW()
      RETURNING value, hit_count
    `, [namespace, key]);
    
    if (entry) {
      logger.debug('[UICache] HIT', { namespace, key, hitCount: entry.hit_count });
      return entry.value;
    }
    
    logger.debug('[UICache] MISS', { namespace, key });
    return null;
  } catch (error) {
    logger.warn('[UICache] Get failed', { namespace, key, error });
    return null;
  }
}

/**
 * Store a value in the cache with automatic TTL
 */
export async function setCached<T>(
  namespace: CacheNamespace,
  key: string,
  value: T,
  ttlMs?: number
): Promise<void> {
  try {
    await initUICacheTable();
    
    const ttl = ttlMs ?? DEFAULT_TTLS[namespace];
    const expiresAt = new Date(Date.now() + ttl);
    
    await query(`
      INSERT INTO ui_cache (namespace, cache_key, value, created_at, expires_at, hit_count)
      VALUES ($1, $2, $3, NOW(), $4, 0)
      ON CONFLICT (namespace, cache_key) DO UPDATE SET
        value = EXCLUDED.value,
        created_at = NOW(),
        expires_at = EXCLUDED.expires_at,
        hit_count = 0
    `, [namespace, key, JSON.stringify(value), expiresAt.toISOString()]);
    
    logger.debug('[UICache] SET', { namespace, key, ttlMs: ttl });
  } catch (error) {
    logger.warn('[UICache] Set failed', { namespace, key, error });
  }
}

/**
 * Delete a specific cache entry
 */
export async function deleteCached(
  namespace: CacheNamespace,
  key: string
): Promise<void> {
  try {
    await initUICacheTable();
    await query(`DELETE FROM ui_cache WHERE namespace = $1 AND cache_key = $2`, [namespace, key]);
  } catch (error) {
    logger.warn('[UICache] Delete failed', { namespace, key, error });
  }
}

/**
 * Clear all entries in a namespace
 */
export async function clearNamespace(namespace: CacheNamespace): Promise<void> {
  try {
    await initUICacheTable();
    await query(`DELETE FROM ui_cache WHERE namespace = $1`, [namespace]);
    logger.info('[UICache] Cleared namespace', { namespace });
  } catch (error) {
    logger.warn('[UICache] Clear namespace failed', { namespace, error });
  }
}

/**
 * Clean up expired entries (called periodically or on deploy)
 */
export async function cleanupExpired(): Promise<number> {
  try {
    await initUICacheTable();
    const result = await query<{ count: number }>(`
      WITH deleted AS (
        DELETE FROM ui_cache WHERE expires_at < NOW()
        RETURNING 1
      )
      SELECT COUNT(*) as count FROM deleted
    `);
    const count = result[0]?.count ?? 0;
    if (count > 0) {
      logger.info('[UICache] Cleaned up expired entries', { count });
    }
    return count;
  } catch (error) {
    logger.warn('[UICache] Cleanup failed', { error });
    return 0;
  }
}

/**
 * Get cache statistics for monitoring
 */
export async function getCacheStats(): Promise<{
  totalEntries: number;
  byNamespace: Record<string, number>;
  totalHits: number;
  expiredCount: number;
}> {
  try {
    await initUICacheTable();
    
    const stats = await query<{ namespace: string; entry_count: number; total_hits: number }>(`
      SELECT 
        namespace,
        COUNT(*) as entry_count,
        SUM(hit_count) as total_hits
      FROM ui_cache
      WHERE expires_at > NOW()
      GROUP BY namespace
    `);
    
    const expired = await queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM ui_cache WHERE expires_at <= NOW()
    `);
    
    const byNamespace: Record<string, number> = {};
    let totalEntries = 0;
    let totalHits = 0;
    
    for (const row of stats) {
      byNamespace[row.namespace] = row.entry_count;
      totalEntries += row.entry_count;
      totalHits += row.total_hits || 0;
    }
    
    return {
      totalEntries,
      byNamespace,
      totalHits,
      expiredCount: expired?.count ?? 0,
    };
  } catch (error) {
    logger.warn('[UICache] Stats failed', { error });
    return { totalEntries: 0, byNamespace: {}, totalHits: 0, expiredCount: 0 };
  }
}

/**
 * Cache-through helper: get from cache or compute and store
 */
export async function cacheThrough<T>(
  namespace: CacheNamespace,
  key: string,
  fetcher: () => Promise<T>,
  ttlMs?: number
): Promise<T> {
  // Try cache first
  const cached = await getCached<T>(namespace, key);
  if (cached !== null) {
    return cached;
  }
  
  // Compute fresh value
  const value = await fetcher();
  
  // Store in cache (fire-and-forget)
  setCached(namespace, key, value, ttlMs).catch(() => {});
  
  return value;
}

/**
 * Invalidate cache entries matching a pattern
 * Useful when portfolio changes and all related caches should refresh
 */
export async function invalidatePattern(
  namespace: CacheNamespace,
  keyPattern: string
): Promise<number> {
  try {
    await initUICacheTable();
    const result = await query<{ count: number }>(`
      WITH deleted AS (
        DELETE FROM ui_cache 
        WHERE namespace = $1 AND cache_key LIKE $2
        RETURNING 1
      )
      SELECT COUNT(*) as count FROM deleted
    `, [namespace, keyPattern]);
    return result[0]?.count ?? 0;
  } catch (error) {
    logger.warn('[UICache] Invalidate pattern failed', { namespace, keyPattern, error });
    return 0;
  }
}
