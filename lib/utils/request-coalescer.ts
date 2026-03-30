/**
 * Request Coalescing — Deduplicate concurrent identical requests
 * 
 * When 1000 users all request the BTC price simultaneously, this ensures
 * only ONE external API call is made. All concurrent callers share
 * the same in-flight promise.
 * 
 * Usage:
 *   const coalescer = createCoalescer<number>(5000); // 5s TTL
 *   const price = await coalescer.get('BTC', () => fetchPriceFromAPI('BTC'));
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface InFlightEntry<T> {
  promise: Promise<T>;
}

export function createCoalescer<T>(ttlMs: number) {
  const cache = new Map<string, CacheEntry<T>>();
  const inFlight = new Map<string, InFlightEntry<T>>();

  // Periodic cache cleanup every 30 seconds
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt < now) cache.delete(key);
    }
  }, 30_000);
  cleanupTimer.unref();

  return {
    /**
     * Get a value by key. If cached and fresh, returns immediately.
     * If another caller is already fetching the same key, shares that promise.
     * Otherwise, calls the factory function exactly once.
     */
    async get(key: string, factory: () => Promise<T>): Promise<T> {
      // 1. Check cache
      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }

      // 2. Check if another caller is already fetching this key
      const existing = inFlight.get(key);
      if (existing) {
        return existing.promise;
      }

      // 3. This caller is the first — initiate the fetch
      const promise = factory().then(
        (value) => {
          cache.set(key, { value, expiresAt: Date.now() + ttlMs });
          inFlight.delete(key);
          return value;
        },
        (err) => {
          inFlight.delete(key);
          throw err;
        }
      );

      inFlight.set(key, { promise });
      return promise;
    },

    /** Invalidate a specific key */
    invalidate(key: string): void {
      cache.delete(key);
    },

    /** Stats for monitoring */
    stats() {
      return {
        cachedKeys: cache.size,
        inFlightKeys: inFlight.size,
      };
    },
  };
}

/**
 * Pre-configured coalescer for price data (5-second TTL).
 * Ensures max 1 Crypto.com API call per asset per 5 seconds
 * regardless of how many concurrent users request the same price.
 */
export const priceCoalescer = createCoalescer<{
  symbol: string;
  price: number;
  change24h?: number;
  volume24h?: number;
  source: string;
}>(5_000);

/**
 * Pre-configured coalescer for batch price data (5-second TTL).
 */
export const batchPriceCoalescer = createCoalescer<Record<string, number>>(5_000);
