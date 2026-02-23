/**
 * Crypto.com Market Data MCP Client
 * Provides real-time market data via Model Context Protocol
 */

import { logger } from '@/lib/utils/logger';
import { getMarketDataService } from './RealMarketDataService';

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
   * Get real-time price for symbol - uses central proactive price feed
   */
  public async getPrice(symbol: string): Promise<MarketDataPrice> {
    if (!this.connected) {
      await this.connect();
    }

    try {
      // Use central RealMarketDataService (proactive cache - instant, non-blocking)
      const marketDataService = getMarketDataService();
      const priceData = await marketDataService.getTokenPrice(symbol);
      
      return {
        symbol,
        price: priceData.price,
        change24h: priceData.change24h || 0,
        volume24h: priceData.volume24h || 0,
        high24h: priceData.price, // Proactive cache doesn't track high/low
        low24h: priceData.price,
        timestamp: priceData.timestamp || Date.now(),
      };
    } catch (error) {
      logger.warn('Failed to fetch price from central service, trying CoinGecko', { symbol, error });
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
   * ⚠️ NOTE: MCP integration not yet implemented - returns empty array for safety
   */
  public async getOHLCV(
    symbol: string,
    timeframe: string = '1h',
    limit: number = 100
  ): Promise<MarketDataOHLCV[]> {
    if (!this.connected) {
      await this.connect();
    }

    // FAIL SAFE: MCP integration not implemented
    // Do NOT return demo data that could be mistaken for real market data
    logger.warn('MarketDataMCPClient.getOHLCV: MCP not implemented, returning empty array', { symbol, timeframe });
    return [];
  }

  /**
   * Get ticker data (bid/ask)
   * ⚠️ NOTE: MCP integration not yet implemented - returns zero values for safety
   */
  public async getTicker(symbol: string): Promise<MarketDataTicker> {
    if (!this.connected) {
      await this.connect();
    }

    // FAIL SAFE: MCP integration not implemented
    // Do NOT return demo data that could be mistaken for real market data
    logger.warn('MarketDataMCPClient.getTicker: MCP not implemented, returning zero values', { symbol });
    return {
      symbol,
      bid: 0,
      ask: 0,
      spread: 0,
      timestamp: Date.now(),
    };
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
   * Check if using demo mode (no API key configured)
   * When true, OHLCV and Ticker data are not available
   */
  public isDemoMode(): boolean {
    return !this.apiKey;
  }
}

// Export singleton getter
export const getMarketDataMCPClient = () => MarketDataMCPClient.getInstance();
