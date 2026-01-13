/**
 * Crypto.com Exchange API Service
 * High-performance market data from Crypto.com Exchange
 * Rate limit: 100 requests per second per IP
 */

import axios, { AxiosInstance } from 'axios';

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
  private client: AxiosInstance;
  private readonly BASE_URL = 'https://api.crypto.com/exchange/v1';
  private priceCache: Map<string, { price: MarketPrice; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds (aggressive caching for high performance)
  
  // Symbol mapping: internal symbol → exchange instrument name
  private readonly SYMBOL_MAP: Record<string, string> = {
    'BTC': 'BTC_USD',
    'BITCOIN': 'BTC_USD',
    'ETH': 'ETH_USD',
    'ETHEREUM': 'ETH_USD',
    'CRO': 'CRO_USD',
    'CRONOS': 'CRO_USD',
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
  };

  constructor() {
    this.client = axios.create({
      baseURL: this.BASE_URL,
      timeout: 3000, // Reduced from 10s to 3s for faster failures
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        console.error('[CryptocomExchange] API Error:', error.message);
        throw error;
      }
    );
  }

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
    
    // Check cache first
    const cached = this.priceCache.get(normalizedSymbol);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    try {
      const instrumentName = this.getInstrumentName(normalizedSymbol);
      const response = await this.client.get<ExchangeTickerResponse>(
        '/public/get-tickers',
        {
          params: {
            instrument_name: instrumentName,
          },
        }
      );

      if (response.data.code === 0 && response.data.result?.data?.length > 0) {
        const ticker = response.data.result.data[0];
        const marketData = this.parseTickerData(ticker, normalizedSymbol);
        
        // Cache the result
        this.priceCache.set(normalizedSymbol, {
          price: marketData,
          timestamp: Date.now(),
        });

        return marketData;
      }

      throw new Error(`No data returned for ${instrumentName}`);
    } catch (error: any) {
      console.error(`[CryptocomExchange] Failed to fetch ${symbol}:`, error.message);
      throw new Error(`Failed to fetch market data for ${symbol}: ${error.message}`);
    }
  }

  /**
   * Get prices for multiple symbols (batch request)
   */
  async getBatchPrices(symbols: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};
    
    // Crypto.com Exchange doesn't have a true batch endpoint,
    // but with 100 req/s we can make parallel requests
    const promises = symbols.map(async (symbol) => {
      try {
        const price = await this.getPrice(symbol);
        prices[symbol] = price;
      } catch (error) {
        console.warn(`[CryptocomExchange] Failed to fetch ${symbol}, skipping`);
      }
    });

    await Promise.all(promises);
    return prices;
  }

  /**
   * Get all available tickers
   */
  async getAllTickers(): Promise<ExchangeTicker[]> {
    try {
      const response = await this.client.get<ExchangeTickerResponse>(
        '/public/get-tickers'
      );

      if (response.data.code === 0 && response.data.result?.data) {
        return response.data.result.data;
      }

      return [];
    } catch (error: any) {
      console.error('[CryptocomExchange] Failed to fetch all tickers:', error.message);
      return [];
    }
  }

  /**
   * Parse ticker data into MarketPrice format
   */
  private parseTickerData(ticker: ExchangeTicker, symbol: string): MarketPrice {
    const price = parseFloat(ticker.a || '0');
    const change = parseFloat(ticker.c || '0');
    const high = parseFloat(ticker.h || '0');
    const low = parseFloat(ticker.l || '0');
    const volume = parseFloat(ticker.v || '0');

    return {
      symbol,
      price,
      change24h: change,
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
      const response = await this.client.get('/public/get-tickers', {
        params: { instrument_name: 'BTC_USD' },
        timeout: 5000,
      });
      return response.data.code === 0;
    } catch (error) {
      console.error('[CryptocomExchange] Health check failed:', error);
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
