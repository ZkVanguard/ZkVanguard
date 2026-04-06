/**
 * Request Deduplication & Caching — Optimized for Multi-User Scalability
 * 
 * Two-tier optimization preventing thundering herd problems:
 * 1. In-flight deduplication: Concurrent requests share the same promise
 * 2. Response caching: Successful responses cached with auto-TTL
 * 
 * Safeguards:
 * - Max cache size with LRU eviction (prevents OOM)
 * - Auto-cleanup of expired entries every 30s
 * - Stale pending request detection (prevents leaked promises)
 */

import { logger } from '@/lib/utils/logger';

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

interface CachedResponse<T> {
  data: T;
  timestamp: number;
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

const MAX_CACHE_SIZE = 2000;
const MAX_PENDING_SIZE = 500;

class RequestDeduplicator {
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
  private responseCache = new Map<string, CachedResponse<unknown>>();
  private requestTimeout = 30000; // 30s timeout for pending requests
  private cacheEnabled = true;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Auto-cleanup every 30s to prevent memory leaks
    this.cleanupTimer = setInterval(() => this.cleanup(), 30_000);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  async dedupe<T>(key: string, fetcher: () => Promise<T>, skipCache = false): Promise<T> {
    const now = Date.now();
    
    // Check response cache first (unless skipped)
    if (this.cacheEnabled && !skipCache) {
      const cached = this.responseCache.get(key);
      const ttl = getCacheTTL(key);
      if (cached && (now - cached.timestamp) < ttl) {
        // Refresh LRU position
        this.responseCache.delete(key);
        this.responseCache.set(key, cached);
        return cached.data as T;
      }
    }
    
    const pending = this.pendingRequests.get(key);

    // Return existing promise if request is still pending and not timed out
    if (pending && (now - pending.timestamp) < this.requestTimeout) {
      return pending.promise as Promise<T>;
    }

    // Evict oldest if at capacity
    if (this.pendingRequests.size >= MAX_PENDING_SIZE) {
      const firstKey = this.pendingRequests.keys().next().value;
      if (firstKey !== undefined) this.pendingRequests.delete(firstKey);
    }

    // Create new request
    const promise = fetcher()
      .then((result) => {
        this.pendingRequests.delete(key);
        
        // Cache successful response with LRU eviction
        if (this.cacheEnabled && !skipCache) {
          if (this.responseCache.size >= MAX_CACHE_SIZE) {
            // Evict oldest 5%
            const evictCount = Math.max(1, Math.floor(MAX_CACHE_SIZE * 0.05));
            let removed = 0;
            for (const k of this.responseCache.keys()) {
              if (removed >= evictCount) break;
              this.responseCache.delete(k);
              removed++;
            }
          }
          this.responseCache.delete(key); // refresh LRU position
          this.responseCache.set(key, { data: result, timestamp: Date.now() });
        }
        
        return result;
      })
      .catch((error) => {
        this.pendingRequests.delete(key);
        throw error;
      });

    this.pendingRequests.set(key, { promise, timestamp: now });
    return promise;
  }
  
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    if (!enabled) this.responseCache.clear();
  }

  clear(key: string): void {
    this.pendingRequests.delete(key);
    this.responseCache.delete(key);
  }

  clearAll(): void {
    this.pendingRequests.clear();
    this.responseCache.clear();
  }
  
  invalidateCache(pattern: string): number {
    let count = 0;
    const regex = new RegExp(pattern, 'i');
    for (const key of this.responseCache.keys()) {
      if (regex.test(key)) {
        this.responseCache.delete(key);
        count++;
      }
    }
    return count;
  }
  
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    // Clean expired cache entries
    for (const [key, entry] of this.responseCache.entries()) {
      const ttl = getCacheTTL(key);
      if ((now - entry.timestamp) > ttl) {
        this.responseCache.delete(key);
        cleaned++;
      }
    }
    // Clean stale pending requests (guards against leaked promises)
    for (const [key, entry] of this.pendingRequests.entries()) {
      if ((now - entry.timestamp) > this.requestTimeout) {
        this.pendingRequests.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  getStats(): { pending: number; cached: number } {
    return {
      pending: this.pendingRequests.size,
      cached: this.responseCache.size,
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

/**
 * Simple coalescer API (wrapper around deduplicator)
 * Provides `.get(key, factory)` for callers that prefer a typed, per-resource API.
 */
export function createCoalescer<T>(_ttlMs?: number) {
  return {
    async get(key: string, factory: () => Promise<T>): Promise<T> {
      return deduplicator.dedupe(key, factory) as Promise<T>;
    },
    invalidate(key: string): void {
      deduplicator.clear(key);
    },
    stats() {
      return deduplicator.getStats();
    },
  };
}

/** Pre-configured coalescer for single price data */
export const priceCoalescer = createCoalescer<{
  symbol: string;
  price: number;
  change24h?: number;
  volume24h?: number;
  source: string;
}>();

/** Pre-configured coalescer for batch price data */
export const batchPriceCoalescer = createCoalescer<Record<string, number>>();
