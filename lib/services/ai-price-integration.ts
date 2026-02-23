/**
 * AI Price Integration Service
 * ============================
 * Smart integration layer between live market prices and AI decisions.
 * Each AI service type uses prices differently for optimal performance.
 * 
 * Service-Specific Price Usage:
 * - Risk Analysis: Uses volatility, change24h for risk scoring
 * - Hedge Recommendations: Uses current prices for entry/target calculations
 * - Market Insights: Uses price trends for sentiment analysis
 * - Portfolio Actions: Uses real-time prices for value calculations
 */

import { logger } from '@/lib/utils/logger';
import CryptocomExchangeService, { type MarketPrice } from './CryptocomExchangeService';

// ============================================================================
// Service-Specific Configurations
// ============================================================================

export interface ServiceConfig {
  /** How often to refresh prices for this service (ms) */
  priceRefreshInterval: number;
  /** Price change threshold to trigger cache invalidation (%) */
  invalidationThreshold: number;
  /** Which price fields matter for this service */
  priceFields: Array<'price' | 'change24h' | 'volume24h' | 'high24h' | 'low24h'>;
  /** Whether to batch price requests */
  batchPrices: boolean;
  /** Priority level for price fetching (higher = more frequent) */
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export const SERVICE_CONFIGS: Record<string, ServiceConfig> = {
  risk: {
    priceRefreshInterval: 30000,  // 30s - needs fresh volatility data
    invalidationThreshold: 3,     // 3% price change triggers re-analysis
    priceFields: ['price', 'change24h', 'high24h', 'low24h'],
    batchPrices: true,
    priority: 'high',
  },
  hedges: {
    priceRefreshInterval: 15000,  // 15s - needs real-time for entry prices
    invalidationThreshold: 2,     // 2% price change - more sensitive
    priceFields: ['price', 'change24h'],
    batchPrices: true,
    priority: 'critical',
  },
  insights: {
    priceRefreshInterval: 60000,  // 60s - trend analysis less time-sensitive
    invalidationThreshold: 5,     // 5% - only major moves matter
    priceFields: ['price', 'change24h', 'volume24h'],
    batchPrices: true,
    priority: 'medium',
  },
  action: {
    priceRefreshInterval: 20000,  // 20s - portfolio value needs freshness
    invalidationThreshold: 2.5,   // 2.5% - moderate sensitivity
    priceFields: ['price', 'change24h'],
    batchPrices: true,
    priority: 'high',
  },
};

// ============================================================================
// Live Price State
// ============================================================================

interface PriceSnapshot {
  prices: Record<string, MarketPrice>;
  timestamp: number;
  assetsTracked: string[];
}

let currentSnapshot: PriceSnapshot | null = null;
let previousSnapshot: PriceSnapshot | null = null;
let priceListeners: Array<(snapshot: PriceSnapshot) => void> = [];
let refreshInterval: NodeJS.Timeout | null = null;

const priceService = new CryptocomExchangeService();

// ============================================================================
// Smart Price Monitoring
// ============================================================================

/**
 * Get the current live prices
 */
export function getCurrentPrices(): Record<string, MarketPrice> {
  return currentSnapshot?.prices || {};
}

/**
 * Get price for a specific symbol
 */
export function getPrice(symbol: string): MarketPrice | null {
  return currentSnapshot?.prices[symbol.toUpperCase()] || null;
}

/**
 * Calculate price change since last snapshot
 */
export function getPriceChange(symbol: string): { absolute: number; percent: number } | null {
  if (!currentSnapshot || !previousSnapshot) return null;
  
  const current = currentSnapshot.prices[symbol.toUpperCase()];
  const previous = previousSnapshot.prices[symbol.toUpperCase()];
  
  if (!current || !previous) return null;
  
  const absolute = current.price - previous.price;
  const percent = (absolute / previous.price) * 100;
  
  return { absolute, percent };
}

/**
 * Check if any tracked asset exceeds the invalidation threshold for a service
 */
export function shouldInvalidateCache(serviceType: keyof typeof SERVICE_CONFIGS): boolean {
  const config = SERVICE_CONFIGS[serviceType];
  if (!currentSnapshot || !previousSnapshot) return false;
  
  for (const symbol of currentSnapshot.assetsTracked) {
    const change = getPriceChange(symbol);
    if (change && Math.abs(change.percent) >= config.invalidationThreshold) {
      logger.info(`[AIPriceIntegration] ${serviceType} cache invalidation triggered`, {
        symbol,
        change: `${change.percent.toFixed(2)}%`,
        threshold: `${config.invalidationThreshold}%`,
      });
      return true;
    }
  }
  
  return false;
}

/**
 * Refresh prices for given assets
 */
export async function refreshPrices(assets: string[]): Promise<Record<string, MarketPrice>> {
  const normalizedAssets = assets.map(a => a.toUpperCase());
  const uniqueAssets = [...new Set(normalizedAssets)];
  
  try {
    const prices: Record<string, MarketPrice> = {};
    
    // Batch fetch for efficiency
    for (const symbol of uniqueAssets) {
      try {
        const data = await priceService.getMarketData(symbol);
        prices[symbol] = data;
      } catch {
        // Skip failed symbols, don't break the batch
        logger.debug(`[AIPriceIntegration] Skipped ${symbol} - not available`);
      }
    }
    
    // Update snapshots
    previousSnapshot = currentSnapshot;
    currentSnapshot = {
      prices,
      timestamp: Date.now(),
      assetsTracked: uniqueAssets,
    };
    
    // Notify listeners
    priceListeners.forEach(listener => {
      try {
        listener(currentSnapshot!);
      } catch (e) {
        logger.error('[AIPriceIntegration] Listener error', e instanceof Error ? e : undefined);
      }
    });
    
    return prices;
  } catch (error) {
    logger.error('[AIPriceIntegration] Price refresh failed', error instanceof Error ? error : undefined);
    return currentSnapshot?.prices || {};
  }
}

/**
 * Subscribe to price updates
 */
export function onPriceUpdate(callback: (snapshot: PriceSnapshot) => void): () => void {
  priceListeners.push(callback);
  return () => {
    priceListeners = priceListeners.filter(l => l !== callback);
  };
}

/**
 * Start automatic price monitoring for given assets
 */
export function startPriceMonitoring(assets: string[], intervalMs = 15000): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
  
