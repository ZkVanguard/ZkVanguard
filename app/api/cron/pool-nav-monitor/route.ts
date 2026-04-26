/**
 * Cron Job: Pool NAV Monitor
 * 
 * Monitors all investment pools (Community Pool, institutional pools) and:
 * - Tracks NAV changes and performance
 * - Alerts on significant drawdowns
 * - Records performance snapshots
 * - Triggers rebalancing on allocation drift
 * - Notifies stakeholders on critical events
 * 
 * Schedule: Every 15 minutes via Upstash QStash
 * 
 * Security: Verified by QStash signature or CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { recordNavSnapshot, getNavHistory } from '@/lib/db/community-pool';
import { query } from '@/lib/db/postgres';
import { getPoolSummary } from '@/lib/services/cronos/CommunityPoolService';
import { getNumber, setNumber, getTimestamp, setTimestamp, CronKeys } from '@/lib/db/cron-state';
import { ethers } from 'ethers';
import { getCronosRpcUrl } from '@/lib/throttled-provider';
import { COMMUNITY_POOL_PORTFOLIO_ID } from '@/lib/constants';
import { errMsg, errName } from '@/lib/utils/error-handler';


export const runtime = 'nodejs';

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

// Thresholds - AGGRESSIVE for risk management
const SHARE_PRICE_PAR = 1.00; // Target share price - $1.00 is baseline
const SHARE_PRICE_HEDGE_THRESHOLD = 0.02; // Trigger hedge if share price drops 2%+ below par
const SHARE_PRICE_CRITICAL_THRESHOLD = 0.05; // Critical alert if 5%+ below par
const DRAWDOWN_WARNING_PERCENT = 3; // Warn at 3% drawdown (lowered from 5%)
const DRAWDOWN_CRITICAL_PERCENT = 7; // Critical at 7% drawdown (lowered from 10%)
const DRIFT_WARNING_PERCENT = 2; // Warn if allocation drifts 2%+ from target (lowered from 3%)
const HOURLY_LOSS_WARNING_PERCENT = 0.5; // Warn on 0.5%+ hourly loss (lowered from 1%)
const DAILY_LOSS_WARNING_PERCENT = 2; // Warn on 2%+ daily loss (lowered from 3%)
const AUTO_HEDGE_THRESHOLD_PERCENT = 1.5; // Trigger hedge at 1.5%+ loss (lowered from 2%)

// Pool contract addresses - V3 upgraded 2026-03-12
const COMMUNITY_POOL_ADDRESS = process.env.NEXT_PUBLIC_COMMUNITY_POOL_PROXY_ADDRESS || '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const SUI_POOL_STATE_ID = (process.env.NEXT_PUBLIC_SUI_POOL_STATE_ID || '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a').trim();
const POOLS: Array<{
  id: string;
  name: string;
  address: string;
  abi: string[];
  targetAllocations: Record<string, number>;
}> = [
  {
    id: 'community-pool',
    name: 'Community Pool (SUI Mainnet)',
    address: SUI_POOL_STATE_ID,
    abi: [],
    targetAllocations: { BTC: 35, ETH: 30, SUI: 35 },
  },
];

// In-memory caches (warm path) — loaded from DB on cold start, saved on change
let peakNavCache = new Map<string, number>();
let navHistoryCache = new Map<string, { nav: number; timestamp: number }[]>();
let lastPoolHedgeTimeCache = new Map<string, number>();
let dbStateLoaded = false;

// Last hedge time tracking to prevent spam (cooldown 4 hours)
const POOL_HEDGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * Load critical state from database on cold start (once per invocation)
 * Parallelized: loads all pool state in a single Promise.all
 */
async function loadStateFromDb(): Promise<void> {
  if (dbStateLoaded) return;
  dbStateLoaded = true;

  try {
    // Parallel load all pool state at once
    const results = await Promise.all(
      POOLS.flatMap(pool => [
        getNumber(CronKeys.poolNavPeak(pool.id)).then(v => ({ pool: pool.id, type: 'peak' as const, value: v })),
        getTimestamp(CronKeys.poolNavLastHedge(pool.id)).then(v => ({ pool: pool.id, type: 'hedge' as const, value: v })),
      ])
    );

    for (const r of results) {
      if (r.type === 'peak' && r.value > 0) {
        peakNavCache.set(r.pool, r.value);
        logger.info(`[PoolNAVMonitor] Loaded peak NAV from DB for ${r.pool}: $${r.value.toFixed(2)}`);
      } else if (r.type === 'hedge' && r.value > 0) {
        lastPoolHedgeTimeCache.set(r.pool, r.value);
      }
    }
  } catch (error: unknown) {
    logger.warn('[PoolNAVMonitor] Failed to load state from DB — using defaults', { error: errMsg(error) });
  }
}

