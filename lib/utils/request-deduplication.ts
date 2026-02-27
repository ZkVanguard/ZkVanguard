/**
 * Request Deduplication & Caching Utility
 * 
 * Prevents duplicate API requests with two-tier optimization:
 * 1. In-flight deduplication: Concurrent requests share the same promise
 * 2. Response caching: Successful responses are cached for a short TTL
 * 
 * This dramatically reduces API load during rapid UI interactions
 */

import { logger } from '@/lib/utils/logger';

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

interface CachedResponse<T> {
  data: T;
  timestamp: number;
  statusCode?: number;
}

// Default cache TTL for different request types (ms)
const CACHE_TTL = {
  default: 5000,    // 5s for most API calls
  prices: 3000,     // 3s for price data (needs freshness)
  portfolio: 10000, // 10s for portfolio data (less volatile)
  ai: 15000,        // 15s for AI decisions (expensive to compute)
};

function getCacheTTL(key: string): number {
  if (key.includes('price') || key.includes('ticker')) return CACHE_TTL.prices;
  if (key.includes('portfolio') || key.includes('position')) return CACHE_TTL.portfolio;
  if (key.includes('agent') || key.includes('ai') || key.includes('risk') || key.includes('hedge')) return CACHE_TTL.ai;
  return CACHE_TTL.default;
}

class RequestDeduplicator {
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
  private responseCache = new Map<string, CachedResponse<unknown>>();
  private requestTimeout = 30000; // 30s timeout for pending requests
  private cacheEnabled = true;

  /**
   * Execute a request with deduplication and optional response caching
   * @param key Unique identifier for the request
   * @param fetcher Function that performs the actual request
   * @param skipCache If true, bypass response cache (but still use in-flight dedup)
   * @returns Promise that resolves to the request result
   */
  async dedupe<T>(key: string, fetcher: () => Promise<T>, skipCache = false): Promise<T> {
    const now = Date.now();
    
    // Check response cache first (unless skipped)
    if (this.cacheEnabled && !skipCache) {
      const cached = this.responseCache.get(key);
      const ttl = getCacheTTL(key);
      if (cached && (now - cached.timestamp) < ttl) {
        logger.debug(`Cache HIT: ${key} (age: ${now - cached.timestamp}ms)`, { component: 'deduper' });
        return cached.data as T;
      }
    }
    
    const pending = this.pendingRequests.get(key);

    // Return existing promise if request is still pending and not timed out
    if (pending && (now - pending.timestamp) < this.requestTimeout) {
      logger.debug(`Reusing pending request for: ${key}`, { component: 'deduper' });
      return pending.promise as Promise<T>;
    }

    // Create new request
    logger.debug(`Creating new request for: ${key}`, { component: 'deduper' });
    const promise = fetcher()
      .then((result) => {
        // Clean up pending request
        this.pendingRequests.delete(key);
        
        // Cache successful response
        if (this.cacheEnabled && !skipCache) {
          this.responseCache.set(key, {
            data: result,
            timestamp: Date.now(),
          });
        }
        
        return result;
      })
      .catch((error) => {
        // Clean up after error (don't cache errors)
        this.pendingRequests.delete(key);
        throw error;
      });

    // Store pending request
    this.pendingRequests.set(key, {
      promise,
      timestamp: now,
    });

    return promise;
  }
  
  /**
   * Enable or disable response caching
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    if (!enabled) {
      this.responseCache.clear();
    }
  }

  /**
   * Clear a specific pending request
   */
  clear(key: string): void {
    this.pendingRequests.delete(key);
    this.responseCache.delete(key);
  }

  /**
   * Clear all pending requests and cache
   */
  clearAll(): void {
    this.pendingRequests.clear();
    this.responseCache.clear();
  }
  
  /**
   * Invalidate cache entries matching a pattern
   */
  invalidateCache(pattern: string): number {
    let count = 0;
    const regex = new RegExp(pattern, 'i');
    for (const key of this.responseCache.keys()) {
      if (regex.test(key)) {
        this.responseCache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`Invalidated ${count} cache entries matching: ${pattern}`, { component: 'deduper' });
    }
    return count;
  }
  
  /**
   * Clean up expired cache entries
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.responseCache.entries()) {
      const ttl = getCacheTTL(key);
      if ((now - entry.timestamp) > ttl) {
        this.responseCache.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Get stats about pending requests and cache
   */
  getStats(): { pending: number; cached: number; keys: string[] } {
    return {
      pending: this.pendingRequests.size,
      cached: this.responseCache.size,
      keys: Array.from(this.pendingRequests.keys()),
    };
  }
}

// Global singleton instance
const deduplicator = new RequestDeduplicator();

/**
 * Wrapper for fetch with automatic deduplication
 * Each consumer gets a cloned Response to avoid body stream conflicts
 */
export async function dedupedFetch(url: string, options?: RequestInit): Promise<Response> {
  const key = `${options?.method || 'GET'}:${url}`;
  
  // Get the shared response from deduplication
  const response = await deduplicator.dedupe(key, async () => {
    const res = await fetch(url, options);
    // Store the response body as ArrayBuffer so we can recreate it multiple times
    const body = await res.arrayBuffer();
    // Create a new Response with the stored body that can be cloned
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  });
  
  // Clone the response for this consumer
  return response.clone();
}

/**
 * Generic deduplication helper
 */
export function withDeduplication<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  return deduplicator.dedupe(key, fetcher);
}

export { deduplicator };
