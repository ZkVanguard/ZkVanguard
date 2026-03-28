/**
 * High-concurrency cache and request deduplication for community pool
 */

import { logger } from '@/lib/utils/logger';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const rpcCache = new Map<string, CacheEntry<unknown>>();
const pendingRequests = new Map<string, Promise<unknown>>();

// CACHE TTLs - Increased for high concurrency (pool data changes slowly)
export const POOL_DATA_TTL = 60_000;       // 60 seconds for pool summary
export const USER_POSITION_TTL = 30_000;   // 30 seconds for user positions
export const LEADERBOARD_TTL = 120_000;    // 2 minutes for leaderboard

/**
 * Request deduplication - prevent thundering herd.
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
    logger.debug('[CommunityPool] Deduped request', { key });
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
  return entry.data as T;
}

export function setCachedRpc<T>(key: string, data: T, ttlMs: number = 30000): void {
  rpcCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** Clear all in-memory caches (used by full-reset admin action) */
export function clearRpcCaches(): void {
  rpcCache.clear();
  pendingRequests.clear();
}