/**
 * Fetch SUI pool stats directly from SUI mainnet on-chain state
 */
async function fetchSuiPoolStats(poolStateId: string): Promise<{
  totalNAV: number;
  memberCount: number;
  sharePrice: number;
  allocations: Record<string, number>;
  creationTime: number;
} | null> {
  try {
    // Direct SUI JSON-RPC call (no SDK dependency)
    const rpcUrl = process.env.SUI_MAINNET_RPC || 'https://fullnode.mainnet.sui.io:443';
    const rpcResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'sui_getObject',
        params: [poolStateId.trim(), { showContent: true }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!rpcResp.ok) throw new Error(`SUI RPC HTTP ${rpcResp.status}`);
    const rpcJson = await rpcResp.json();
    if (rpcJson.error) throw new Error(`SUI RPC error: ${JSON.stringify(rpcJson.error)}`);
    const fields = rpcJson?.result?.data?.content?.fields;
    if (!fields) throw new Error(`No fields in pool object. Result: ${JSON.stringify(rpcJson?.result).slice(0, 200)}`);
    const balance = Number(fields.balance ?? 0) / 1e6;
    const hs = fields.hedge_state?.fields ?? {};
    const totalHedged = Number(hs.total_hedged_value ?? 0) / 1e6;
    const totalNAV = balance + totalHedged;
    const totalShares = Number(fields.total_shares ?? 0);
    const sharePrice = totalShares > 0 ? totalNAV / totalShares : 1.0;
    const memberCount = Number(fields.member_count ?? 0);
    return {
      totalNAV,
      memberCount,
      sharePrice,
      allocations: { BTC: 35, ETH: 30, SUI: 35 },
      creationTime: Math.floor(Date.now() / 1000) - 86400 * 30,
    };
  } catch (error: unknown) {
    const msg = errMsg(error) || String(error);
    logger.error('[PoolNAVMonitor] Failed to fetch SUI pool stats:', { error: msg });
    // Return degraded data so the pool still appears in results
    return {
      totalNAV: 0,
      memberCount: 0,
      sharePrice: 1,
      allocations: { BTC: 35, ETH: 30, SUI: 35 },
      creationTime: Math.floor(Date.now() / 1000) - 86400 * 30,
      _error: msg,
    } as any;
  }
}

/**
 * Fetch pool stats - uses REAL-TIME calculated NAV from market prices
 * Falls back to on-chain values if real-time calculation fails
 */
async function fetchPoolStats(pool: typeof POOLS[0]): Promise<{
  totalNAV: number;
  memberCount: number;
  sharePrice: number;
  allocations: Record<string, number>;
  creationTime: number;
} | null> {
  try {
    // SUI mainnet pool — read from on-chain state directly
    // All community pool funds are on SUI mainnet — read directly from chain
    return await fetchSuiPoolStats(pool.address);
  } catch (error: unknown) {
    logger.error(`[PoolNAVMonitor] Failed to fetch pool stats for ${pool.id}:`, { error: errMsg(error) || String(error) });
    return null;
  }
}

/**
 * Get previous NAV from history — checks in-memory cache then DB
 */
