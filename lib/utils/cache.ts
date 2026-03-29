/**
 * Optimized In-Memory Cache — Multi-User Scalable
 * 
 * Features:
 * - LRU eviction with configurable max size (prevents OOM on serverless)
 * - Per-entry TTL support
 * - Auto-cleanup on both server and client
 * - Hit/miss stats for observability
 */

import { logger } from '@/lib/utils/logger';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;  // per-entry TTL
}

interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

class CacheManager {
  private cache: Map<string, CacheEntry<unknown>>;
  private defaultTTL: number;
  private maxSize: number;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(defaultTTL: number = 60000, maxSize: number = 5000) {
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
    this.maxSize = maxSize;

    // Auto-cleanup every 60 seconds (works on both server and client)
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  get<T>(key: string, ttl?: number): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this._misses++;
      return null;
    }

    const maxAge = ttl || entry.ttl;
    const age = Date.now() - entry.timestamp;

    if (age > maxAge) {
      this.cache.delete(key);
      this._misses++;
      return null;
    }

    this._hits++;
    // Refresh LRU position: delete + re-set moves to end of Map
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data as T;
  }

  set<T>(key: string, data: T, customTTL?: number): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest(Math.max(1, Math.floor(this.maxSize * 0.05)));
    }

    // Delete first to refresh LRU position
    this.cache.delete(key);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: customTTL ?? this.defaultTTL,
    });
  }

  /**
   * Get-or-fetch: returns cached value or calls fetcher, stores result.
   * Eliminates duplicate fetcher code at call sites.
   */
  async getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get<T>(key, ttl);
    if (cached !== null) return cached;
    const result = await fetcher();
    this.set(key, result, ttl);
    return result;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  stats(): CacheStats {
    return {
      size: this.cache.size,
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
    };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  private evictOldest(count: number): void {
    let removed = 0;
    for (const key of this.cache.keys()) {
      if (removed >= count) break;
      this.cache.delete(key);
      removed++;
    }
    this._evictions += removed;
  }
}

// Export singleton instance — 60s default TTL, 5000 max entries
export const cache = new CacheManager(60000, 5000);

/**
 * Higher-order function to cache async function results
 */
export function withCache<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  keyGenerator: (...args: Parameters<T>) => string,
  ttl?: number
): T {
  return (async (...args: Parameters<T>) => {
    const key = keyGenerator(...args);
    const cached = cache.get<Awaited<ReturnType<T>>>(key, ttl);
    
    if (cached !== null) {
      return cached;
    }

    const result = await fn(...args);
    cache.set(key, result, ttl);
    return result;
  }) as T;
}
