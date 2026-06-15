import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { getMarketDataService } from '@/lib/services/market-data/RealMarketDataService';
import { cryptocomExchangeService } from '@/lib/services/CryptocomExchangeService';
import { readLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { getCached, setCached } from '@/lib/db/ui-cache';

export const runtime = 'nodejs';

export const maxDuration = 10;
// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

// Two-tier cache: In-memory (fast) + DB (survives cold starts)
// LRU eviction to prevent memory bloat across many users
const MAX_POSITIONS_CACHE = 500;
const positionsCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

async function getDbCachedPositions(address: string): Promise<unknown | null> {
  try {
    return await getCached('portfolio', `positions:${address.toLowerCase()}`);
  } catch {
    return null;
  }
}

async function setAllPositionsCaches(address: string, data: unknown): Promise<void> {
  // LRU: evict oldest entries if at capacity
  if (positionsCache.size >= MAX_POSITIONS_CACHE && !positionsCache.has(address)) {
    const firstKey = positionsCache.keys().next().value;
    if (firstKey !== undefined) positionsCache.delete(firstKey);
  }
  positionsCache.delete(address); // refresh LRU position
  positionsCache.set(address, { data, timestamp: Date.now() });
  setCached('portfolio', `positions:${address.toLowerCase()}`, data, CACHE_TTL).catch(err => logger.warn('Positions cache write failed', { error: String(err) }));
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = readLimiter.check(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    
    if (!address) {
      return NextResponse.json(
        { error: 'Address parameter is required' },
        { status: 400 }
      );
    }

    // Accept EVM (40 hex) and SUI (64 hex) addresses
    if (!/^0x[a-fA-F0-9]{40,64}$/.test(address)) {
      return NextResponse.json(
        { error: 'Invalid address format' },
        { status: 400 }
      );
    }

    // SUI addresses (>40 hex chars): return the user's full SUI portfolio —
    // their Community Pool share PLUS native wallet coin balances (USDC,
    // SUI, wBTC, wETH). Before this fix the route short-circuited to
    // totalValue=0, so the dashboard overview rendered "$0.00" even when
    // the user held 23.43 pool shares ($43.88) plus $10.61 USDC in their
    // wallet ready to deposit. Cached 30 s server-side.
    if (address.length > 42) {
      try {
        const [{ getSuiUsdcPoolService }, { getMarketDataService }] = await Promise.all([
          import('@/lib/services/sui/SuiCommunityPoolService'),
          import('@/lib/services/market-data/RealMarketDataService'),
        ]);
        const service = getSuiUsdcPoolService('mainnet');
        const mds = getMarketDataService();

        // 1) Pool share + 2) wallet coin balances + 3) live prices, all in parallel
        const rpcUrl = (process.env.SUI_MAINNET_RPC || 'https://fullnode.mainnet.sui.io:443').trim();
        const balancesP = fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getAllBalances', params: [address] }),
        }).then(r => r.json()).then(j => (j.result as Array<{ coinType: string; totalBalance: string }>) || []).catch(() => []);

        const [stats, user, balances, pBtc, pEth, pSui] = await Promise.all([
          service.getPoolStats(),
          service.getMemberPosition(address),
          balancesP,
          mds.getTokenPrice('BTC').then(p => p?.price ?? 0).catch(() => 0),
          mds.getTokenPrice('ETH').then(p => p?.price ?? 0).catch(() => 0),
          mds.getTokenPrice('SUI').then(p => p?.price ?? 0).catch(() => 0),
        ]);

        // Coin type catalog — canonical 64-char address form
        const canon = (t: string) => {
          const parts = t.split('::');
          if (parts.length !== 3) return t;
          let a = parts[0].replace(/^0x/, '').toLowerCase();
          if (a.length < 64) a = a.padStart(64, '0');
          return `0x${a}::${parts[1]}::${parts[2]}`;
        };
        const CATALOG: Record<string, { symbol: string; name: string; dec: number; price: number }> = {
          [canon('0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC')]: { symbol: 'USDC', name: 'USD Coin', dec: 6, price: 1 },
          [canon('0x2::sui::SUI')]: { symbol: 'SUI', name: 'Sui', dec: 9, price: pSui },
          [canon('0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN')]: { symbol: 'wBTC', name: 'Wrapped Bitcoin', dec: 8, price: pBtc },
          [canon('0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN')]: { symbol: 'wETH', name: 'Wrapped Ether', dec: 8, price: pEth },
        };

        const positions: Array<Record<string, unknown>> = [];
        let totalValue = 0;

        // Pool share
        const shares = Number(user?.shares ?? 0);
        const shareValueUsd = Number(user?.valueUsd ?? 0);
        const sharePrice = Number(stats?.sharePriceUsd ?? stats?.sharePrice ?? 1);
        if (shares > 0) {
          positions.push({
            id: 'sui-community-pool',
            symbol: 'SUIPOOL',
            name: 'SUI Community Pool (USDC)',
            chain: 'sui',
            network: 'mainnet',
            type: 'pool-share',
            shares,
            balance: shares,
            price: sharePrice,
            currentValue: shareValueUsd,
            value: shareValueUsd,
            valueUsd: shareValueUsd,
            percentage: Number(user?.percentage ?? 0),
            poolNav: Number(stats?.totalNAVUsd ?? stats?.totalNAV ?? 0),
            poolMembers: Number(stats?.memberCount ?? 0),
            joinedAt: Number(user?.joinedAt ?? 0),
            isMember: !!user?.isMember,
          });
          totalValue += shareValueUsd;
        }

        // Wallet coin balances (USDC, SUI, wBTC, wETH)
        for (const b of balances) {
          const meta = CATALOG[canon(b.coinType)];
          if (!meta) continue;
          const amount = Number(b.totalBalance) / Math.pow(10, meta.dec);
          if (amount <= 0) continue;
          const value = amount * meta.price;
          // Skip dust (< $0.01) to keep the UI uncluttered
          if (value < 0.01 && meta.symbol !== 'SUI') continue;
          positions.push({
            id: `wallet-${meta.symbol.toLowerCase()}`,
            symbol: meta.symbol,
            name: meta.name,
            chain: 'sui',
            network: 'mainnet',
            type: 'wallet-balance',
            balance: amount,
            shares: amount,
            price: meta.price,
            currentValue: value,
            value,
            valueUsd: value,
          });
          totalValue += value;
        }

        const payload = {
          address,
          totalValue,
          positions,
          lastUpdated: Date.now(),
          chain: 'sui',
        };
        await setAllPositionsCaches(address, payload);
        return NextResponse.json(payload);
      } catch (err) {
        logger.warn('[Positions API] SUI position lookup failed', { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json({
          address,
          totalValue: 0,
          positions: [],
          lastUpdated: Date.now(),
          chain: 'sui',
        });
      }
    }

    // Check cache first (two-tier: memory → DB)
    const memCached = positionsCache.get(address);
    if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
      logger.info(`[Positions API] Memory cache HIT for ${address}`);
      return NextResponse.json(memCached.data);
    }
    
    // Tier 2: DB cache (survives cold starts)
    const dbCached = await getDbCachedPositions(address);
    if (dbCached) {
      positionsCache.set(address, { data: dbCached, timestamp: Date.now() });
      logger.info(`[Positions API] DB cache HIT (cold start recovery) for ${address}`);
      return NextResponse.json(dbCached);
    }

    logger.info(`[Positions API] Cache MISS - fetching positions for ${address}`);
    const startTime = Date.now();
    
    const marketData = getMarketDataService();
    const portfolioDataStart = Date.now();
    const portfolioData = await marketData.getPortfolioData(address);
    logger.info(`[Positions API] Portfolio data fetched in ${Date.now() - portfolioDataStart}ms`);
    
    logger.info(`[Positions API] Found ${portfolioData.tokens.length} tokens, total value: $${portfolioData.totalValue}`);
    
    // Get extended prices with 24h high/low for volatility calculation - SINGLE BATCH
    // Using multi-source fallback: Crypto.com Exchange API → MCP → VVS → Cache → Mock
    const pricesStart = Date.now();
    const symbols = portfolioData.tokens.map(t => t.symbol);
    const extendedPrices = await marketData.getExtendedPrices(symbols);
    
    const positionsWithPrices = portfolioData.tokens.map((token) => {
      const priceData = extendedPrices.get(token.symbol.toUpperCase());
      
      if (priceData && priceData.price > 0) {
        // Calculate real volatility from 24h price range
        // Intraday volatility = (high - low) / price (annualized ≈ × √252)
        const range = priceData.high24h - priceData.low24h;
        const intradayVol = priceData.price > 0 ? range / priceData.price : 0;
        const annualizedVol = intradayVol * Math.sqrt(252); // Annualize
        
        logger.info(`[Positions API] ${token.symbol}: $${priceData.price} vol=${(annualizedVol * 100).toFixed(1)}% from [${priceData.source}]`);
        
        return {
          symbol: token.symbol,
          balance: token.balance,
          balanceUSD: token.usdValue.toFixed(2),
          price: priceData.price.toFixed(2),
          change24h: priceData.change24h,
          high24h: priceData.high24h,
          low24h: priceData.low24h,
          volatility: annualizedVol, // Real volatility from market data
          token: token.token,
          source: priceData.source,
        };
      }
      
      // Fallback with default volatility
      logger.info(`[Positions API] ${token.symbol}: fallback (no market data)`);
      return {
        symbol: token.symbol,
        balance: token.balance,
        balanceUSD: token.usdValue.toFixed(2),
        price: (token.usdValue / parseFloat(token.balance || '1')).toFixed(2),
        change24h: 0,
        high24h: 0,
        low24h: 0,
        volatility: 0.30, // Default 30% for unknown tokens
        token: token.token,
        source: 'fallback',
      };
    });
    logger.info(`[Positions API] All prices fetched in ${Date.now() - pricesStart}ms`);
    
    // Sort by USD value descending
    positionsWithPrices.sort((a, b) => parseFloat(b.balanceUSD) - parseFloat(a.balanceUSD));
    
    // Check Exchange API health (don't await - run in parallel)
    const exchangeHealthPromise = cryptocomExchangeService.healthCheck();
    
    const response = {
      address: portfolioData.address,
      totalValue: portfolioData.totalValue,
      positions: positionsWithPrices,
      lastUpdated: portfolioData.lastUpdated,
      health: {
        exchangeAPI: await exchangeHealthPromise,
        timestamp: Date.now(),
      },
    };

    // Cache the response (two-tier: memory + DB)
    await setAllPositionsCaches(address, response);
    logger.info(`[Positions API] Cached positions (memory + DB) for ${address}`);
    logger.info(`[Positions API] Total request time: ${Date.now() - startTime}ms`);
    
    // Return with SWR cache headers for smooth UI
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
        'Vary': 'Accept-Encoding',
      },
    });
  } catch (error: unknown) {
    return safeErrorResponse(error, 'Positions fetch');
  }
}
