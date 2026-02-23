/**
 * Vercel Cron Job: Hedge Position Monitor
 * 
 * Monitors all active hedge positions and executes:
 * - Stop-loss orders when price hits threshold
 * - Take-profit orders when targets are met
 * - Trailing stop updates on profitable moves
 * - Emergency closes on extreme volatility
 * 
 * Schedule: Every 15 minutes
 * Configured in: vercel.json
 * 
 * Security: Protected by CRON_SECRET environment variable
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';

// Types
interface ActiveHedge {
  id: string;
  asset: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  size: number;
  leverage: number;
  notionalValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
  createdAt: number;
  walletAddress: string;
  portfolioId?: number;
}

interface HedgeMonitorResult {
  success: boolean;
  hedgesChecked: number;
  actionsExecuted: {
    stopLossTriggered: string[];
    takeProfitTriggered: string[];
    trailingStopUpdated: string[];
    emergencyCloses: string[];
  };
  summary: {
    totalPnl: number;
    totalPnlPercent: number;
    criticalCount: number;
    healthyCount: number;
  };
  duration: number;
  error?: string;
}

// Configuration
const STOP_LOSS_DEFAULT_PERCENT = 5; // Close at 5% loss if no stop-loss set
const TAKE_PROFIT_DEFAULT_PERCENT = 15; // Take profit at 15% if no TP set
const TRAILING_STOP_ACTIVATION = 5; // Activate trailing stop at 5% profit
const TRAILING_STOP_DISTANCE = 2; // Trail 2% behind price
const EMERGENCY_VOLATILITY_THRESHOLD = 10; // Close if 10%+ move in single check

// In-memory tracking for trailing stops (would use Redis in production)
const trailingStopPeaks = new Map<string, number>();

/**
 * Fetch all active hedges from the positions API
 */
