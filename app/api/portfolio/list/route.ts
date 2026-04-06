import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';
import { CRONOS_CONTRACT_ADDRESSES, getContractAddresses } from '@/lib/contracts/addresses';
import { getCronosProvider, getCronosChainId } from '@/lib/throttled-provider';
import { getCached, setCached } from '@/lib/db/ui-cache';

export const runtime = 'nodejs';

export const maxDuration = 10;
// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Two-tier cache: per-user in-memory (fast) + DB (survives cold starts)
// Map supports multiple concurrent users instead of single-entry cache
const MAX_LIST_CACHE = 200;
const listCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 30000;

async function getDbCachedList(address: string): Promise<unknown | null> {
  try {
    return await getCached('portfolio', `list:${address.toLowerCase()}`);
  } catch {
    return null;
  }
}

async function setAllListCaches(address: string, data: unknown): Promise<void> {
  const key = address.toLowerCase();
  // LRU eviction when at capacity
  if (listCache.size >= MAX_LIST_CACHE && !listCache.has(key)) {
    const firstKey = listCache.keys().next().value;
    if (firstKey !== undefined) listCache.delete(firstKey);
  }
  listCache.delete(key); // refresh LRU position
  listCache.set(key, { data, timestamp: Date.now() });
  setCached('portfolio', `list:${key}`, data, CACHE_TTL).catch(err => logger.warn('Portfolio list cache write failed', { error: String(err) }));
}

/**
 * GET /api/portfolio/list?address=0x...
 * 
 * Server-side fallback for fetching user portfolios from the RWAManager contract.
 * Used when useReadContract fails in the browser (chain mismatch, RPC timeout, etc.)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json({ error: 'Address parameter is required' }, { status: 400 });
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid Ethereum address' }, { status: 400 });
    }

    // Two-tier cache check (memory → DB)
    // Tier 1: In-memory per-user cache
    const memCached = listCache.get(address.toLowerCase());
    if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
      logger.info(`[Portfolio List API] Memory cache HIT for ${address}`);
      return NextResponse.json(memCached.data);
    }
    
    // Tier 2: DB cache (survives cold starts)
    const dbCached = await getDbCachedList(address);
    if (dbCached) {
      const key = address.toLowerCase();
      listCache.delete(key);
      listCache.set(key, { data: dbCached, timestamp: Date.now() });
      logger.info(`[Portfolio List API] DB cache HIT (cold start recovery) for ${address}`);
      return NextResponse.json(dbCached);
    }

    logger.info(`[Portfolio List API] Fetching portfolios for ${address}`);
    const startTime = Date.now();

    const addresses = getContractAddresses(getCronosChainId());
    const rwaManager = addresses.rwaManager;
    const throttled = getCronosProvider();
    const provider = throttled.provider;

    const contract = new ethers.Contract(rwaManager, RWA_MANAGER_ABI, provider);

    // Get total portfolio count
    const totalCount = await contract.portfolioCount();
    const count = Number(totalCount);
    logger.info(`[Portfolio List API] Total portfolioCount = ${count}`);

    if (count === 0) {
      const response = { portfolios: [], count: 0 };
      await setAllListCaches(address, response);
      return NextResponse.json(response);
    }

    // Fetch all portfolios in parallel
    const portfolioPromises = [];
    for (let i = 0; i < count; i++) {
      portfolioPromises.push(
        contract.portfolios(i)
          .then((p: { owner: string; totalValue: bigint; targetYield: bigint; riskTolerance: bigint; lastRebalance: bigint; isActive: boolean }) => ({
            id: i,
            owner: p.owner,
            totalValue: p.totalValue.toString(),
            targetYield: p.targetYield.toString(),
            riskTolerance: p.riskTolerance.toString(),
            lastRebalance: p.lastRebalance.toString(),
            isActive: p.isActive,
          }))
          .catch((err: unknown) => {
            logger.warn(`[Portfolio List API] Failed to fetch portfolio ${i}`, { error: String(err) });
            return null;
          })
      );
    }

    const allPortfolios = (await Promise.all(portfolioPromises)).filter(Boolean);

    // Filter by owner address
    const userPortfolios = allPortfolios.filter(
      (p) => p && p.owner.toLowerCase() === address.toLowerCase()
    );

    // Fetch tx hashes from events (optional, don't fail if this errors)
    const txHashMap: Record<number, string> = {};
    try {
      const currentBlock = await provider.getBlockNumber();
      const CHUNK_SIZE = 1900;
      const TOTAL_BLOCKS = 20000;
      const fromBlock = Math.max(0, currentBlock - TOTAL_BLOCKS);
      
      const portfolioCreatedFilter = contract.filters.PortfolioCreated();
      
      // Query in a single batch for server-side (more reliable than browser)
      const chunks: Array<{ from: number; to: number }> = [];
      for (let f = fromBlock; f < currentBlock; f += CHUNK_SIZE) {
        chunks.push({ from: f, to: Math.min(f + CHUNK_SIZE - 1, currentBlock) });
      }

      for (let i = 0; i < chunks.length; i += 3) {
        const batch = chunks.slice(i, i + 3);
        const results = await Promise.all(
          batch.map(({ from, to }) =>
            contract.queryFilter(portfolioCreatedFilter, from, to).catch(() => [])
          )
        );
        for (const events of results) {
          for (const event of events) {
            const args = 'args' in event ? (event.args as unknown as { portfolioId?: bigint }) : undefined;
            const portfolioId = Number(args?.portfolioId ?? 0);
            txHashMap[portfolioId] = event.transactionHash;
          }
        }
      }
    } catch (eventErr) {
      logger.warn('[Portfolio List API] Event query failed (non-fatal)', { error: String(eventErr) });
    }

    // Attach tx hashes
    const portfoliosWithTx = userPortfolios.map((p) => ({
      ...p,
      txHash: txHashMap[p!.id] || null,
    }));

    const response = {
      portfolios: portfoliosWithTx,
      count: portfoliosWithTx.length,
      totalOnChain: count,
    };

    // Cache result (two-tier: memory + DB)
    await setAllListCaches(address, response);

    logger.info(`[Portfolio List API] Found ${portfoliosWithTx.length}/${count} portfolios for ${address} in ${Date.now() - startTime}ms`);

    return NextResponse.json(response);
  } catch (error) {
    logger.error('[Portfolio List API] Error', error);
    return safeErrorResponse(error, 'Portfolio list');
  }
}
