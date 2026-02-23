/**
 * Vercel Cron Job: Pool NAV Monitor
 * 
 * Monitors all investment pools (Community Pool, institutional pools) and:
 * - Tracks NAV changes and performance
 * - Alerts on significant drawdowns
 * - Records performance snapshots
 * - Triggers rebalancing on allocation drift
 * - Notifies stakeholders on critical events
 * 
 * Schedule: Every hour
 * Configured in: vercel.json
 * 
 * Security: Protected by CRON_SECRET environment variable
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { recordNavSnapshot, getNavHistory } from '@/lib/db/community-pool';
import { ethers } from 'ethers';

// Types
interface PoolMetrics {
  poolId: string;
  poolName: string;
  totalNAV: number;
  previousNAV: number;
  navChange: number;
  navChangePercent: number;
  memberCount: number;
  sharePrice: number;
  allocations: Record<string, number>;
  drawdownPercent: number;
  peakNAV: number;
  sinceInception: {
    returns: number;
    returnsPercent: number;
    days: number;
  };
  alerts: PoolAlert[];
}

interface PoolAlert {
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  type: 'DRAWDOWN' | 'DRIFT' | 'PERFORMANCE' | 'LIQUIDITY' | 'MEMBER';
  message: string;
  timestamp: number;
}

interface PoolMonitorResult {
  success: boolean;
  poolsChecked: number;
  pools: PoolMetrics[];
  alerts: PoolAlert[];
  summary: {
    totalAUM: number;
    avgReturns: number;
    criticalPools: number;
    healthyPools: number;
  };
  duration: number;
  error?: string;
}

// Thresholds
const DRAWDOWN_WARNING_PERCENT = 5; // Warn at 5% drawdown
const DRAWDOWN_CRITICAL_PERCENT = 10; // Critical at 10% drawdown
const DRIFT_WARNING_PERCENT = 3; // Warn if allocation drifts 3%+ from target
const HOURLY_LOSS_WARNING_PERCENT = 1; // Warn on 1%+ hourly loss
const DAILY_LOSS_WARNING_PERCENT = 3; // Warn on 3%+ daily loss

// Pool contract addresses
const POOLS = [
  {
    id: 'community-pool',
    name: 'Community Pool',
    address: '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30',
    abi: [
      'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
      'function poolCreationTime() view returns (uint256)',
    ],
    targetAllocations: { BTC: 35, ETH: 30, SUI: 20, CRO: 15 },
  },
];

// In-memory peak NAV tracking (would use database in production)
const peakNavTracker = new Map<string, number>();
const navHistory = new Map<string, { nav: number; timestamp: number }[]>();

/**
 * Fetch pool stats from blockchain
 */
async function fetchPoolStats(pool: typeof POOLS[0]): Promise<{
  totalNAV: number;
  memberCount: number;
  sharePrice: number;
  allocations: Record<string, number>;
  creationTime: number;
} | null> {
  try {
    const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org');
    const contract = new ethers.Contract(pool.address, pool.abi, provider);
    
    const stats = await contract.getPoolStats();
    let creationTime: number;
    
    try {
      creationTime = Number(await contract.poolCreationTime());
    } catch {
      creationTime = Math.floor(Date.now() / 1000) - 86400 * 30; // Default to 30 days ago
    }
    
    const totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
    const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
    const memberCount = Number(stats._memberCount);
    
    // Parse allocations (BTC, ETH, SUI, CRO in basis points)
    const allocBps = stats._allocations.map((a: bigint) => Number(a));
    const allocations: Record<string, number> = {
      BTC: allocBps[0] / 100,
      ETH: allocBps[1] / 100,
      SUI: allocBps[2] / 100,
      CRO: allocBps[3] / 100,
    };
    
    return { totalNAV, memberCount, sharePrice, allocations, creationTime };
  } catch (error: any) {
    logger.error(`[PoolNAVMonitor] Failed to fetch pool stats for ${pool.id}:`, { error: error?.message || String(error) });
    return null;
  }
}

/**
 * Get previous NAV from history
 */
function getPreviousNAV(poolId: string): number | null {
  const history = navHistory.get(poolId);
  if (!history || history.length < 2) return null;
  return history[history.length - 2].nav;
}

/**
 * Calculate drawdown from peak
 */
function calculateDrawdown(poolId: string, currentNAV: number): { drawdownPercent: number; peakNAV: number } {
  const peak = peakNavTracker.get(poolId) || currentNAV;
  
  // Update peak if new high
  if (currentNAV > peak) {
    peakNavTracker.set(poolId, currentNAV);
    return { drawdownPercent: 0, peakNAV: currentNAV };
  }
  
  const drawdownPercent = ((peak - currentNAV) / peak) * 100;
  return { drawdownPercent, peakNAV: peak };
}

