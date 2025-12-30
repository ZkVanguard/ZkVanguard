/**
 * @fileoverview MCP (Model Context Protocol) Server client for real-time data feeds
 * @module integrations/mcp/MCPClient
 * 
 * Uses Crypto.com's FREE MCP server via SSE (Server-Sent Events)
 * No API key required - public access for hackathon projects
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '@shared/utils/logger';
import config from '@shared/utils/config';
import { RealMarketDataService } from '../../lib/services/RealMarketDataService';
const { EventSource } = require('eventsource');

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
    // In test/development mode, we use CoinGecko fallback instead
    logger.info('MCP direct connection disabled - using CoinGecko fallback for market data');
    this.connected = false;
    return;
    
    try {
      const mcpUrl = config.mcpServerUrl || 'https://mcp.crypto.com/market-data/mcp';
      logger.info('Connecting to MCP Server via SSE', { url: mcpUrl });

      // Connect via SSE (Server-Sent Events)
      this.eventSource = new EventSource(mcpUrl, {
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
  private handleMCPMessage(message: any): void {
    try {
      // Handle different MCP message types
      if (message.type === 'price') {
        const priceData: MCPPriceData = {
          symbol: message.symbol,
          price: message.price,
          timestamp: message.timestamp || Date.now(),
          volume24h: message.volume24h,
          priceChange24h: message.priceChange24h,
        };
        
        this.priceCache.set(message.symbol, priceData);
        this.emit('price-update', priceData);
        
      } else if (message.type === 'market-data') {
        this.emit('market-data', message.data as MCPMarketData);
        
      } else if (message.type === 'error') {
        logger.error('MCP Server error', { error: message.error });
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
        // If MCP SSE is disabled (development/test), fall back to CoinGecko via RealMarketDataService
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
   * Get historical price data
   * Note: May not be supported by MCP SSE - placeholder for future enhancement
   */
  async getHistoricalPrices(
    symbol: string,
    interval: '1m' | '5m' | '1h' | '1d',
    limit: number = 100
  ): Promise<MCPPriceData[]> {
    logger.warn('Historical prices not yet implemented via MCP SSE', { symbol });
    throw new Error('Historical prices not supported via SSE');
  }

  /**
   * Get market sentiment data
   * Note: May not be supported by MCP SSE - placeholder for future enhancement
   */
  async getMarketSentiment(_symbols?: string[]): Promise<Record<string, unknown>> {
    logger.warn('Market sentiment not yet implemented via MCP SSE');
    throw new Error('Market sentiment not supported via SSE');
  }

  /**
   * Get volatility data
   * Note: May not be supported by MCP SSE - placeholder for future enhancement
   */
  async getVolatility(symbol: string, _period: number = 30): Promise<number> {
    logger.warn('Volatility data not yet implemented via MCP SSE', { symbol });
    throw new Error('Volatility not supported via SSE');
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