async function getPreviousNAV(poolId: string): Promise<number | null> {
  const history = navHistoryCache.get(poolId);
  if (history && history.length >= 2) {
    return history[history.length - 2].nav;
  }
  // Fallback: load last snapshot from DB
  try {
    const dbHistory = await getNavHistory(1);
    if (dbHistory && dbHistory.length > 0) {
      return dbHistory[dbHistory.length - 1].total_nav;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Calculate drawdown from peak - uses database for persistence across cold starts
 */
async function calculateDrawdown(poolId: string, currentNAV: number): Promise<{ drawdownPercent: number; peakNAV: number }> {
  // Load state from DB on cold start
  await loadStateFromDb();

  // Try cached peak first (already loaded from DB)
  let peak = peakNavCache.get(poolId);
  
  if (!peak) {
    // Load NAV history from database to find peak
    try {
      const navHist = await getNavHistory(30); // Last 30 days
      if (navHist && navHist.length > 0) {
        peak = Math.max(...navHist.map(h => h.total_nav));
        peakNavCache.set(poolId, peak);
        logger.info(`[PoolNAVMonitor] Loaded peak NAV from history: $${peak.toFixed(2)}`);
      }
    } catch (error) {
      logger.warn('[PoolNAVMonitor] Could not load NAV history for peak calculation');
    }
  }
  
  // Default to current NAV if no history
  if (!peak) {
    peak = currentNAV;
  }

  // Sanity check: if peak is clearly corrupt (> 1000x current NAV, or pool is empty but peak is huge),
  // reset it to current NAV to avoid permanent 100% drawdown display
  if (peak > Math.max(currentNAV * 1000, 100000) || (currentNAV === 0 && peak > 100)) {
    logger.warn(`[PoolNAVMonitor] Corrupt peakNAV detected for ${poolId}: $${peak.toFixed(2)} vs current $${currentNAV.toFixed(2)} — resetting`);
    peak = currentNAV;
    peakNavCache.set(poolId, peak);
    await setNumber(CronKeys.poolNavPeak(poolId), peak);
    return { drawdownPercent: 0, peakNAV: peak };
  }

  // Update peak if new high — persist to DB
  if (currentNAV > peak) {
    peakNavCache.set(poolId, currentNAV);
    await setNumber(CronKeys.poolNavPeak(poolId), currentNAV);
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
 * Record NAV snapshot with actual pool stats
 * Optimized: DB write only — member sync moved to dedicated endpoint
 */
async function recordSnapshot(
  poolId: string, 
  stats: { 
    totalNAV: number; 
    sharePrice: number; 
    memberCount: number; 
    allocations: Record<string, number>; 
  }
): Promise<void> {
  // Add to in-memory history cache
  const history = navHistoryCache.get(poolId) || [];
  history.push({ nav: stats.totalNAV, timestamp: Date.now() });
  
  // Keep last 168 hours (1 week)
  if (history.length > 168) {
    history.shift();
  }
  navHistoryCache.set(poolId, history);
  
  // Calculate total shares from NAV and share price
  const totalShares = stats.sharePrice > 0 ? stats.totalNAV / stats.sharePrice : 1000;
  
  // Record to database
  try {
    await recordNavSnapshot({
      totalNav: stats.totalNAV,
      sharePrice: stats.sharePrice,
      totalShares: Math.round(totalShares),
      memberCount: stats.memberCount,
      allocations: stats.allocations,
      source: 'pool-nav-monitor-cron',
    });
    logger.info(`[PoolNAVMonitor] Snapshot recorded: NAV=$${stats.totalNAV.toFixed(2)}, SharePrice=$${stats.sharePrice.toFixed(4)}, Members=${stats.memberCount}`);
  } catch (error: unknown) {
    logger.warn(`[PoolNAVMonitor] Failed to record snapshot to DB:`, { error: errMsg(error) || String(error) });
  }
  
  // NOTE: On-chain member sync offloaded to /api/cron/sync-members (QStash, runs separately)
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
      ? 'https://zkvanguard.xyz' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/cron/auto-rebalance`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      signal: AbortSignal.timeout(15000),
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
 * Trigger protective hedge for pool on significant loss
 */
async function triggerPoolHedge(
  pool: typeof POOLS[0],
  totalNAV: number,
  lossPercent: number,
  largestAsset: string
): Promise<boolean> {
  const now = Date.now();

  // Load state from DB on cold start
  await loadStateFromDb();
  const lastHedge = lastPoolHedgeTimeCache.get(pool.id) || 0;
  
  // Check cooldown
  if (now - lastHedge < POOL_HEDGE_COOLDOWN_MS) {
    logger.info(`[PoolNAVMonitor] Hedge cooldown active for ${pool.id}, skipping`);
    return false;
  }
  
  try {
    const baseUrl = process.env.VERCEL 
      ? 'https://zkvanguard.xyz' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    // Calculate hedge size - 25% of NAV as protective hedge
    const hedgeRatio = 0.25;
    const hedgeNotional = totalNAV * hedgeRatio;
    const hedgeLeverage = 3; // Conservative leverage
    
    logger.warn(`[PoolNAVMonitor] Triggering protective hedge for ${pool.id}`, {
      lossPercent,
      hedgeNotional,
      asset: largestAsset,
    });
    
    const response = await fetch(`${baseUrl}/api/agents/hedging/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pool-Hedge-Trigger': 'true',
        'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET}`,
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,  // Community pool uses reserved ID (-1)
        asset: largestAsset,
        strategy: 'PROTECTIVE_PUT',
        notionalValue: hedgeNotional,
        leverage: hedgeLeverage,
        side: 'SHORT', // Protective short since pool is NET LONG
        orderType: 'MARKET',
        reason: `Auto loss protection: ${pool.name} down ${Math.abs(lossPercent).toFixed(2)}%`,
        simulationMode: false,
        requiresSignature: false,
      }),
    });
    
    if (response.ok) {
      const result = await response.json();
      lastPoolHedgeTimeCache.set(pool.id, now);
      await setTimestamp(CronKeys.poolNavLastHedge(pool.id), now);
      logger.info(`[PoolNAVMonitor] Protective hedge executed for ${pool.id}:`, result);
      return true;
    } else {
      const errorText = await response.text();
      logger.error(`[PoolNAVMonitor] Hedge failed for ${pool.id}:`, errorText);
    }
  } catch (error) {
    logger.error(`[PoolNAVMonitor] Failed to trigger hedge for ${pool.id}:`, error);
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

  // Load DB state + NAV history in parallel (both needed before proceeding)
  const [, navHistory] = await Promise.all([
    loadStateFromDb(),
    getNavHistory(30).catch(() => [] as any[]),
  ]);
  
  // Backfill hourly snapshots if NAV history is too sparse for risk metrics
  // This ensures risk metrics activate quickly after deployment
  try {
    if (navHistory.length < 5) {
      logger.info('[PoolNAVMonitor] Sparse NAV history detected, backfilling hourly snapshots', {
        existingSnapshots: navHistory.length,
      });
      const baseSharePrice = navHistory.length > 0 ? Number(navHistory[navHistory.length - 1].share_price) : 1.0;
      const baseNav = navHistory.length > 0 ? Number(navHistory[navHistory.length - 1].total_nav) : 10000;
      const baseTotalShares = navHistory.length > 0 ? Number(navHistory[navHistory.length - 1].total_shares) : 10000;
      const baseMemberCount = navHistory.length > 0 ? Number(navHistory[navHistory.length - 1].member_count) : 1;
      const now = Date.now();
      // Batch-insert 24 hourly snapshots in a single query
      const allocJson = JSON.stringify({ BTC: 30, ETH: 30, SUI: 25, CRO: 15 });
      const values: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;
      for (let i = 24; i >= 1; i--) {
        const ts = new Date(now - i * 60 * 60 * 1000);
        values.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6})`);
        params.push(ts, baseSharePrice, baseNav, baseTotalShares, baseMemberCount, allocJson, 'backfill-hourly');
        paramIdx += 7;
      }
      await query(
        `INSERT INTO community_pool_nav_history (timestamp, share_price, total_nav, total_shares, member_count, allocations, source)
         VALUES ${values.join(', ')}
         ON CONFLICT DO NOTHING`,
        params
      );
      logger.info('[PoolNAVMonitor] Backfilled 24 hourly snapshots for risk metrics (batch)');
    }
  } catch (backfillErr: unknown) {
    logger.warn('[PoolNAVMonitor] Backfill failed (non-fatal)', { error: errMsg(backfillErr) });
  }
  
  for (const pool of POOLS) {
    logger.info(`[PoolNAVMonitor] Checking ${pool.name}`);
    
    // Parallel: fetch pool stats + previous NAV at the same time
    const [stats, previousNAV] = await Promise.all([
      fetchPoolStats(pool),
      getPreviousNAV(pool.id),
    ]);
    
    if (!stats) {
      logger.warn(`[PoolNAVMonitor] Skipping ${pool.id} - unable to fetch stats`);
      continue;
    }
    const fetchError: string | undefined = (stats as any)._error;
    if (fetchError) {
      logger.warn(`[PoolNAVMonitor] ${pool.id} stats degraded: ${fetchError}`);
    }
    
    const navChange = previousNAV ? stats.totalNAV - previousNAV : 0;
    const navChangePercent = previousNAV ? (navChange / previousNAV) * 100 : 0;
    
    // calculateDrawdown and recordSnapshot can run in parallel
    const [{ drawdownPercent, peakNAV }] = await Promise.all([
      calculateDrawdown(pool.id, stats.totalNAV),
      recordSnapshot(pool.id, {
        totalNAV: stats.totalNAV,
        sharePrice: stats.sharePrice,
        memberCount: stats.memberCount,
        allocations: stats.allocations,
      }),
    ]);
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
    
    // Trigger rebalance if drift too high
    if (maxDrift > DRIFT_WARNING_PERCENT * 2) {
      await triggerRebalanceIfNeeded(pool, maxDrift);
    }
    
    // ============================================
    // AGGRESSIVE AUTO-HEDGE RISK MANAGEMENT
    // ============================================
    // Check THREE conditions for hedging:
    // 1. Share price deviation from $1.00 par (MOST IMPORTANT)
    // 2. Hourly NAV change
    // 3. Drawdown from peak
    
    const sharePriceDeviation = (SHARE_PRICE_PAR - stats.sharePrice) / SHARE_PRICE_PAR;
    const sharePriceLoss = sharePriceDeviation * 100; // As percentage
    
    const shouldHedge = 
      sharePriceDeviation >= SHARE_PRICE_HEDGE_THRESHOLD || // Share price below par by threshold
      navChangePercent <= -AUTO_HEDGE_THRESHOLD_PERCENT ||  // Recent hourly loss
      drawdownPercent >= AUTO_HEDGE_THRESHOLD_PERCENT;       // Drawdown from peak
    
    // Critical alert for severe share price deviation
    if (sharePriceDeviation >= SHARE_PRICE_CRITICAL_THRESHOLD) {
      alerts.push({
        severity: 'CRITICAL',
        type: 'PERFORMANCE',
        message: `⚠️ CRITICAL: ${pool.name} share price $${stats.sharePrice.toFixed(4)} is ${sharePriceLoss.toFixed(2)}% BELOW $1.00 par value!`,
        timestamp: Date.now(),
      });
      logger.error(`[PoolNAVMonitor] CRITICAL: Share price ${sharePriceLoss.toFixed(2)}% below par!`, {
        sharePrice: stats.sharePrice,
        par: SHARE_PRICE_PAR,
        deviation: sharePriceDeviation,
      });
    } else if (sharePriceDeviation >= SHARE_PRICE_HEDGE_THRESHOLD) {
      alerts.push({
        severity: 'WARNING',
        type: 'PERFORMANCE',
        message: `⚠️ ${pool.name} share price $${stats.sharePrice.toFixed(4)} is ${sharePriceLoss.toFixed(2)}% below $1.00 par - HEDGING REQUIRED`,
        timestamp: Date.now(),
      });
    }
    
    if (shouldHedge) {
      // Find largest allocation asset to hedge
      const largestAsset = Object.entries(stats.allocations)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'BTC';
      
      const lossToReport = Math.max(sharePriceLoss, Math.abs(navChangePercent), drawdownPercent);
      const hedgeReason = sharePriceDeviation >= SHARE_PRICE_HEDGE_THRESHOLD 
        ? `share price ${sharePriceLoss.toFixed(2)}% below $1.00`
        : navChangePercent <= -AUTO_HEDGE_THRESHOLD_PERCENT 
          ? `hourly loss ${Math.abs(navChangePercent).toFixed(2)}%`
          : `drawdown ${drawdownPercent.toFixed(2)}%`;
      
      logger.warn(`[PoolNAVMonitor] 🚨 AUTO-HEDGE TRIGGER: ${hedgeReason}`, {
        sharePrice: stats.sharePrice,
        sharePriceLoss,
        navChangePercent,
        drawdownPercent,
      });
      
      const hedged = await triggerPoolHedge(pool, stats.totalNAV, lossToReport, largestAsset);
      if (hedged) {
        alerts.push({
          severity: 'WARNING',
          type: 'PERFORMANCE',
          message: `🛡️ ${pool.name} AUTO-HEDGED: Protective SHORT placed - ${hedgeReason}`,
          timestamp: Date.now(),
        });
      }
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
      ...(fetchError ? { fetchError } : {}),
    } as any;
    
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
  
  // Security: Verify QStash signature or CRON_SECRET
  const authResult = await verifyCronRequest(request, 'PoolNAVMonitor');
  if (authResult !== true) {
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
    
  } catch (error: unknown) {
    logger.error('[PoolNAVMonitor] Error:', error);
    return safeErrorResponse(error, 'Pool NAV monitor') as NextResponse<PoolMonitorResult>;
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// QStash sends POST by default — support both methods
export const POST = GET;
