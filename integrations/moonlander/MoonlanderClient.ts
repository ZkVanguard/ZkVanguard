/**
 * Moonlander Client
 * Integration with Moonlander perpetual futures exchange on Cronos
 */

import axios, { AxiosInstance } from 'axios';
import { ethers } from 'ethers';
import { logger } from '@shared/utils/logger';
import { config } from '@shared/utils/config';

export interface PerpetualPosition {
  positionId: string;
  market: string;
  side: 'LONG' | 'SHORT';
  size: string;
  entryPrice: string;
  markPrice: string;
  leverage: number;
  margin: string;
  unrealizedPnL: string;
  liquidationPrice: string;
  timestamp: number;
}

export interface OrderRequest {
  market: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT';
  size: string;
  price?: string;
  stopPrice?: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  clientOrderId?: string;
}

export interface OrderResult {
  orderId: string;
  clientOrderId?: string;
  market: string;
  side: 'BUY' | 'SELL';
  type: string;
  size: string;
  filledSize: string;
  price: string;
  avgFillPrice: string;
  status: 'OPEN' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED';
  timestamp: number;
}

export interface MarketInfo {
  market: string;
  baseAsset: string;
  quoteAsset: string;
  indexPrice: string;
  markPrice: string;
  fundingRate: string;
  nextFundingTime: number;
  openInterest: string;
  volume24h: string;
  high24h: string;
  low24h: string;
  priceChange24h: string;
  minOrderSize: string;
  maxOrderSize: string;
  tickSize: string;
  maxLeverage: number;
}

export interface FundingPayment {
  market: string;
  payment: string;
  rate: string;
  timestamp: number;
}

