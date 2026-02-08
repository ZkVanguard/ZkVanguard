/**
 * Throttled RPC Provider for Cronos Testnet
 * 
 * Wraps ethers.JsonRpcProvider with:
 *  1. Concurrency semaphore — max N in-flight RPC calls at once
 *  2. Exponential backoff retry — auto-retries 429s and transient errors
 *  3. Per-call response cache — deduplicates identical calls within TTL window
 * 
 * This prevents Vercel serverless functions from getting rate-limited (error 1015)
 * by the Cronos public RPC endpoint.
 */

import { ethers } from 'ethers';

// ─── Semaphore (concurrency limiter) ───────────────────────────────────────

class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ─── In-memory cache ───────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TTLCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private readonly defaultTTL: number = 30_000) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttl?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttl ?? this.defaultTTL),
    });
  }

  clear(): void {
    this.store.clear();
  }
}

// ─── Retry with exponential backoff ────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 500,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message || '';
      // Only retry on rate-limits and transient server errors
      const isRetryable =
        msg.includes('429') ||
        msg.includes('Too Many Requests') ||
        msg.includes('1015') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('SERVER_ERROR');

      if (!isRetryable || attempt === maxRetries) throw lastError;

      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200;
      console.warn(`⏳ RPC retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms: ${msg.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── Throttled Provider ────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_CACHE_TTL = 30_000; // 30 seconds

let _cachedProvider: ThrottledProvider | null = null;

export class ThrottledProvider {
  public readonly provider: ethers.JsonRpcProvider;
  private readonly semaphore: Semaphore;
  private readonly cache: TTLCache;
  private readonly maxRetries: number;

  constructor(
    rpcUrl: string,
    options?: {
      maxConcurrency?: number;
      cacheTTL?: number;
      maxRetries?: number;
    },
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      batchMaxCount: 1, // Cronos doesn't support batching well
    });
    this.semaphore = new Semaphore(options?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
    this.cache = new TTLCache(options?.cacheTTL ?? DEFAULT_CACHE_TTL);
    this.maxRetries = options?.maxRetries ?? 3;
  }

  /**
   * Execute a throttled, cached RPC call.
   * @param cacheKey  Unique key for this call (or null to skip cache)
   * @param fn        The async function that makes the RPC call
   * @param ttl       Optional per-call cache TTL override
   */
  async call<T>(cacheKey: string | null, fn: () => Promise<T>, ttl?: number): Promise<T> {
    // Check cache first
    if (cacheKey) {
      const cached = this.cache.get(cacheKey) as T | undefined;
      if (cached !== undefined) return cached;
    }

    // Acquire semaphore slot (blocks if at max concurrency)
    await this.semaphore.acquire();
    try {
      const result = await withRetry(fn, this.maxRetries);
      if (cacheKey) {
        this.cache.set(cacheKey, result, ttl);
      }
      return result;
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Run multiple calls with throttling (replaces raw Promise.all).
   * Automatically queues through the semaphore.
   */
  async throttledAll<T>(
    tasks: Array<{ key: string | null; fn: () => Promise<T>; ttl?: number }>,
  ): Promise<T[]> {
    return Promise.all(tasks.map((t) => this.call(t.key, t.fn, t.ttl)));
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Get a singleton ThrottledProvider for the Cronos testnet RPC.
 * Reuses the same provider + cache across requests within the same
 * serverless function invocation (cold start shares the instance).
 */
export function getCronosProvider(rpcUrl: string = 'https://evm-t3.cronos.org'): ThrottledProvider {
  if (!_cachedProvider) {
    _cachedProvider = new ThrottledProvider(rpcUrl, {
      maxConcurrency: 3,   // Max 3 parallel RPC calls
      cacheTTL: 30_000,    // Cache responses for 30s
      maxRetries: 3,       // Retry 429s up to 3 times with backoff
    });
  }
  return _cachedProvider;
}
