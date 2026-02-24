/**
 * Price Alert Webhook System
 * 
 * Event-driven hedge monitoring triggered by significant price movements.
 * No cron jobs needed - runs on every price fetch and triggers automatically.
 * 
 * Thresholds:
 * - 2% move in 1 hour: Check all hedges
 * - 5% move in 1 hour: Trigger stop-loss/take-profit checks
 * - 10% move: Emergency alert + liquidation check
 */

import { logger } from '@/lib/utils/logger';

// Types
interface PriceSnapshot {
  price: number;
  timestamp: number;
}

interface PriceAlert {
  asset: string;
  type: 'HEDGE_CHECK' | 'STOP_LOSS_CHECK' | 'EMERGENCY';
  changePercent: number;
  previousPrice: number;
  currentPrice: number;
  triggeredAt: number;
}

// In-memory price history (last 1 hour of snapshots per asset)
const priceHistory = new Map<string, PriceSnapshot[]>();
const lastAlertTime = new Map<string, number>();
const ALERT_COOLDOWN_MS = 60000; // 1 minute cooldown between alerts for same asset
const HISTORY_RETENTION_MS = 3600000; // Keep 1 hour of history

// Thresholds
const THRESHOLD_HEDGE_CHECK = 2; // 2% triggers hedge check
const THRESHOLD_STOP_LOSS = 5; // 5% triggers stop-loss check
const THRESHOLD_EMERGENCY = 10; // 10% triggers emergency procedures

// Webhook queue for background processing
const webhookQueue: PriceAlert[] = [];
let isProcessingWebhooks = false;

// Heartbeat tracking - ensure monitoring runs even without price moves
let lastHeartbeatCheck = 0;
const HEARTBEAT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
let requestCounter = 0;
const HEARTBEAT_CHECK_EVERY_N_REQUESTS = 100; // Check every 100 price requests

// Community pool continuous monitoring (more frequent than general heartbeat)
let lastPoolCheck = 0;
const POOL_CHECK_INTERVAL_MS = 15 * 60 * 1000; // Every 15 minutes for pools
const POOL_CHECK_EVERY_N_REQUESTS = 20; // Or every 20 price requests

/**
 * Record a price update and check for significant moves
 */
export function recordPriceUpdate(asset: string, price: number): PriceAlert | null {
  const now = Date.now();
  requestCounter++;
  
  // Community pool continuous monitoring (every 20 requests or 15 min)
  if (requestCounter % POOL_CHECK_EVERY_N_REQUESTS === 0 || now - lastPoolCheck > POOL_CHECK_INTERVAL_MS) {
    checkCommunityPools();
  }
  
  // Periodic heartbeat check - ensures monitoring even without price moves
  if (requestCounter % HEARTBEAT_CHECK_EVERY_N_REQUESTS === 0) {
    checkHeartbeat();
  }
  
  const history = priceHistory.get(asset) || [];
  
  // Add new snapshot
  history.push({ price, timestamp: now });
  
  // Prune old entries (older than 1 hour)
  const cutoff = now - HISTORY_RETENTION_MS;
  const prunedHistory = history.filter(s => s.timestamp > cutoff);
  priceHistory.set(asset, prunedHistory);
  
  // Need at least 2 data points to compare
  if (prunedHistory.length < 2) {
    return null;
  }
  
  // Get oldest price in history for comparison
  const oldestSnapshot = prunedHistory[0];
  const changePercent = ((price - oldestSnapshot.price) / oldestSnapshot.price) * 100;
  const absChange = Math.abs(changePercent);
  
  // Check cooldown
  const lastAlert = lastAlertTime.get(asset) || 0;
  if (now - lastAlert < ALERT_COOLDOWN_MS) {
    return null;
  }
  
  // Determine alert type based on magnitude
  let alertType: PriceAlert['type'] | null = null;
  
  if (absChange >= THRESHOLD_EMERGENCY) {
    alertType = 'EMERGENCY';
  } else if (absChange >= THRESHOLD_STOP_LOSS) {
    alertType = 'STOP_LOSS_CHECK';
  } else if (absChange >= THRESHOLD_HEDGE_CHECK) {
    alertType = 'HEDGE_CHECK';
  }
  
  if (!alertType) {
    return null;
  }
  
  const alert: PriceAlert = {
    asset,
    type: alertType,
    changePercent,
    previousPrice: oldestSnapshot.price,
    currentPrice: price,
    triggeredAt: now,
  };
  
  lastAlertTime.set(asset, now);
  
  // Queue webhook for background processing
  webhookQueue.push(alert);
  processWebhookQueue(); // Fire and forget
  
  logger.warn(`[PriceAlert] ${asset} ${alertType}: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}% ($${oldestSnapshot.price.toFixed(2)} → $${price.toFixed(2)})`);
  
  return alert;
}

