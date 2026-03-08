import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';
import { CRONOS_CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';
import { getCronosProvider } from '@/lib/throttled-provider';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Cache for portfolio list (30s TTL)
let listCache: { address: string; data: unknown; timestamp: number } | null = null;
const CACHE_TTL = 30000;

/**
 * GET /api/portfolio/list?address=0x...
 * 
 * Server-side fallback for fetching user portfolios from the RWAManager contract.
 * Used when wagmi's useReadContract fails in the browser (chain mismatch, RPC timeout, etc.)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json({ error: 'Address parameter is required' }, { status: 400 });
    }

    // Check cache
    if (listCache && listCache.address === address.toLowerCase() && Date.now() - listCache.timestamp < CACHE_TTL) {
      logger.info(`[Portfolio List API] Cache HIT for ${address}`);
      return NextResponse.json(listCache.data);
    }

    logger.info(`[Portfolio List API] Fetching portfolios for ${address}`);
    const startTime = Date.now();

    const rwaManager = CRONOS_CONTRACT_ADDRESSES.testnet.rwaManager;
    const throttled = getCronosProvider(
      process.env.NEXT_PUBLIC_CRONOS_RPC_URL || 'https://evm-t3.cronos.org'
    );
    const provider = throttled.provider;

    const contract = new ethers.Contract(rwaManager, RWA_MANAGER_ABI, provider);

    // Get total portfolio count
    const totalCount = await contract.portfolioCount();
    const count = Number(totalCount);
    logger.info(`[Portfolio List API] Total portfolioCount = ${count}`);

    if (count === 0) {
      const response = { portfolios: [], count: 0 };
      listCache = { address: address.toLowerCase(), data: response, timestamp: Date.now() };
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

    // Cache result
    listCache = { address: address.toLowerCase(), data: response, timestamp: Date.now() };

    logger.info(`[Portfolio List API] Found ${portfoliosWithTx.length}/${count} portfolios for ${address} in ${Date.now() - startTime}ms`);

    return NextResponse.json(response);
  } catch (error) {
    logger.error('[Portfolio List API] Error', error);
    return safeErrorResponse(error, 'Portfolio list');
  }
}
