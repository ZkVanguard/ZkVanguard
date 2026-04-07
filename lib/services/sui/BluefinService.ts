/**
 * BlueFin Pro Perpetual DEX Integration for SUI
 * 
 * BlueFin is the leading orderbook-based perpetual exchange on SUI Network.
 * This service provides hedge execution via BlueFin Pro REST API.
 * 
 * AUTHENTICATION (No API Keys - Wallet Signature Only):
 * - POST /auth/v2/token with BCS-encoded payload signature
 * - Body: { accountAddress, signedAtMillis, audience }
 * - Header: payloadSignature (BCS signature with intent bytes)
 * - Returns JWT tokens for authenticated requests
 * 
 * RATE LIMITS:
 * - auth.api: 30 RPM (token requests)
 * - api: 300 RPM (pro services except trading)
 * - stream.api: 50 RPM (websocket)
 * - trade.api: 500 RPM (trading gateway)
 * 
 * ENDPOINTS:
 * - Auth API: https://auth.api.{env}.bluefin.io/auth/v2/token
 * - Trade API: https://trade.api.{env}.bluefin.io/api/v1/trade/
 * - Exchange API: https://api.{env}.bluefin.io/api/v1/exchange/
 * 
 * Order Fields (e9 scaling - 1e9 = 1.0):
 * - price_e9: Price in e9 format
 * - quantity_e9: Size in e9 format
 * - leverage_e9: Leverage in e9 format (2x = 2000000000)
 * 
 * @see https://bluefin-exchange.readme.io/reference/post_auth-v2-token
 * @see https://bluefin-exchange.readme.io/reference/postcreateorder
 */

import { logger } from '@/lib/utils/logger';
import { getMarketDataService } from '../market-data/RealMarketDataService';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import crypto from 'crypto';

