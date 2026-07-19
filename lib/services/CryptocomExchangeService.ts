/**
 * Crypto.com Exchange API Service
 * High-performance market data from Crypto.com Exchange
 * Rate limit: 100 requests per second per IP
 */

import { logger } from '@/lib/utils/logger';

export interface ExchangeTicker {
  instrument_name: string;
  h: string; // 24h high
  l: string; // 24h low
  a: string; // Latest price
  c: string; // 24h price change
  b: string; // Best bid
  k: string; // Best ask
  v: string; // 24h volume
  vv: string; // 24h volume value (USD)
  oi: string; // Open interest
  t: number; // Timestamp
}

export interface ExchangeTickerResponse {
  code: number;
  method: string;
  result: {
    data: ExchangeTicker[];
  };
}

export interface MarketPrice {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
  source: 'cryptocom-exchange';
}

class CryptocomExchangeService {
  private readonly BASE_URL = 'https://api.crypto.com/exchange/v1';
  private readonly DEFAULT_TIMEOUT_MS = 2000;
  private priceCache: Map<string, { price: MarketPrice; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds (aggressive caching for high performance)

  // Small fetch wrapper — carries baseURL, JSON parsing, and status-200-only
  // enforcement. Replaces the axios.create()+interceptor pattern with the
  // 3 features we actually used: baseURL, validateStatus, error logging.
  private async fetchJson<T>(
    path: string,
    params?: Record<string, string>,
    timeoutMs: number = this.DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const url = new URL(this.BASE_URL + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      logger.error('API Error', err, { component: 'CryptocomExchange' });
      throw err;
    }
    if (response.status !== 200) {
      const err = new Error(`Crypto.com Exchange returned ${response.status}`);
      logger.error('API Error', err, { component: 'CryptocomExchange', status: response.status });
      throw err;
    }
    return response.json() as Promise<T>;
  }
  
  // Symbol mapping: internal symbol → exchange instrument name
  private readonly SYMBOL_MAP: Record<string, string> = {
    'BTC': 'BTC_USD',
    'BITCOIN': 'BTC_USD',
    'WBTC': 'BTC_USD',  // Wrapped BTC (1:1 with BTC)
    'ETH': 'ETH_USD',
    'ETHEREUM': 'ETH_USD',
    'WETH': 'ETH_USD',  // Wrapped ETH (1:1 with ETH)
    'CRO': 'CRO_USD',
    'CRONOS': 'CRO_USD',
    'WCRO': 'CRO_USD',  // Wrapped CRO (1:1 with CRO)
    'USDT': 'USDT_USD',
    'USDC': 'USDC_USD',
    'MATIC': 'MATIC_USD',
    'POLYGON': 'MATIC_USD',
    'SOL': 'SOL_USD',
    'SOLANA': 'SOL_USD',
    'ADA': 'ADA_USD',
    'CARDANO': 'ADA_USD',
    'DOT': 'DOT_USD',
    'POLKADOT': 'DOT_USD',
    'ATOM': 'ATOM_USD',
    'COSMOS': 'ATOM_USD',
    'SUI': 'SUI_USD',
  };

  // Testnet tokens that should return $1 without API call
  private readonly TESTNET_STABLECOINS = new Set([
    'DEVUSDC', 'DEVUSDCE', 'TESTUSDC', 'TESTWETH', 'TESTCRO',
  ]);

  // No axios instance — fetchJson() above bundles baseURL + timeout + JSON
  // parsing + 200-only status check. Constructor is now defaulted.

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<number> {
    const marketData = await this.getMarketData(symbol);
    return marketData.price;
  }

  /**
   * Get comprehensive market data for a symbol
   */
  async getMarketData(symbol: string): Promise<MarketPrice> {
    const normalizedSymbol = symbol.toUpperCase();
    
    // Handle testnet tokens - return $1 without API call
    if (this.TESTNET_STABLECOINS.has(normalizedSymbol)) {
      const now = Date.now();
      return {
        symbol: normalizedSymbol,
        price: 1,
        change24h: 0,
        volume24h: 0,
        high24h: 1,
        low24h: 1,
        timestamp: now,
        source: 'cryptocom-exchange',
      };
    }
    
    // Check cache first
    const cached = this.priceCache.get(normalizedSymbol);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    try {
      const instrumentName = this.getInstrumentName(normalizedSymbol);
      const data = await this.fetchJson<ExchangeTickerResponse>(
        '/public/get-tickers',
        { instrument_name: instrumentName },
      );

      if (data.code === 0 && data.result?.data?.length > 0) {
        const ticker = data.result.data[0];
        const marketData = this.parseTickerData(ticker, normalizedSymbol);
        
        // Cache the result
        this.priceCache.set(normalizedSymbol, {
          price: marketData,
          timestamp: Date.now(),
        });

        return marketData;
      }

      throw new Error(`No data returned for ${instrumentName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to fetch ${symbol}`, error, { component: 'CryptocomExchange' });
      throw new Error(`Failed to fetch market data for ${symbol}: ${message}`);
    }
  }

  /**
   * Get prices for multiple symbols (batch request) - OPTIMIZED
   */
  async getBatchPrices(symbols: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};
    
    // Handle stablecoins and testnet tokens directly (always $1)
    const STABLECOINS = ['USDC', 'USDT', 'DAI', 'DEVUSDC', 'DEVUSDCE', 'TESTUSDC'];
    
    // Separate stablecoins from market tokens
    const stablecoins = symbols.filter(s => STABLECOINS.includes(s.toUpperCase()));
    const marketTokens = symbols.filter(s => !STABLECOINS.includes(s.toUpperCase()));
    
    // Immediately set stablecoin prices
    stablecoins.forEach(symbol => {
      prices[symbol] = 1.0;
    });
    
    // OPTIMIZATION: Batch market tokens in chunks of 5 to avoid overwhelming the API
    // with 100 req/s limit, we can safely do 5 parallel requests
    const CHUNK_SIZE = 5;
    const chunks: string[][] = [];
    for (let i = 0; i < marketTokens.length; i += CHUNK_SIZE) {
      chunks.push(marketTokens.slice(i, i + CHUNK_SIZE));
    }
    
    // Process chunks sequentially to respect rate limits
    for (const chunk of chunks) {
      const promises = chunk.map(async (symbol) => {
        try {
          const price = await this.getPrice(symbol);
          prices[symbol] = price;
        } catch (error) {
          logger.warn(`Failed to fetch ${symbol}, skipping`, { component: 'CryptocomExchange' });
        }
      });
      
      await Promise.all(promises);
    }
    
    return prices;
  }

