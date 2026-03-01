/**
 * BlueFin Perpetual DEX Integration for SUI
 * 
 * BlueFin is the leading orderbook-based perpetual exchange on SUI Network.
 * This service provides hedge execution via BlueFin's REST API.
 * 
 * Features:
 * - Open/close perpetual positions programmatically
 * - Up to 50x leverage on major pairs
 * - ZK-compatible signing via Ed25519
 * 
 * @see https://learn.bluefin.io/bluefin
 * @see https://bluefin-exchange.readme.io/reference/introduction
 */

import { logger } from '@/lib/utils/logger';
import * as crypto from 'crypto';
import { getMarketDataService } from './RealMarketDataService';

// Network configurations
export const BLUEFIN_NETWORKS = {
  mainnet: {
    name: 'SUI Mainnet',
    rpcUrl: 'https://fullnode.mainnet.sui.io:443',
    apiUrl: 'https://dapi.api.sui-prod.bluefin.io',
    socketUrl: 'wss://dapi.api.sui-prod.bluefin.io',
    chainId: 'mainnet',
  },
  testnet: {
    name: 'SUI Testnet',
    rpcUrl: 'https://fullnode.testnet.sui.io:443',
    apiUrl: 'https://dapi.api.sui-staging.bluefin.io',
    socketUrl: 'wss://dapi.api.sui-staging.bluefin.io',
    chainId: 'testnet',
  },
} as const;

// Supported trading pairs on BlueFin
export const BLUEFIN_PAIRS = {
  'BTC-PERP': { index: 0, symbol: 'BTC-PERP', baseAsset: 'BTC', maxLeverage: 50 },
  'ETH-PERP': { index: 1, symbol: 'ETH-PERP', baseAsset: 'ETH', maxLeverage: 50 },
  'SUI-PERP': { index: 2, symbol: 'SUI-PERP', baseAsset: 'SUI', maxLeverage: 20 },
  'SOL-PERP': { index: 3, symbol: 'SOL-PERP', baseAsset: 'SOL', maxLeverage: 20 },
  'APT-PERP': { index: 4, symbol: 'APT-PERP', baseAsset: 'APT', maxLeverage: 20 },
  'ARB-PERP': { index: 5, symbol: 'ARB-PERP', baseAsset: 'ARB', maxLeverage: 20 },
  'DOGE-PERP': { index: 6, symbol: 'DOGE-PERP', baseAsset: 'DOGE', maxLeverage: 10 },
  'PEPE-PERP': { index: 7, symbol: 'PEPE-PERP', baseAsset: 'PEPE', maxLeverage: 10 },
} as const;

// Order types
export enum BluefinOrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
}

export enum BluefinSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

// Position interface
export interface BluefinPosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  margin: number;
  marginRatio: number;
}

// Order interface
export interface BluefinOrder {
  orderId: string;
  symbol: string;
  side: BluefinSide;
  type: BluefinOrderType;
  size: number;
  price?: number;
  leverage: number;
  reduceOnly: boolean;
  postOnly: boolean;
  timeInForce: 'GTC' | 'IOC' | 'FOK';
}

// Hedge execution result
export interface BluefinHedgeResult {
  success: boolean;
  hedgeId: string;
  orderId?: string;
  txDigest?: string;
  executionPrice?: number;
  filledSize?: number;
  fees?: number;
  error?: string;
  timestamp: number;
}

/**
 * BlueFin Service - Handles all interactions with BlueFin DEX via REST API
 */
export class BluefinService {
  private static instance: BluefinService;
  private initialized: boolean = false;
  private network: 'mainnet' | 'testnet' = 'testnet';
  private privateKey: string | null = null;
  private apiKey: string | null = null;
  private apiSecret: string | null = null;
  private walletAddress: string | null = null;

  private constructor() {}

  static getInstance(): BluefinService {
    if (!BluefinService.instance) {
      BluefinService.instance = new BluefinService();
    }
    return BluefinService.instance;
  }

