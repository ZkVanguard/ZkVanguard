import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { createPublicClient, http, erc20Abi } from 'viem';
import { cronosTestnet } from 'viem/chains';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';

// Token price estimates (in production, fetch from price oracle)
const TOKEN_PRICES: Record<string, number> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 1.0,  // devUSDC = $1
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 0.10, // WCRO = $0.10
  '0x28217daddc55e3c4831b4a48a00ce04880786967': 1.0,  // MockUSDC = $1
};

// Token decimals
const TOKEN_DECIMALS: Record<string, number> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 6,   // devUSDC = 6 decimals
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 18,  // WCRO = 18 decimals
  '0x28217daddc55e3c4831b4a48a00ce04880786967': 6,   // MockUSDC = 6 decimals
};

// Token symbols
const TOKEN_SYMBOLS: Record<string, string> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 'devUSDC',
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 'WCRO',
  '0x28217daddc55e3c4831b4a48a00ce04880786967': 'MockUSDC',
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
      // Batch fetch all asset allocations in parallel (avoids N+1)
      const allocationResults = await Promise.allSettled(
        assets.map(assetAddress =>
          client.readContract({
            address: addresses.rwaManager as `0x${string}`,
            abi: RWA_MANAGER_ABI,
            functionName: 'getAssetAllocation',
            args: [portfolioId, assetAddress as `0x${string}`],
          }).then(allocation => ({ assetAddress, allocation: allocation as bigint }))
        )
      );

      for (const result of allocationResults) {
        if (result.status === 'rejected') {
          logger.warn(`[Portfolio API] Failed to fetch allocation`, { error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
          continue;
        }
        const { assetAddress, allocation } = result.value;
        const addr = assetAddress.toLowerCase();
        const decimals = TOKEN_DECIMALS[addr] || 18;
        const price = TOKEN_PRICES[addr] || 1.0;
        const symbol = TOKEN_SYMBOLS[addr] || 'Unknown';
        const balanceNum = Number(allocation) / Math.pow(10, decimals);
        const valueUSD = balanceNum * price;
        logger.debug(`[Portfolio API] Asset ${symbol}: allocation=${allocation.toString()}, balance=${balanceNum.toFixed(4)}, value=$${valueUSD.toFixed(2)}`);
        if (balanceNum > 0) {
          assetBalances.push({ token: assetAddress, symbol, balance: balanceNum.toFixed(4), valueUSD });
          calculatedValue += valueUSD;
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

    // Check if portfolio contains MockUSDC - if so, create virtual allocations for BTC/ETH/CRO/SUI
    const mockUsdcAsset = assetBalances.find(a => 
      a.token.toLowerCase() === '0x28217daddc55e3c4831b4a48a00ce04880786967'
    );
    
    let virtualAllocations: Array<{
      symbol: string;
      percentage: number;
      valueUSD: number;
      amount: number;
      price: number;
      entryPrice: number;
      pnl: number;
      pnlPercentage: number;
      chain: string;
    }> = [];
    
    // Entry prices when portfolio was created (Portfolio #3 created on 2/11/2026)
    // These are the historical prices at creation time
    const entryPrices: Record<string, number> = {
      'BTC': 67212.36,  // From hedge creation logs
      'ETH': 1968.17,   // From hedge creation logs
      'CRO': 0.0765,    // From hedge creation logs
      'SUI': 0.9100,    // Approximate entry
    };
    
    // For institutional portfolios with MockUSDC, use the ACTUAL wallet balance
    // This ensures the portfolio value matches the wallet balance
    let actualMockUsdcBalance = 0;
    if (mockUsdcAsset && mockUsdcAsset.valueUSD > 1000000) {
      try {
        // Read actual MockUSDC balance from wallet (not from portfolio allocation)
        const mockUsdcAddress = '0x28217daddc55e3c4831b4a48a00ce04880786967' as `0x${string}`;
        const walletBalance = await client.readContract({
          address: mockUsdcAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [portfolio[0] as `0x${string}`], // portfolio owner
        }) as bigint;
        
        actualMockUsdcBalance = Number(walletBalance) / 1e6; // MockUSDC has 6 decimals
        logger.info(`[Portfolio API] Actual wallet MockUSDC balance: $${actualMockUsdcBalance.toLocaleString()}`);
        
        // Use actual wallet balance if it's greater than the on-chain allocation
        if (actualMockUsdcBalance > finalValueUSD) {
          logger.info(`[Portfolio API] Using wallet balance ($${actualMockUsdcBalance.toLocaleString()}) instead of allocation ($${finalValueUSD.toLocaleString()})`);
          calculatedValue = actualMockUsdcBalance;
        }
      } catch (error) {
        logger.warn(`[Portfolio API] Failed to read actual MockUSDC balance`, { error: String(error) });
      }
    }
    
    // Recalculate finalValueUSD after potential update
    const finalEntryValue = Math.max(calculatedValue, finalValueUSD);
    
    if (mockUsdcAsset && finalEntryValue > 1000000) {
      // This is an institutional portfolio with MockUSDC - create virtual allocations
      const allocations = [
        { symbol: 'BTC', percentage: 35, chain: 'cronos' },
        { symbol: 'ETH', percentage: 30, chain: 'cronos' },
        { symbol: 'CRO', percentage: 20, chain: 'cronos' },
        { symbol: 'SUI', percentage: 15, chain: 'sui' },
      ];
      
      const marketService = getMarketDataService();
      
      for (const alloc of allocations) {
        try {
          const priceData = await marketService.getTokenPrice(alloc.symbol);
          const currentPrice = priceData.price;
          const entryPrice = entryPrices[alloc.symbol] || currentPrice;
          
          // Calculate amount based on entry price (what we "bought")
          const valueAtEntry = finalEntryValue * (alloc.percentage / 100);
          const amount = valueAtEntry / entryPrice;
          
          // Current value based on current price
          const currentValue = amount * currentPrice;
          const pnl = currentValue - valueAtEntry;
          const pnlPercentage = ((currentPrice - entryPrice) / entryPrice) * 100;
          
          virtualAllocations.push({
            symbol: alloc.symbol,
            percentage: alloc.percentage,
            valueUSD: currentValue,
            amount,
            price: currentPrice,
            entryPrice,
            pnl,
            pnlPercentage,
            chain: alloc.chain,
          });
        } catch (error) {
          logger.warn(`Failed to get price for ${alloc.symbol}`);
        }
      }
      
      logger.info(`[Portfolio API] Created ${virtualAllocations.length} virtual allocations for $${finalEntryValue.toLocaleString()} portfolio`);
    }

    // Calculate total portfolio P&L
    const totalPnl = virtualAllocations.reduce((sum, v) => sum + v.pnl, 0);
    const totalCurrentValue = virtualAllocations.reduce((sum, v) => sum + v.valueUSD, 0);
    const totalEntryValue = finalEntryValue;
    const totalPnlPercentage = totalEntryValue > 0 ? ((totalCurrentValue - totalEntryValue) / totalEntryValue) * 100 : 0;

    // Format response
    const portfolioData = {
      owner: portfolio[0],
      totalValue: (finalEntryValue * 1e6).toString(), // Store as 6-decimal representation for consistency
      calculatedValueUSD: virtualAllocations.length > 0 ? totalCurrentValue : finalEntryValue, // Use current value if virtual
      entryValueUSD: totalEntryValue,
      targetYield: portfolio[2]?.toString() || '0',
      riskTolerance: portfolio[3]?.toString() || '0',
      lastRebalance: portfolio[4]?.toString() || '0',
      isActive: portfolio[5] ?? false,
      assets: assets || [],
      assetBalances: virtualAllocations.length > 0 ? virtualAllocations.map(v => ({
        token: v.symbol,
        symbol: v.symbol,
        balance: v.amount.toFixed(4),
        valueUSD: v.valueUSD,
        percentage: v.percentage,
        price: v.price,
        entryPrice: v.entryPrice,
        pnl: v.pnl,
        pnlPercentage: v.pnlPercentage,
        chain: v.chain,
      })) : assetBalances, // Use virtual allocations if available
      virtualAllocations: virtualAllocations.length > 0 ? virtualAllocations : undefined,
      pnl: {
        total: totalPnl,
        percentage: totalPnlPercentage,
        currentValue: totalCurrentValue,
        entryValue: totalEntryValue,
      },
      isInstitutional: virtualAllocations.length > 0,
    };

    logger.info(`[Portfolio API] Portfolio ${id} final value: $${finalEntryValue.toFixed(2)}, assets: ${assetBalances.length}`);

    // Cache the response
    portfolioCache.set(cacheKey, { data: portfolioData, timestamp: Date.now() });

    return NextResponse.json(portfolioData, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error: unknown) {
    logger.error('[Portfolio API] Error fetching portfolio', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