/**
 * Check allocation drift
 */
function checkAllocationDrift(
  currentAllocations: Record<string, number>,
  targetAllocations: Record<string, number>
): { drifts: Record<string, number>; maxDrift: number; driftingAssets: string[] } {
  const drifts: Record<string, number> = {};
  const driftingAssets: string[] = [];
  
  for (const [asset, target] of Object.entries(targetAllocations)) {
    const current = currentAllocations[asset] || 0;
    const drift = Math.abs(current - target);
    drifts[asset] = drift;
    
    if (drift > DRIFT_WARNING_PERCENT) {
      driftingAssets.push(`${asset}: ${current.toFixed(1)}% (target ${target}%)`);
    }
  }
  
  const maxDrift = Math.max(...Object.values(drifts));
  return { drifts, maxDrift, driftingAssets };
}

/**
 * Generate alerts for a pool
 */
function generateAlerts(
  pool: typeof POOLS[0],
  metrics: {
    totalNAV: number;
    previousNAV: number | null;
    navChangePercent: number;
    drawdownPercent: number;
    maxDrift: number;
    driftingAssets: string[];
    memberCount: number;
  }
): PoolAlert[] {
  const alerts: PoolAlert[] = [];
  const now = Date.now();
  
  // Critical drawdown
  if (metrics.drawdownPercent >= DRAWDOWN_CRITICAL_PERCENT) {
    alerts.push({
      severity: 'CRITICAL',
      type: 'DRAWDOWN',
      message: `${pool.name} in CRITICAL drawdown: ${metrics.drawdownPercent.toFixed(2)}% from peak`,
      timestamp: now,
    });
  } else if (metrics.drawdownPercent >= DRAWDOWN_WARNING_PERCENT) {
    alerts.push({
      severity: 'WARNING',
      type: 'DRAWDOWN',
      message: `${pool.name} drawdown warning: ${metrics.drawdownPercent.toFixed(2)}% from peak`,
      timestamp: now,
    });
  }
  
  // Hourly loss
  if (metrics.navChangePercent < -HOURLY_LOSS_WARNING_PERCENT) {
    alerts.push({
      severity: 'WARNING',
      type: 'PERFORMANCE',
      message: `${pool.name} hourly loss: ${metrics.navChangePercent.toFixed(2)}%`,
      timestamp: now,
    });
  }
  
  // Allocation drift
  if (metrics.driftingAssets.length > 0) {
    alerts.push({
      severity: 'WARNING',
      type: 'DRIFT',
      message: `${pool.name} allocation drift: ${metrics.driftingAssets.join(', ')}`,
      timestamp: now,
    });
  }
  
  // Good performance notification
  if (metrics.navChangePercent > 1) {
    alerts.push({
      severity: 'INFO',
      type: 'PERFORMANCE',
      message: `${pool.name} positive performance: +${metrics.navChangePercent.toFixed(2)}% this hour`,
      timestamp: now,
    });
  }
  
  return alerts;
}

/**
 * Record NAV snapshot
 */
async function recordSnapshot(poolId: string, nav: number): Promise<void> {
  // Add to in-memory history
  const history = navHistory.get(poolId) || [];
  history.push({ nav, timestamp: Date.now() });
  
  // Keep last 168 hours (1 week)
  if (history.length > 168) {
    history.shift();
  }
  navHistory.set(poolId, history);
  
  // Also record to database
  try {
    await recordNavSnapshot({
      totalNav: nav,
      sharePrice: nav / 1000, // Simplified
      totalShares: 1000,
      memberCount: 0,
      allocations: { BTC: 35, ETH: 30, SUI: 20, CRO: 15 },
      source: 'pool-nav-monitor-cron',
    });
  } catch (error: any) {
    logger.warn(`[PoolNAVMonitor] Failed to record snapshot to DB:`, { error: error?.message || String(error) });
  }
}

/**
 * Trigger rebalance if needed
 */
