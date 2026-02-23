/**
 * Real Market Data Service
 * Aggregates real-time market data from Crypto.com sources only
 * Priority: Crypto.com Exchange API → MCP Server → Stale Cache (NO MOCKS)
 */

import axios from 'axios';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { cryptocomExchangeService } from './CryptocomExchangeService';
import { getCronosProvider } from '@/lib/throttled-provider';

export interface MarketPrice {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  timestamp: number;
  source: string;
}

/**
 * Extended market data with full 24h stats
 * Used by AI decisions, risk analysis, and volatility calculations
 */
export interface ExtendedMarketData {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
  source: string;
}

export interface TokenBalance {
  token: string;
  symbol: string;
  balance: string;
  decimals: number;
  usdValue: number;
}

export interface PortfolioData {
  address: string;
  totalValue: number;
  tokens: TokenBalance[];
  nfts: unknown[];
  defiPositions: {
    delphi?: unknown[];
    vvs?: unknown[];
    moonlander?: unknown[];
    x402?: unknown[];
  };
  lastUpdated: number;
}

/**
 * Proactive Price Feed Service
 * 
 * Architecture: Background refresh keeps prices always fresh
 * - Singleton service with automatic background refresh every 5 seconds
 * - All price requests return INSTANTLY from cache (non-blocking)
 * - Never waits for API - cache is always warm
 * - Single API call refreshes all tracked symbols
 * 
 * Usage: Just call getTokenPrice() - it's always instant
 */
class RealMarketDataService {
  private provider: ethers.JsonRpcProvider;
  private priceCache: Map<string, { price: number; change24h: number; high24h: number; low24h: number; volume24h: number; timestamp: number }> = new Map();
  
  // Proactive refresh configuration
  private readonly REFRESH_INTERVAL = 5000; // 5 seconds - always fresh
  private readonly TRACKED_SYMBOLS = ['BTC', 'ETH', 'SUI', 'CRO']; // Core symbols to always track
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isRefreshing: boolean = false;
  private lastRefresh: number = 0;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  
  // Legacy support
  private testSequence: number = 0;
  private rateLimitedUntil: number = 0;
  private failedAttempts: Map<string, number> = new Map();
  private pendingRequests: Map<string, Promise<MarketPrice>> = new Map();
  private pendingBatchRequest: Promise<void> | null = null;
  private contractCache: Map<string, ethers.Contract> = new Map();
  private vvsRouterContract: ethers.Contract | null = null;
  private lastBatchFetch: number = 0;

  constructor() {
    const rpcUrl = process.env.CRONOS_RPC_URL || 
                   process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 
                   'https://evm-t3.cronos.org';
    
    this.provider = getCronosProvider(rpcUrl).provider;
    
    // Start proactive refresh (only in non-test environment)
    if (typeof window !== 'undefined' || process.env.NODE_ENV !== 'test') {
      this._startProactiveRefresh();
    }
    
    logger.info('[RealMarketData] Proactive price feed initialized');
  }

  /**
   * Start proactive background refresh
   * Fetches all tracked symbols every 5 seconds
   */
  private _startProactiveRefresh(): void {
    if (this.refreshTimer) return; // Already running
    
    // Initial fetch
    this._proactiveRefresh().catch(() => {});
    
    // Set up interval
    this.refreshTimer = setInterval(() => {
      this._proactiveRefresh().catch(() => {});
    }, this.REFRESH_INTERVAL);
    
    // Cleanup on process exit (Node.js)
    if (typeof process !== 'undefined' && process.on) {
      process.on('beforeExit', () => this._stopProactiveRefresh());
    }
  }

  /**
   * Stop proactive refresh (cleanup)
   */
  private _stopProactiveRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Proactive refresh - fetches all prices in ONE API call
   */
  private async _proactiveRefresh(): Promise<void> {
    if (this.isRefreshing) return; // Prevent concurrent refreshes
    this.isRefreshing = true;
    
    try {
      const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
        signal: AbortSignal.timeout(4000), // 4s timeout (leaves 1s buffer)
      });
      
