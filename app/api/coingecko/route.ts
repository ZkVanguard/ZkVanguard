import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy endpoint for CoinGecko API to avoid CORS issues
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ids = searchParams.get('ids');
    const vsCurrencies = searchParams.get('vs_currencies') || 'usd';
    const include24hrChange = searchParams.get('include_24hr_change') || 'true';
    const include24hrVol = searchParams.get('include_24hr_vol') || 'true';

    if (!ids) {
      return NextResponse.json(
        { error: 'Missing required parameter: ids' },
        { status: 400 }
      );
    }

    const url = new URL('https://api.coingecko.com/api/v3/simple/price');
    url.searchParams.set('ids', ids);
    url.searchParams.set('vs_currencies', vsCurrencies);
    url.searchParams.set('include_24hr_change', include24hrChange);
    url.searchParams.set('include_24hr_vol', include24hrVol);

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`CoinGecko API returned ${response.status}`);
    }

    const data = await response.json();
    
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('CoinGecko proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch CoinGecko data' },
      { status: 500 }
    );
  }
}