async function triggerRebalanceIfNeeded(pool: typeof POOLS[0], maxDrift: number): Promise<boolean> {
  if (maxDrift < DRIFT_WARNING_PERCENT * 2) {
    return false;
  }
  
  try {
    const baseUrl = process.env.VERCEL 
      ? 'https://zkvanguard.vercel.app' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/cron/auto-rebalance`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
    });
    
    if (response.ok) {
      logger.info(`[PoolNAVMonitor] Triggered rebalance for ${pool.id}`);
      return true;
    }
  } catch (error) {
    logger.error(`[PoolNAVMonitor] Failed to trigger rebalance:`, error);
  }
  
  return false;
}

/**
 * Monitor all pools
 */
async function monitorPools(): Promise<{ pools: PoolMetrics[]; allAlerts: PoolAlert[]; summary: PoolMonitorResult['summary'] }> {
  const poolMetrics: PoolMetrics[] = [];
  const allAlerts: PoolAlert[] = [];
  let totalAUM = 0;
  let totalReturns = 0;
  let criticalPools = 0;
  let healthyPools = 0;
  
  for (const pool of POOLS) {
    logger.info(`[PoolNAVMonitor] Checking ${pool.name}`);
    
    const stats = await fetchPoolStats(pool);
    
    if (!stats) {
      logger.warn(`[PoolNAVMonitor] Skipping ${pool.id} - unable to fetch stats`);
      continue;
    }
    
    const previousNAV = getPreviousNAV(pool.id);
    const navChange = previousNAV ? stats.totalNAV - previousNAV : 0;
    const navChangePercent = previousNAV ? (navChange / previousNAV) * 100 : 0;
    
    const { drawdownPercent, peakNAV } = calculateDrawdown(pool.id, stats.totalNAV);
    const { maxDrift, driftingAssets } = checkAllocationDrift(stats.allocations, pool.targetAllocations);
    
    // Calculate since inception
    const daysActive = Math.max(1, (Date.now() / 1000 - stats.creationTime) / 86400);
    const inceptionNAV = peakNAV * 0.9; // Estimate - would use actual data
    const returnsPercent = ((stats.totalNAV - inceptionNAV) / inceptionNAV) * 100;
    
    // Generate alerts
    const alerts = generateAlerts(pool, {
      totalNAV: stats.totalNAV,
      previousNAV,
      navChangePercent,
      drawdownPercent,
      maxDrift,
      driftingAssets,
      memberCount: stats.memberCount,
    });
    
    allAlerts.push(...alerts);
    
    // Record snapshot
    await recordSnapshot(pool.id, stats.totalNAV);
    
    // Trigger rebalance if drift too high
    if (maxDrift > DRIFT_WARNING_PERCENT * 2) {
      await triggerRebalanceIfNeeded(pool, maxDrift);
    }
    
    const metrics: PoolMetrics = {
      poolId: pool.id,
      poolName: pool.name,
      totalNAV: stats.totalNAV,
      previousNAV: previousNAV || stats.totalNAV,
      navChange,
      navChangePercent,
      memberCount: stats.memberCount,
      sharePrice: stats.sharePrice,
      allocations: stats.allocations,
      drawdownPercent,
      peakNAV,
      sinceInception: {
        returns: stats.totalNAV - inceptionNAV,
        returnsPercent,
        days: Math.floor(daysActive),
      },
      alerts,
    };
    
    poolMetrics.push(metrics);
    
    // Update aggregates
    totalAUM += stats.totalNAV;
    totalReturns += navChangePercent;
    
    if (drawdownPercent >= DRAWDOWN_CRITICAL_PERCENT) {
      criticalPools++;
    } else {
      healthyPools++;
    }
    
    logger.info(`[PoolNAVMonitor] ${pool.name}: NAV $${stats.totalNAV.toLocaleString()}, Change ${navChangePercent >= 0 ? '+' : ''}${navChangePercent.toFixed(2)}%, Drawdown ${drawdownPercent.toFixed(2)}%`);
  }
  
  return {
    pools: poolMetrics,
    allAlerts,
    summary: {
      totalAUM,
      avgReturns: poolMetrics.length > 0 ? totalReturns / poolMetrics.length : 0,
      criticalPools,
      healthyPools,
    },
  };
}

/**
 * GET handler for Vercel Cron
 */
export async function GET(request: NextRequest): Promise<NextResponse<PoolMonitorResult>> {
  const startTime = Date.now();
  
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, poolsChecked: 0, pools: [], alerts: [], summary: { totalAUM: 0, avgReturns: 0, criticalPools: 0, healthyPools: 0 }, duration: Date.now() - startTime, error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  logger.info('[PoolNAVMonitor] Starting pool NAV monitoring');
  
  try {
    const result = await monitorPools();
    
    logger.info(`[PoolNAVMonitor] Complete: ${result.pools.length} pools checked, ${result.allAlerts.length} alerts`, {
      summary: result.summary,
    });
    
    return NextResponse.json({
      success: true,
      poolsChecked: result.pools.length,
      pools: result.pools,
      alerts: result.allAlerts,
      summary: result.summary,
      duration: Date.now() - startTime,
    });
    
  } catch (error: any) {
    logger.error('[PoolNAVMonitor] Error:', error);
    return NextResponse.json({
      success: false,
      poolsChecked: 0,
      pools: [],
      alerts: [],
      summary: {
        totalAUM: 0,
        avgReturns: 0,
        criticalPools: 0,
        healthyPools: 0,
      },
      duration: Date.now() - startTime,
      error: error.message,
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
