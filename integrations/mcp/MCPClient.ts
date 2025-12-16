/**
 * @fileoverview MCP (Model Context Protocol) Server client for real-time data feeds
 * @module integrations/mcp/MCPClient
 */

import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'eventemitter3';
import { logger } from '@shared/utils/logger';
import config from '@shared/utils/config';

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
 */
export class MCPClient extends EventEmitter {
  private httpClient: AxiosInstance;
  private wsClient: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private subscriptions: Set<string> = new Set();

  constructor() {
    super();
    
    this.httpClient = axios.create({
      baseURL: config.mcpServerUrl,
      headers: {
        'Authorization': `Bearer ${config.mcpApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  /**
   * Connect to MCP Server
   */
  async connect(): Promise<void> {
    try {
      logger.info('Connecting to MCP Server', { url: config.mcpServerUrl });

      // Test HTTP connection
      await this.httpClient.get('/health');
      
      // Connect WebSocket for real-time data
      await this.connectWebSocket();

      logger.info('Successfully connected to MCP Server');
    } catch (error) {
      logger.error('Failed to connect to MCP Server', { error });
      throw error;
    }
  }

  /**
   * Connect WebSocket for real-time updates
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = config.mcpServerUrl.replace('http', 'ws');
      this.wsClient = new WebSocket(`${wsUrl}/ws?token=${config.mcpApiKey}`);

      this.wsClient.on('open', () => {
        logger.info('WebSocket connected to MCP Server');
        this.reconnectAttempts = 0;
        
        // Resubscribe to previous subscriptions
        this.subscriptions.forEach((symbol) => {
          this.subscribeToPriceUpdates(symbol);
        });
        
        resolve();
      });

      this.wsClient.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          logger.error('Failed to parse WebSocket message', { error });
        }
      });

      this.wsClient.on('error', (error) => {
        logger.error('WebSocket error', { error });
        reject(error);
      });

      this.wsClient.on('close', () => {
        logger.warn('WebSocket disconnected from MCP Server');
        this.handleWebSocketClose();
      });
    });
  }

  /**
   * Handle WebSocket messages
   */
  private handleWebSocketMessage(message: Record<string, unknown>): void {
    switch (message.type) {
      case 'price-update':
        this.emit('price-update', message.data as MCPPriceData);
        break;
      case 'market-data':
        this.emit('market-data', message.data as MCPMarketData);
        break;
      case 'error':
        logger.error('MCP Server error', { error: message.error });
        this.emit('error', message.error);
        break;
      default:
        logger.debug('Unknown message type from MCP Server', { type: message.type });
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleWebSocketClose(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      
      logger.info('Attempting to reconnect to MCP Server', {
        attempt: this.reconnectAttempts,
        delay,
      });

      setTimeout(() => {
        this.connectWebSocket().catch((error) => {
          logger.error('Reconnection failed', { error });
        });
      }, delay);
    } else {
      logger.error('Max reconnection attempts reached for MCP Server');
      this.emit('connection-lost');
    }
  }

  /**
   * Subscribe to real-time price updates
   */
  subscribeToPriceUpdates(symbol: string): void {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      logger.warn('WebSocket not connected, cannot subscribe', { symbol });
      return;
    }

    this.subscriptions.add(symbol);
    
    this.wsClient.send(JSON.stringify({
      type: 'subscribe',
      channel: 'prices',
      symbol,
    }));

    logger.debug('Subscribed to price updates', { symbol });
  }

  /**
   * Unsubscribe from price updates
   */
  unsubscribeFromPriceUpdates(symbol: string): void {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      return;
    }

    this.subscriptions.delete(symbol);

    this.wsClient.send(JSON.stringify({
      type: 'unsubscribe',
      channel: 'prices',
      symbol,
    }));

    logger.debug('Unsubscribed from price updates', { symbol });
  }

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<MCPPriceData> {
    try {
      const response = await this.httpClient.get(`/api/v1/price/${symbol}`);
      return response.data;
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
      const response = await this.httpClient.post('/api/v1/prices', { symbols });
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch prices', { symbols, error });
      throw error;
    }
  }

  /**
   * Get historical price data
   */
  async getHistoricalPrices(
    symbol: string,
    interval: '1m' | '5m' | '1h' | '1d',
    limit: number = 100
  ): Promise<MCPPriceData[]> {
    try {
      const response = await this.httpClient.get(`/api/v1/historical/${symbol}`, {
        params: { interval, limit },
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch historical prices', { symbol, error });
      throw error;
    }
  }

  /**
   * Get market sentiment data
   */
  async getMarketSentiment(symbols?: string[]): Promise<Record<string, unknown>> {
    try {
      const response = await this.httpClient.post('/api/v1/sentiment', {
        symbols: symbols || ['BTC', 'ETH', 'CRO'],
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch market sentiment', { error });
      throw error;
    }
  }

  /**
   * Get volatility data
   */
  async getVolatility(symbol: string, period: number = 30): Promise<number> {
    try {
      const response = await this.httpClient.get(`/api/v1/volatility/${symbol}`, {
        params: { period },
      });
      return response.data.volatility;
    } catch (error) {
      logger.error('Failed to fetch volatility', { symbol, error });
      throw error;
    }
  }

  /**
   * Disconnect from MCP Server
   */
  async disconnect(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    
    this.subscriptions.clear();
    logger.info('Disconnected from MCP Server');
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.wsClient !== null && this.wsClient.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const mcpClient = new MCPClient();
