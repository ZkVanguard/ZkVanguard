/**
 * Rate Limiter — Optimized for Multi-User Scalability
 * 
 * Sliding window rate limiter with:
 * - LRU eviction to cap memory usage across thousands of users
 * - Proper rate-limit headers (Limit / Remaining / Reset)
 * - Per-IP + per-wallet key extraction
 * - Auto-cleanup of expired windows
 * 
 * For production with multiple serverless instances, the in-memory approach
 * is still effective because Vercel routes requests to the same instance
 * for the warm period.  For truly distributed rate limiting, swap to
 * Upstash @upstash/ratelimit (drop-in replacement).
 */

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Key extractor — defaults to IP address */
  keyFn?: (request: NextRequest) => string;
  /** Max unique keys to track (prevents memory bloat) */
  maxKeys?: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const DEFAULT_KEY_FN = (request: NextRequest): string => {
  // Prefer wallet address for user-level limiting, fallback to IP
  const wallet = request.headers.get('x-wallet-address');
  if (wallet) return `w:${wallet.toLowerCase()}`;
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
};

export function createRateLimiter(config: RateLimitConfig) {
  const {
    maxRequests,
    windowMs,
    keyFn = DEFAULT_KEY_FN,
    maxKeys = 10_000,
  } = config;

  // Use a Map for insertion-order iteration (LRU eviction)
  const windows = new Map<string, WindowEntry>();

  // Cleanup stale entries every 60 seconds (faster cycle for high traffic)
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (entry.resetAt < now) {
        windows.delete(key);
      }
    }
  }, 60_000);
  cleanupTimer.unref();

  function evictOldest(): void {
    // Evict the oldest 10% when at capacity
    const evictCount = Math.max(1, Math.floor(maxKeys * 0.1));
    let removed = 0;
    for (const key of windows.keys()) {
      if (removed >= evictCount) break;
      windows.delete(key);
      removed++;
    }
  }

  return {
    /**
     * Check rate limit. Returns NextResponse (429) if limited, null if allowed.
     */
    check(request: NextRequest): NextResponse | null {
      const key = keyFn(request);
      const now = Date.now();
      const entry = windows.get(key);

      if (!entry || entry.resetAt < now) {
        // Evict if at capacity before inserting new key
        if (!entry && windows.size >= maxKeys) {
          evictOldest();
        }
        // New window — re-insert to refresh Map ordering (LRU)
        windows.delete(key);
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return null;
      }

      // Refresh LRU order
      windows.delete(key);
      entry.count++;
      windows.set(key, entry);

      if (entry.count > maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return NextResponse.json(
          {
            success: false,
            error: 'Too many requests',
            retryAfter,
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(maxRequests),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
            },
          }
        );
      }

      return null;
    },

    /** Get current stats for monitoring */
    stats() {
      return { trackedKeys: windows.size, maxKeys };
    },
  };
}

// ─── Pre-configured limiters for different route types ──────────────

/** Mutation endpoints (hedge execute, settlement, etc.) — 20 req/min */
export const mutationLimiter = createRateLimiter({
  maxRequests: 20,
  windowMs: 60_000,
});

/** Read-only endpoints (prices, status, etc.) — 120 req/min */
export const readLimiter = createRateLimiter({
  maxRequests: 120,
  windowMs: 60_000,
});

/** Heavy computation endpoints (ZK proofs, analysis, chat) — 10 req/min */
export const heavyLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
});

/** Admin/internal endpoints — 60 req/min */
export const adminLimiter = createRateLimiter({
  maxRequests: 60,
  windowMs: 60_000,
});
