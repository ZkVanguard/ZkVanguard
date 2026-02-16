import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';

// Force dynamic rendering (uses request.url)
export const dynamic = 'force-dynamic';

/**
 * Proxy endpoint for Polymarket API to avoid CORS issues.
 * Forwards all query parameters (slug, limit, closed, tag, etc.)
 * to gamma-api.polymarket.com/markets.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Build upstream URL — forward every query parameter the caller sent
    const upstream = new URL('https://gamma-api.polymarket.com/markets');
    searchParams.forEach((value, key) => {
      upstream.searchParams.set(key, value);
    });

    // Default closed=false so we only get active markets unless caller overrides
    if (!upstream.searchParams.has('closed')) {
      upstream.searchParams.set('closed', 'false');
    }
    // Default limit when no slug-based lookup (slug returns 1 market anyway)
    if (!upstream.searchParams.has('limit') && !upstream.searchParams.has('slug')) {
      upstream.searchParams.set('limit', '100');
    }

    const url = upstream.toString();
    logger.info(`[Polymarket Proxy] Fetching: ${url}`);

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Polymarket API returned ${response.status}`);
    }

    const data = await response.json();
    const count = Array.isArray(data) ? data.length : 1;
    logger.info(`[Polymarket Proxy] Returned ${count} market(s)`);

    // Short cache for slug lookups (5-min markets), longer for generic
    const maxAge = upstream.searchParams.has('slug') ? 15 : 300;

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`,
      },
    });
  } catch (error) {
    logger.error('Polymarket proxy error', error);
    return NextResponse.json(
      { error: 'Failed to fetch Polymarket data' },
      { status: 500 }
    );
  }
}
