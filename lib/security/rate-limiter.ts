/**
 * Rate Limiter
 * 
 * In-memory sliding window rate limiter for API routes.
 * For production with multiple instances, replace with Upstash Ratelimit.
 * 
 * Usage:
 *   const limiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });
 *   
 *   export async function POST(request: NextRequest) {
 *     const limited = limiter.check(request);
 *     if (limited) return limited;
 *     // ... handle request
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Key extractor — defaults to IP address */
  keyFn?: (request: NextRequest) => string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const DEFAULT_KEY_FN = (request: NextRequest): string => {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
};

export function createRateLimiter(config: RateLimitConfig) {
  const { maxRequests, windowMs, keyFn = DEFAULT_KEY_FN } = config;
  const windows = new Map<string, WindowEntry>();

  // Cleanup stale entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (entry.resetAt < now) {
        windows.delete(key);
      }
    }
  }, 5 * 60_000).unref();

  return {
    /**
     * Check rate limit. Returns NextResponse (429) if limited, null if allowed.
     */
    check(request: NextRequest): NextResponse | null {
      const key = keyFn(request);
      const now = Date.now();
      const entry = windows.get(key);

      if (!entry || entry.resetAt < now) {
        // New window
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return null;
      }

      entry.count++;
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
