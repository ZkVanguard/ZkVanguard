/**
 * Simple in-memory cache utility for API responses
 * Reduces network requests and improves performance
 */

import { logger } from '@/lib/utils/logger';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class CacheManager {
  private cache: Map<string, CacheEntry<unknown>>;
  private defaultTTL: number;

  constructor(defaultTTL: number = 60000) {
    this.cache = new Map();
    this.defaultTTL = defaultTTL; // Default 60s TTL
  }

  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string, ttl?: number): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const maxAge = ttl || this.defaultTTL;
    const age = Date.now() - entry.timestamp;

    if (age > maxAge) {
      this.cache.delete(key);
      return null;
    }

    logger.debug(`[Cache HIT] ${key} (age: ${(age / 1000).toFixed(1)}s)`, { component: 'cache' });
    return entry.data;
  }

  /**
   * Set data in cache with timestamp and optional custom TTL
   */
  set<T>(key: string, data: T, customTTL?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ...(customTTL ? { ttl: customTTL } : {}),
    });
    logger.debug(`[Cache SET] ${key}${customTTL ? ` (TTL: ${customTTL}ms)` : ''}`, { component: 'cache' });
  }

  /**
   * Invalidate specific cache key
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    logger.debug(`[Cache INVALIDATE] ${key}`, { component: 'cache' });
  }

  /**
   * Invalidate all cache keys matching pattern
   */
  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    logger.debug(`[Cache INVALIDATE] ${count} keys matching "${pattern}"`, { component: 'cache' });
  }

  /**
   * Clear all cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.debug(`[Cache CLEAR] ${size} entries removed`, { component: 'cache' });
  }

  /**
   * Get cache stats
   */
  stats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Automatic cache cleanup - removes expired entries
   */
  cleanup(): void {
    let removed = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.defaultTTL) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug(`[Cache CLEANUP] ${removed} expired entries removed`, { component: 'cache' });
    }
  }
}

// Export singleton instance
export const cache = new CacheManager(60000); // 60s default TTL

// Run cleanup every 5 minutes
if (typeof window !== 'undefined') {
  setInterval(() => cache.cleanup(), 5 * 60 * 1000);
}

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
    cache.set(key, result);
    return result;
  }) as T;
}
