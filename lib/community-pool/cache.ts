/**
 * Community-pool RPC cache + request dedup.
 *
 * Storage is the shared CacheManager in lib/utils/cache (rpc: key prefix so
 * clearRpcCaches can wipe only this namespace). The unique concern this file
 * owns is thundering-herd prevention via pendingRequests — when 100 users
 * request the same pool data simultaneously, only 1 upstream fetch runs.
 */

import { cache } from '@/lib/utils/cache';

const RPC_PREFIX = 'rpc:';
const pendingRequests = new Map<string, Promise<unknown>>();

// TTLs — tuned to pool-data volatility.
export const POOL_DATA_TTL = 60_000;       // pool summary
export const USER_POSITION_TTL = 30_000;   // per-user positions
export const LEADERBOARD_TTL = 120_000;    // leaderboard

/**
 * Request dedup — if a fetch for `key` is already in flight, subscribe to
 * it instead of firing a second one. Result is cached on completion.
 */
export async function dedupedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
): Promise<T> {
  const cached = getCachedRpc<T>(key);
  if (cached !== null) return cached;

  const pending = pendingRequests.get(key) as Promise<T> | undefined;
  if (pending) return pending;

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
  return cache.get<T>(RPC_PREFIX + key);
}

export function setCachedRpc<T>(key: string, data: T, ttlMs: number = 30_000): void {
  cache.set(RPC_PREFIX + key, data, ttlMs);
}

/** Full-reset admin action — wipes only rpc: namespace, leaves LLM cache etc. */
export function clearRpcCaches(): void {
  cache.invalidatePattern(`^${RPC_PREFIX}`);
  pendingRequests.clear();
}

export function getCacheStats(): { rpcCacheSize: number; pendingRequests: number } {
  // rpcCacheSize is now a component of the shared cache — expose only what
  // callers actually use (pendingRequests count for dedup observability).
  return { rpcCacheSize: cache.stats().size, pendingRequests: pendingRequests.size };
}
