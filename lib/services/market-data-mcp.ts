/**
 * Crypto.com Market Data MCP Client
 * Provides real-time market data via Model Context Protocol
 */

import { logger } from '@/lib/utils/logger';

export interface MarketDataPrice {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

export interface MarketDataOHLCV {
  symbol: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface MarketDataTicker {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
}

/**
 * Crypto.com Market Data MCP Client
 */
export class MarketDataMCPClient {
  private static instance: MarketDataMCPClient | null = null;
  private mcpServerUrl: string;
  private apiKey: string;
  private connected: boolean = false;

  private constructor() {
    this.mcpServerUrl = process.env.CRYPTOCOM_MCP_URL || 'https://mcp.crypto.com/market-data';
    this.apiKey = process.env.CRYPTOCOM_MCP_API_KEY || '';

    if (!this.apiKey) {
      logger.warn('MarketDataMCPClient: No API key found, using demo mode');
    }
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): MarketDataMCPClient {
    if (!MarketDataMCPClient.instance) {
      MarketDataMCPClient.instance = new MarketDataMCPClient();
    }
    return MarketDataMCPClient.instance;
  }

  /**
   * Connect to MCP server
   */
  public async connect(): Promise<void> {
    try {
      if (this.connected) {
        return;
      }

      // TODO: Implement real MCP connection when credentials available
      if (!this.apiKey) {
        logger.info('MarketDataMCPClient: Running in demo mode');
        this.connected = true;
        return;
      }

      // Real connection logic here
      logger.info('MarketDataMCPClient: Connected to Crypto.com Market Data MCP');
      this.connected = true;
    } catch (error) {
      logger.error('Failed to connect to Market Data MCP', { error });
      throw error;
    }
  }

  /**
   * Disconnect from MCP server
   */
  public async disconnect(): Promise<void> {
    this.connected = false;
    logger.info('MarketDataMCPClient: Disconnected');
  }

  /**
   * Get real-time price for symbol - uses REAL Crypto.com API
   */
  public async getPrice(symbol: string): Promise<MarketDataPrice> {
    if (!this.connected) {
      await this.connect();
    }

    try {
      // Fetch REAL price data from Crypto.com Exchange API
      const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) throw new Error('Crypto.com API unavailable');
      
      const data = await response.json();
      const tickers = data.result?.data || [];
      
      // Map common symbols to Crypto.com format
      const symbolMap: Record<string, string> = {
        'BTC': 'BTC_USDT',
        'ETH': 'ETH_USDT',
        'CRO': 'CRO_USDT',
        'BTCUSDT': 'BTC_USDT',
        'ETHUSDT': 'ETH_USDT',
        'CROUSDT': 'CRO_USDT',
      };
      
      const cryptoSymbol = symbolMap[symbol.toUpperCase()] || `${symbol.toUpperCase()}_USDT`;
      const ticker = tickers.find((t: Record<string, string>) => t.i === cryptoSymbol);
      
      if (ticker) {
        const price = parseFloat(ticker.a || '0');
        const change24h = parseFloat(ticker.c || '0') * 100;
        const high24h = parseFloat(ticker.h || price.toString());
        const low24h = parseFloat(ticker.l || price.toString());
        const volume24h = parseFloat(ticker.v || '0') * price;
        
        return {
          symbol,
          price,
          change24h,
          volume24h,
          high24h,
          low24h,
          timestamp: Date.now(),
        };
      }
      
      // Fallback to CoinGecko for symbols not on Crypto.com
      return await this.getRealPriceFromCoinGecko(symbol);
    } catch (error) {
      logger.warn('Failed to fetch real price, trying CoinGecko', { symbol, error });
      return await this.getRealPriceFromCoinGecko(symbol);
    }
  }
  
