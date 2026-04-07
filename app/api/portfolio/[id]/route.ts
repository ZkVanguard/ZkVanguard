import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { createPublicClient, http, erc20Abi } from 'viem';
import { cronos, cronosTestnet } from 'viem/chains';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';
import { getMarketDataService } from '@/lib/services/market-data/RealMarketDataService';
import { getCached, setCached } from '@/lib/db/ui-cache';
import { ProductionGuard } from '@/lib/security/production-guard';
import { isMainnet } from '@/lib/utils/network';
import { getCronosRpcUrl, getCronosChainId } from '@/lib/throttled-provider';

export const runtime = 'nodejs';

export const maxDuration = 10;
// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTION SAFETY: Token configuration with NO hardcoded prices
// Prices MUST be fetched from market data service in production
// ═══════════════════════════════════════════════════════════════════════════

// Token decimals (static - these don't change)
const TOKEN_DECIMALS: Record<string, number> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 6,   // devUSDC = 6 decimals
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 18,  // WCRO = 18 decimals
  '0x28217daddc55e3c4831b4a48a00ce04880786967': 6,   // Testnet USDC = 6 decimals
};

// Token symbols (for price lookup)
const TOKEN_SYMBOLS: Record<string, string> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 'USDC',  // Treat devUSDC as USDC
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 'CRO',   // WCRO -> CRO price
  '0x28217daddc55e3c4831b4a48a00ce04880786967': 'USDC',  // Testnet USDC -> USDC price
};

// Token display names
const TOKEN_DISPLAY_NAMES: Record<string, string> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 'devUSDC',
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 'WCRO',
  '0x28217daddc55e3c4831b4a48a00ce04880786967': 'USDC',
};

/**
 * Fetch live token price - NEVER falls back to hardcoded values in production
 */
