import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';

// Force dynamic rendering — uses searchParams
export const dynamic = 'force-dynamic';

export const maxDuration = 15;
/**
 * Oasis Explorer API Proxy
 * 
 * Queries Oasis Sapphire / Emerald block explorers for transaction data.
 * Uses the Oasis Nexus REST API (no key required for basic queries).
 * 
 * @see app/api/cronos-explorer/route.ts (Cronos equivalent)
 */

interface OasisTransaction {
  hash: string;
  from?: string;
  to?: string;
  timestamp?: string;
  [key: string]: unknown;
}

const EXPLORER_APIS: Record<string, string> = {
  'sapphire-testnet': 'https://explorer.oasis.io/api/sapphire/testnet',
  'sapphire-mainnet': 'https://explorer.oasis.io/api/sapphire/mainnet',
  'emerald-testnet': 'https://explorer.oasis.io/api/emerald/testnet',
  'emerald-mainnet': 'https://explorer.oasis.io/api/emerald/mainnet',
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const network = searchParams.get('network') || 'sapphire-testnet';
  const contracts = searchParams.get('contracts');

  if (!address && !contracts) {
    return NextResponse.json(
      { error: 'Address or contracts parameter is required' },
      { status: 400 },
    );
  }

  try {
    const baseUrl = EXPLORER_APIS[network] || EXPLORER_APIS['sapphire-testnet'];
    const allResults: OasisTransaction[] = [];

    // Fetch transactions for user address
    if (address) {
      try {
        const url = `${baseUrl}/accounts/${address}/transactions?limit=${limit}`;
        logger.info(`[Oasis Explorer Proxy] Fetching: ${url}`);

        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });

        if (response.ok) {
          const data = await response.json();
          const txs = data.transactions || data.result || [];
          if (Array.isArray(txs)) allResults.push(...txs);
        }
      } catch (e) {
        logger.warn('[Oasis Explorer Proxy] User tx fetch failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Fetch transactions for platform contracts
    if (contracts) {
      const contractList = contracts.split(',').slice(0, 5);
      const results = await Promise.allSettled(
        contractList.map(async (addr) => {
          const url = `${baseUrl}/accounts/${addr.trim()}/transactions?limit=20`;
          const res = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return [];
          const data = await res.json();
          const txs = data.transactions || data.result || [];
          return Array.isArray(txs) ? txs : [];
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          const filterAndPush = (tx: OasisTransaction) => {
            if (address) {
              return (
                tx.from?.toLowerCase() === address.toLowerCase() ||
                tx.to?.toLowerCase() === address.toLowerCase()
              );
            }
            return true;
          };
          allResults.push(...r.value.filter(filterAndPush));
        }
      }
    }

    // Deduplicate by hash
    const unique = Array.from(
      new Map(allResults.map((tx) => [tx.hash, tx])).values(),
    ).sort(
      (a, b) =>
        new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime(),
    );

    return NextResponse.json(
      { result: unique.slice(0, limit), status: '1', network },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      },
    );
  } catch (error) {
    logger.error('[Oasis Explorer Proxy] Error', { error });
    return NextResponse.json(
      { result: [], message: 'Oasis Explorer API unavailable' },
      { status: 200, headers: { 'Cache-Control': 'public, s-maxage=60' } },
    );
  }
}