/**
 * Process queued webhooks in background
 */
async function processWebhookQueue(): Promise<void> {
  if (isProcessingWebhooks || webhookQueue.length === 0) {
    return;
  }
  
  isProcessingWebhooks = true;
  
  try {
    while (webhookQueue.length > 0) {
      const alert = webhookQueue.shift();
      if (!alert) continue;
      
      await triggerWebhook(alert);
    }
  } catch (error: any) {
    logger.error('[PriceAlert] Webhook processing error:', { error: error?.message });
  } finally {
    isProcessingWebhooks = false;
  }
}

/**
 * Trigger the appropriate webhook based on alert type
 */
async function triggerWebhook(alert: PriceAlert): Promise<void> {
  const baseUrl = process.env.VERCEL 
    ? 'https://zkvanguard.vercel.app' 
    : process.env.NEXTAUTH_URL || 'http://localhost:3000';
  
  try {
    switch (alert.type) {
      case 'HEDGE_CHECK':
        // Quick hedge position check
        await fetch(`${baseUrl}/api/agents/hedging/pnl?asset=${alert.asset}`, {
          method: 'GET',
          headers: { 'X-Price-Trigger': 'true' },
        });
        logger.info(`[PriceAlert] Triggered hedge check for ${alert.asset}`);
        break;
        
      case 'STOP_LOSS_CHECK':
        // Trigger full hedge monitor
        await fetch(`${baseUrl}/api/cron/hedge-monitor`, {
          method: 'GET',
          headers: { 
            'Authorization': `Bearer ${process.env.CRON_SECRET}`,
            'X-Price-Trigger': 'true',
          },
        });
        logger.info(`[PriceAlert] Triggered stop-loss check for ${alert.asset}`);
        break;
        
      case 'EMERGENCY':
        // Trigger both hedge monitor and liquidation guard
        await Promise.all([
          fetch(`${baseUrl}/api/cron/hedge-monitor`, {
            method: 'GET',
            headers: { 
              'Authorization': `Bearer ${process.env.CRON_SECRET}`,
              'X-Price-Trigger': 'emergency',
            },
          }),
          fetch(`${baseUrl}/api/cron/liquidation-guard`, {
            method: 'GET',
            headers: { 
              'Authorization': `Bearer ${process.env.CRON_SECRET}`,
              'X-Price-Trigger': 'emergency',
            },
          }),
        ]);
        logger.warn(`[PriceAlert] EMERGENCY triggered for ${alert.asset}: ${alert.changePercent.toFixed(2)}%`);
        break;
    }
  } catch (error: any) {
    logger.error(`[PriceAlert] Failed to trigger webhook for ${alert.asset}:`, { error: error?.message });
  }
}

/**
 * Get current price alerts summary
 */
export function getPriceAlertStatus(): {
  trackedAssets: string[];
  recentAlerts: PriceAlert[];
  queueLength: number;
} {
  const recentAlerts: PriceAlert[] = [];
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  
  lastAlertTime.forEach((timestamp, asset) => {
    if (timestamp > oneHourAgo) {
      const history = priceHistory.get(asset);
      if (history && history.length > 0) {
        const latest = history[history.length - 1];
        const oldest = history[0];
        const changePercent = ((latest.price - oldest.price) / oldest.price) * 100;
        
        recentAlerts.push({
          asset,
          type: 'HEDGE_CHECK',
          changePercent,
          previousPrice: oldest.price,
          currentPrice: latest.price,
          triggeredAt: timestamp,
        });
      }
    }
  });
  
  return {
    trackedAssets: Array.from(priceHistory.keys()),
    recentAlerts,
    queueLength: webhookQueue.length,
  };
}

/**
 * Manual trigger for testing
 */
export async function manualTriggerHedgeCheck(asset?: string): Promise<void> {
  const baseUrl = process.env.VERCEL 
    ? 'https://zkvanguard.vercel.app' 
    : process.env.NEXTAUTH_URL || 'http://localhost:3000';
  
  await fetch(`${baseUrl}/api/cron/hedge-monitor`, {
    method: 'GET',
    headers: { 
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      'X-Manual-Trigger': 'true',
    },
  });
  
  logger.info(`[PriceAlert] Manual hedge check triggered${asset ? ` for ${asset}` : ''}`);
}