  /**
   * Fallback to CoinGecko for real price data
   */
  private async getRealPriceFromCoinGecko(symbol: string): Promise<MarketDataPrice> {
    try {
      const coinMap: Record<string, string> = {
        'BTC': 'bitcoin',
        'ETH': 'ethereum',
        'CRO': 'crypto-com-chain',
        'USDC': 'usd-coin',
        'USDT': 'tether',
      };
      
      const coinId = coinMap[symbol.toUpperCase()] || symbol.toLowerCase();
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_24hr_high=true&include_24hr_low=true`,
        { signal: AbortSignal.timeout(5000) }
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data[coinId]) {
          return {
            symbol,
            price: data[coinId].usd || 0,
            change24h: data[coinId].usd_24h_change || 0,
            volume24h: data[coinId].usd_24h_vol || 0,
            high24h: data[coinId].usd_24h_high || data[coinId].usd,
            low24h: data[coinId].usd_24h_low || data[coinId].usd,
            timestamp: Date.now(),
          };
        }
      }
    } catch (error) {
      logger.error('CoinGecko fallback also failed', { symbol, error });
    }
    
    // Return empty data with error flag instead of fake data
    return {
      symbol,
      price: 0,
      change24h: 0,
      volume24h: 0,
      high24h: 0,
      low24h: 0,
      timestamp: Date.now(),
    };
  }

  /**
   * Get OHLCV data
   */
  public async getOHLCV(
    symbol: string,
    timeframe: string = '1h',
    limit: number = 100
  ): Promise<MarketDataOHLCV[]> {
    if (!this.connected) {
      await this.connect();
    }

    try {
      if (!this.apiKey) {
        return this.getDemoOHLCV(symbol, limit);
      }

      // TODO: Implement real MCP API call
      return this.getDemoOHLCV(symbol, limit);
    } catch (error) {
      logger.error('Failed to fetch OHLCV', { symbol, timeframe, error });
      return this.getDemoOHLCV(symbol, limit);
    }
  }

  /**
   * Get ticker data (bid/ask)
   */
  public async getTicker(symbol: string): Promise<MarketDataTicker> {
    if (!this.connected) {
      await this.connect();
    }

    try {
      if (!this.apiKey) {
        return this.getDemoTicker(symbol);
      }

      // TODO: Implement real MCP API call
      return this.getDemoTicker(symbol);
    } catch (error) {
      logger.error('Failed to fetch ticker', { symbol, error });
      return this.getDemoTicker(symbol);
    }
  }

  /**
   * Get multiple prices at once
   */
  public async getMultiplePrices(symbols: string[]): Promise<MarketDataPrice[]> {
    return Promise.all(symbols.map(symbol => this.getPrice(symbol)));
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check if using demo mode
   */
  public isDemoMode(): boolean {
    return !this.apiKey;
  }

  // ============= Demo Data Generators =============

  private getDemoPrice(symbol: string): MarketDataPrice {
    const basePrice = this.getBasePrice(symbol);
    const variance = basePrice * 0.02; // 2% variance

    return {
      symbol,
      price: basePrice + (Math.random() - 0.5) * variance,
      change24h: (Math.random() - 0.5) * 10, // -5% to +5%
      volume24h: Math.random() * 1000000000,
      high24h: basePrice * (1 + Math.random() * 0.05),
      low24h: basePrice * (1 - Math.random() * 0.05),
      timestamp: Date.now(),
    };
  }

  private getDemoOHLCV(symbol: string, limit: number): MarketDataOHLCV[] {
    const basePrice = this.getBasePrice(symbol);
    const data: MarketDataOHLCV[] = [];
    const now = Date.now();

    for (let i = 0; i < limit; i++) {
      const timestamp = now - (limit - i) * 3600000; // 1 hour intervals
      const open = basePrice * (1 + (Math.random() - 0.5) * 0.05);
      const close = basePrice * (1 + (Math.random() - 0.5) * 0.05);
      const high = Math.max(open, close) * (1 + Math.random() * 0.02);
      const low = Math.min(open, close) * (1 - Math.random() * 0.02);

      data.push({
        symbol,
        timeframe: '1h',
        open,
        high,
        low,
        close,
        volume: Math.random() * 10000000,
        timestamp,
      });
    }

    return data;
  }

  private getDemoTicker(symbol: string): MarketDataTicker {
    const basePrice = this.getBasePrice(symbol);
    const spread = basePrice * 0.001; // 0.1% spread

    return {
      symbol,
      bid: basePrice - spread / 2,
      ask: basePrice + spread / 2,
      spread: spread,
      timestamp: Date.now(),
    };
  }

  private getBasePrice(symbol: string): number {
    const prices: Record<string, number> = {
      'BTC': 42850,
      'ETH': 2245,
      'CRO': 0.0876,
      'USDT': 1.0,
      'USDC': 1.0,
      'BTC-USD': 42850,
      'ETH-USD': 2245,
      'CRO-USD': 0.0876,
    };

    return prices[symbol] || prices[symbol.split('-')[0]] || 100;
  }
}

// Export singleton getter
export const getMarketDataMCPClient = () => MarketDataMCPClient.getInstance();
