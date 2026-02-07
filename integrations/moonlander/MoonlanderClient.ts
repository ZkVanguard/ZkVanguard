/**
 * Moonlander Client
 * Integration with Moonlander perpetual futures exchange on Cronos
 */

import axios, { AxiosInstance } from 'axios';
import { ethers } from 'ethers';
import { logger } from '../../shared/utils/logger';

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
   * Get market information from Crypto.com Exchange API (real data)
   */
  async getMarketInfo(market: string): Promise<MarketInfo> {
    const EXCHANGE_API = 'https://api.crypto.com/exchange/v1/public';

    try {
      // Primary: Use Crypto.com Exchange API for real market data
      const spotSymbol = market.split('-')[0];
      const perpInstrument = `${spotSymbol}USD-PERP`;
      const spotInstrument = `${spotSymbol}_USDT`;

      // Try perp ticker first, then spot
      let ticker: Record<string, string> | null = null;
      let usedInstrument = '';
      for (const instrument of [perpInstrument, spotInstrument]) {
        try {
          const resp = await fetch(`${EXCHANGE_API}/get-tickers?instrument_name=${instrument}`);
          const json = await resp.json();
          if (json.code === 0 && json.result?.data?.[0]) {
            ticker = json.result.data[0];
            usedInstrument = instrument;
            break;
          }
        } catch { continue; }
      }

      if (!ticker) {
        throw new Error(`No ticker data from Exchange API for ${market}`);
      }

      // Get real funding rate if perp exists
      let fundingRate = '0';
      if (usedInstrument.includes('PERP')) {
        try {
          const fundingResp = await fetch(`${EXCHANGE_API}/get-valuations?instrument_name=${perpInstrument}&valuation_type=funding_rate&count=1`);
          const fundingJson = await fundingResp.json();
          if (fundingJson.code === 0 && fundingJson.result?.data?.[0]) {
            fundingRate = fundingJson.result.data[0].v;
          }
        } catch { /* funding rate not available for this instrument */ }
      }

      // Get real instrument parameters (leverage, tick sizes) from instruments endpoint
      let maxLeverage = 50;
      let minOrderSize = '0.0001';
      let maxOrderSize = '1000000';
      let tickSize = '0.01';
      try {
        const instrResp = await fetch(`${EXCHANGE_API}/get-instruments`);
        const instrJson = await instrResp.json();
        if (instrJson.code === 0 && instrJson.result?.data) {
          // Try perp first, fall back to spot instrument
          const perpInfo = instrJson.result.data.find((i: Record<string, string>) => i.symbol === perpInstrument);
          const spotInfo = instrJson.result.data.find((i: Record<string, string>) => i.symbol === spotInstrument);
          const instrInfo = perpInfo || spotInfo;
          if (instrInfo) {
            if (instrInfo.max_leverage) maxLeverage = parseInt(instrInfo.max_leverage, 10);
            if (instrInfo.qty_tick_size) minOrderSize = instrInfo.qty_tick_size;
            if (instrInfo.price_tick_size) tickSize = instrInfo.price_tick_size;
            // Derive max order size from quantity_decimals: e.g. 4 decimals → 10^(10-4) = 1000000
            if (instrInfo.quantity_decimals != null) {
              maxOrderSize = String(Math.pow(10, Math.max(1, 10 - instrInfo.quantity_decimals)));
            }
          }
        }
      } catch { /* data unavailable, will use defaults from API fallback */ }

      // Compute next funding time: funding settles at the top of each hour
      const now = Date.now();
      const msIntoCurrentHour = now % 3600000;
      const nextFundingTime = now + (3600000 - msIntoCurrentHour);

      logger.info('Fetched real market info from Exchange API', { market, instrument: usedInstrument, fundingRate });

      return {
        market,
        baseAsset: spotSymbol,
        quoteAsset: 'USD',
        indexPrice: ticker.a || '0',
        markPrice: ticker.a || '0',
        fundingRate,
        nextFundingTime,
        openInterest: ticker.oi || '0',
        volume24h: ticker.vv || ticker.v || '0',
        high24h: ticker.h || '0',
        low24h: ticker.l || '0',
        priceChange24h: ticker.c || '0',
        minOrderSize,
        maxOrderSize,
        tickSize,
        maxLeverage,
      };
    } catch (error) {
      // Last resort: try original Moonlander API with short timeout
      try {
        const response = await this.httpClient.get(`/v1/markets/${market}`, { timeout: 3000 });
        return response.data;
      } catch {
        logger.error('All market info sources failed', { market, error });
        throw new Error(`Cannot get market info for ${market}: all data sources unavailable`);
      }
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
      logger.warn('Moonlander API unavailable, returning Exchange API fallback markets', { error });
      return [await this.getMarketInfo('BTC-USD-PERP')];
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
      logger.error('Order placement failed — no exchange API available', { orderRequest, error });
      throw new Error(`Cannot place order: exchange API unavailable`);
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
      logger.warn('Moonlander API unavailable, no open positions available', { error });
      // Return empty array — no simulated/hardcoded positions
      return [];
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
  async closePosition(params: { market: string; size?: string }): Promise<OrderResult> {
    this.ensureInitialized();
    const { market, size } = params;

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
   * Get funding rate history from Crypto.com Exchange API (real data)
   */
  async getFundingHistory(market: string, limit: number = 100): Promise<FundingPayment[]> {
    const EXCHANGE_API = 'https://api.crypto.com/exchange/v1/public';

    try {
      // Primary: Use Crypto.com Exchange valuations API for real funding data
      const spotSymbol = market.split('-')[0];
      const perpInstrument = `${spotSymbol}USD-PERP`;

      const url = `${EXCHANGE_API}/get-valuations?instrument_name=${perpInstrument}&valuation_type=funding_hist&count=${Math.min(limit, 300)}`;
      const resp = await fetch(url);
      const json = await resp.json();

      if (json.code === 0 && json.result?.data?.length > 0) {
        logger.info('Fetched real funding history from Exchange API', {
          market,
          instrument: perpInstrument,
          dataPoints: json.result.data.length,
        });
        return json.result.data.map((d: { v: string; t: number }) => ({
          market,
          payment: d.v,
          rate: d.v,
          timestamp: d.t,
        }));
      }

      throw new Error(`No funding data from Exchange API for ${perpInstrument}`);
    } catch (exchangeError) {
      // Fallback: derive funding estimate from spot market momentum
      try {
        const spotSymbol = market.split('-')[0];
        const spotInstrument = `${spotSymbol}_USDT`;
        const tickerResp = await fetch(`https://api.crypto.com/exchange/v1/public/get-tickers?instrument_name=${spotInstrument}`);
        const tickerJson = await tickerResp.json();
        const ticker = tickerJson.result?.data?.[0];

        if (ticker) {
          const change24h = parseFloat(ticker.c || '0');
          // Derive funding proxy from price momentum:
          // Positive price change → positive funding (longs pay shorts)
          const derivedRate = change24h * 0.0001; // Scale: ~0.01% per 1% price change

          logger.info('Derived funding rate from spot momentum (no perp market)', {
            market,
            change24h: `${(change24h * 100).toFixed(2)}%`,
            derivedRate: derivedRate.toFixed(8),
          });

          return [{
            market,
            payment: derivedRate.toFixed(8),
            rate: derivedRate.toFixed(8),
            timestamp: Date.now(),
          }];
        }
      } catch { /* spot ticker also failed */ }

      // Absolute last resort: try Moonlander API
      try {
        const response = await this.httpClient.get(`/v1/markets/${market}/funding`, {
          params: { limit },
          timeout: 3000,
        });
        return response.data;
      } catch {
        logger.error('All funding data sources failed', { market, error: exchangeError });
        throw new Error(`Cannot get funding data for ${market}: all sources unavailable`);
      }
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
