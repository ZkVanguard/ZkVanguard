/**
 * Price Monitor Agent
 * 
 * REAL autonomous agent that monitors cryptocurrency prices and triggers alerts/actions
 * Uses x402 for any required on-chain settlements
 */

import { logger } from '../../lib/utils/logger';
import { X402FacilitatorService } from '../../lib/services/x402-facilitator';
import { CronosNetwork } from '@crypto.com/facilitator-client';

// Price thresholds for different alert levels
export interface PriceAlert {
  id: string;
  symbol: string;
  type: 'above' | 'below' | 'change_percent';
  threshold: number;
  action: 'alert' | 'hedge' | 'rebalance';
  active: boolean;
  lastTriggered?: number;
  createdAt: number;
}

export interface PriceData {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  timestamp: number;
  source: string;
}

export interface MonitorConfig {
  pollingIntervalMs: number;
  enableX402Settlement: boolean;
  alertWebhookUrl?: string;
}

// Configurable price feeds - using Crypto.com API
const PRICE_FEEDS: Record<string, string> = {
  BTC: 'https://api.crypto.com/v2/public/get-ticker?instrument_name=BTC_USDT',
  ETH: 'https://api.crypto.com/v2/public/get-ticker?instrument_name=ETH_USDT',
  CRO: 'https://api.crypto.com/v2/public/get-ticker?instrument_name=CRO_USDT',
};

/**
 * PriceMonitorAgent - Autonomous price monitoring with x402 settlement
 */
export class PriceMonitorAgent {
  private alerts: Map<string, PriceAlert> = new Map();
  private priceHistory: Map<string, PriceData[]> = new Map();
  private isRunning: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private config: MonitorConfig;
  private x402Service: X402FacilitatorService;
  private subscribers: Set<(event: MonitorEvent) => void> = new Set();

  constructor(config: Partial<MonitorConfig> = {}) {
    this.config = {
      pollingIntervalMs: config.pollingIntervalMs || 10000, // 10 seconds default
      enableX402Settlement: config.enableX402Settlement ?? true,
      alertWebhookUrl: config.alertWebhookUrl,
    };
    this.x402Service = new X402FacilitatorService(CronosNetwork.CronosTestnet);
    logger.info('PriceMonitorAgent initialized', { config: this.config });
  }

  /**
   * Start the autonomous monitoring loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Price monitor already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting price monitor agent');
    this.emit({ type: 'agent_started', timestamp: Date.now() });

    // Initial price fetch
    await this.fetchAllPrices();

    // Start polling loop
    this.pollingInterval = setInterval(async () => {
      try {
        await this.monitoringLoop();
      } catch (error) {
        logger.error('Monitoring loop error', { error });
        this.emit({ type: 'error', error: String(error), timestamp: Date.now() });
      }
    }, this.config.pollingIntervalMs);
  }

  /**
   * Stop the monitoring agent
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    logger.info('Price monitor agent stopped');
    this.emit({ type: 'agent_stopped', timestamp: Date.now() });
  }

  /**
   * Main monitoring loop - runs every polling interval
   */
  private async monitoringLoop(): Promise<void> {
    // Fetch latest prices
    const prices = await this.fetchAllPrices();

    // Check all alerts
    for (const alert of this.alerts.values()) {
      if (!alert.active) continue;

      const priceData = prices.get(alert.symbol);
      if (!priceData) continue;

      const triggered = this.checkAlertCondition(alert, priceData);
      if (triggered) {
        await this.handleAlertTriggered(alert, priceData);
      }
    }

    // Emit price update event
    this.emit({
      type: 'price_update',
      prices: Object.fromEntries(prices),
      timestamp: Date.now(),
    });
  }

  /**
   * Fetch prices from all configured feeds
   */
  private async fetchAllPrices(): Promise<Map<string, PriceData>> {
    const prices = new Map<string, PriceData>();

    for (const [symbol, url] of Object.entries(PRICE_FEEDS)) {
      try {
        const priceData = await this.fetchPrice(symbol, url);
        if (priceData) {
          prices.set(symbol, priceData);
          
          // Store in history
          const history = this.priceHistory.get(symbol) || [];
          history.push(priceData);
          // Keep last 1000 data points
          if (history.length > 1000) history.shift();
          this.priceHistory.set(symbol, history);
        }
      } catch (error) {
        logger.error(`Failed to fetch ${symbol} price`, { error });
      }
    }

    return prices;
  }