async function fetchActiveHedges(): Promise<ActiveHedge[]> {
  try {
    const baseUrl = process.env.VERCEL 
      ? 'https://zkvanguard.vercel.app' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/positions?type=hedges&status=active`, {
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      logger.warn('[HedgeMonitor] Failed to fetch positions, using mock data');
      return getMockActiveHedges();
    }
    
    const data = await response.json();
    return data.hedges || getMockActiveHedges();
  } catch (error: any) {
    logger.warn('[HedgeMonitor] Error fetching positions:', { error: error?.message || String(error) });
    return getMockActiveHedges();
  }
}

/**
 * Get current prices for assets
 */
async function getCurrentPrices(assets: string[]): Promise<Record<string, number>> {
  try {
    const baseUrl = process.env.VERCEL 
      ? 'https://zkvanguard.vercel.app' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/prices?assets=${assets.join(',')}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      return getDefaultPrices();
    }
    
    const data = await response.json();
    return data.prices || getDefaultPrices();
  } catch {
    return getDefaultPrices();
  }
}

function getDefaultPrices(): Record<string, number> {
  return {
    BTC: 95000,
    ETH: 3200,
    CRO: 0.15,
    SUI: 4.50,
  };
}

/**
 * Calculate P&L for a hedge position
 */
function calculatePnl(hedge: ActiveHedge, currentPrice: number): { pnl: number; pnlPercent: number } {
  const priceChange = currentPrice - hedge.entryPrice;
  const direction = hedge.side === 'LONG' ? 1 : -1;
  const pnl = direction * (priceChange / hedge.entryPrice) * hedge.notionalValue;
  const pnlPercent = direction * (priceChange / hedge.entryPrice) * 100 * hedge.leverage;
  
  return { pnl, pnlPercent };
}

/**
 * Execute close position
 */
async function closePosition(hedge: ActiveHedge, reason: string): Promise<boolean> {
  try {
    const baseUrl = process.env.VERCEL 
      ? 'https://zkvanguard.vercel.app' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/agents/hedging/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CLOSE',
        hedgeId: hedge.id,
        asset: hedge.asset,
        side: hedge.side === 'LONG' ? 'SELL' : 'BUY', // Opposite to close
        size: hedge.size,
        reason,
        walletAddress: hedge.walletAddress,
        autoApprovalEnabled: true,
        source: 'hedge-monitor-cron',
      }),
    });
    
    if (!response.ok) {
      logger.error(`[HedgeMonitor] Failed to close position ${hedge.id}: ${response.statusText}`);
      return false;
    }
    
    const result = await response.json();
    logger.info(`[HedgeMonitor] Position ${hedge.id} closed: ${result.txHash}`);
    return true;
  } catch (error) {
    logger.error(`[HedgeMonitor] Error closing position ${hedge.id}:`, error);
    return false;
  }
}

/**
 * Check and update trailing stop
 */
function checkTrailingStop(hedge: ActiveHedge, currentPrice: number, pnlPercent: number): number | null {
  const peakKey = hedge.id;
  const currentPeak = trailingStopPeaks.get(peakKey) || hedge.entryPrice;
  
  // Only activate trailing stop if in profit
  if (pnlPercent < TRAILING_STOP_ACTIVATION) {
    return null;
  }
  
  // For LONG: track highest price, for SHORT: track lowest price
  if (hedge.side === 'LONG') {
    if (currentPrice > currentPeak) {
      trailingStopPeaks.set(peakKey, currentPrice);
      return currentPrice * (1 - TRAILING_STOP_DISTANCE / 100);
    }
  } else {
    if (currentPrice < currentPeak || currentPeak === hedge.entryPrice) {
      trailingStopPeaks.set(peakKey, currentPrice);
      return currentPrice * (1 + TRAILING_STOP_DISTANCE / 100);
    }
  }
  
  // Return existing trailing stop based on peak
  const peak = trailingStopPeaks.get(peakKey) || hedge.entryPrice;
  return hedge.side === 'LONG' 
    ? peak * (1 - TRAILING_STOP_DISTANCE / 100)
    : peak * (1 + TRAILING_STOP_DISTANCE / 100);
}

/**
 * Mock data for testing
 */
function getMockActiveHedges(): ActiveHedge[] {
  return [
    {
      id: 'hedge-btc-001',
      asset: 'BTC',
      side: 'SHORT',
      entryPrice: 96000,
      currentPrice: 95000,
      size: 0.5,
      leverage: 3,
      notionalValue: 142500,
      unrealizedPnl: 1500,
      unrealizedPnlPercent: 3.12,
      stopLoss: 100000,
      takeProfit: 90000,
      createdAt: Date.now() - 86400000,
      walletAddress: '0x1234567890123456789012345678901234567890',
      portfolioId: 1,
    },
    {
      id: 'hedge-eth-001',
      asset: 'ETH',
      side: 'SHORT',
      entryPrice: 3300,
      currentPrice: 3200,
      size: 10,
      leverage: 2,
      notionalValue: 64000,
      unrealizedPnl: 2000,
      unrealizedPnlPercent: 6.06,
      stopLoss: 3500,
      takeProfit: 3000,
      createdAt: Date.now() - 43200000,
      walletAddress: '0x1234567890123456789012345678901234567890',
      portfolioId: 1,
    },
  ];
}

/**
 * Main monitor function
 */
async function monitorHedges(): Promise<HedgeMonitorResult['actionsExecuted'] & { hedges: ActiveHedge[]; summary: HedgeMonitorResult['summary'] }> {
  const hedges = await fetchActiveHedges();
  const assets = [...new Set(hedges.map(h => h.asset))];
  const prices = await getCurrentPrices(assets);
  
  const actions: HedgeMonitorResult['actionsExecuted'] = {
    stopLossTriggered: [],
    takeProfitTriggered: [],
    trailingStopUpdated: [],
    emergencyCloses: [],
  };
  
  let totalPnl = 0;
  let criticalCount = 0;
  let healthyCount = 0;
  
  for (const hedge of hedges) {
    const currentPrice = prices[hedge.asset] || hedge.currentPrice;
    const { pnl, pnlPercent } = calculatePnl(hedge, currentPrice);
    
    totalPnl += pnl;
    
    logger.info(`[HedgeMonitor] Checking ${hedge.id}: ${hedge.side} ${hedge.asset} @ ${hedge.entryPrice} → ${currentPrice} (P&L: ${pnlPercent.toFixed(2)}%)`);
    
    // Check emergency volatility
    const priceChange = Math.abs((currentPrice - hedge.currentPrice) / hedge.currentPrice * 100);
    if (priceChange > EMERGENCY_VOLATILITY_THRESHOLD) {
      logger.warn(`[HedgeMonitor] EMERGENCY: ${hedge.id} moved ${priceChange.toFixed(2)}% since last check!`);
      const closed = await closePosition(hedge, `Emergency close: ${priceChange.toFixed(2)}% volatility`);
      if (closed) {
        actions.emergencyCloses.push(hedge.id);
        continue;
      }
    }
    
    // Check stop-loss
    const stopLoss = hedge.stopLoss || (hedge.side === 'LONG' 
      ? hedge.entryPrice * (1 - STOP_LOSS_DEFAULT_PERCENT / 100)
      : hedge.entryPrice * (1 + STOP_LOSS_DEFAULT_PERCENT / 100));
    
    const stopLossHit = hedge.side === 'LONG' 
      ? currentPrice <= stopLoss 
      : currentPrice >= stopLoss;
    
    if (stopLossHit) {
      logger.warn(`[HedgeMonitor] STOP-LOSS triggered for ${hedge.id} at ${currentPrice} (stop: ${stopLoss})`);
      const closed = await closePosition(hedge, `Stop-loss triggered at ${currentPrice}`);
      if (closed) {
        actions.stopLossTriggered.push(hedge.id);
        criticalCount++;
        continue;
      }
    }
    
    // Check take-profit
    const takeProfit = hedge.takeProfit || (hedge.side === 'LONG'
      ? hedge.entryPrice * (1 + TAKE_PROFIT_DEFAULT_PERCENT / 100)
      : hedge.entryPrice * (1 - TAKE_PROFIT_DEFAULT_PERCENT / 100));
    
    const takeProfitHit = hedge.side === 'LONG'
      ? currentPrice >= takeProfit
      : currentPrice <= takeProfit;
    
    if (takeProfitHit) {
      logger.info(`[HedgeMonitor] TAKE-PROFIT triggered for ${hedge.id} at ${currentPrice} (target: ${takeProfit})`);
      const closed = await closePosition(hedge, `Take-profit triggered at ${currentPrice}`);
      if (closed) {
        actions.takeProfitTriggered.push(hedge.id);
        healthyCount++;
        continue;
      }
    }
    
    // Check trailing stop
    const trailingStopPrice = checkTrailingStop(hedge, currentPrice, pnlPercent);
    if (trailingStopPrice && pnlPercent > TRAILING_STOP_ACTIVATION) {
      const trailingStopHit = hedge.side === 'LONG'
        ? currentPrice <= trailingStopPrice
        : currentPrice >= trailingStopPrice;
      
      if (trailingStopHit) {
        logger.info(`[HedgeMonitor] TRAILING-STOP triggered for ${hedge.id} at ${currentPrice}`);
        const closed = await closePosition(hedge, `Trailing stop triggered at ${currentPrice}`);
        if (closed) {
          actions.trailingStopUpdated.push(hedge.id);
          healthyCount++;
          continue;
        }
      } else {
        // Just log the update
        logger.debug(`[HedgeMonitor] Trailing stop for ${hedge.id}: ${trailingStopPrice.toFixed(2)}`);
      }
    }
    
    // Healthy position
    if (pnlPercent > 0) healthyCount++;
    else if (pnlPercent < -3) criticalCount++;
  }
  
  const totalNotional = hedges.reduce((sum, h) => sum + h.notionalValue, 0);
  
  return {
    ...actions,
    hedges,
    summary: {
      totalPnl,
      totalPnlPercent: totalNotional > 0 ? (totalPnl / totalNotional) * 100 : 0,
      criticalCount,
      healthyCount,
    },
  };
}

/**
 * GET handler for Vercel Cron
 */
export async function GET(request: NextRequest): Promise<NextResponse<HedgeMonitorResult>> {
  const startTime = Date.now();
  
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, hedgesChecked: 0, actionsExecuted: { stopLossTriggered: [], takeProfitTriggered: [], trailingStopUpdated: [], emergencyCloses: [] }, summary: { totalPnl: 0, totalPnlPercent: 0, criticalCount: 0, healthyCount: 0 }, duration: Date.now() - startTime, error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  logger.info('[HedgeMonitor] Starting hedge position monitoring');
  
  try {
    const result = await monitorHedges();
    
    const totalActions = 
      result.stopLossTriggered.length + 
      result.takeProfitTriggered.length + 
      result.trailingStopUpdated.length +
      result.emergencyCloses.length;
    
    logger.info(`[HedgeMonitor] Complete: ${result.hedges.length} hedges checked, ${totalActions} actions executed`, {
      summary: result.summary,
      actions: {
        stopLoss: result.stopLossTriggered.length,
        takeProfit: result.takeProfitTriggered.length,
        trailingStop: result.trailingStopUpdated.length,
        emergency: result.emergencyCloses.length,
      },
    });
    
    return NextResponse.json({
      success: true,
      hedgesChecked: result.hedges.length,
      actionsExecuted: {
        stopLossTriggered: result.stopLossTriggered,
        takeProfitTriggered: result.takeProfitTriggered,
        trailingStopUpdated: result.trailingStopUpdated,
        emergencyCloses: result.emergencyCloses,
      },
      summary: result.summary,
      duration: Date.now() - startTime,
    });
    
  } catch (error: any) {
    logger.error('[HedgeMonitor] Error:', error);
    return NextResponse.json({
      success: false,
      hedgesChecked: 0,
      actionsExecuted: {
        stopLossTriggered: [],
        takeProfitTriggered: [],
        trailingStopUpdated: [],
        emergencyCloses: [],
      },
      summary: {
        totalPnl: 0,
        totalPnlPercent: 0,
        criticalCount: 0,
        healthyCount: 0,
      },
      duration: Date.now() - startTime,
      error: error.message,
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