  // Initial fetch
  refreshPrices(assets);
  
  // Set up interval
  refreshInterval = setInterval(() => {
    refreshPrices(assets);
  }, intervalMs);
  
  logger.info('[AIPriceIntegration] Price monitoring started', {
    assets: assets.length,
    interval: `${intervalMs}ms`,
  });
}

/**
 * Stop price monitoring
 */
export function stopPriceMonitoring(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    logger.info('[AIPriceIntegration] Price monitoring stopped');
  }
}

// ============================================================================
// Service-Specific Price Enrichment
// ============================================================================

export interface RiskPriceContext {
  prices: Record<string, number>;
  volatilities: Record<string, number>;
  changes24h: Record<string, number>;
  highLowSpread: Record<string, number>;
  timestamp: number;
}

export interface HedgePriceContext {
  currentPrices: Record<string, number>;
  changes24h: Record<string, number>;
  suggestedEntries: Record<string, { price: number; side: 'LONG' | 'SHORT' }>;
  timestamp: number;
}

export interface InsightPriceContext {
  prices: Record<string, number>;
  trends: Record<string, 'up' | 'down' | 'sideways'>;
  volumeSpikes: string[];
  timestamp: number;
}

export interface ActionPriceContext {
  portfolioAssetPrices: Record<string, number>;
  totalValueChange: number;
  urgentAssets: string[]; // Assets with >5% change
  timestamp: number;
}

/**
 * Get price context for Risk Analysis
 * Focus: volatility, high/low spreads, 24h changes
 */
export function getRiskPriceContext(assets: string[]): RiskPriceContext {
  const context: RiskPriceContext = {
    prices: {},
    volatilities: {},
    changes24h: {},
    highLowSpread: {},
    timestamp: Date.now(),
  };
  
  const currentPrices = getCurrentPrices();
  
  for (const asset of assets) {
    const data = currentPrices[asset.toUpperCase()];
    if (data) {
      context.prices[asset] = data.price;
      context.changes24h[asset] = data.change24h;
      // Calculate intraday volatility from high/low spread
      const spread = ((data.high24h - data.low24h) / data.price) * 100;
      context.volatilities[asset] = spread;
      context.highLowSpread[asset] = spread;
    }
  }
  
  return context;
}

