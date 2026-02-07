/**
 * @fileoverview MCP (Model Context Protocol) Server client for real-time data feeds
 * @module integrations/mcp/MCPClient
 * 
 * Uses Crypto.com's FREE MCP server via SSE (Server-Sent Events)
 * No API key required - public access for hackathon projects
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../../shared/utils/logger';
import config from '../../shared/utils/config';
import { RealMarketDataService } from '../../lib/services/RealMarketDataService';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const EventSourceModule = require('eventsource');
const EventSourceConstructor = (EventSourceModule.default || EventSourceModule) as { new(url: string, options?: Record<string, unknown>): EventSource };

export interface MCPPriceData {
  symbol: string;
  price: number;
  timestamp: number;
  volume24h?: number;
  priceChange24h?: number;
}

export interface MCPMarketData {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  timestamp: number;
}

/**
 * MCP Server client for market data integration
 * Using Crypto.com's MCP server via SSE protocol (FREE, no key needed)
 */
export class MCPClient extends EventEmitter {
  private eventSource: EventSource | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private subscriptions: Set<string> = new Set();
  private priceCache: Map<string, MCPPriceData> = new Map();
  private connected: boolean = false;
  private realMarket: RealMarketDataService | null = null;

  constructor() {
    super();
    // Disabled - MCP is for Claude Desktop integration, not direct API access
    // console.log('✅ Crypto.com MCP Client initialized (SSE-based, FREE hackathon access)');
  }

