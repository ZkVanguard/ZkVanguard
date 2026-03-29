/**
 * High-concurrency cache and request deduplication for community pool
 * 
 * Optimized for multi-user scalability:
 * - LRU eviction with max size cap (prevents OOM)
 * - Auto-cleanup of expired entries every 30s
 * - Thundering herd prevention via pending request dedup
 */

import { logger } from '@/lib/utils/logger';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const MAX_CACHE_SIZE = 1000;
const rpcCache = new Map<string, CacheEntry<unknown>>();
const pendingRequests = new Map<string, Promise<unknown>>();

// Auto-cleanup expired entries every 30s
const _cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rpcCache) {
    if (now > entry.expiresAt) rpcCache.delete(key);
  }
}, 30_000);
if (typeof _cleanupTimer === 'object' && 'unref' in _cleanupTimer) {
  _cleanupTimer.unref();
}

// CACHE TTLs — tuned for pool data volatility
export const POOL_DATA_TTL = 60_000;       // 60 seconds for pool summary
export const USER_POSITION_TTL = 30_000;   // 30 seconds for user positions
export const LEADERBOARD_TTL = 120_000;    // 2 minutes for leaderboard

/**
 * Request deduplication — prevent thundering herd.
 * When 100 users request the same data simultaneously, only 1 fetch runs.
 */
export async function dedupedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number
): Promise<T> {
  // Check cache first
  const cached = getCachedRpc<T>(key);
  if (cached !== null) {
    return cached;
  }
  
  // Check if a request is already in flight
  const pending = pendingRequests.get(key) as Promise<T> | undefined;
  if (pending) {
    return pending;
  }
  
  // Create new request with cleanup
  const request = fetcher()
    .then(result => {
      setCachedRpc(key, result, ttlMs);
      return result;
    })
    .finally(() => {
      pendingRequests.delete(key);
    });
  
  pendingRequests.set(key, request);
  return request;
}

export function getCachedRpc<T>(key: string): T | null {
  const entry = rpcCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    rpcCache.delete(key);
    return null;
  }
  // Refresh LRU position
  rpcCache.delete(key);
  rpcCache.set(key, entry);
  return entry.data as T;
}

export function setCachedRpc<T>(key: string, data: T, ttlMs: number = 30000): void {
  // LRU eviction: remove oldest entries if at capacity
  if (rpcCache.size >= MAX_CACHE_SIZE && !rpcCache.has(key)) {
    const evictCount = Math.max(1, Math.floor(MAX_CACHE_SIZE * 0.05));
    let removed = 0;
    for (const k of rpcCache.keys()) {
      if (removed >= evictCount) break;
      rpcCache.delete(k);
      removed++;
    }
  }
  rpcCache.delete(key); // refresh LRU position
  rpcCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** Clear all in-memory caches (used by full-reset admin action) */
export function clearRpcCaches(): void {
  rpcCache.clear();
  pendingRequests.clear();
}

/** Get cache stats for monitoring */
export function getCacheStats(): { rpcCacheSize: number; pendingRequests: number } {
  return { rpcCacheSize: rpcCache.size, pendingRequests: pendingRequests.size };
}