  /**
   * Fetch single price from Crypto.com API with fallback to RealMarketDataService
   */
  private async fetchPrice(symbol: string, url: string): Promise<PriceData | null> {
    // Try primary Crypto.com API first
    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Crypto.com API response format
      if (data.result?.data) {
        const ticker = data.result.data;
        return {
          symbol,
          price: parseFloat(ticker.a || ticker.k),
          change24h: parseFloat(ticker.c || '0'),
          volume24h: parseFloat(ticker.v || '0'),
          timestamp: Date.now(),
          source: 'crypto.com',
        };
      }

      throw new Error('Invalid API response format');
    } catch (primaryError) {
      logger.warn(`Primary Crypto.com API failed for ${symbol}, trying RealMarketDataService`, { error: primaryError });
      
      // Fallback to RealMarketDataService which uses Crypto.com Exchange API
      try {
        const { realMarketDataService } = await import('../../lib/services/RealMarketDataService');
        const marketData = await realMarketDataService.getTokenPrice(symbol);
        
        return {
          symbol,
          price: marketData.price,
          change24h: marketData.change24h || 0,
          volume24h: marketData.volume24h || 0,
          timestamp: Date.now(),
          source: marketData.source || 'cryptocom-exchange',
        };
      } catch (fallbackError) {
        logger.error(`All price sources failed for ${symbol}`, { primaryError, fallbackError });
        // Return null instead of mock data - let caller handle missing price
        return null;
      }
    }
  }

  /**
   * Check if alert condition is met
   */
  private checkAlertCondition(alert: PriceAlert, price: PriceData): boolean {
    switch (alert.type) {
      case 'above':
        return price.price > alert.threshold;
      case 'below':
        return price.price < alert.threshold;
      case 'change_percent':
        return Math.abs(price.change24h) > alert.threshold;
      default:
        return false;
    }
  }

  /**
   * Handle triggered alert - execute action
   */
  private async handleAlertTriggered(alert: PriceAlert, price: PriceData): Promise<void> {
    // Cooldown: don't trigger same alert within 5 minutes
    if (alert.lastTriggered && Date.now() - alert.lastTriggered < 300000) {
      return;
    }

    alert.lastTriggered = Date.now();
    this.alerts.set(alert.id, alert);

    logger.info('Alert triggered', { alert, price });
    this.emit({
      type: 'alert_triggered',
      alert,
      price,
      timestamp: Date.now(),
    });

    // Execute action
    switch (alert.action) {
      case 'hedge':
        await this.executeHedgeAction(alert, price);
        break;
      case 'rebalance':
        await this.executeRebalanceAction(alert, price);
        break;
      case 'alert':
      default:
        // Just emit notification
        break;
    }
  }

  /**
   * Execute hedge action via x402
   */
  private async executeHedgeAction(alert: PriceAlert, price: PriceData): Promise<void> {
    if (!this.config.enableX402Settlement) {
      logger.info('x402 settlement disabled, skipping hedge execution');
      return;
    }

    try {
      // Create x402 payment challenge for hedge execution fee
      const challenge = await this.x402Service.createPaymentChallenge({
        amount: 0.01,
        currency: 'USDC',
        description: `Hedge execution for ${alert.symbol} at $${price.price.toFixed(2)}`,
        resource: `/agent/hedge/${alert.id}`,
        expiry: 60,
      });

      this.emit({
        type: 'hedge_initiated',
        alert,
        price,
        challenge,
        timestamp: Date.now(),
      });

      logger.info('Hedge action initiated via x402', { 
        paymentId: challenge.accepts?.[0]?.extra?.paymentId,
        symbol: alert.symbol,
      });
    } catch (error) {
      logger.error('Hedge action failed', { error });
    }
  }

  /**
   * Execute rebalance action
   */
  private async executeRebalanceAction(alert: PriceAlert, price: PriceData): Promise<void> {
    logger.info('Rebalance action triggered', { alert, price });
    this.emit({
      type: 'rebalance_initiated',
      alert,
      price,
      timestamp: Date.now(),
    });
  }

  /**
   * Add a price alert
   */
  addAlert(alert: Omit<PriceAlert, 'id' | 'createdAt'>): string {
    const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullAlert: PriceAlert = {
      ...alert,
      id,
      createdAt: Date.now(),
    };
    this.alerts.set(id, fullAlert);
    logger.info('Alert added', { alert: fullAlert });
    return id;
  }

  /**
   * Remove a price alert
   */
  removeAlert(id: string): boolean {
    return this.alerts.delete(id);
  }

  /**
   * Get all alerts
   */
  getAlerts(): PriceAlert[] {
    return Array.from(this.alerts.values());
  }

  /**
   * Get price history for a symbol
   */
  getPriceHistory(symbol: string, limit: number = 100): PriceData[] {
    const history = this.priceHistory.get(symbol) || [];
    return history.slice(-limit);
  }

  /**
   * Get current price for a symbol
   */
  getCurrentPrice(symbol: string): PriceData | undefined {
    const history = this.priceHistory.get(symbol);
    return history?.[history.length - 1];
  }

  /**
   * Subscribe to monitor events
   */
  subscribe(callback: (event: MonitorEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Emit event to all subscribers
   */
  private emit(event: MonitorEvent): void {
    this.subscribers.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        logger.error('Subscriber error', { error });
      }
    });
  }

  /**
   * Get agent status
   */
  getStatus(): AgentStatus {
    return {
      isRunning: this.isRunning,
      alertCount: this.alerts.size,
      trackedSymbols: Object.keys(PRICE_FEEDS),
      pollingIntervalMs: this.config.pollingIntervalMs,
      x402Enabled: this.config.enableX402Settlement,
    };
  }
}

// Event types
export type MonitorEvent =
  | { type: 'agent_started'; timestamp: number }
  | { type: 'agent_stopped'; timestamp: number }
  | { type: 'price_update'; prices: Record<string, PriceData>; timestamp: number }
  | { type: 'alert_triggered'; alert: PriceAlert; price: PriceData; timestamp: number }
  | { type: 'hedge_initiated'; alert: PriceAlert; price: PriceData; challenge: unknown; timestamp: number }
  | { type: 'rebalance_initiated'; alert: PriceAlert; price: PriceData; timestamp: number }
  | { type: 'error'; error: string; timestamp: number };

export interface AgentStatus {
  isRunning: boolean;
  alertCount: number;
  trackedSymbols: string[];
  pollingIntervalMs: number;
  x402Enabled: boolean;
}

// Export singleton
export const priceMonitorAgent = new PriceMonitorAgent();
