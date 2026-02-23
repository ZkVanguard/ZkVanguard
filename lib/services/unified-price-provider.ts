/**
 * Unified Price Provider
 * 
 * Single source of truth for all real-time prices across the application.
 * Consolidates WebSocket streaming, REST polling, and caching into one service.
 * 
 * Priority Chain:
 * 1. WebSocket stream (real-time, <100ms latency)
 * 2. RealMarketDataService cache (5s refresh)
 * 3. Direct Crypto.com API (fallback)
 * 
 * Used by:
 * - AutoHedgingService (background hedging)
 * - Hedge execute route (order entry)
 * - AI decisions (recommendations)
 * - PnL calculations
 */

import { logger } from '@/lib/utils/logger';
import { EventEmitter } from 'events';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface LivePrice {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
  source: 'websocket' | 'rest' | 'cache' | 'fallback';
  latency: number; // ms since last update
}

export interface PriceValidation {
  isValid: boolean;
  isFresh: boolean;
  staleness: number; // ms since last update
  spreadPercent: number;
  priceSource: string;
  warnings: string[];
}

export interface HedgePriceContext {
  entryPrice: number;
  bidPrice: number;
  askPrice: number;
  effectivePrice: number; // bid for shorts, ask for longs
  slippageEstimate: number;
  validation: PriceValidation;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // WebSocket configuration
  WS_URL: 'wss://stream.crypto.com/exchange/v1/market',
  WS_RECONNECT_DELAY: 2000,
  WS_MAX_RECONNECTS: 10,
  WS_HEARTBEAT_INTERVAL: 30000,
  
  // Cache configuration
  FRESH_THRESHOLD_MS: 1000,   // Price is "fresh" if <1s old
  STALE_THRESHOLD_MS: 5000,   // Price is "stale" if 1-5s old
  EXPIRED_THRESHOLD_MS: 30000, // Price is "expired" if >30s old
  
  // Validation thresholds
  MAX_SPREAD_PERCENT: 1.0,    // Warn if spread > 1%
  MAX_SLIPPAGE_PERCENT: 0.5,  // Expected slippage for orders
  
  // Tracked symbols
  DEFAULT_SYMBOLS: ['BTC', 'ETH', 'CRO', 'SUI', 'SOL', 'DOGE', 'ATOM'],
  