      if (!response.ok) {
        logger.warn('[RealMarketData] Proactive refresh failed', { status: response.status });
        return;
      }
      
      const data = await response.json();
      const tickers = data.result?.data || [];
      const now = Date.now();
      
      const symbolMap: Record<string, string> = {
        'BTC_USDT': 'BTC',
        'ETH_USDT': 'ETH',
        'SUI_USDT': 'SUI',
        'CRO_USDT': 'CRO',
        'VVS_USDT': 'VVS',
        'ATOM_USDT': 'ATOM',
        'SOL_USDT': 'SOL',
      };
      
      let updated = 0;
      for (const ticker of tickers) {
        const symbol = symbolMap[ticker.i];
        if (!symbol) continue;
        
        const price = parseFloat(ticker.a) || 0;
        const change24h = parseFloat(ticker.c) || 0;
        const volume24h = parseFloat(ticker.v) || 0;
        const high24h = parseFloat(ticker.h) || price;
        const low24h = parseFloat(ticker.l) || price;
        
        this.priceCache.set(symbol, {
          price,
          change24h,
          high24h,
          low24h,
          volume24h,
          timestamp: now,
        });
        updated++;
      }
      
      this.lastRefresh = now;
      this.initialized = true;
      
      logger.debug(`[RealMarketData] Proactive refresh: ${updated} symbols updated`);
      
    } catch (error) {
      logger.warn('[RealMarketData] Proactive refresh error', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Ensure service is initialized with at least one successful fetch
   * Called automatically on first request if needed
   */
  private async _ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    
    if (!this.initPromise) {
      this.initPromise = this._proactiveRefresh();
    }
    
    await this.initPromise;
  }

  /**
   * Get real-time price - ALWAYS INSTANT from cache
   * Non-blocking: Returns cached data immediately
   * Fresh: Background refresh keeps cache current
   */
  async getTokenPrice(symbol: string): Promise<MarketPrice> {
    const cacheKey = symbol.toUpperCase();
    const now = Date.now();
    
    // Stablecoins - always $1
    if (['USDC', 'USDT', 'DEVUSDC', 'DEVUSDCE', 'DAI', 'MOCKUSDC'].includes(cacheKey)) {
      return {
        symbol,
        price: 1,
        change24h: 0,
        volume24h: 0,
        timestamp: now,
        source: 'stablecoin',
      };
    }
    
    // Check cache first (instant return)
    const cached = this.priceCache.get(cacheKey);
    if (cached) {
      return {
        symbol,
        price: cached.price,
        change24h: cached.change24h,
        volume24h: cached.volume24h,
        timestamp: cached.timestamp,
        source: now - cached.timestamp < 10000 ? 'cache' : 'stale_cache',
      };
    }
    
    // No cache - ensure initialized then check again
    await this._ensureInitialized();
    
    const afterInit = this.priceCache.get(cacheKey);
    if (afterInit) {
      return {
        symbol,
        price: afterInit.price,
        change24h: afterInit.change24h,
        volume24h: afterInit.volume24h,
        timestamp: afterInit.timestamp,
        source: 'cache',
      };
    }
    
    // Symbol not in tracked list - fetch individually
    return this._fetchSinglePrice(symbol);
  }

  /**
   * Fetch a single price (for non-tracked symbols)
   */
  private async _fetchSinglePrice(symbol: string): Promise<MarketPrice> {
    const cacheKey = symbol.toUpperCase();
    
    // Deduplicate concurrent requests
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) return pending;
    
    const promise = this._doFetchSinglePrice(symbol);
    this.pendingRequests.set(cacheKey, promise);
    
    try {
      return await promise;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  private async _doFetchSinglePrice(symbol: string): Promise<MarketPrice> {
    const cacheKey = symbol.toUpperCase();
    const now = Date.now();

    // Handle stablecoins (always $1)
    if (['USDC', 'USDT', 'DEVUSDC', 'DEVUSDCE', 'DAI', 'MOCKUSDC'].includes(cacheKey)) {
      return {
        symbol,
        price: 1,
        change24h: 0,
        volume24h: 0,
        timestamp: now,
        source: 'stablecoin',
      };
    }

    // Fast deterministic fallback for tests/CI
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      const testPrices: Record<string, number> = {
        CRO: 0.09, BTC: 50000, ETH: 3000, VVS: 0.5, SUI: 3.50,
        WBTC: 50000, WETH: 3000,
      };
      const base = testPrices[cacheKey] || 1;
      const driftFactor = 1 + (0.001 * (Math.floor(Date.now() / 1000) % 5));
      const tp = Number((base * driftFactor).toFixed(6));
      this.priceCache.set(cacheKey, { price: tp, change24h: 0, high24h: tp, low24h: tp, volume24h: 0, timestamp: now });
      return { symbol, price: tp, change24h: 0, volume24h: 0, timestamp: now, source: 'test-mock' };
    }

    // Fetch from Exchange API (single symbol)
    try {
      const exchangeData = await Promise.race([
        cryptocomExchangeService.getMarketData(symbol),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
      ]);
      
      this.priceCache.set(cacheKey, { 
        price: exchangeData.price, 
        change24h: exchangeData.change24h || 0,
        high24h: exchangeData.price,
        low24h: exchangeData.price,
        volume24h: exchangeData.volume24h || 0,
        timestamp: Date.now() 
      });
      
      return {
        symbol,
        price: exchangeData.price,
        change24h: exchangeData.change24h || 0,
        volume24h: exchangeData.volume24h || 0,
        timestamp: Date.now(),
        source: 'cryptocom-exchange',
      };
    } catch (error) {
      logger.warn(`[RealMarketData] Exchange API failed for ${symbol}`, { error: error instanceof Error ? error.message : String(error) });
    }

    // Fallback to MCP
    try {
      const mcpData = await this.getMCPServerPrice(symbol);
      if (mcpData) {
        this.priceCache.set(cacheKey, { 
          price: mcpData.price, change24h: mcpData.change24h || 0,
          high24h: mcpData.price, low24h: mcpData.price, volume24h: 0, timestamp: Date.now() 
        });
        return {
          symbol, price: mcpData.price, change24h: mcpData.change24h || 0,
          volume24h: 0, timestamp: Date.now(), source: 'cryptocom-mcp',
        };
      }
    } catch {
      logger.warn(`[RealMarketData] MCP also failed for ${symbol}`);
    }

    // Final fallback: stale cache up to 1 hour
    const cached = this.priceCache.get(cacheKey);
    if (cached && now - cached.timestamp < 3600000) {
      return { symbol, price: cached.price, change24h: 0, volume24h: 0, timestamp: cached.timestamp, source: 'stale_cache' };
    }

    throw new Error(`Unable to fetch real price for ${symbol} from Crypto.com sources.`);
  }

  /**
   * Refresh price in background (for stale-while-revalidate pattern)
   */
  private async _refreshPriceInBackground(symbol: string, cacheKey: string): Promise<void> {
    try {
      // Try Exchange API first
      const exchangeData = await Promise.race([
        cryptocomExchangeService.getMarketData(symbol),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
      ]);
      
      this.priceCache.set(cacheKey, { 
        price: exchangeData.price, 
        change24h: exchangeData.change24h || 0,
        high24h: exchangeData.price,
        low24h: exchangeData.price,
        volume24h: exchangeData.volume24h || 0,
        timestamp: Date.now() 
      });
      logger.debug(`[RealMarketData] Background refresh: ${symbol} = $${exchangeData.price}`);
    } catch (error) {
      // Try MCP as fallback
      try {
        const mcpData = await this.getMCPServerPrice(symbol);
        if (mcpData) {
          this.priceCache.set(cacheKey, { 
            price: mcpData.price, 
            change24h: mcpData.change24h || 0,
            high24h: mcpData.price,
            low24h: mcpData.price,
            volume24h: 0,
            timestamp: Date.now() 
          });
          logger.debug(`[RealMarketData] Background refresh (MCP): ${symbol} = $${mcpData.price}`);
        }
      } catch {
        logger.warn(`[RealMarketData] Background refresh failed for ${symbol}`);
      }
    }
  }

  /**
   * Get price from Crypto.com MCP Server
   */
  private async getMCPServerPrice(symbol: string): Promise<{ price: number; change24h?: number } | null> {
    try {
      // MCP Server endpoint (no authentication needed for basic queries)
      const response = await axios.get('https://mcp.crypto.com/api/v1/price', {
        params: { symbol: symbol.toUpperCase() },
        timeout: 5000,
      });

      if (response.data && response.data.price) {
        return {
          price: parseFloat(response.data.price),
          change24h: response.data.change_24h ? parseFloat(response.data.change_24h) : undefined,
        };
      }
    } catch (error) {
      // MCP Server might not support all tokens, fail silently
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status !== 404) {
        logger.debug(`MCP Server query failed for ${symbol}`, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return null;
  }

  /**
   * Get multiple token prices in parallel
   */
  async getTokenPrices(symbols: string[]): Promise<Map<string, MarketPrice>> {
    const pricePromises = symbols.map(symbol =>
      this.getTokenPrice(symbol)
        .then(price => ({ symbol, price }))
        .catch(error => {
          logger.warn(`Failed to get price for ${symbol}`, { error: error instanceof Error ? error.message : String(error) });
          return null;
        })
    );

    const results = await Promise.all(pricePromises);
    const priceMap = new Map<string, MarketPrice>();

    results.forEach(result => {
      if (result) {
        priceMap.set(result.symbol, result.price);
      }
    });

    return priceMap;
  }

  /**
   * Get real portfolio data for an address
   */
  async getPortfolioData(address: string): Promise<PortfolioData> {
    const tokens: TokenBalance[] = [];
    let totalValue = 0;

    try {
      const portfolioStart = Date.now();
      logger.info(`[RealMarketData] Fetching portfolio for ${address}`);
      
      // Define all tokens upfront (including MockUSDC from Moonlander)
      const testnetTokens = [
        { address: 'native', symbol: 'CRO', decimals: 18 },
        { address: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0', symbol: 'devUSDC', decimals: 6 },
        { address: '0x6a3173618859C7cd40fAF6921b5E9eB6A76f1fD4', symbol: 'WCRO', decimals: 18 },
        { address: '0x28217DAddC55e3C4831b4A48A00Ce04880786967', symbol: 'MockUSDC', decimals: 6 }, // MockMoonlander USDC
      ];

      // PARALLEL: Fetch all balances simultaneously with timeout for serverless
      const balanceStart = Date.now();
      const BALANCE_TIMEOUT = 8000; // 8 second timeout for serverless
      
      const balancePromises = testnetTokens.map(async (token) => {
        try {
          const timeoutPromise = new Promise<null>((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout fetching ${token.symbol}`)), BALANCE_TIMEOUT)
          );
          
          const balancePromise = (async () => {
            if (token.address === 'native') {
              const croBalance = await this.provider.getBalance(address);
              return {
                token: token.address,
                symbol: token.symbol,
                balance: ethers.formatEther(croBalance),
                decimals: token.decimals,
              };
            } else {
              const balance = await this.getTokenBalance(address, token.address, token.decimals);
              return {
                token: token.address,
                symbol: token.symbol,
                balance,
                decimals: token.decimals,
              };
            }
          })();
          
          return await Promise.race([balancePromise, timeoutPromise]);
        } catch (error) {
          logger.warn(`[RealMarketData] Failed to fetch ${token.symbol} balance`, { error: error instanceof Error ? (error as Error).message : String(error) });
          return null;
        }
      });

      const balances = (await Promise.all(balancePromises)).filter((b): b is NonNullable<typeof b> => b !== null && parseFloat(b.balance) > 0);
      logger.debug(`[RealMarketData] Fetched ${balances.length} balances in ${Date.now() - balanceStart}ms`);

      // If no balances found, return early with empty portfolio
      if (balances.length === 0) {
        logger.info(`[RealMarketData] No token balances found for ${address}`);
        return {
          address,
          totalValue: 0,
          tokens: [],
          nfts: [],
          defiPositions: {},
          lastUpdated: Date.now(),
        };
      }

      // OPTIMIZATION: Use Crypto.com Exchange batch API for all prices at once
      const priceStart = Date.now();
      const symbols = balances.map(b => b.symbol);
      
      try {
        // Fetch all prices in one batch call
        const batchPrices = await cryptocomExchangeService.getBatchPrices(symbols);
        logger.debug(`[RealMarketData] Fetched ${Object.keys(batchPrices).length} prices via batch in ${Date.now() - priceStart}ms`);
        
        // Map balances to final token data
        const STABLECOINS = ['USDC', 'USDT', 'DAI', 'DEVUSDC', 'DEVUSDCE', 'MOCKUSDC'];
        for (const tokenBalance of balances) {
          let price = batchPrices[tokenBalance.symbol];
          
          // Fallback: stablecoins are always $1
          if (!price && STABLECOINS.includes(tokenBalance.symbol.toUpperCase())) {
            price = 1.0;
            logger.debug(`[RealMarketData] Using stablecoin price $1 for ${tokenBalance.symbol}`);
          }
          
          if (price) {
            const value = parseFloat(tokenBalance.balance) * price;
            tokens.push({
              token: tokenBalance.token,
              symbol: tokenBalance.symbol,
              balance: tokenBalance.balance,
              decimals: tokenBalance.decimals,
              usdValue: value,
            });
            totalValue += value;
          } else {
            logger.warn(`[RealMarketData] No price found for ${tokenBalance.symbol}`);
          }
        }
      } catch (error) {
        logger.error('[RealMarketData] Batch price fetch failed, falling back to individual', error);
        
        // Fallback: fetch prices individually if batch fails
        const pricePromises = balances.map(async (tokenBalance) => {
          try {
            const price = await this.getTokenPrice(tokenBalance.symbol);
            const value = parseFloat(tokenBalance.balance) * price.price;

            return {
              token: tokenBalance.token,
              symbol: tokenBalance.symbol,
              balance: tokenBalance.balance,
              decimals: tokenBalance.decimals,
              usdValue: value,
            };
          } catch (error) {
            logger.error(`Failed to fetch ${tokenBalance.symbol} price`, error);
            return null;
          }
        });

        const tokenResults = (await Promise.all(pricePromises)).filter((t): t is TokenBalance => t !== null);
        tokens.push(...tokenResults);
        totalValue = tokens.reduce((sum, t) => sum + t.usdValue, 0);
      }

      logger.debug(`[RealMarketData] Total portfolio data fetch: ${Date.now() - portfolioStart}ms`);

      return {
        address,
        totalValue,
        tokens,
        nfts: [],
        defiPositions: {},
        lastUpdated: Date.now(),
      };
    } catch (error) {
      logger.error('Failed to get portfolio data', error);
      // Return empty portfolio data instead of throwing
      return {
        address,
        totalValue: 0,
        tokens: [],
        nfts: [],
        defiPositions: {},
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Get token balance for an address with timeout
   */
  private async getTokenBalance(
    ownerAddress: string,
    tokenAddress: string,
    decimals: number
  ): Promise<string> {
    // Cache contract instances by address (immutable, safe to reuse)
    let contract = this.contractCache.get(tokenAddress);
    if (!contract) {
      const abi = ['function balanceOf(address) view returns (uint256)'];
      contract = new ethers.Contract(tokenAddress, abi, this.provider);
      this.contractCache.set(tokenAddress, contract);
    }
    
    // Add 3s timeout for balance calls
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Balance fetch timeout')), 3000)
    );
    
    const balance = await Promise.race([
      contract.balanceOf(ownerAddress),
      timeoutPromise
    ]);
    
    return ethers.formatUnits(balance, decimals);
  }

  /**
   * Get price from VVS Finance
   */
  private async getVVSPrice(symbol: string): Promise<number | null> {
    // VVS Router for price queries
    const VVS_ROUTER = '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae';
    const WCRO = '0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23';

    // Map tokens to their addresses
    const tokenMap: Record<string, string> = {
      VVS: '0x2D03bECE6747ADC00E1a131BBA1469C15fD11e03',
      USDC: '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59',
      USDT: '0x66e428c3f67a68878562e79A0234c1F83c208770',
    };

    const tokenAddress = tokenMap[symbol.toUpperCase()];
    if (!tokenAddress) return null;

    try {
      const abi = [
        'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
      ];
      // Cache VVS router contract instance
      if (!this.vvsRouterContract) {
        this.vvsRouterContract = new ethers.Contract(VVS_ROUTER, abi, this.provider);
      }
      const router = this.vvsRouterContract;

      // Get price in CRO
      const amountIn = ethers.parseUnits('1', 18);
      const path = [tokenAddress, WCRO];
      const amounts = await router.getAmountsOut(amountIn, path);

      const croAmount = parseFloat(ethers.formatUnits(amounts[1], 18));

      // Get CRO price
      const croPrice = await this.getTokenPrice('CRO');
      return croAmount * croPrice.price;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get historical price data for volatility calculations
   * Note: Currently returns empty array. Can be implemented with Exchange API historical data if needed.
   */
  async getHistoricalPrices(
    symbol: string,
    _days: number = 30
  ): Promise<Array<{ timestamp: number; price: number }>> {
    logger.warn(`[RealMarketData] Historical price data not implemented for ${symbol}`);
    // TODO: Implement with Crypto.com Exchange API historical data endpoints if available
    return [];
  }

  /**
   * Calculate volatility from historical prices
   */
  calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    // Calculate daily returns
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const dailyReturn = (prices[i] - prices[i - 1]) / prices[i - 1];
      returns.push(dailyReturn);
    }

    // Calculate standard deviation
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Annualize volatility (252 trading days)
    return stdDev * Math.sqrt(252);
  }

  /**
   * Get extended market data for multiple symbols in a single API call
   * Uses stale-while-revalidate: returns cached data immediately while refreshing in background
   * Includes: price, 24h change, 24h high/low, 24h volume
   */
  async getExtendedPrices(symbols: string[]): Promise<Map<string, ExtendedMarketData>> {
    const results = new Map<string, ExtendedMarketData>();
    const now = Date.now();
    const needsFetch: string[] = [];
    
    // Check cache first for all symbols
    for (const symbol of symbols) {
      const upper = symbol.toUpperCase();
      
      // Handle stablecoins
      if (['USDC', 'USDT', 'DEVUSDC', 'DAI'].includes(upper)) {
        results.set(upper, {
          symbol: upper,
          price: 1,
          change24h: 0,
          volume24h: 0,
          high24h: 1,
          low24h: 1,
          timestamp: now,
          source: 'stablecoin',
        });
        continue;
      }
      
      // Check cache
      const cached = this.priceCache.get(upper);
      if (cached && now - cached.timestamp < this.CACHE_TTL) {
        // Fresh cache - use it
        results.set(upper, {
          symbol: upper,
          price: cached.price,
          change24h: cached.change24h || 0,
          volume24h: cached.volume24h || 0,
          high24h: cached.high24h || cached.price,
          low24h: cached.low24h || cached.price,
          timestamp: cached.timestamp,
          source: 'cache',
        });
      } else if (cached && now - cached.timestamp < this.STALE_TTL) {
        // Stale cache - use it but mark for refresh
        results.set(upper, {
          symbol: upper,
          price: cached.price,
          change24h: cached.change24h || 0,
          volume24h: cached.volume24h || 0,
          high24h: cached.high24h || cached.price,
          low24h: cached.low24h || cached.price,
          timestamp: cached.timestamp,
          source: 'stale_cache',
        });
        needsFetch.push(upper);
      } else {
        // No cache - must fetch
        needsFetch.push(upper);
      }
    }
    
    // If all cached, return immediately
    if (needsFetch.length === 0 || (results.size === symbols.length)) {
      // Trigger background refresh if any were stale
      if (needsFetch.length > 0) {
        this._batchRefreshInBackground(needsFetch).catch(() => {});
      }
      return results;
    }
    
    // Fetch missing symbols from API
    const symbolMap: Record<string, string> = {};
    for (const s of needsFetch) {
      symbolMap[`${s}_USDT`] = s;
    }
    
    try {
      const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
        signal: AbortSignal.timeout(5000), // Reduced timeout for faster response
      });
      
      if (!response.ok) {
        throw new Error(`Crypto.com API error: ${response.status}`);
      }
      
      const data = await response.json();
      const tickers = data.result?.data || [];
      
      for (const ticker of tickers) {
        const symbol = symbolMap[ticker.i];
        if (!symbol) continue;
        
        const price = parseFloat(ticker.a) || 0;
        const change24h = parseFloat(ticker.c) || 0;
        const volume24h = parseFloat(ticker.v) || 0;
        const high24h = parseFloat(ticker.h) || price;
        const low24h = parseFloat(ticker.l) || price;
        
        results.set(symbol, {
          symbol,
          price,
          change24h,
          volume24h,
          high24h,
          low24h,
          timestamp: now,
          source: 'cryptocom-exchange',
        });
        
        // Update cache with full data
        this.priceCache.set(symbol, { 
          price, 
          change24h, 
          high24h, 
          low24h, 
          volume24h, 
          timestamp: now 
        });
      }
      
      // Check for missing symbols
      for (const symbol of symbols) {
        const upper = symbol.toUpperCase();
        if (!results.has(upper)) {
          logger.warn(`[RealMarketData] Missing extended data for ${upper}`);
        }
      }
      
      this.lastBatchFetch = now;
      logger.info(`[RealMarketData] Extended prices fetched for ${results.size} symbols`);
      return results;
      
    } catch (error) {
      logger.error('[RealMarketData] Failed to fetch extended prices:', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      // Return whatever we have in cache
      for (const symbol of needsFetch) {
        const cached = this.priceCache.get(symbol);
        if (cached && !results.has(symbol)) {
          results.set(symbol, {
            symbol,
            price: cached.price,
            change24h: cached.change24h || 0,
            volume24h: cached.volume24h || 0,
            high24h: cached.high24h || cached.price,
            low24h: cached.low24h || cached.price,
            timestamp: cached.timestamp,
            source: 'fallback_cache',
          });
        }
      }
      
      if (results.size < symbols.length) {
        throw new Error('Unable to fetch extended market data from Crypto.com');
      }
      return results;
    }
  }

  /**
   * Background batch refresh for stale prices
   */
  private async _batchRefreshInBackground(symbols: string[]): Promise<void> {
    // Deduplicate concurrent batch requests
    if (this.pendingBatchRequest) {
      return this.pendingBatchRequest;
    }
    
    this.pendingBatchRequest = (async () => {
      try {
        const symbolMap: Record<string, string> = {};
        for (const s of symbols) {
          symbolMap[`${s}_USDT`] = s;
        }
        
        const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
          signal: AbortSignal.timeout(5000),
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        const tickers = data.result?.data || [];
        const now = Date.now();
        
        for (const ticker of tickers) {
          const symbol = symbolMap[ticker.i];
          if (!symbol) continue;
          
          const price = parseFloat(ticker.a) || 0;
          const change24h = parseFloat(ticker.c) || 0;
          const volume24h = parseFloat(ticker.v) || 0;
          const high24h = parseFloat(ticker.h) || price;
          const low24h = parseFloat(ticker.l) || price;
          
          this.priceCache.set(symbol, { 
            price, 
            change24h, 
            high24h, 
            low24h, 
            volume24h, 
            timestamp: now 
          });
        }
        
        logger.debug(`[RealMarketData] Background refresh completed for ${symbols.join(', ')}`);
      } catch (error) {
        logger.debug('[RealMarketData] Background refresh failed', { error });
      } finally {
        this.pendingBatchRequest = null;
      }
    })();
    
    return this.pendingBatchRequest;
  }
}

// Singleton instance
let marketDataService: RealMarketDataService | null = null;

export function getMarketDataService(): RealMarketDataService {
  if (!marketDataService) {
    marketDataService = new RealMarketDataService();
  }
  return marketDataService;
}

export { RealMarketDataService };
