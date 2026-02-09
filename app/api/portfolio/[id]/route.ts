import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { createPublicClient, http } from 'viem';
import { cronosTestnet } from 'viem/chains';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';

// Token price estimates (in production, fetch from price oracle)
const TOKEN_PRICES: Record<string, number> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 1.0,  // devUSDC = $1
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 0.10, // WCRO = $0.10
};

// Token decimals
const TOKEN_DECIMALS: Record<string, number> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 6,   // devUSDC = 6 decimals
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 18,  // WCRO = 18 decimals
};

// Token symbols
const TOKEN_SYMBOLS: Record<string, string> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 'devUSDC',
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 'WCRO',
};

// In-memory cache for portfolio data (60s TTL)
const portfolioCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 60000; // 60 seconds

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // In Next.js 14+, params is a Promise
    const { id } = await context.params;
    const portfolioId = BigInt(id);
    
    // Check for cache bypass in query params
    const { searchParams } = new URL(request.url);
    const bypassCache = searchParams.get('refresh') === 'true';
    
    // Check cache first (unless bypassed)
    const cacheKey = `portfolio-${id}`;
    const cached = portfolioCache.get(cacheKey);
    if (!bypassCache && cached && Date.now() - cached.timestamp < CACHE_TTL) {
      logger.info(`[Portfolio API] Cache HIT for portfolio ${id}`);
      return NextResponse.json(cached.data);
    }
    
    logger.info(`[Portfolio API] Fetching portfolio ${portfolioId}${bypassCache ? ' (cache bypassed)' : ''}...`);
    
    // Create public client for Cronos Testnet (with retry for rate-limit protection)
    const client = createPublicClient({
      chain: cronosTestnet,
      transport: http('https://evm-t3.cronos.org', {
        retryCount: 3,
        retryDelay: 500,
        batch: { batchSize: 1 },
      }),
    });

    const addresses = getContractAddresses(338); // Cronos Testnet chain ID
    logger.info(`[Portfolio API] Using RWA Manager: ${addresses.rwaManager}`);

    // Read portfolio data from contract using 'portfolios' mapping getter
    const portfolio = await client.readContract({
      address: addresses.rwaManager as `0x${string}`,
      abi: RWA_MANAGER_ABI,
      functionName: 'portfolios',
      args: [portfolioId],
    }) as [string, bigint, bigint, bigint, bigint, boolean];

    logger.debug('[Portfolio API] Raw portfolio data', { data: portfolio });

    // Also fetch asset list
    const assets = await client.readContract({
      address: addresses.rwaManager as `0x${string}`,
      abi: RWA_MANAGER_ABI,
      functionName: 'getPortfolioAssets',
      args: [portfolioId],
    }) as string[];

    logger.debug('[Portfolio API] Portfolio assets', { data: assets });

    // Calculate actual portfolio value using getAssetAllocation (reads from portfolio's internal accounting)
    let calculatedValue = 0;
    const assetBalances: Array<{ token: string; symbol: string; balance: string; valueUSD: number }> = [];
    
    if (assets && assets.length > 0) {
      // Fetch allocation for each deposited asset from the contract's internal accounting
      for (const assetAddress of assets) {
        try {
          // Use getAssetAllocation to read the portfolio's allocation for this asset
          const allocation = await client.readContract({
            address: addresses.rwaManager as `0x${string}`,
            abi: RWA_MANAGER_ABI,
            functionName: 'getAssetAllocation',
            args: [portfolioId, assetAddress as `0x${string}`],
          }) as bigint;
          
          const addr = assetAddress.toLowerCase();
          const decimals = TOKEN_DECIMALS[addr] || 18;
          const price = TOKEN_PRICES[addr] || 1.0;
          const symbol = TOKEN_SYMBOLS[addr] || 'Unknown';
          
          const balanceNum = Number(allocation) / Math.pow(10, decimals);
          const valueUSD = balanceNum * price;
          
          logger.debug(`[Portfolio API] Asset ${symbol}: allocation=${allocation.toString()}, balance=${balanceNum.toFixed(4)}, value=$${valueUSD.toFixed(2)}`);
          
          if (balanceNum > 0) {
            assetBalances.push({
              token: assetAddress,
              symbol,
              balance: balanceNum.toFixed(4),
              valueUSD,
            });
            calculatedValue += valueUSD;
          }
        } catch (err) {
          logger.warn(`[Portfolio API] Failed to fetch allocation for ${assetAddress}`, { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    
    // Also check the contract's totalValue field
    const contractTotalValue = portfolio[1] ? Number(portfolio[1]) : 0;
    logger.debug(`[Portfolio API] Contract totalValue field: ${contractTotalValue}`);
    
    // The contract totalValue is stored in raw token units (usually the deposited amount)
    // Try to interpret it - if it's small, it might already be normalized, if large, normalize it
    let normalizedContractValue = 0;
    if (contractTotalValue > 0) {
      // If the value looks like raw USDC (6 decimals) - divide by 1e6
      // If it looks like raw 18 decimal token - divide by 1e18
      if (contractTotalValue > 1e15) {
        normalizedContractValue = contractTotalValue / 1e18;
      } else if (contractTotalValue > 1e3) {
        normalizedContractValue = contractTotalValue / 1e6;
      } else {
        normalizedContractValue = contractTotalValue;
      }
    }
    
    logger.debug(`[Portfolio API] Calculated value: $${calculatedValue.toFixed(2)}, Normalized contract value: $${normalizedContractValue.toFixed(2)}`);
    
    // Use the calculated value from asset allocations (more accurate), fall back to contract value
    const finalValueUSD = calculatedValue > 0 ? calculatedValue : normalizedContractValue;

    // Format response
    const portfolioData = {
      owner: portfolio[0],
      totalValue: (finalValueUSD * 1e6).toString(), // Store as 6-decimal representation for consistency
      calculatedValueUSD: finalValueUSD, // Actual USD value from asset allocations
      targetYield: portfolio[2]?.toString() || '0',
      riskTolerance: portfolio[3]?.toString() || '0',
      lastRebalance: portfolio[4]?.toString() || '0',
      isActive: portfolio[5] ?? false,
      assets: assets || [],
      assetBalances, // Include detailed balance info
    };

    logger.info(`[Portfolio API] Portfolio ${id} final value: $${finalValueUSD.toFixed(2)}, assets: ${assetBalances.length}`);

    // Cache the response
    portfolioCache.set(cacheKey, { data: portfolioData, timestamp: Date.now() });

    return NextResponse.json(portfolioData);
  } catch (error: unknown) {
    logger.error('[Portfolio API] Error fetching portfolio', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
