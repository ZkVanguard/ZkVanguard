import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy endpoint for Polymarket API to avoid CORS issues
 */
export async function GET(req: NextRequest) {
  try {
    // Forward query parameters
    const { searchParams } = new URL(req.url);
    const limit = searchParams.get('limit') || '50';
    const active = searchParams.get('active') || 'true';
    
    const url = `https://gamma-api.polymarket.com/markets?limit=${limit}&active=${active}`;
    console.log('[Polymarket Proxy] Fetching:', url);
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Polymarket API returned ${response.status}`);
    }

    const data = await response.json();
    console.log(`[Polymarket Proxy] Fetched ${data.length} markets`);
    
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Polymarket proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Polymarket data' },
      { status: 500 }
    );
  }
}