/**
 * Get price context for Hedge Recommendations
 * Focus: current prices for entry points, direction from 24h change
 */
export function getHedgePriceContext(assets: string[]): HedgePriceContext {
  const context: HedgePriceContext = {
    currentPrices: {},
    changes24h: {},
    suggestedEntries: {},
    timestamp: Date.now(),
  };
  
  const currentPrices = getCurrentPrices();
  
  for (const asset of assets) {
    const data = currentPrices[asset.toUpperCase()];
    if (data) {
      context.currentPrices[asset] = data.price;
      context.changes24h[asset] = data.change24h;
      
      // Suggest entry based on current momentum
      // If dropping significantly, suggest SHORT entry slightly below current
      // If rising, suggest LONG entry slightly above current
      const side: 'LONG' | 'SHORT' = data.change24h < -2 ? 'SHORT' : data.change24h > 2 ? 'LONG' : 'LONG';
      const entryOffset = side === 'SHORT' ? 0.995 : 1.005; // 0.5% offset
      context.suggestedEntries[asset] = {
        price: data.price * entryOffset,
        side,
      };
    }
  }
  
  return context;
}

/**
 * Get price context for Market Insights
 * Focus: trend detection, volume spikes
 */
export function getInsightPriceContext(assets: string[]): InsightPriceContext {
  const context: InsightPriceContext = {
    prices: {},
    trends: {},
    volumeSpikes: [],
    timestamp: Date.now(),
  };
  
  const currentPrices = getCurrentPrices();
  
  for (const asset of assets) {
    const data = currentPrices[asset.toUpperCase()];
    if (data) {
      context.prices[asset] = data.price;
      
      // Determine trend from 24h change
      if (data.change24h > 3) {
        context.trends[asset] = 'up';
      } else if (data.change24h < -3) {
        context.trends[asset] = 'down';
      } else {
        context.trends[asset] = 'sideways';
      }
      
      // Flag high volume (would need historical avg, using absolute threshold for now)
      // Volume spike detection would be enhanced with historical data
    }
  }
  
  return context;
}

/**
 * Get price context for Portfolio Actions  
 * Focus: real-time values, urgent assets
 */
export function getActionPriceContext(
  assets: string[],
  holdings?: Record<string, number>
): ActionPriceContext {
  const context: ActionPriceContext = {
    portfolioAssetPrices: {},
    totalValueChange: 0,
    urgentAssets: [],
    timestamp: Date.now(),
  };
  
  const currentPrices = getCurrentPrices();
  let totalChange = 0;
  let assetCount = 0;
  
  for (const asset of assets) {
    const data = currentPrices[asset.toUpperCase()];
    if (data) {
      context.portfolioAssetPrices[asset] = data.price;
      
      // Track assets with significant moves
      if (Math.abs(data.change24h) > 5) {
        context.urgentAssets.push(asset);
      }
      
      // Calculate weighted change if holdings provided
      if (holdings && holdings[asset]) {
        totalChange += data.change24h * (holdings[asset] / Object.values(holdings).reduce((a, b) => a + b, 0));
        assetCount++;
      } else {
        totalChange += data.change24h;
        assetCount++;
      }
    }
  }
  
  context.totalValueChange = assetCount > 0 ? totalChange / assetCount : 0;
  
  return context;
}

// ============================================================================
// Exports
// ============================================================================

export const AIPriceIntegration = {
  // Price access
  getCurrentPrices,
  getPrice,
  getPriceChange,
  refreshPrices,
  
  // Monitoring
  startPriceMonitoring,
  stopPriceMonitoring,
  onPriceUpdate,
  
  // Cache integration
  shouldInvalidateCache,
  
  // Service-specific contexts
  getRiskPriceContext,
  getHedgePriceContext,
  getInsightPriceContext,
  getActionPriceContext,
  
  // Config access
  getServiceConfig: (service: keyof typeof SERVICE_CONFIGS) => SERVICE_CONFIGS[service],
};

export default AIPriceIntegration;