  // Polling fallback interval (only if WebSocket fails)
  FALLBACK_POLL_INTERVAL: 3000,
};

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED PRICE PROVIDER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class UnifiedPriceProvider extends EventEmitter {
  private prices: Map<string, LivePrice> = new Map();
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private trackedSymbols: Set<string> = new Set(CONFIG.DEFAULT_SYMBOLS);
  private lastApiCall = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    logger.info('[UnifiedPrice] Initializing...');
    
    // Start with REST fetch to populate cache immediately
    await this.fetchPricesFromREST();
    
    // Connect WebSocket for real-time updates
    if (typeof WebSocket !== 'undefined') {
      this.connectWebSocket();
    } else {
      // Server-side: use polling fallback
      this.startPolling();
    }
    
    this.initialized = true;
    logger.info('[UnifiedPrice] Initialized', {
      symbols: Array.from(this.trackedSymbols),
      priceCount: this.prices.size,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBSOCKET MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  private connectWebSocket(): void {
    try {
      this.ws = new WebSocket(CONFIG.WS_URL);
      
      this.ws.onopen = () => {
        this.wsConnected = true;
        this.reconnectAttempts = 0;
        logger.info('[UnifiedPrice] WebSocket connected');
        
        // Subscribe to ticker updates
        this.subscribeToTickers();
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Stop polling if running
        this.stopPolling();
        
        this.emit('connected');
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

      this.ws.onerror = (error) => {
        logger.error('[UnifiedPrice] WebSocket error', { error });
        this.emit('error', error);
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
        this.stopHeartbeat();
        logger.warn('[UnifiedPrice] WebSocket disconnected');
        
        // Fallback to polling
        this.startPolling();
        
        // Attempt reconnect
        this.scheduleReconnect();
        
        this.emit('disconnected');
      };
    } catch (error) {
      logger.error('[UnifiedPrice] Failed to create WebSocket', { error });
      this.startPolling();
    }
  }

  private subscribeToTickers(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const symbols = Array.from(this.trackedSymbols);
    const subscriptions = symbols.map(s => `ticker.${s}_USDT`);

    this.ws.send(JSON.stringify({
      id: Date.now(),
      method: 'subscribe',
      params: { channels: subscriptions },
    }));

    logger.debug('[UnifiedPrice] Subscribed to tickers', { symbols });
  }

  private handleWebSocketMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      
      if (msg.method === 'subscribe' && msg.result?.channel?.startsWith('ticker.')) {
        const tickerData = msg.result.data;
        if (tickerData) {
          this.updatePrice({
            symbol: this.extractSymbol(msg.result.channel),
            price: parseFloat(tickerData.a || tickerData.k),
            bid: parseFloat(tickerData.b || tickerData.k),
            ask: parseFloat(tickerData.a || tickerData.k),
            change24h: parseFloat(tickerData.c || 0),
            high24h: parseFloat(tickerData.h || tickerData.k),
            low24h: parseFloat(tickerData.l || tickerData.k),
            volume24h: parseFloat(tickerData.v || 0),
            timestamp: Date.now(),
            source: 'websocket',
            latency: 0,
          });
        }
      }
    } catch (error) {
      // Ignore parse errors for heartbeat messages
    }
  }

  private extractSymbol(channel: string): string {
    // ticker.BTC_USDT -> BTC
    const match = channel.match(/ticker\.([A-Z]+)_USDT/);
    return match ? match[1] : channel;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ id: Date.now(), method: 'public/heartbeat' }));
      }
    }, CONFIG.WS_HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= CONFIG.WS_MAX_RECONNECTS) {
      logger.error('[UnifiedPrice] Max reconnect attempts reached');
      return;
    }

    const delay = CONFIG.WS_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (!this.wsConnected) {
        logger.info('[UnifiedPrice] Attempting WebSocket reconnect', {
          attempt: this.reconnectAttempts,
        });
        this.connectWebSocket();
      }
    }, delay);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REST POLLING (FALLBACK)
  // ═══════════════════════════════════════════════════════════════════════════

  private startPolling(): void {
    if (this.pollTimer) return;

    logger.info('[UnifiedPrice] Starting REST polling fallback');
    
    this.pollTimer = setInterval(async () => {
      if (!this.wsConnected) {
        await this.fetchPricesFromREST();
      }
    }, CONFIG.FALLBACK_POLL_INTERVAL);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logger.debug('[UnifiedPrice] Stopped REST polling');
    }
  }

  async fetchPricesFromREST(): Promise<void> {
    // Rate limit: max 1 call per second
    const now = Date.now();
    if (now - this.lastApiCall < 1000) return;
    this.lastApiCall = now;

    try {
      const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const tickers = data.result?.data || [];

      for (const ticker of tickers) {
        const symbol = this.extractSymbolFromTicker(ticker.i);
        if (this.trackedSymbols.has(symbol)) {
          this.updatePrice({
            symbol,
            price: parseFloat(ticker.a),
            bid: parseFloat(ticker.b),
            ask: parseFloat(ticker.a),
            change24h: parseFloat(ticker.c || 0),
            high24h: parseFloat(ticker.h),
            low24h: parseFloat(ticker.l),
            volume24h: parseFloat(ticker.v),
            timestamp: now,
            source: 'rest',
            latency: Date.now() - now,
          });
        }
      }

      this.emit('pricesUpdated', this.getAllPrices());
    } catch (error) {
      logger.error('[UnifiedPrice] REST fetch failed', { error });
    }
  }

  private extractSymbolFromTicker(instrument: string): string {
    // BTC_USDT -> BTC
    const match = instrument.match(/^([A-Z]+)_USDT$/);
    return match ? match[1] : instrument;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRICE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  private updatePrice(price: LivePrice): void {
    const existing = this.prices.get(price.symbol);
    
    // Only update if newer
    if (!existing || price.timestamp > existing.timestamp) {
      this.prices.set(price.symbol, price);
      this.emit('priceUpdate', price);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current price for a symbol
   * Returns cached price with freshness metadata
   */
  getPrice(symbol: string): LivePrice | null {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const price = this.prices.get(normalizedSymbol);
    
    if (price) {
      return {
        ...price,
        latency: Date.now() - price.timestamp,
      };
    }
    
    return null;
  }

  /**
   * Get price with validation for hedge execution
   * Includes bid/ask spread analysis and staleness checks
   */
  async getHedgePrice(symbol: string, side: 'LONG' | 'SHORT'): Promise<HedgePriceContext> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }
    
    let price = this.prices.get(normalizedSymbol);
    
    // If no cached price or expired, fetch fresh
    if (!price || Date.now() - price.timestamp > CONFIG.EXPIRED_THRESHOLD_MS) {
      await this.fetchPricesFromREST();
      price = this.prices.get(normalizedSymbol);
    }
    
    // Build validation result
    const validation = this.validatePrice(price);
    
    if (!price) {
      return {
        entryPrice: 0,
        bidPrice: 0,
        askPrice: 0,
        effectivePrice: 0,
        slippageEstimate: 0,
        validation: {
          isValid: false,
          isFresh: false,
          staleness: Infinity,
          spreadPercent: 0,
          priceSource: 'none',
          warnings: ['No price data available'],
        },
        timestamp: Date.now(),
      };
    }
    
    // Calculate effective price based on side
    // LONG: we buy at ask price
    // SHORT: we sell at bid price
    const effectivePrice = side === 'LONG' ? price.ask : price.bid;
    const slippageEstimate = Math.abs(effectivePrice - price.price) / price.price * 100;
    
    return {
      entryPrice: price.price,
      bidPrice: price.bid,
      askPrice: price.ask,
      effectivePrice,
      slippageEstimate,
      validation,
      timestamp: Date.now(),
    };
  }

  /**
   * Validate price for hedge execution
   */
  validatePrice(price: LivePrice | null | undefined): PriceValidation {
    if (!price) {
      return {
        isValid: false,
        isFresh: false,
        staleness: Infinity,
        spreadPercent: 0,
        priceSource: 'none',
        warnings: ['No price data available'],
      };
    }
    
    const staleness = Date.now() - price.timestamp;
    const spreadPercent = price.ask > 0 && price.bid > 0
      ? ((price.ask - price.bid) / price.price) * 100
      : 0;
    
    const warnings: string[] = [];
    
    // Check staleness
    const isFresh = staleness < CONFIG.FRESH_THRESHOLD_MS;
    if (staleness > CONFIG.STALE_THRESHOLD_MS) {
      warnings.push(`Price is ${(staleness / 1000).toFixed(1)}s old`);
    }
    
    // Check spread
    if (spreadPercent > CONFIG.MAX_SPREAD_PERCENT) {
      warnings.push(`High spread: ${spreadPercent.toFixed(2)}%`);
    }
    
    // Check source
    if (price.source !== 'websocket') {
      warnings.push(`Using ${price.source} price (not real-time)`);
    }
    
    return {
      isValid: price.price > 0 && staleness < CONFIG.EXPIRED_THRESHOLD_MS,
      isFresh,
      staleness,
      spreadPercent,
      priceSource: price.source,
      warnings,
    };
  }

  /**
   * Get all cached prices
   */
  getAllPrices(): Map<string, LivePrice> {
    return new Map(this.prices);
  }

  /**
   * Add a symbol to track
   */
  trackSymbol(symbol: string): void {
    const normalized = this.normalizeSymbol(symbol);
    if (!this.trackedSymbols.has(normalized)) {
      this.trackedSymbols.add(normalized);
      
      // Subscribe via WebSocket if connected
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          id: Date.now(),
          method: 'subscribe',
          params: { channels: [`ticker.${normalized}_USDT`] },
        }));
      }
    }
  }

  /**
   * Normalize symbol format
   */
  private normalizeSymbol(symbol: string): string {
    let normalized = symbol.toUpperCase()
      .replace('-PERP', '')
      .replace('-USD-PERP', '')
      .replace('-USD', '')
      .replace('_USDT', '');
    
    // Map wrapped tokens to base
    if (normalized === 'WBTC') normalized = 'BTC';
    if (normalized === 'WETH') normalized = 'ETH';
    
    return normalized;
  }

  /**
   * Get connection status
   */
  getStatus(): {
    initialized: boolean;
    wsConnected: boolean;
    priceCount: number;
    trackedSymbols: string[];
    oldestPrice: number;
    newestPrice: number;
  } {
    let oldest = Date.now();
    let newest = 0;
    
    for (const price of this.prices.values()) {
      if (price.timestamp < oldest) oldest = price.timestamp;
      if (price.timestamp > newest) newest = price.timestamp;
    }
    
    return {
      initialized: this.initialized,
      wsConnected: this.wsConnected,
      priceCount: this.prices.size,
      trackedSymbols: Array.from(this.trackedSymbols),
      oldestPrice: oldest,
      newestPrice: newest,
    };
  }

  /**
   * Shutdown the provider
   */
  shutdown(): void {
    this.stopHeartbeat();
    this.stopPolling();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.wsConnected = false;
    this.initialized = false;
    this.initPromise = null;
    
    logger.info('[UnifiedPrice] Shutdown complete');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════════

let instance: UnifiedPriceProvider | null = null;

export function getUnifiedPriceProvider(): UnifiedPriceProvider {
  if (!instance) {
    instance = new UnifiedPriceProvider();
  }
  return instance;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVENIENCE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quick access to current price (for simple use cases)
 */
export async function getLivePrice(symbol: string): Promise<number> {
  const provider = getUnifiedPriceProvider();
  await provider.initialize();
  const price = provider.getPrice(symbol);
  return price?.price ?? 0;
}

/**
 * Get validated price context for hedge execution
 */
export async function getHedgeExecutionPrice(
  symbol: string,
  side: 'LONG' | 'SHORT'
): Promise<HedgePriceContext> {
  const provider = getUnifiedPriceProvider();
  await provider.initialize();
  return provider.getHedgePrice(symbol, side);
}

/**
 * Validate if a price is suitable for hedge execution
 */
export function validatePriceForHedge(price: LivePrice | null): PriceValidation {
  const provider = getUnifiedPriceProvider();
  return provider.validatePrice(price);
}

export { UnifiedPriceProvider };
