import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';

// Force dynamic rendering - this route uses searchParams
export const dynamic = 'force-dynamic';

interface BlockscoutTransaction {
  hash: string;
  from?: string;
  to?: string;
  timeStamp?: string;
  [key: string]: unknown;
}

/**
 * Cronos Explorer API Proxy
 * 
 * Uses the Blockscout-compatible API endpoint for Cronos testnet.
 * No API key required for basic queries.
 */

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');
  const limit = searchParams.get('limit') || '50';
  const network = searchParams.get('network') || 'testnet';
  const contracts = searchParams.get('contracts'); // Comma-separated list of contract addresses

  if (!address && !contracts) {
    return NextResponse.json(
      { error: 'Address or contracts parameter is required' },
      { status: 400 }
    );
  }

  try {
    // Use Blockscout-compatible API (no auth required)
    const baseUrl = network === 'testnet'
      ? 'https://cronos.org/explorer/testnet3/api'
      : 'https://cronos.org/explorer/api';

    const allResults: BlockscoutTransaction[] = [];
    
    // Fetch transactions for user address
    if (address) {
      const userUrl = `${baseUrl}?module=account&action=txlist&address=${address}&page=1&offset=${limit}&sort=desc`;
      logger.info(`[Cronos Explorer Proxy] Fetching user txs: ${userUrl}`);
      
      try {
        const response = await fetch(userUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000), // 10s timeout
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.result && Array.isArray(data.result)) {
            allResults.push(...data.result);
          }
        }
      } catch (e) {
        logger.warn('[Cronos Explorer Proxy] User txs fetch failed', { error: e instanceof Error ? e.message : String(e) });
      }
    }
    
    // Fetch transactions for platform contracts
    if (contracts) {
      const contractList = contracts.split(',');
      for (const contractAddr of contractList.slice(0, 5)) { // Limit to 5 contracts
        try {
          const contractUrl = `${baseUrl}?module=account&action=txlist&address=${contractAddr.trim()}&page=1&offset=20&sort=desc`;
          logger.info(`[Cronos Explorer Proxy] Fetching contract txs: ${contractUrl}`);
          
          const response = await fetch(contractUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000),
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.result && Array.isArray(data.result)) {
              // Filter to only include txs involving the user (if address provided)
              const relevantTxs = address
                ? data.result.filter((tx: BlockscoutTransaction) => 
                    tx.from?.toLowerCase() === address.toLowerCase() ||
                    tx.to?.toLowerCase() === address.toLowerCase()
                  )
                : data.result;
              allResults.push(...relevantTxs);
            }
          }
        } catch (e) {
          logger.warn(`[Cronos Explorer Proxy] Contract ${contractAddr} fetch failed`, { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    
    // Deduplicate by hash and sort by timestamp
    const uniqueTxs = Array.from(
      new Map(allResults.map(tx => [tx.hash, tx])).values()
    ).sort((a, b) => Number(b.timeStamp || 0) - Number(a.timeStamp || 0));
    
    logger.info(`[Cronos Explorer Proxy] Total unique txs: ${uniqueTxs.length}`);

    return NextResponse.json(
      { result: uniqueTxs.slice(0, Number(limit)), status: '1' },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      }
    );
  } catch (error) {
    logger.error('[Cronos Explorer Proxy] Fetch error', error);
    
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