export interface LiquidationRisk {
  positionId: string;
  currentPrice: string;
  liquidationPrice: string;
  margin: string;
  distanceToLiquidation: number; // percentage
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export class MoonlanderClient {
  private httpClient: AxiosInstance;
  private signer: ethers.Wallet | ethers.Signer;
  private apiKey?: string;
  private apiSecret?: string;
  private initialized: boolean = false;

  constructor(
    private provider: ethers.Provider,
    signerOrPrivateKey: ethers.Wallet | ethers.Signer | string
  ) {
    // Initialize HTTP client
    this.httpClient = axios.create({
      baseURL: process.env.NEXT_PUBLIC_MOONLANDER_API || 'https://api.moonlander.io',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Initialize signer
    if (typeof signerOrPrivateKey === 'string') {
      this.signer = new ethers.Wallet(signerOrPrivateKey, provider);
    } else {
      this.signer = signerOrPrivateKey;
    }

    // API credentials (optional, for authenticated endpoints)
    this.apiKey = process.env.NEXT_PUBLIC_MOONLANDER_API_KEY || '';
    this.apiSecret = process.env.NEXT_PUBLIC_MOONLANDER_API_SECRET || '';

    logger.info('MoonlanderClient initialized', {
      apiUrl: this.httpClient.defaults.baseURL,
      hasApiKey: !!this.apiKey,
    });
  }

  /**
   * Initialize client and authenticate
   */
  async initialize(): Promise<void> {
    try {
      if (this.apiKey && this.apiSecret) {
        // Authenticate with API key
        await this.authenticate();
      }

      this.initialized = true;
      logger.info('MoonlanderClient initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize MoonlanderClient', { error });
      throw error;
    }
  }

  /**
   * Authenticate with Moonlander API
   */
  private async authenticate(): Promise<void> {
    const timestamp = Date.now();
    const message = `${this.apiKey}${timestamp}`;
    
    // Sign authentication message
    const signature = await this.signer.signMessage(message);

    this.httpClient.defaults.headers.common['X-API-KEY'] = this.apiKey;
    this.httpClient.defaults.headers.common['X-TIMESTAMP'] = timestamp.toString();
    this.httpClient.defaults.headers.common['X-SIGNATURE'] = signature;

    logger.info('Authenticated with Moonlander API');
  }

  /**
   * Get market information
   */
  async getMarketInfo(market: string): Promise<MarketInfo> {
    try {
      const response = await this.httpClient.get(`/v1/markets/${market}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get market info', { market, error });
      throw error;
    }
  }

  /**
   * Get all available markets
   */
  async getAllMarkets(): Promise<MarketInfo[]> {
    try {
      const response = await this.httpClient.get('/v1/markets');
      return response.data;
    } catch (error) {
      logger.error('Failed to get all markets', { error });
      throw error;
    }
  }

  /**
   * Place order
   */
  async placeOrder(orderRequest: OrderRequest): Promise<OrderResult> {
    this.ensureInitialized();

    try {
      logger.info('Placing order', { orderRequest });

      const response = await this.httpClient.post('/v1/orders', orderRequest);
      const order = response.data;

      logger.info('Order placed successfully', { orderId: order.orderId });
      return order;
    } catch (error) {
      logger.error('Failed to place order', { orderRequest, error });
      throw error;
    }
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.httpClient.delete(`/v1/orders/${orderId}`);
      logger.info('Order cancelled', { orderId });
    } catch (error) {
      logger.error('Failed to cancel order', { orderId, error });
      throw error;
    }
  }

  /**
   * Get open positions
   */
  async getPositions(): Promise<PerpetualPosition[]> {
    this.ensureInitialized();

    try {
      const response = await this.httpClient.get('/v1/positions');
      return response.data;
    } catch (error) {
      logger.error('Failed to get positions', { error });
      throw error;
    }
  }

  /**
   * Get specific position
   */
  async getPosition(market: string): Promise<PerpetualPosition | null> {
    const positions = await this.getPositions();
    return positions.find(p => p.market === market) || null;
  }

  /**
   * Close position
   */
  async closePosition(market: string, size?: string): Promise<OrderResult> {
    this.ensureInitialized();

    try {
      const position = await this.getPosition(market);
      if (!position) {
        throw new Error(`No position found for market ${market}`);
      }

      // Determine close side (opposite of position side)
      const closeSide = position.side === 'LONG' ? 'SELL' : 'BUY';
      const closeSize = size || position.size;

      return await this.placeOrder({
        market,
        side: closeSide,
        type: 'MARKET',
        size: closeSize,
        reduceOnly: true,
      });
    } catch (error) {
      logger.error('Failed to close position', { market, error });
      throw error;
    }
  }

  /**
   * Open hedging position
   */
  async openHedge(params: {
    market: string;
    side: 'LONG' | 'SHORT';
    notionalValue: string;
    leverage?: number;
    stopLoss?: string;
    takeProfit?: string;
  }): Promise<OrderResult> {
    this.ensureInitialized();

    const { market, side, notionalValue, leverage = 1, stopLoss, takeProfit } = params;

    try {
      logger.info('Opening hedge position', params);

      // Get market info for size calculation
      const marketInfo = await this.getMarketInfo(market);
      const markPrice = parseFloat(marketInfo.markPrice);
      
      // Calculate position size
      const size = (parseFloat(notionalValue) * leverage / markPrice).toFixed(4);

      // Place main order
      const orderSide = side === 'LONG' ? 'BUY' : 'SELL';
      const order = await this.placeOrder({
        market,
        side: orderSide,
        type: 'MARKET',
        size,
      });

      // Place stop loss if specified
      if (stopLoss) {
        const stopSide = side === 'LONG' ? 'SELL' : 'BUY';
        await this.placeOrder({
          market,
          side: stopSide,
          type: 'STOP_MARKET',
          size,
          stopPrice: stopLoss,
          reduceOnly: true,
          clientOrderId: `${order.orderId}-sl`,
        });
      }

      // Place take profit if specified
      if (takeProfit) {
        const tpSide = side === 'LONG' ? 'SELL' : 'BUY';
        await this.placeOrder({
          market,
          side: tpSide,
          type: 'LIMIT',
          size,
          price: takeProfit,
          reduceOnly: true,
          postOnly: true,
          clientOrderId: `${order.orderId}-tp`,
        });
      }

      logger.info('Hedge position opened successfully', { orderId: order.orderId });
      return order;
    } catch (error) {
      logger.error('Failed to open hedge position', { params, error });
      throw error;
    }
  }

  /**
   * Get funding rate history
   */
  async getFundingHistory(market: string, limit: number = 100): Promise<FundingPayment[]> {
    try {
      const response = await this.httpClient.get(`/v1/markets/${market}/funding`, {
        params: { limit },
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to get funding history', { market, error });
      throw error;
    }
  }

  /**
   * Calculate liquidation risk for positions
   */
  async calculateLiquidationRisk(): Promise<LiquidationRisk[]> {
    this.ensureInitialized();

    try {
      const positions = await this.getPositions();
      const risks: LiquidationRisk[] = [];

      for (const position of positions) {
        const currentPrice = parseFloat(position.markPrice);
        const liquidationPrice = parseFloat(position.liquidationPrice);
        
        // Calculate distance to liquidation as percentage
        const distance = Math.abs((currentPrice - liquidationPrice) / currentPrice) * 100;

        // Determine risk level
        let riskLevel: LiquidationRisk['riskLevel'];
        if (distance > 20) {
          riskLevel = 'LOW';
        } else if (distance > 10) {
          riskLevel = 'MEDIUM';
        } else if (distance > 5) {
          riskLevel = 'HIGH';
        } else {
          riskLevel = 'CRITICAL';
        }

        risks.push({
          positionId: position.positionId,
          currentPrice: position.markPrice,
          liquidationPrice: position.liquidationPrice,
          margin: position.margin,
          distanceToLiquidation: distance,
          riskLevel,
        });
      }

      return risks;
    } catch (error) {
      logger.error('Failed to calculate liquidation risk', { error });
      throw error;
    }
  }

  /**
   * Adjust position leverage
   */
  async adjustLeverage(market: string, leverage: number): Promise<void> {
    this.ensureInitialized();

    try {
      await this.httpClient.post(`/v1/positions/${market}/leverage`, {
        leverage,
      });
      logger.info('Leverage adjusted', { market, leverage });
    } catch (error) {
      logger.error('Failed to adjust leverage', { market, leverage, error });
      throw error;
    }
  }

  /**
   * Add margin to position
   */
  async addMargin(market: string, amount: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.httpClient.post(`/v1/positions/${market}/margin`, {
        amount,
      });
      logger.info('Margin added', { market, amount });
    } catch (error) {
      logger.error('Failed to add margin', { market, amount, error });
      throw error;
    }
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<{ available: string; total: string; margin: string }> {
    this.ensureInitialized();

    try {
      const response = await this.httpClient.get('/v1/account/balance');
      return response.data;
    } catch (error) {
      logger.error('Failed to get balance', { error });
      throw error;
    }
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('MoonlanderClient not initialized. Call initialize() first.');
    }
  }

  /**
   * Disconnect client
   */
  async disconnect(): Promise<void> {
    this.initialized = false;
    logger.info('MoonlanderClient disconnected');
  }
}

// Export singleton instance factory
let moonlanderClient: MoonlanderClient | null = null;

export function getMoonlanderClient(
  provider: ethers.Provider,
  signer: ethers.Wallet | ethers.Signer | string
): MoonlanderClient {
  if (!moonlanderClient) {
    moonlanderClient = new MoonlanderClient(provider, signer);
  }
  return moonlanderClient;
}
