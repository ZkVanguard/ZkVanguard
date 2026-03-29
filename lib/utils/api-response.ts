/**
 * Optimized API Response Helpers — Multi-User Scalability
 * 
 * Consistent response patterns with:
 * - CDN cache headers (Vercel Edge Cache / stale-while-revalidate)
 * - Proper JSON serialization
 * - Pagination support
 * - Error formatting
 */

import { NextResponse } from 'next/server';

interface CacheOptions {
  /** CDN s-maxage in seconds (default: 0 = no CDN cache) */
  cdnTtl?: number;
  /** stale-while-revalidate in seconds (default: 2x cdnTtl) */
  swr?: number;
  /** Browser max-age in seconds (default: 0) */
  browserTtl?: number;
  /** Whether response is private (per-user data) */
  isPrivate?: boolean;
}

interface PaginatedData<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * JSON response with optimized caching headers
 */
export function jsonResponse<T>(
  data: T,
  options: CacheOptions & { status?: number } = {}
): NextResponse {
  const { cdnTtl = 0, swr, browserTtl = 0, isPrivate = false, status = 200 } = options;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (cdnTtl > 0 && !isPrivate) {
    const swrValue = swr ?? cdnTtl * 2;
    headers['Cache-Control'] = `public, s-maxage=${cdnTtl}, stale-while-revalidate=${swrValue}`;
  } else if (browserTtl > 0) {
    headers['Cache-Control'] = `private, max-age=${browserTtl}`;
  } else if (isPrivate) {
    headers['Cache-Control'] = 'private, no-store';
  }

  return new NextResponse(JSON.stringify(data), { status, headers });
}

/**
 * Paginate an array and return with metadata
 */
export function paginate<T>(
  items: T[],
  limit: number = 50,
  offset: number = 0
): PaginatedData<T> {
  const safeLimit = Math.min(Math.max(1, limit), 200); // Clamp 1-200
  const safeOffset = Math.max(0, offset);
  const sliced = items.slice(safeOffset, safeOffset + safeLimit);

  return {
    items: sliced,
    total: items.length,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + safeLimit < items.length,
  };
}

/**
 * Parse pagination params from URL search params
 */
export function parsePagination(searchParams: URLSearchParams): { limit: number; offset: number } {
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
  return { limit, offset };
}

/**
 * Standard error response
 */
export function errorResponse(
  message: string,
  status: number = 500,
  code?: string
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(code ? { code } : {}),
    },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}

/**
 * Success response with optional CDN caching
 */
export function successResponse<T>(
  data: T,
  cacheOptions?: CacheOptions
): NextResponse {
  return jsonResponse({ success: true, ...data as object }, { ...cacheOptions, status: 200 });
}
