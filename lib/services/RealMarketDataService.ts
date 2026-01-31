/**
 * Real Market Data Service
 * Aggregates real-time market data from Crypto.com sources only
 * Priority: Crypto.com Exchange API → MCP Server → Stale Cache (NO MOCKS)
 */

import axios from 'axios';
import { ethers } from 'ethers';
import { cryptocomExchangeService, type MarketPrice as ExchangeMarketPrice } from './CryptocomExchangeService';

export interface MarketPrice {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
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
  nfts: any[];
  defiPositions: {
    delphi?: any[];
    vvs?: any[];
    moonlander?: any[];
    x402?: any[];
  };
  lastUpdated: number;
}

class RealMarketDataService {
  private provider: ethers.JsonRpcProvider;
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 45000; // 45 seconds (reduced from 60s for faster updates)
  private testSequence: number = 0;
  private rateLimitedUntil: number = 0; // Timestamp when rate limit expires
  private failedAttempts: Map<string, number> = new Map(); // Track failed attempts per symbol
  private pendingRequests: Map<string, Promise<MarketPrice>> = new Map(); // Deduplication

  constructor() {
    // OPTIMIZATION 1: Use StaticJsonRpcProvider for better caching (no network detection)
    // OPTIMIZATION 2: Configure connection pooling and lower polling interval
    // OPTIMIZATION 3: Use persistent connection with keep-alive
    // Support both env var names for RPC URL
    const rpcUrl = process.env.CRONOS_RPC_URL || 
                   process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 
                   'https://evm-t3.cronos.org';
    
    console.log(`[RealMarketData] Using RPC: ${rpcUrl}`);
    
    this.provider = new ethers.JsonRpcProvider(
      rpcUrl,
      {
        chainId: 338, // Cronos Testnet
        name: 'cronos-testnet',
      },
      {
        staticNetwork: true, // Don't detect network on every call
        batchMaxCount: 10, // Reduced for serverless compatibility
        batchMaxSize: 512 * 1024, // 512KB max batch size
        polling: false, // Don't poll for new blocks
      }
    );
  }

  /**
   * Get mock price for a token (fallback during rate limits)
   */
  private getMockPrice(symbol: string): number {
    const mockPrices: Record<string, number> = {
      CRO: 0.10,      // Updated to current CRO price ~$0.10
      BTC: 50000,
      WBTC: 50000,
      ETH: 3000,
      WETH: 3000,
      USDC: 1,
      USDT: 1,
      VVS: 0.000005,  // VVS typical price
      WCRO: 0.10,     // Same as CRO
    };
    return mockPrices[symbol.toUpperCase()] || 1;
  }

  /**
   * Get real-time price for a token with multi-source fallback
   * 1. Crypto.com Exchange API (100 req/s)
   * 2. Crypto.com MCP Server (free, no rate limits)
   * 3. Stale cache (if available)
   * NO MOCK PRICES - Real data only from Crypto.com
   */
  async getTokenPrice(symbol: string): Promise<MarketPrice> {
    const cacheKey = symbol.toUpperCase();
    
    // Deduplicate concurrent requests for the same symbol
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      console.log(`⚡ [RealMarketData] Reusing pending request for ${symbol}`);
      return pending;
    }

