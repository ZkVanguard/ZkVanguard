import { NextRequest, NextResponse } from 'next/server';

/**
 * Cronos Explorer API Proxy
 * 
 * Proxies requests to the Cronos Explorer API to avoid CORS issues
 * in the browser. Supports both testnet and mainnet.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');
  const limit = searchParams.get('limit') || '50';
  const network = searchParams.get('network') || 'testnet'; // testnet or mainnet

  if (!address) {
    return NextResponse.json(
      { error: 'Address parameter is required' },
      { status: 400 }
    );
  }

  try {
    // Determine the correct API URL based on network
    const explorerApiUrl = network === 'testnet'
      ? 'https://explorer-api.cronos.org/testnet/api/v1'
      : 'https://explorer-api.cronos.org/mainnet/api/v1';

    const url = `${explorerApiUrl}/addresses/${address}/transactions?limit=${limit}`;
    
    console.log(`[Cronos Explorer Proxy] Fetching from: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Chronos-Vanguard/1.0',
      },
    });

    if (!response.ok) {
      console.error(`[Cronos Explorer Proxy] Error: ${response.status} ${response.statusText}`);
      
      // Return empty result instead of error to allow fallback to RPC
      return NextResponse.json(
        { 
          result: [], 
          message: `Explorer API returned ${response.status}` 
        },
        { 
          status: 200,
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          },
        }
      );
    }

    const data = await response.json();
    console.log(`[Cronos Explorer Proxy] Success: ${data.result?.length || 0} transactions found`);

    return NextResponse.json(data, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('[Cronos Explorer Proxy] Fetch error:', error);
    
    // Return empty result instead of error to allow fallback to RPC
    return NextResponse.json(
      { 
        result: [], 
        message: 'Explorer API unavailable, will use RPC fallback' 
      },
      { 
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      }
    );
  }
}