// Network configurations - Updated per BlueFin Pro API docs
export const BLUEFIN_NETWORKS = {
  mainnet: {
    name: 'SUI Mainnet',
    rpcUrl: 'https://fullnode.mainnet.sui.io:443',
    // Auth API for JWT tokens (30 RPM)
    authApiUrl: 'https://auth.api.sui-prod.bluefin.io',
    // Exchange API for market data (300 RPM) - uses /v1/exchange/ paths
    exchangeApiUrl: 'https://api.sui-prod.bluefin.io',
    // Trade API for orders/accounts (500 RPM) - uses /api/v1/ paths
    tradeApiUrl: 'https://trade.api.sui-prod.bluefin.io',
    // WebSocket streams (50 RPM for connection)
    wsUrl: 'wss://stream.api.sui-prod.bluefin.io',
    chainId: 'mainnet',
    // IDS (Independent Data Store) object address from exchange/info contractsConfig
    idsId: '0xa9f033047d2fc453da063b03500a48950d2497bb0a2faec57da2833d42a12806',
    // Audience must be 'api' per SDK source code
    audience: 'api',
  },
  testnet: {
    name: 'SUI Testnet',
    rpcUrl: 'https://fullnode.testnet.sui.io:443',
    // Staging/testnet endpoints
    authApiUrl: 'https://auth.api.sui-staging.bluefin.io',
    exchangeApiUrl: 'https://api.sui-staging.bluefin.io',
    tradeApiUrl: 'https://trade.api.sui-staging.bluefin.io',
    wsUrl: 'wss://stream.api.sui-staging.bluefin.io',
    chainId: 'testnet',
    // IDS (Independent Data Store) object address from exchange/info contractsConfig
    idsId: '0xf19acdacbd086641c7a316d23617fa18bba5d95dab8a02c1281538104f3d4040',
    // Audience must be 'api' per SDK source code
    audience: 'api',
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
 * BlueFin Service - Handles all interactions with BlueFin DEX
 * 
 * Authentication: Wallet signature to get JWT token (no API keys)
 * Rate limiting: Built-in with exponential backoff on 429, respects Retry-After header
 */
export class BluefinService {
  private static instance: BluefinService;
  private initialized: boolean = false;
  private network: 'mainnet' | 'testnet' = 'testnet';
  private keypair: Ed25519Keypair | null = null;
  private walletAddress: string | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number = 0;
  
  // Rate limiting state
  private lastRequestTime: Map<string, number> = new Map();
  private rateLimitRetryAfter: number = 0;

  private constructor() {}

  static getInstance(): BluefinService {
    if (!BluefinService.instance) {
      BluefinService.instance = new BluefinService();
    }
    return BluefinService.instance;
  }

  /**
   * Get service status for diagnostics
   */
  getStatus(): {
    initialized: boolean;
    network: string;
    walletAddress: string | null;
    authenticated: boolean;
  } {
    return {
      initialized: this.initialized,
      network: this.network,
      walletAddress: this.walletAddress,
      authenticated: !!this.accessToken,
    };
  }

  /**
   * Initialize BlueFin client with SUI wallet private key
   * BlueFin Pro uses wallet signature auth (no API keys needed)
   */
  async initialize(privateKey: string, network: 'mainnet' | 'testnet' = 'testnet'): Promise<void> {
    if (this.initialized && this.network === network) {
      return;
    }

    try {
      const networkConfig = BLUEFIN_NETWORKS[network];

      logger.info('🌊 Initializing BlueFin Pro client', { 
        network, 
        authApi: networkConfig.authApiUrl,
        tradeApi: networkConfig.tradeApiUrl 
      });

      // Parse private key - supports bech32 (suiprivkey...) or hex formats
      if (privateKey.startsWith('suiprivkey')) {
        const { secretKey } = decodeSuiPrivateKey(privateKey);
        this.keypair = Ed25519Keypair.fromSecretKey(secretKey);
      } else {
        // Hex format
        const hexKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
        const keyBytes = Buffer.from(hexKey, 'hex');
        this.keypair = Ed25519Keypair.fromSecretKey(keyBytes);
      }

      this.walletAddress = this.keypair.toSuiAddress();
      this.network = network;
      
      // Try to authenticate with BlueFin API
      const authSuccess = await this.authenticate();
      
      if (!authSuccess) {
        logger.warn('⚠️ BlueFin auth failed — service will retry auth on next API call');
      }
      
      this.initialized = true;
      logger.info('✅ BlueFin client initialized', { 
        network, 
        address: this.walletAddress,
        authenticated: authSuccess,
      });

    } catch (error) {
      logger.error('❌ Failed to initialize BlueFin client', error instanceof Error ? error : undefined);
      throw new Error(`BlueFin initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Authenticate with BlueFin Pro /auth/v2/token endpoint
   * Uses SUI signPersonalMessage for wallet signature authentication
   * Returns true if authentication succeeded
   * 
   * Rate limit: 30 RPM on auth.api
   */
  private async authenticate(): Promise<boolean> {
    if (!this.keypair) return false;

    const networkConfig = BLUEFIN_NETWORKS[this.network];
    
    try {
      const signedAtMillis = Date.now();
      const audience = networkConfig.audience;
      
      // Create the auth payload per SDK format
      const authPayload = {
        accountAddress: this.walletAddress,
        signedAtMillis,
        audience,
      };
      
      // Serialize payload for signing
      const payloadString = JSON.stringify(authPayload);
      const messageBytes = new TextEncoder().encode(payloadString);
      
      // Sign using SUI's signPersonalMessage which handles:
      // - BCS encoding message as vector<u8>
      // - Adding PersonalMessage intent prefix
      // - Blake2b hashing
      // - Creating serialized signature (flag + signature + pubkey in base64)
      const { signature: payloadSignature } = await this.keypair.signPersonalMessage(messageBytes);
      
      logger.debug('BlueFin Pro auth attempt', { 
        address: this.walletAddress, 
        network: this.network,
        authUrl: `${networkConfig.authApiUrl}/auth/v2/token`
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${networkConfig.authApiUrl}/auth/v2/token`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'payloadSignature': payloadSignature,
        },
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        this.rateLimitRetryAfter = Date.now() + (retryAfter * 1000);
        logger.warn('BlueFin auth rate limited', { retryAfter });
        return false;
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn('BlueFin Pro auth failed', { 
          status: response.status, 
          error: errorText.slice(0, 200),
          network: this.network
        });
        return false;
      }

      const data = await response.json();
      this.accessToken = data.accessToken || data.token;
      this.refreshToken = data.refreshToken;
      
      // Token typically valid for 30 days, but refresh before expiry
      if (data.expiresIn) {
        this.tokenExpiresAt = Date.now() + (data.expiresIn * 1000) - 60000; // Refresh 1 min early
      } else {
        this.tokenExpiresAt = Date.now() + (24 * 60 * 60 * 1000); // Default 24 hours
      }
      
      if (this.accessToken) {
        logger.info('✅ BlueFin Pro authentication successful');
        return true;
      }
      
      logger.warn('BlueFin Pro: No token in response');
      return false;
      
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.debug('BlueFin Pro auth error', { error: errMsg });
      return false;
    }
  }
  
  /**
   * Ensure we have a valid access token, refreshing if needed
   */
  private async ensureValidToken(): Promise<boolean> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      return await this.authenticate();
    }
    return true;
  }

  /**
   * Sign order fields with SUI wallet using signPersonalMessage
   * Transforms fields to BlueFin Pro UI format and signs
   * 
   * Per SDK: fields are transformed to UI format, pretty-printed JSON,
   * then signed with signPersonalMessage
   */
  private async signOrderFields(signedFields: {
    idsId: string;
    accountAddress: string;
    symbol: string;
    priceE9: string;
    quantityE9: string;
    leverageE9: string;
    side: string;
    isIsolated: boolean;
    expiresAtMillis: number;
    salt: string;
    signedAtMillis: number;
  }): Promise<string> {
    if (!this.keypair) throw new Error('Keypair not initialized');
    
    // Transform to UI format per SDK's toUICreateOrderRequest
    const uiOrderRequest = {
      type: 'Bluefin Pro Order',
      ids: signedFields.idsId,
      account: signedFields.accountAddress,
      market: signedFields.symbol,
      price: signedFields.priceE9,
      quantity: signedFields.quantityE9,
      leverage: signedFields.leverageE9,
      side: signedFields.side.toString(),
      positionType: signedFields.isIsolated ? 'ISOLATED' : 'CROSS',
      expiration: signedFields.expiresAtMillis.toString(),
      salt: signedFields.salt,
      signedAt: signedFields.signedAtMillis.toString(),
    };
    
    // SDK uses pretty-printed JSON with 2-space indent
    const orderJson = JSON.stringify(uiOrderRequest, null, 2);
    const messageBytes = new TextEncoder().encode(orderJson);
    
    // Sign using signPersonalMessage
    const { signature } = await this.keypair.signPersonalMessage(messageBytes);
    
    // Return the base64 serialized signature
    return signature;
  }

  /**
   * Make authenticated API request to BlueFin Trade API
   * Handles rate limiting with exponential backoff and Retry-After header
   * 
   * Rate limit: 500 RPM on trade.api
   */
  private async apiRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    apiType: 'trade' | 'exchange' = 'trade'
  ): Promise<T> {
    // Check if we're rate limited
    if (Date.now() < this.rateLimitRetryAfter) {
      const waitTime = Math.ceil((this.rateLimitRetryAfter - Date.now()) / 1000);
      throw new Error(`Rate limited. Retry after ${waitTime} seconds`);
    }
    
    // Ensure we have a valid token
    await this.ensureValidToken();
    
    const networkConfig = BLUEFIN_NETWORKS[this.network];
    const baseUrl = apiType === 'exchange' ? networkConfig.exchangeApiUrl : networkConfig.tradeApiUrl;
    const url = `${baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Add auth token if available
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const requestBody = method !== 'GET' && body ? JSON.stringify(body) : undefined;
      const response = await fetch(url, {
        method,
        headers,
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        this.rateLimitRetryAfter = Date.now() + (retryAfter * 1000);
        logger.warn('BlueFin API rate limited', { retryAfter, path });
        throw new Error(`Rate limited. Retry after ${retryAfter} seconds`);
      }

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`BlueFin API error: ${response.status} - ${error}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
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
    await this.ensureInitializedAsync();

    try {
      const data = await this.apiRequest<{ freeCollateral: string }>('GET', '/api/v1/account');
      return parseFloat(data?.freeCollateral || '0');
    } catch (error) {
      logger.error('Failed to get BlueFin balance', error instanceof Error ? error : undefined);
      return 0;
    }
  }

  /**
   * Get all open positions from account data
   * Uses Exchange API: /api/v1/account (same host as market data)
   * Falls back to empty array if API is unavailable
   */
  async getPositions(): Promise<BluefinPosition[]> {
    await this.ensureInitializedAsync();

    try {
      // Account data is on the exchange API host (api.sui-staging), not trade API
      const account = await this.apiRequest<{
        positions?: Array<Record<string, unknown>>;
      }>('GET', '/api/v1/account', undefined, 'exchange');
      
      const positions = account?.positions || [];
      return positions.map((p: Record<string, unknown>) => ({
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
      // Log at debug level - exchange API may be temporarily unavailable on testnet
      logger.debug('Failed to get BlueFin positions', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return [];
    }
  }

  /**
   * Get open orders from Trade API
   * Uses Trade API: /api/v1/trade/openOrders
   */
  async getOpenOrders(): Promise<Array<{
    orderId: string;
    symbol: string;
    side: string;
    price: number;
    quantity: number;
    status: string;
  }>> {
    await this.ensureInitializedAsync();

    try {
      const orders = await this.apiRequest<Array<Record<string, unknown>>>(
        'GET',
        '/api/v1/trade/openOrders',
        undefined,
        'trade'
      );
      return (orders || []).map(o => ({
        orderId: o.orderId as string || o.orderHash as string,
        symbol: o.symbol as string,
        side: o.side as string,
        price: parseFloat(o.price as string || '0'),
        quantity: parseFloat(o.quantity as string || '0'),
        status: o.status as string || 'OPEN',
      }));
    } catch (error) {
      logger.debug('Failed to get BlueFin open orders', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return [];
    }
  }

  /**
   * Get market data for a symbol
   * Uses Exchange API: /v1/exchange/ticker
   * Note: Prices are in E9 format (multiply by 1e-9 to get decimal)
   * Falls back to null if exchange API is unavailable
   */
  async getMarketData(symbol: string): Promise<{ price: number; fundingRate: number; change24h?: number } | null> {
    await this.ensureInitializedAsync();

    try {
      // Response uses E9 format: lastPriceE9, fundingRateE9, etc.
      const marketData = await this.apiRequest<{ 
        lastPriceE9?: string;
        lastPrice?: string;  // Some responses may use non-E9 format
        lastFundingRateE9?: string;
        fundingRate?: string;
        priceChangePercent24hrE9?: string;
        priceChange24h?: string;
      }>(
        'GET',
        `/v1/exchange/ticker?symbol=${encodeURIComponent(symbol)}`,
        undefined,
        'exchange'
      );
      
      // Parse E9 format prices (divide by 1e9)
      let price = 0;
      if (marketData?.lastPriceE9) {
        price = parseFloat(marketData.lastPriceE9) / 1e9;
      } else if (marketData?.lastPrice) {
        price = parseFloat(marketData.lastPrice);
      }
      
      let fundingRate = 0;
      if (marketData?.lastFundingRateE9) {
        fundingRate = parseFloat(marketData.lastFundingRateE9) / 1e9;
      } else if (marketData?.fundingRate) {
        fundingRate = parseFloat(marketData.fundingRate);
      }
      
      let change24h: number | undefined;
      if (marketData?.priceChangePercent24hrE9) {
        change24h = parseFloat(marketData.priceChangePercent24hrE9) / 1e9 * 100; // Convert to percentage
      } else if (marketData?.priceChange24h) {
        change24h = parseFloat(marketData.priceChange24h);
      }
      
      return { price, fundingRate, change24h };
    } catch (error) {
      // Log at debug level - exchange API may be temporarily unavailable on testnet
      logger.debug('Failed to get market data', { 
        symbol, 
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Open a hedge position on BlueFin
   * Uses wallet signature authentication per BlueFin API docs
   */
  async openHedge(params: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    leverage: number;
    portfolioId?: number;
    reason?: string;
  }): Promise<BluefinHedgeResult> {
    await this.ensureInitializedAsync();

    const hedgeId = `BF_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const startTime = Date.now();

    try {
      logger.info('🌊 Opening BlueFin hedge', {
        symbol: params.symbol,
        side: params.side,
        size: params.size,
        leverage: params.leverage,
      });

      // Check if account is onboarded on BlueFin
      try {
        const acctResp = await this.apiRequest<{ freeCollateral?: string } | null>('GET', '/api/v1/account');
        if (!acctResp) {
          throw new Error(`BlueFin account ${this.walletAddress} not found. Please onboard at https://trade.bluefin.io/pro (mainnet) or https://testnet.bluefin.io/perps (testnet) first.`);
        }
      } catch (acctError) {
        const msg = acctError instanceof Error ? acctError.message : String(acctError);
        if (msg.includes('404') || msg.includes('not found')) {
          throw new Error(`BlueFin account ${this.walletAddress} not onboarded. Visit https://trade.bluefin.io/pro (mainnet) or https://testnet.bluefin.io/perps (testnet) to register.`);
        }
      }

      // Validate pair
      const pair = Object.values(BLUEFIN_PAIRS).find(p => p.symbol === params.symbol);
      if (!pair) {
        throw new Error(`Invalid pair: ${params.symbol}. Available: ${Object.keys(BLUEFIN_PAIRS).join(', ')}`);
      }

      // Check leverage limits
      if (params.leverage > pair.maxLeverage) {
        throw new Error(`Leverage ${params.leverage}x exceeds max ${pair.maxLeverage}x for ${params.symbol}`);
      }

      // Get current market price for market orders
      const marketData = await this.getMarketData(params.symbol);
      const currentPrice = marketData?.price || 0;
      if (currentPrice <= 0) {
        throw new Error(`Could not get market price for ${params.symbol}`);
      }

      // BlueFin uses e9 scaling (1e9 = 1.0)
      const quantityE9 = Math.floor(params.size * 1e9).toString();
      const leverageE9 = Math.floor(params.leverage * 1e9).toString();
      // For market orders, use a price with slippage buffer
      const slippageMultiplier = params.side === 'LONG' ? 1.01 : 0.99; // 1% slippage
      const limitPriceE9 = Math.floor(currentPrice * slippageMultiplier * 1e9).toString();
      // MARKET orders require price=0 in signedFields; LIMIT orders use the limit price
      const priceE9 = '0';
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
      const signedAtMillis = Date.now();
      const salt = (Date.now() + crypto.randomInt(1000000)).toString();

      // Create signedFields object per BlueFin Pro SDK format
      // Uses SDK-compatible field names (camelCase)
      const networkConfig = BLUEFIN_NETWORKS[this.network];
      const signedFields = {
        idsId: networkConfig.idsId,
        accountAddress: this.walletAddress!,
        symbol: params.symbol,
        priceE9: priceE9,
        quantityE9: quantityE9,
        leverageE9: leverageE9,
        side: params.side, // LONG or SHORT
        isIsolated: false,
        expiresAtMillis: expiresAt,
        salt,
        signedAtMillis,
      };

      // Sign the fields with wallet
      const signature = await this.signOrderFields(signedFields);

      // Submit order to BlueFin Pro Trade API
      // POST /api/v1/trade/orders
      const orderResponse = await this.apiRequest<{
        orderHash: string;
        orderId?: string;
        txDigest?: string;
        avgFillPrice?: string;
        filledQty?: string;
        fee?: string;
      }>('POST', '/api/v1/trade/orders', {
        signedFields,
        signature,
        clientOrderId: hedgeId,
        type: 'MARKET',
        reduceOnly: false,
      });

      logger.info('✅ BlueFin hedge opened', {
        hedgeId,
        orderHash: orderResponse?.orderHash,
        txDigest: orderResponse?.txDigest,
        elapsed: `${Date.now() - startTime}ms`,
      });

      return {
        success: true,
        hedgeId,
        orderId: orderResponse?.orderHash || orderResponse?.orderId,
        txDigest: orderResponse?.txDigest,
        executionPrice: parseFloat(orderResponse?.avgFillPrice || String(currentPrice)),
        filledSize: parseFloat(orderResponse?.filledQty || String(params.size)),
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
   * Dry-run validation of a hedge — tests everything except actual order submission.
   * Validates: auth, account onboarding, pair, leverage, market data, order construction, signing.
   * Returns detailed step-by-step results for pre-mainnet verification.
   */
  async dryRunHedge(params: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    leverage: number;
  }): Promise<{
    success: boolean;
    steps: { step: string; passed: boolean; detail: string }[];
    order?: Record<string, unknown>;
    error?: string;
  }> {
    await this.ensureInitializedAsync();
    const steps: { step: string; passed: boolean; detail: string }[] = [];

    try {
      // Step 1: Authentication
      const hasToken = !!this.accessToken;
      steps.push({ step: 'auth', passed: hasToken, detail: hasToken ? `JWT token acquired for ${this.walletAddress}` : 'No token — auth failed' });
      if (!hasToken) return { success: false, steps, error: 'Authentication failed' };

      // Step 2: Account onboarding check
      let accountOnboarded = false;
      let freeCollateral = '0';
      try {
        const acctResp = await this.apiRequest<{ freeCollateral?: string } | null>('GET', '/api/v1/account');
        accountOnboarded = !!acctResp;
        freeCollateral = acctResp?.freeCollateral || '0';
        steps.push({ step: 'account', passed: true, detail: `Onboarded, freeCollateral=${freeCollateral}` });
      } catch {
        steps.push({ step: 'account', passed: false, detail: `Account ${this.walletAddress} NOT onboarded — register at https://trade.bluefin.io/pro (mainnet) or https://testnet.bluefin.io/perps (testnet)` });
      }

      // Step 3: Validate pair
      const pair = Object.values(BLUEFIN_PAIRS).find(p => p.symbol === params.symbol);
      if (!pair) {
        steps.push({ step: 'pair', passed: false, detail: `Invalid pair: ${params.symbol}` });
        return { success: false, steps, error: `Invalid pair: ${params.symbol}` };
      }
      steps.push({ step: 'pair', passed: true, detail: `${pair.symbol} — maxLeverage=${pair.maxLeverage}x` });

      // Step 4: Leverage
      const leverageOk = params.leverage <= pair.maxLeverage;
      steps.push({ step: 'leverage', passed: leverageOk, detail: `${params.leverage}x (max ${pair.maxLeverage}x)` });

      // Step 5: Market data
      const marketData = await this.getMarketData(params.symbol);
      const price = marketData?.price || 0;
      steps.push({
        step: 'market-data',
        passed: price > 0,
        detail: price > 0 ? `${params.symbol} price=$${price.toFixed(2)}, funding=${marketData?.fundingRate?.toFixed(6) || 'n/a'}` : 'No price data',
      });

      // Step 6: Order construction
      const quantityE9 = Math.floor(params.size * 1e9).toString();
      const leverageE9 = Math.floor(params.leverage * 1e9).toString();
      const expiresAt = Date.now() + 10 * 60 * 1000;
      const signedAtMillis = Date.now();
      const salt = (Date.now() + crypto.randomInt(1000000)).toString();
      const networkConfig = BLUEFIN_NETWORKS[this.network];

      const signedFields = {
        idsId: networkConfig.idsId,
        accountAddress: this.walletAddress!,
        symbol: params.symbol,
        priceE9: '0',
        quantityE9,
        leverageE9,
        side: params.side,
        isIsolated: false,
        expiresAtMillis: expiresAt,
        salt,
        signedAtMillis,
      };

      const notionalValue = params.size * price;
      steps.push({
        step: 'order-construction',
        passed: true,
        detail: `${params.side} ${params.size.toFixed(6)} ${pair.baseAsset} (~$${notionalValue.toFixed(2)}) @ market, 1x leverage`,
      });

      // Step 7: Signature
      try {
        const signature = await this.signOrderFields(signedFields);
        steps.push({ step: 'signature', passed: !!signature, detail: `Signed (${signature.slice(0, 20)}...)` });

        // Return the constructed order for inspection
        const allPassed = steps.every(s => s.passed);
        return {
          success: allPassed,
          steps,
          order: {
            signedFields,
            signature: signature.slice(0, 30) + '...',
            type: 'MARKET',
            notionalValueUsd: notionalValue,
            wouldSubmitTo: `${networkConfig.tradeApiUrl}/api/v1/trade/orders`,
          },
        };
      } catch (sigErr) {
        steps.push({ step: 'signature', passed: false, detail: `Signing failed: ${sigErr instanceof Error ? sigErr.message : String(sigErr)}` });
        return { success: false, steps, error: 'Signature failed' };
      }
    } catch (error) {
      return { success: false, steps, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Close a hedge position on BlueFin
   * Uses wallet signature authentication per BlueFin API docs
   */
  async closeHedge(params: {
    symbol: string;
    size?: number; // If not provided, closes entire position
  }): Promise<BluefinHedgeResult> {
    await this.ensureInitializedAsync();

    const hedgeId = `BF_CLOSE_${Date.now()}`;
    const startTime = Date.now();

    try {
      logger.info('🌊 Closing BlueFin position', { symbol: params.symbol, size: params.size });

      // Get current position to determine close side and size
      const positions = await this.getPositions();
      const position = positions.find(p => p.symbol === params.symbol);

      if (!position) {
        throw new Error(`No open position found for ${params.symbol}`);
      }

      const closeSize = params.size || position.size;
      const closeSide = position.side === 'LONG' ? 'SHORT' : 'LONG';

      // Get current market price
      const marketData = await this.getMarketData(params.symbol);
      const currentPrice = marketData?.price || position.markPrice;

      // BlueFin uses e9 scaling
      const quantityE9 = Math.floor(closeSize * 1e9).toString();
      const slippageMultiplier = closeSide === 'LONG' ? 1.01 : 0.99;
      const limitPriceE9 = Math.floor(currentPrice * slippageMultiplier * 1e9).toString();
      // MARKET orders require price=0
      const priceE9 = '0';
      const expiresAt = Date.now() + 10 * 60 * 1000;
      const signedAtMillis = Date.now();
      const salt = (Date.now() + crypto.randomInt(1000000)).toString();

      // Create signedFields for close order per SDK format
      const networkConfig = BLUEFIN_NETWORKS[this.network];
      const signedFields = {
        idsId: networkConfig.idsId,
        accountAddress: this.walletAddress!,
        symbol: params.symbol,
        priceE9: priceE9,
        quantityE9: quantityE9,
        leverageE9: '1000000000', // 1x leverage for close
        side: closeSide,
        isIsolated: false,
        expiresAtMillis: expiresAt,
        salt,
        signedAtMillis,
      };

      const signature = await this.signOrderFields(signedFields);

      // Submit close order
      const orderResponse = await this.apiRequest<{
        orderHash: string;
        txDigest?: string;
        avgFillPrice?: string;
        filledQty?: string;
        fee?: string;
        realizedPnl?: string;
      }>('POST', '/api/v1/trade/orders', {
        signedFields,
        signature,
        clientOrderId: hedgeId,
        type: 'MARKET',
        reduceOnly: true,
      });

      logger.info('✅ BlueFin position closed', {
        hedgeId,
        symbol: params.symbol,
        orderHash: orderResponse?.orderHash,
        realizedPnl: orderResponse?.realizedPnl,
        elapsed: `${Date.now() - startTime}ms`,
      });

      return {
        success: true,
        hedgeId,
        orderId: orderResponse?.orderHash,
        txDigest: orderResponse?.txDigest,
        executionPrice: parseFloat(orderResponse?.avgFillPrice || String(currentPrice)),
        filledSize: parseFloat(orderResponse?.filledQty || String(closeSize)),
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
    await this.ensureInitializedAsync();

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
    await this.ensureInitializedAsync();

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
   * Ensure client is initialized - auto-initializes from env vars if not already initialized
   */
  private async ensureInitializedAsync(): Promise<void> {
    if (!this.initialized) {
      const privateKey = process.env.BLUEFIN_PRIVATE_KEY;
      const network = (process.env.SUI_NETWORK || 'testnet') as 'mainnet' | 'testnet';
      
      if (!privateKey) {
        throw new Error('BlueFin client not initialized. Set BLUEFIN_PRIVATE_KEY or call initialize() first.');
      }
      
      await this.initialize(privateKey, network);
    }
  }

  /**
   * Sync version for backward compatibility - throws if not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('BlueFin client not initialized. Call initialize() first or use async methods.');
    }
  }
}

// Export singleton instance
export const bluefinService = BluefinService.getInstance();