  /**
   * Get all available tickers
   */
  async getAllTickers(): Promise<ExchangeTicker[]> {
    try {
      const data = await this.fetchJson<ExchangeTickerResponse>('/public/get-tickers');
      if (data.code === 0 && data.result?.data) {
        return data.result.data;
      }
      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to fetch all tickers: ${message}`, error, { component: 'CryptocomExchange' });
      return [];
    }
  }

  /**
   * Parse ticker data into MarketPrice format
   */
  private parseTickerData(ticker: ExchangeTicker, symbol: string): MarketPrice {
    const price = parseFloat(ticker.a || '0');
    const priceChange = parseFloat(ticker.c || '0'); // Raw price change in USD
    const high = parseFloat(ticker.h || '0');
    const low = parseFloat(ticker.l || '0');
    const volume = parseFloat(ticker.v || '0');

    // Calculate 24h percentage change: (current price change / previous price) * 100
    // Previous price = current price - price change
    const previousPrice = price - priceChange;
    const change24hPercent = previousPrice > 0 ? (priceChange / previousPrice) * 100 : 0;

    return {
      symbol,
      price,
      change24h: change24hPercent,
      volume24h: volume,
      high24h: high,
      low24h: low,
      timestamp: ticker.t || Date.now(),
      source: 'cryptocom-exchange',
    };
  }

  /**
   * Map internal symbol to exchange instrument name
   */
  private getInstrumentName(symbol: string): string {
    const mapped = this.SYMBOL_MAP[symbol];
    if (mapped) {
      return mapped;
    }

    // Default: assume symbol_USD format
    return `${symbol}_USD`;
  }

  /**
   * Check if service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const data = await this.fetchJson<ExchangeTickerResponse>(
        '/public/get-tickers',
        { instrument_name: 'BTC_USD' },
        5000,
      );
      return data.code === 0;
    } catch (error) {
      logger.error('Health check failed', error, { component: 'CryptocomExchange' });
      return false;
    }
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.priceCache.size,
      entries: Array.from(this.priceCache.keys()),
    };
  }
}

// Export singleton instance
export const cryptocomExchangeService = new CryptocomExchangeService();
export default CryptocomExchangeService;