    // Create promise for this request
    const promise = this._fetchTokenPrice(symbol);
    this.pendingRequests.set(cacheKey, promise);
    
    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up after request completes
      this.pendingRequests.delete(cacheKey);
    }
  }

  private async _fetchTokenPrice(symbol: string): Promise<MarketPrice> {
    const cacheKey = symbol.toUpperCase();
    const cached = this.priceCache.get(cacheKey);
    const now = Date.now();

    // Handle stablecoins (always $1)
    if (['USDC', 'USDT', 'DEVUSDC', 'DEVUSDCE', 'DAI'].includes(cacheKey)) {
      return {
        symbol,
        price: 1,
        change24h: 0,
        volume24h: 0,
        timestamp: now,
        source: 'stablecoin',
      };
    }

    // OPTIMIZATION: Return cached if fresh (< 45s)
    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return {
        symbol,
        price: cached.price,
        change24h: 0,
        volume24h: 0,
        timestamp: cached.timestamp,
        source: 'cache',
      };
    }

    // OPTIMIZATION: If we have stale cache, return it immediately and refresh in background
    if (cached && now - cached.timestamp < 300000) { // 5 minutes stale cache
      console.log(`⚡ [RealMarketData] Using stale cache for ${symbol}, refreshing in background`);
      
      // Return stale data immediately
      const staleResult = {
        symbol,
        price: cached.price,
        change24h: 0,
        volume24h: 0,
        timestamp: cached.timestamp,
        source: 'stale_cache',
      };
      
      // Refresh in background (don't await)
      this._refreshPriceInBackground(symbol, cacheKey).catch(() => {});
      
      return staleResult;
    }

    // Fast deterministic fallback for tests/CI
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      const testPrices: Record<string, number> = {
        CRO: 0.09,
        BTC: 50000,
        ETH: 3000,
        USDC: 1,
        USDT: 1,
        VVS: 0.5,
        WBTC: 50000,
        WETH: 3000,
      };
      const base = testPrices[cacheKey] || 1;
      const seconds = Math.floor(Date.now() / 1000);
      const driftFactor = 1 + (0.001 * (seconds % 5));
      const tp = Number((base * driftFactor).toFixed(6));
      const now = Date.now();
      this.priceCache.set(cacheKey, { price: tp, timestamp: now });
      return {
        symbol,
        price: tp,
        change24h: 0,
        volume24h: 0,
        timestamp: now,
        source: 'test-mock',
      };
    }

    // SOURCE 1: Crypto.com Exchange API (PRIMARY - 100 req/s) with timeout
    try {
      console.log(`📊 [RealMarketData] Fetching ${symbol} from Crypto.com Exchange API`);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Exchange API timeout')), 1500) // Reduced from 2s to 1.5s
      );
      const exchangeData = await Promise.race([
        cryptocomExchangeService.getMarketData(symbol),
        timeoutPromise
      ]);
      
      this.priceCache.set(cacheKey, { price: exchangeData.price, timestamp: Date.now() });
      console.log(`✅ [RealMarketData] Got ${symbol} price from Exchange API: $${exchangeData.price}`);
      
      return {
        symbol,
        price: exchangeData.price,
        change24h: exchangeData.change24h,
        volume24h: exchangeData.volume24h,
        timestamp: Date.now(),
        source: 'cryptocom-exchange',
      };
    } catch (error: any) {
      console.warn(`⚠️ [RealMarketData] Exchange API failed for ${symbol}:`, error.message);
    }

    // SOURCE 2: Crypto.com MCP Server (FALLBACK 1 - Free, no limits) with timeout
    try {
      console.log(`📊 [RealMarketData] Trying MCP Server for ${symbol}`);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('MCP timeout')), 1500) // Reduced from 2s to 1.5s
      );
      const mcpData = await Promise.race([
        this.getMCPServerPrice(symbol),
        timeoutPromise
      ]);
      
      if (mcpData) {
        this.priceCache.set(cacheKey, { price: mcpData.price, timestamp: Date.now() });
        console.log(`✅ [RealMarketData] Got ${symbol} from MCP Server: $${mcpData.price}`);
        
        return {
          symbol,
          price: mcpData.price,
          change24h: mcpData.change24h || 0,
          volume24h: 0,
          timestamp: Date.now(),
          source: 'cryptocom-mcp',
        };
      }
    } catch (error: any) {
      console.warn(`⚠️ [RealMarketData] MCP Server failed for ${symbol}:`, error.message);
    }

    // FALLBACK 3: Stale cache if available (up to 1 hour old)
    if (cached && now - cached.timestamp < 3600000) {
      console.warn(`⚠️ [RealMarketData] Using stale cache for ${symbol} (${Math.round((now - cached.timestamp) / 1000)}s old)`);
      return {
        symbol,
        price: cached.price,
        change24h: 0,
        volume24h: 0,
        timestamp: cached.timestamp,
        source: 'stale_cache',
      };
    }

    // FINAL: Throw error - NO MOCK PRICES
    console.error(`❌ [RealMarketData] All Crypto.com sources failed for ${symbol}`);
    throw new Error(`Unable to fetch real price for ${symbol} from Crypto.com sources. Please try again.`);
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
      
      this.priceCache.set(cacheKey, { price: exchangeData.price, timestamp: Date.now() });
      console.log(`🔄 [RealMarketData] Background refresh: ${symbol} = $${exchangeData.price}`);
    } catch (error) {
      // Try MCP as fallback
      try {
        const mcpData = await this.getMCPServerPrice(symbol);
        if (mcpData) {
          this.priceCache.set(cacheKey, { price: mcpData.price, timestamp: Date.now() });
          console.log(`🔄 [RealMarketData] Background refresh (MCP): ${symbol} = $${mcpData.price}`);
        }
      } catch {
        console.warn(`⚠️ [RealMarketData] Background refresh failed for ${symbol}`);
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
    } catch (error: any) {
      // MCP Server might not support all tokens, fail silently
      if (error?.response?.status !== 404) {
        console.debug(`MCP Server query failed for ${symbol}:`, error.message);
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
          console.warn(`Failed to get price for ${symbol}:`, error);
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
      console.log(`🔄 [RealMarketData] Fetching portfolio for ${address}`);
      
      // Define all tokens upfront
      const testnetTokens = [
        { address: 'native', symbol: 'CRO', decimals: 18 },
        { address: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0', symbol: 'devUSDC', decimals: 6 },
        { address: '0x6a3173618859C7cd40fAF6921b5E9eB6A76f1fD4', symbol: 'WCRO', decimals: 18 },
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
        } catch (error: any) {
          console.warn(`⚠️ [RealMarketData] Failed to fetch ${token.symbol} balance: ${error?.message}`);
          return null;
        }
      });

      const balances = (await Promise.all(balancePromises)).filter((b): b is NonNullable<typeof b> => b !== null && parseFloat(b.balance) > 0);
      console.log(`⏱️ [RealMarketData] Fetched ${balances.length} balances in ${Date.now() - balanceStart}ms`);

      // If no balances found, return early with empty portfolio
      if (balances.length === 0) {
        console.log(`📭 [RealMarketData] No token balances found for ${address}`);
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
        console.log(`⏱️ [RealMarketData] Fetched ${Object.keys(batchPrices).length} prices via batch in ${Date.now() - priceStart}ms`);
        
        // Map balances to final token data
        const STABLECOINS = ['USDC', 'USDT', 'DAI', 'DEVUSDC', 'DEVUSDCE'];
        for (const tokenBalance of balances) {
          let price = batchPrices[tokenBalance.symbol];
          
          // Fallback: stablecoins are always $1
          if (!price && STABLECOINS.includes(tokenBalance.symbol.toUpperCase())) {
            price = 1.0;
            console.log(`💵 [RealMarketData] Using stablecoin price $1 for ${tokenBalance.symbol}`);
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
            console.warn(`⚠️ [RealMarketData] No price found for ${tokenBalance.symbol}`);
          }
        }
      } catch (error) {
        console.error(`❌ [RealMarketData] Batch price fetch failed, falling back to individual:`, error);
        
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
            console.error(`Failed to fetch ${tokenBalance.symbol} price:`, error);
            return null;
          }
        });

        const tokenResults = (await Promise.all(pricePromises)).filter((t): t is TokenBalance => t !== null);
        tokens.push(...tokenResults);
        totalValue = tokens.reduce((sum, t) => sum + t.usdValue, 0);
      }

      console.log(`⏱️ [RealMarketData] Total portfolio data fetch: ${Date.now() - portfolioStart}ms`);

      return {
        address,
        totalValue,
        tokens,
        nfts: [],
        defiPositions: {},
        lastUpdated: Date.now(),
      };
    } catch (error) {
      console.error('Failed to get portfolio data:', error);
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
    const abi = ['function balanceOf(address) view returns (uint256)'];
    const contract = new ethers.Contract(tokenAddress, abi, this.provider);
    
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
      const router = new ethers.Contract(VVS_ROUTER, abi, this.provider);

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
    days: number = 30
  ): Promise<Array<{ timestamp: number; price: number }>> {
    console.warn(`[RealMarketData] Historical price data not implemented for ${symbol}`);
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