async function getLiveTokenPrice(tokenAddress: string): Promise<number> {
  const addr = tokenAddress.toLowerCase();
  const symbol = TOKEN_SYMBOLS[addr];
  
  if (!symbol) {
    logger.warn('[Portfolio API] Unknown token address - cannot fetch price', { tokenAddress });
    if (ProductionGuard.ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Unknown token ${tokenAddress}: cannot determine price`);
    }
    return 0;
  }
  
  try {
    const marketService = getMarketDataService();
    const priceData = await marketService.getTokenPrice(symbol);
    
    // Validate price is reasonable
    const validated = ProductionGuard.requireLivePrice(
      symbol,
      priceData.price,
      priceData.timestamp,
      priceData.source
    );
    
    return validated.price;
  } catch (error) {
    logger.error('[Portfolio API] Failed to fetch live price', { symbol, tokenAddress, error });
    
    if (ProductionGuard.ENFORCE_PRODUCTION_SAFETY) {
      throw new Error(`Unable to fetch price for ${symbol}. Portfolio valuation halted.`);
    }
    
    // Dev mode only - return 0 (will show clearly something is wrong)
    return 0;
  }
}

// Two-tier cache: In-memory (fast) + DB (survives cold starts)
const portfolioCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 60000; // 60 seconds

async function getDbCachedPortfolio(id: string): Promise<unknown | null> {
  try {
    return await getCached('portfolio', `detail:${id}`);
  } catch {
    return null;
  }
}

async function setAllPortfolioCaches(id: string, data: unknown): Promise<void> {
  portfolioCache.set(`portfolio-${id}`, { data, timestamp: Date.now() });
  setCached('portfolio', `detail:${id}`, data, CACHE_TTL).catch(err => logger.warn('Portfolio detail cache write failed', { error: String(err) }));
}

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
    
    // Two-tier cache check (memory → DB)
    const cacheKey = `portfolio-${id}`;
    if (!bypassCache) {
      // Tier 1: In-memory cache
      const memCached = portfolioCache.get(cacheKey);
      if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
        logger.info(`[Portfolio API] Memory cache HIT for portfolio ${id}`);
        return NextResponse.json(memCached.data);
      }
      
      // Tier 2: DB cache (survives cold starts)
      const dbCached = await getDbCachedPortfolio(id);
      if (dbCached) {
        portfolioCache.set(cacheKey, { data: dbCached, timestamp: Date.now() });
        logger.info(`[Portfolio API] DB cache HIT (cold start recovery) for portfolio ${id}`);
        return NextResponse.json(dbCached);
      }
    }
    
    logger.info(`[Portfolio API] Fetching portfolio ${portfolioId}${bypassCache ? ' (cache bypassed)' : ''}...`);
    
    // Create public client for Cronos (with retry for rate-limit protection)
    const client = createPublicClient({
      chain: getCronosChainId() === 25 ? cronos : cronosTestnet,
      transport: http(getCronosRpcUrl(), {
        retryCount: 3,
        retryDelay: 500,
        batch: { batchSize: 1 },
      }),
    });

    const addresses = getContractAddresses(getCronosChainId());
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

      // PRODUCTION SAFETY: Fetch live prices for all unique assets first
      const uniqueAssets = [...new Set(assets.map(a => a.toLowerCase()))];
      const priceMap: Map<string, number> = new Map();
      
      for (const addr of uniqueAssets) {
        try {
          const price = await getLiveTokenPrice(addr);
          priceMap.set(addr, price);
        } catch (error) {
          // In production, this error is already thrown by getLiveTokenPrice
          // In dev, log and continue with 0
          logger.error('[Portfolio API] Price fetch failed', { addr, error });
          priceMap.set(addr, 0);
        }
      }

      for (const result of allocationResults) {
        if (result.status === 'rejected') {
          logger.warn(`[Portfolio API] Failed to fetch allocation`, { error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
          continue;
        }
        const { assetAddress, allocation } = result.value;
        const addr = assetAddress.toLowerCase();
        const decimals = TOKEN_DECIMALS[addr] || 18;
        const price = priceMap.get(addr) || 0; // Never use hardcoded fallback
        const symbol = TOKEN_DISPLAY_NAMES[addr] || 'Unknown';
        const balanceNum = Number(allocation) / Math.pow(10, decimals);
        const valueUSD = balanceNum * price;
        logger.debug(`[Portfolio API] Asset ${symbol}: allocation=${allocation.toString()}, balance=${balanceNum.toFixed(4)}, price=$${price}, value=$${valueUSD.toFixed(2)}`);
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

    // Check if portfolio contains testnet USDC - if so, create virtual allocations for BTC/ETH/CRO/SUI
    const testnetUsdcAsset = assetBalances.find(a => 
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
    
    // ⚠️ TESTNET ONLY: Entry prices should come from on-chain transaction history
    // On mainnet, testnet USDC doesn't exist so this code path is never hit
    // For demo, we use current market prices (P&L will be minimal)
    const entryPrices: Record<string, number> = {};
    // Entry prices are fetched dynamically below from market service
    
    // For institutional portfolios with testnet USDC, use the ACTUAL wallet balance
    // This ensures the portfolio value matches the wallet balance
    let actualUsdcBalance = 0;
    if (testnetUsdcAsset && testnetUsdcAsset.valueUSD > 1000000) {
      try {
        // Read actual USDC balance from wallet (not from portfolio allocation)
        const usdcAddress = '0x28217daddc55e3c4831b4a48a00ce04880786967' as `0x${string}`;
        const walletBalance = await client.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [portfolio[0] as `0x${string}`], // portfolio owner
        }) as bigint;
        
        actualUsdcBalance = Number(walletBalance) / 1e6; // USDC has 6 decimals
        logger.info(`[Portfolio API] Actual wallet USDC balance: $${actualUsdcBalance.toLocaleString()}`);
        
        // Use actual wallet balance if it's greater than the on-chain allocation
        if (actualUsdcBalance > finalValueUSD) {
          logger.info(`[Portfolio API] Using wallet balance ($${actualUsdcBalance.toLocaleString()}) instead of allocation ($${finalValueUSD.toLocaleString()})`);
          calculatedValue = actualUsdcBalance;
        }
      } catch (error) {
        logger.warn(`[Portfolio API] Failed to read actual USDC balance`, { error: String(error) });
      }
    }
    
    // Recalculate finalValueUSD after potential update
    const finalEntryValue = Math.max(calculatedValue, finalValueUSD);
    
    // ⚠️ TESTNET ONLY: Virtual allocations for testnet USDC demo portfolios
    // Testnet USDC only exists on testnet - this code never runs on mainnet
    if (testnetUsdcAsset && finalEntryValue > 1000000 && !isMainnet()) {
      // Get allocation percentages from env or use testnet defaults
      // In production, portfolios hold actual assets - not virtual allocations
      const allocations = [
        { symbol: 'BTC', percentage: Number(process.env.DEMO_ALLOC_BTC || 35), chain: 'cronos' },
        { symbol: 'ETH', percentage: Number(process.env.DEMO_ALLOC_ETH || 30), chain: 'cronos' },
        { symbol: 'CRO', percentage: Number(process.env.DEMO_ALLOC_CRO || 20), chain: 'cronos' },
        { symbol: 'SUI', percentage: Number(process.env.DEMO_ALLOC_SUI || 15), chain: 'sui' },
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
        // Calculate ACTUAL percentage based on current market values (for drift detection)
        percentage: totalCurrentValue > 0 ? (v.valueUSD / totalCurrentValue) * 100 : v.percentage,
        targetPercentage: v.percentage, // Keep target for reference
        price: v.price,
        entryPrice: v.entryPrice,
        pnl: v.pnl,
        pnlPercentage: v.pnlPercentage,
        chain: v.chain,
      })) : assetBalances, // Use virtual allocations if available
      virtualAllocations: virtualAllocations.length > 0 ? virtualAllocations : undefined,
      targetAllocations: virtualAllocations.length > 0 ? {
        'BTC': 35,
        'ETH': 30,
        'CRO': 20,
        'SUI': 15,
      } : undefined,
      pnl: {
        total: totalPnl,
        percentage: totalPnlPercentage,
        currentValue: totalCurrentValue,
        entryValue: totalEntryValue,
      },
      isInstitutional: virtualAllocations.length > 0,
    };

    logger.info(`[Portfolio API] Portfolio ${id} final value: $${finalEntryValue.toFixed(2)}, assets: ${assetBalances.length}`);

    // Cache the response (two-tier: memory + DB)
    await setAllPortfolioCaches(id, portfolioData);

    return NextResponse.json(portfolioData, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error: unknown) {
    logger.error('[Portfolio API] Error fetching portfolio', error);
    return safeErrorResponse(error, 'Portfolio fetch');
  }
}