  /**
   * Connect to MCP Server via SSE
   * Note: Disabled - MCP endpoint is for Claude Desktop, not direct API access
   */
  async connect(): Promise<void> {
    // Disabled - MCP is for Claude Desktop integration
    // In test/development mode, we use Exchange API fallback instead
    logger.info('MCP direct connection disabled - using Exchange API fallback for market data');
    this.connected = false;
    return;
    
    try {
      const mcpUrl = config.mcpServerUrl || 'https://mcp.crypto.com/market-data/mcp';
      logger.info('Connecting to MCP Server via SSE', { url: mcpUrl });

      // Connect via SSE (Server-Sent Events)
      this.eventSource = new EventSourceConstructor(mcpUrl, {
        headers: {
          'Accept': 'text/event-stream',
        },
      });

      if (this.eventSource) {
        // @ts-expect-error - EventSource types from external library
        this.eventSource.onopen = () => {
          logger.info('✅ Connected to Crypto.com MCP via SSE');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
        };

        // @ts-expect-error - EventSource types from external library
        this.eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMCPMessage(data);
          } catch (error) {
            logger.error('Failed to parse MCP message', { error });
          }
        };

        // @ts-expect-error - EventSource types from external library
        this.eventSource.onerror = (error) => {
          logger.error('MCP SSE connection error', { error });
          this.connected = false;
          this.handleReconnect();
        };
      }

    } catch (error) {
      logger.error('Failed to connect to MCP Server', { error });
      throw error;
    }
  }

  /**
   * Handle MCP messages from SSE stream
   */
  private handleMCPMessage(message: Record<string, unknown>): void {
    try {
      // Handle different MCP message types
      if (message.type === 'price') {
        const priceData: MCPPriceData = {
          symbol: message.symbol as string,
          price: message.price as number,
          timestamp: (message.timestamp as number) || Date.now(),
          volume24h: message.volume24h as number | undefined,
          priceChange24h: message.priceChange24h as number | undefined,
        };
        
        this.priceCache.set(message.symbol as string, priceData);
        this.emit('price-update', priceData);
        
      } else if (message.type === 'market-data') {
        this.emit('market-data', message.data as MCPMarketData);
        
      } else if (message.type === 'error') {
        logger.error('MCP Server error', { error: String(message.error) });
        this.emit('error', message.error);
      }
    } catch (error) {
      logger.error('Failed to handle MCP message', { error, message });
    }
  }

  /**
   * Handle reconnection logic
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      
      logger.info('Attempting to reconnect to MCP Server', {
        attempt: this.reconnectAttempts,
        delay,
      });

      setTimeout(() => {
        this.connect().catch((error) => {
          logger.error('Reconnection failed', { error });
        });
      }, delay);
    } else {
      logger.error('Max reconnection attempts reached for MCP Server');
      this.emit('connection-lost');
    }
  }

  /**
   * Subscribe to symbol price updates
   */
  subscribeToPriceUpdates(symbol: string): void {
    this.subscriptions.add(symbol);
    logger.debug('Subscribed to price updates via MCP', { symbol });
  }

  /**
   * Unsubscribe from price updates
   */
  unsubscribeFromPriceUpdates(symbol: string): void {
    this.subscriptions.delete(symbol);
    logger.debug('Unsubscribed from price updates', { symbol });
  }

  /**
   * Get current price for a symbol
   * First checks cache, then requests from MCP if needed
   */
  async getPrice(symbol: string): Promise<MCPPriceData> {
    try {
      // Check cache first (60-second TTL)
      const cached = this.priceCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < 60000) {
        return cached;
      }

      // Ensure connection
      if (!this.connected) {
        // If MCP SSE is disabled (development/test), fall back to Exchange API via RealMarketDataService
        if (!this.realMarket) {
          try {
            this.realMarket = new RealMarketDataService();
          } catch (e) {
            logger.warn('Failed to initialize RealMarketDataService fallback', { error: e });
          }
        }

        if (this.realMarket) {
          try {
            const mp = await this.realMarket.getTokenPrice(symbol);
            const priceData: MCPPriceData = {
              symbol,
              price: mp.price,
              timestamp: mp.timestamp || Date.now(),
              volume24h: mp.volume24h || 0,
              priceChange24h: mp.change24h || 0,
            };
            this.priceCache.set(symbol, priceData);
            return priceData;
          } catch (e) {
            logger.warn('RealMarketDataService fallback failed for MCP.getPrice', { symbol, error: e });
            // continue to attempt connect() below as last resort
          }
        }

        await this.connect();
      }

      // Subscribe to updates for this symbol
      this.subscribeToPriceUpdates(symbol);

      // Wait for price update (with timeout)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timeout waiting for price data for ${symbol}`));
        }, 10000);

        const handler = (data: MCPPriceData) => {
          if (data.symbol === symbol) {
            clearTimeout(timeout);
            this.removeListener('price-update', handler);
            resolve(data);
          }
        };

        this.on('price-update', handler);
      });
    } catch (error) {
      logger.error('Failed to fetch price', { symbol, error });
      throw error;
    }
  }

  /**
   * Get prices for multiple symbols
   */
  async getPrices(symbols: string[]): Promise<MCPPriceData[]> {
    try {
      // Request all symbols in parallel
      const promises = symbols.map(symbol => this.getPrice(symbol));
      return await Promise.all(promises);
    } catch (error) {
      logger.error('Failed to fetch prices', { symbols, error });
      throw error;
    }
  }

  /**
   * Map token symbol to Crypto.com Exchange instrument name
   */
  private mapSymbolToInstrument(symbol: string, type: 'spot' | 'perp' = 'spot'): string {
    const s = symbol.toUpperCase().replace('_USDT', '').replace('USD-PERP', '');
    if (type === 'perp') {
      return `${s}USD-PERP`;
    }
    return `${s}_USDT`;
  }

  /**
   * Get historical price data via Crypto.com Exchange candlestick API
   * Uses REAL candlestick (OHLCV) data from the Exchange — no hardcoded values
   */
  async getHistoricalPrices(
    symbol: string,
    interval: '1m' | '5m' | '1h' | '1d',
    limit: number = 100,
    instrumentType: 'spot' | 'perp' = 'spot'
  ): Promise<MCPPriceData[]> {
    const EXCHANGE_API = 'https://api.crypto.com/exchange/v1/public';

    try {
      const instrumentName = this.mapSymbolToInstrument(symbol, instrumentType);

      // Map interval to Crypto.com timeframe format
      const timeframeMap: Record<string, string> = {
        '1m': '1m',
        '5m': '5m',
        '1h': '1h',
        '1d': '1D',
      };
      const timeframe = timeframeMap[interval] || '1D';

      const url = `${EXCHANGE_API}/get-candlestick?instrument_name=${instrumentName}&timeframe=${timeframe}&count=${Math.min(limit, 300)}`;

      logger.info('Fetching real candlestick data from Exchange API', { symbol, instrumentName, timeframe, limit });

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Exchange API HTTP error: ${response.status}`);
      }

      const json = await response.json();

      if (json.code !== 0 || !json.result?.data || json.result.data.length === 0) {
        throw new Error(`Exchange API returned error code ${json.code}: ${json.message || 'no data'}`);
      }

      // Map candlestick data to MCPPriceData format
      const candles = json.result.data as Array<{ t: number; o: string; h: string; l: string; c: string; v: string }>;

      logger.info('Received real candlestick data', { symbol, instrumentName, count: candles.length });

      return candles.map(candle => ({
        symbol,
        price: parseFloat(candle.c), // Close price
        timestamp: candle.t,
        volume24h: parseFloat(candle.v),
        priceChange24h: ((parseFloat(candle.c) - parseFloat(candle.o)) / parseFloat(candle.o)) * 100,
      }));
    } catch (error) {
      logger.error('Failed to fetch historical prices from Exchange API', {
        symbol,
        instrumentType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get market sentiment derived from real ticker data
   * Uses 24h price change, volume, and momentum from Exchange API
   */
  async getMarketSentiment(symbols?: string[]): Promise<Record<string, unknown>> {
    const targetSymbols = symbols || ['BTC', 'ETH', 'CRO'];
    const sentiment: Record<string, unknown> = {};

    for (const symbol of targetSymbols) {
      try {
        const priceData = await this.getPrice(symbol);
        const change = priceData.priceChange24h || 0;

        sentiment[symbol] = {
          direction: change > 2 ? 'BULLISH' : change < -2 ? 'BEARISH' : 'NEUTRAL',
          strength: Math.min(Math.abs(change) * 10, 100), // Normalize to 0-100
          change24h: change,
          volume24h: priceData.volume24h,
        };
      } catch (e) {
        logger.warn('Failed to get sentiment for symbol', { symbol, error: e });
      }
    }

    return sentiment;
  }

  /**
   * Get volatility calculated from real candlestick data
   * Returns annualized volatility computed from daily returns
   */
  async getVolatility(symbol: string, period: number = 30): Promise<number> {
    const prices = await this.getHistoricalPrices(symbol, '1d', period);

    if (prices.length < 5) {
      throw new Error(`Insufficient price data for volatility calculation: got ${prices.length} candles`);
    }

    // Calculate daily log returns
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1].price > 0) {
        returns.push(Math.log(prices[i].price / prices[i - 1].price));
      }
    }

    if (returns.length < 3) {
      throw new Error('Not enough valid returns for volatility calculation');
    }

    // Calculate standard deviation of returns
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    const dailyVol = Math.sqrt(variance);

    // Annualize (crypto trades 365 days)
    const annualizedVol = dailyVol * Math.sqrt(365);

    logger.info('Calculated real volatility from candlestick data', {
      symbol,
      dataPoints: returns.length,
      dailyVol: (dailyVol * 100).toFixed(2) + '%',
      annualizedVol: (annualizedVol * 100).toFixed(2) + '%',
    });

    return annualizedVol;
  }

  /**
   * Disconnect from MCP Server
   */
  async disconnect(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    this.connected = false;
    this.subscriptions.clear();
    this.priceCache.clear();
    logger.info('Disconnected from MCP Server');
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.connected && this.eventSource !== null;
  }
}

// Singleton instance
export const mcpClient = new MCPClient();

