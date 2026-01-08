import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy endpoint for Polymarket API to avoid CORS issues
 */
export async function GET(req: NextRequest) {
  try {
    const response = await fetch('https://gamma-api.polymarket.com/markets', {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Polymarket API returned ${response.status}`);
    }

    const data = await response.json();
    
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