  /**
   * Initialize BlueFin client with API credentials
   */
  async initialize(privateKey: string, network: 'mainnet' | 'testnet' = 'testnet'): Promise<void> {
    if (this.initialized && this.network === network) {
      return;
    }

    try {
      const networkConfig = BLUEFIN_NETWORKS[network];

      logger.info('🌊 Initializing BlueFin REST client', { network, apiUrl: networkConfig.apiUrl });

      // Get API credentials from environment
      this.apiKey = process.env.BLUEFIN_API_KEY || null;
      this.apiSecret = process.env.BLUEFIN_API_SECRET || null;
      this.walletAddress = process.env.BLUEFIN_WALLET_ADDRESS || null;

      this.privateKey = privateKey;
      this.network = network;
      this.initialized = true;

      logger.info('✅ BlueFin REST client initialized', { network });

    } catch (error) {
      logger.error('❌ Failed to initialize BlueFin client', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Generate HMAC signature for authenticated requests
   */
  private generateSignature(timestamp: number, method: string, path: string, body: string = ''): string {
    if (!this.apiSecret) return '';
    const message = `${timestamp}${method}${path}${body}`;
    return crypto.createHmac('sha256', this.apiSecret).update(message).digest('hex');
  }

  /**
   * Make authenticated API request
   */
  private async apiRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const networkConfig = BLUEFIN_NETWORKS[this.network];
    const url = `${networkConfig.apiUrl}${path}`;
    const timestamp = Date.now();
    const bodyStr = body ? JSON.stringify(body) : '';
    const signature = this.generateSignature(timestamp, method, path, bodyStr);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-KEY'] = this.apiKey;
      headers['X-TIMESTAMP'] = timestamp.toString();
      headers['X-SIGNATURE'] = signature;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? bodyStr : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`BlueFin API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get wallet address
   */
  getAddress(): string | null {
    return this.walletAddress;
  }

  /**
   * Get account balance (USDC)
   */
  async getBalance(): Promise<number> {
    this.ensureInitialized();

    try {
      const data = await this.apiRequest<{ freeCollateral: string }>('GET', '/api/v1/account');
      return parseFloat(data?.freeCollateral || '0');
    } catch (error) {
      logger.error('Failed to get BlueFin balance', error instanceof Error ? error : undefined);
      return 0;
    }
  }

  /**
   * Get all open positions
   */
  async getPositions(): Promise<BluefinPosition[]> {
    this.ensureInitialized();

    try {
      const positions = await this.apiRequest<Array<Record<string, unknown>>>('GET', '/api/v1/positions');
      return (positions || []).map((p: Record<string, unknown>) => ({
        symbol: p.symbol as string,
        side: parseFloat(p.quantity as string) > 0 ? 'LONG' : 'SHORT',
        size: Math.abs(parseFloat(p.quantity as string)),
        leverage: parseFloat(p.leverage as string) || 1,
        entryPrice: parseFloat(p.avgEntryPrice as string),
        markPrice: parseFloat(p.markPrice as string),
        liquidationPrice: parseFloat(p.liquidationPrice as string),
        unrealizedPnl: parseFloat(p.unrealizedProfit as string),
        margin: parseFloat(p.margin as string),
        marginRatio: parseFloat(p.marginRatio as string) || 0,
      })) as BluefinPosition[];
    } catch (error) {
      logger.error('Failed to get BlueFin positions', error instanceof Error ? error : undefined);
      return [];
    }
  }

  /**
   * Get market data for a symbol
   */
  async getMarketData(symbol: string): Promise<{ price: number; fundingRate: number } | null> {
    this.ensureInitialized();

    try {
      const marketData = await this.apiRequest<{ lastPrice: string; fundingRate: string }>(
        'GET',
        `/api/v1/ticker?symbol=${encodeURIComponent(symbol)}`
      );
      return {
        price: parseFloat(marketData?.lastPrice || '0'),
        fundingRate: parseFloat(marketData?.fundingRate || '0'),
      };
    } catch (error) {
      logger.error('Failed to get market data', error instanceof Error ? error : undefined, { symbol });
      return null;
    }
  }

  /**
   * Open a hedge position on BlueFin
   */
  async openHedge(params: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    leverage: number;
    portfolioId?: number;
    reason?: string;
  }): Promise<BluefinHedgeResult> {
    this.ensureInitialized();

    const hedgeId = `BF_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();

    try {
      logger.info('🌊 Opening BlueFin hedge', {
        symbol: params.symbol,
        side: params.side,
        size: params.size,
        leverage: params.leverage,
      });

      // Validate pair
      const pair = Object.values(BLUEFIN_PAIRS).find(p => p.symbol === params.symbol);
      if (!pair) {
        throw new Error(`Invalid pair: ${params.symbol}. Available: ${Object.keys(BLUEFIN_PAIRS).join(', ')}`);
      }

      // Check leverage limits
      if (params.leverage > pair.maxLeverage) {
        throw new Error(`Leverage ${params.leverage}x exceeds max ${pair.maxLeverage}x for ${params.symbol}`);
      }

      // Set leverage for the symbol
      await this.apiRequest('POST', '/api/v1/leverage', {
        symbol: params.symbol,
        leverage: params.leverage,
      });

      // Place market order
      const orderSide = params.side === 'LONG' ? BluefinSide.BUY : BluefinSide.SELL;
      
      const orderResponse = await this.apiRequest<{
        orderId: string;
        txDigest: string;
        avgFillPrice: string;
        filledQty: string;
        fee: string;
      }>('POST', '/api/v1/orders', {
        symbol: params.symbol,
        side: orderSide,
        orderType: BluefinOrderType.MARKET,
        quantity: params.size.toString(),
        leverage: params.leverage,
        reduceOnly: false,
        postOnly: false,
        timeInForce: 'IOC',
      });

      logger.info('✅ BlueFin hedge opened', {
        hedgeId,
        orderId: orderResponse?.orderId,
        txDigest: orderResponse?.txDigest,
        elapsed: `${Date.now() - startTime}ms`,
      });

      return {
        success: true,
        hedgeId,
        orderId: orderResponse?.orderId,
        txDigest: orderResponse?.txDigest,
        executionPrice: parseFloat(orderResponse?.avgFillPrice || '0'),
        filledSize: parseFloat(orderResponse?.filledQty || '0'),
        fees: parseFloat(orderResponse?.fee || '0'),
        timestamp: Date.now(),
      };

    } catch (error) {
      logger.error('❌ Failed to open BlueFin hedge', error instanceof Error ? error : undefined);
      return {
        success: false,
        hedgeId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Close a hedge position on BlueFin
   */
  async closeHedge(params: {
    symbol: string;
    size?: number; // If not provided, closes entire position
  }): Promise<BluefinHedgeResult> {
    this.ensureInitialized();

    const hedgeId = `BF_CLOSE_${Date.now()}`;
    const startTime = Date.now();

    try {
      logger.info('🌊 Closing BlueFin position', { symbol: params.symbol, size: params.size });

      // Get current position to determine close side
      const positions = await this.getPositions();
      const position = positions.find(p => p.symbol === params.symbol);

      if (!position) {
        throw new Error(`No open position found for ${params.symbol}`);
      }

      const closeSize = params.size || position.size;
      const closeSide = position.side === 'LONG' ? BluefinSide.SELL : BluefinSide.BUY;

      // Place market order to close
      const orderResponse = await this.apiRequest<{
        orderId: string;
        txDigest: string;
        avgFillPrice: string;
        filledQty: string;
        fee: string;
        realizedPnl: string;
      }>('POST', '/api/v1/orders', {
        symbol: params.symbol,
        side: closeSide,
        orderType: BluefinOrderType.MARKET,
        quantity: closeSize.toString(),
        reduceOnly: true,
        postOnly: false,
        timeInForce: 'IOC',
      });

      logger.info('✅ BlueFin position closed', {
        hedgeId,
        symbol: params.symbol,
        realizedPnl: orderResponse?.realizedPnl,
        elapsed: `${Date.now() - startTime}ms`,
      });

      return {
        success: true,
        hedgeId,
        orderId: orderResponse?.orderId,
        txDigest: orderResponse?.txDigest,
        executionPrice: parseFloat(orderResponse?.avgFillPrice || '0'),
        filledSize: parseFloat(orderResponse?.filledQty || '0'),
        fees: parseFloat(orderResponse?.fee || '0'),
        timestamp: Date.now(),
      };

    } catch (error) {
      logger.error('❌ Failed to close BlueFin position', error instanceof Error ? error : undefined);
      return {
        success: false,
        hedgeId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Get order book for a symbol
   */
  async getOrderBook(symbol: string, depth: number = 10): Promise<{
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  }> {
    this.ensureInitialized();

    try {
      const orderbook = await this.apiRequest<{ bids: [string, string][]; asks: [string, string][] }>(
        'GET',
        `/api/v1/orderbook?symbol=${encodeURIComponent(symbol)}&limit=${depth}`
      );
      return {
        bids: (orderbook?.bids || []).map((b: [string, string]) => ({
          price: parseFloat(b[0]),
          size: parseFloat(b[1]),
        })),
        asks: (orderbook?.asks || []).map((a: [string, string]) => ({
          price: parseFloat(a[0]),
          size: parseFloat(a[1]),
        })),
      };
    } catch (error) {
      logger.error('Failed to get orderbook', error instanceof Error ? error : undefined);
      return { bids: [], asks: [] };
    }
  }

  /**
   * Get funding rate history
   */
  async getFundingRates(symbol: string): Promise<Array<{ time: number; rate: number }>> {
    this.ensureInitialized();

    try {
      const fundingHistory = await this.apiRequest<Array<{ time: number; fundingRate: string }>>(
        'GET',
        `/api/v1/fundingRates?symbol=${encodeURIComponent(symbol)}`
      );
      return (fundingHistory || []).map((f: { time: number; fundingRate: string }) => ({
        time: f.time,
        rate: parseFloat(f.fundingRate),
      }));
    } catch (error) {
      logger.error('Failed to get funding rates', error instanceof Error ? error : undefined);
      return [];
    }
  }

  /**
   * Convert asset symbol to BlueFin pair symbol
   */
  static assetToPair(asset: string): string | null {
    const mapping: Record<string, string> = {
      'BTC': 'BTC-PERP',
      'ETH': 'ETH-PERP',
      'SUI': 'SUI-PERP',
      'SOL': 'SOL-PERP',
      'APT': 'APT-PERP',
      'ARB': 'ARB-PERP',
      'DOGE': 'DOGE-PERP',
      'PEPE': 'PEPE-PERP',
    };
    return mapping[asset.toUpperCase()] || null;
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('BlueFin client not initialized. Call initialize() first.');
    }
  }
}

// Export singleton instance
export const bluefinService = BluefinService.getInstance();

// Export mock service for testing without private key
export class MockBluefinService {
  private positions: Map<string, BluefinPosition> = new Map();

  async openHedge(params: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    leverage: number;
  }): Promise<BluefinHedgeResult> {
    const hedgeId = `MOCK_BF_${Date.now()}`;
    const livePrice = await this.getLivePrice(params.symbol);
    if (livePrice <= 0) {
      return {
        success: false,
        hedgeId: '',
        error: `Could not fetch live price for ${params.symbol}`,
        timestamp: Date.now(),
      };
    }

    // Store position with live price
    this.positions.set(params.symbol, {
      symbol: params.symbol,
      side: params.side,
      size: params.size,
      leverage: params.leverage,
      entryPrice: livePrice,
      markPrice: livePrice,
      liquidationPrice: params.side === 'LONG' 
        ? livePrice * (1 - 0.9 / params.leverage)
        : livePrice * (1 + 0.9 / params.leverage),
      unrealizedPnl: 0,
      margin: params.size * livePrice / params.leverage,
      marginRatio: 1 / params.leverage,
    });

    logger.info('📡 Mock BlueFin hedge opened (live price)', { hedgeId, price: livePrice, ...params });

    return {
      success: true,
      hedgeId,
      orderId: `ORDER_${hedgeId}`,
      txDigest: `TX_${hedgeId}`,
      executionPrice: livePrice,
      filledSize: params.size,
      fees: params.size * livePrice * 0.0005, // 0.05% fee
      timestamp: Date.now(),
    };
  }

  async closeHedge(params: { symbol: string }): Promise<BluefinHedgeResult> {
    const position = this.positions.get(params.symbol);
    if (!position) {
      return {
        success: false,
        hedgeId: '',
        error: `No position found for ${params.symbol}`,
        timestamp: Date.now(),
      };
    }

    const closePrice = await this.getLivePrice(params.symbol) || position.markPrice;
    const pnl = position.side === 'LONG'
      ? (closePrice - position.entryPrice) * position.size
      : (position.entryPrice - closePrice) * position.size;

    this.positions.delete(params.symbol);

    logger.info('🧪 Mock BlueFin position closed', {
      symbol: params.symbol,
      entryPrice: position.entryPrice,
      closePrice,
      pnl,
    });

    return {
      success: true,
      hedgeId: `MOCK_CLOSE_${Date.now()}`,
      executionPrice: closePrice,
      filledSize: position.size,
      fees: position.size * closePrice * 0.0005,
      timestamp: Date.now(),
    };
  }

  async getPositions(): Promise<BluefinPosition[]> {
    return Array.from(this.positions.values());
  }

  private async getLivePrice(symbol: string): Promise<number> {
    // Extract base asset from perp symbol (e.g. 'BTC-PERP' → 'BTC')
    const baseAsset = symbol.replace('-PERP', '');
    try {
      const svc = getMarketDataService();
      const data = await svc.getTokenPrice(baseAsset);
      if (data.price > 0) return data.price;
    } catch (e) {
      logger.warn(`[MockBluefin] Live price fetch failed for ${baseAsset}`, { error: e });
    }
    return 0;
  }
}

export const mockBluefinService = new MockBluefinService();