/**
 * Heartbeat check - ensures monitoring runs periodically even without price moves
 * This piggybacks on normal API traffic
 */
async function checkHeartbeat(): Promise<void> {
  const now = Date.now();
  
  // Check if heartbeat is due
  if (now - lastHeartbeatCheck < HEARTBEAT_INTERVAL_MS) {
    return;
  }
  
  lastHeartbeatCheck = now;
  logger.info('[PriceAlert] Heartbeat triggered - running periodic monitoring');
  
  const baseUrl = process.env.VERCEL 
    ? 'https://zkvanguard.vercel.app' 
    : process.env.NEXTAUTH_URL || 'http://localhost:3000';
  
  try {
    // Run all monitoring endpoints in parallel
    await Promise.allSettled([
      fetch(`${baseUrl}/api/cron/hedge-monitor`, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          'X-Heartbeat-Trigger': 'true',
        },
      }),
      fetch(`${baseUrl}/api/cron/liquidation-guard`, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          'X-Heartbeat-Trigger': 'true',
        },
      }),
      fetch(`${baseUrl}/api/cron/pool-nav-monitor`, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          'X-Heartbeat-Trigger': 'true',
        },
      }),
      // Auto-rebalance includes loss protection for configured portfolios (e.g. Portfolio #3)
      fetch(`${baseUrl}/api/cron/auto-rebalance`, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          'X-Heartbeat-Trigger': 'true',
        },
      }),
    ]);
    
    logger.info('[PriceAlert] Heartbeat monitoring completed (hedge + liquidation + pool-nav + auto-rebalance)');
  } catch (error: any) {
    logger.error('[PriceAlert] Heartbeat error:', { error: error?.message || String(error) });
  }
}

/**
 * Trigger pool NAV update
 */
export async function triggerPoolNavUpdate(): Promise<void> {
  const baseUrl = process.env.VERCEL 
    ? 'https://zkvanguard.vercel.app' 
    : process.env.NEXTAUTH_URL || 'http://localhost:3000';
  
  try {
    await fetch(`${baseUrl}/api/cron/pool-nav-monitor`, {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
        'X-Price-Trigger': 'true',
      },
    });
    logger.info('[PriceAlert] Pool NAV update triggered');
  } catch (error: any) {
    logger.error('[PriceAlert] Pool NAV trigger failed:', { error: error?.message || String(error) });
  }
}

/**
 * Check community pools continuously (more frequent than heartbeat)
 * This enables "always on" auto-hedging for community pools
 */
async function checkCommunityPools(): Promise<void> {
  const now = Date.now();
  
  // Check if pool check is due
  if (now - lastPoolCheck < POOL_CHECK_INTERVAL_MS) {
    return;
  }
  
  lastPoolCheck = now;
  logger.info('[PriceAlert] Community pool check - running auto-rebalance/hedging');
  
  const baseUrl = process.env.VERCEL 
    ? 'https://zkvanguard.vercel.app' 
    : process.env.NEXTAUTH_URL || 'http://localhost:3000';
  
  try {
    // Run both auto-rebalance AND pool-nav-monitor (which has the hedging logic)
    await Promise.allSettled([
      // Auto-rebalance for portfolio allocation drift
      fetch(`${baseUrl}/api/cron/auto-rebalance`, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          'X-Pool-Trigger': 'true',
        },
      }),
      // Pool NAV monitor for loss detection and auto-hedging
      fetch(`${baseUrl}/api/cron/pool-nav-monitor`, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          'X-Pool-Trigger': 'true',
        },
      }),
    ]);
    
    logger.info('[PriceAlert] Community pool auto-hedge check completed (rebalance + nav monitor)');
  } catch (error: any) {
    logger.error('[PriceAlert] Community pool check error:', { error: error?.message || String(error) });
  }
}

/**
 * Force community pool check - for testing/admin
 */
export async function forceCommunityPoolCheck(): Promise<void> {
  lastPoolCheck = 0; // Reset to force trigger
  await checkCommunityPools();
}

/**
 * Force manual heartbeat - for testing/admin
 */
export async function forceHeartbeat(): Promise<void> {
  lastHeartbeatCheck = 0; // Reset to force trigger
  await checkHeartbeat();
}
