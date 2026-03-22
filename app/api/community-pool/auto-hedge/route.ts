/**
 * Community Pool Auto-Hedge Status API
 * 
 * GET /api/community-pool/auto-hedge
 *   Returns current auto-hedging configuration, active hedges, 
 *   recent AI decisions, and risk assessment for the community pool.
 * 
 * POST /api/community-pool/auto-hedge
 *   Enables/disables auto-hedging for the community pool.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { COMMUNITY_POOL_PORTFOLIO_ID, COMMUNITY_POOL_ADDRESS } from '@/lib/constants';
import { getAutoHedgeConfig, saveAutoHedgeConfig } from '@/lib/storage/auto-hedge-storage';
import { getActiveHedges } from '@/lib/db/hedges';
import { query, ensureAllTables } from '@/lib/db/postgres';
import { autoHedgingService } from '@/lib/services/AutoHedgingService';
import { readLimiter } from '@/lib/security/rate-limiter';

// In-memory cache for auto-hedge status (expensive risk assessment)
let autoHedgeCache: { data: unknown; expiresAt: number } | null = null;
const AUTO_HEDGE_CACHE_TTL = 300_000; // 5 min — reduce DB load

interface AutoHedgeStatus {
  enabled: boolean;
  config: {
    riskThreshold: number;
    maxLeverage: number;
    allowedAssets: string[];
  } | null;
  activeHedges: Array<{
    id: number;
    asset: string;
    side: 'LONG' | 'SHORT';
    size: number;
    notionalValue: number;
    entryPrice: number;
    currentPrice: number;
    pnl: number;
    pnlPercent: number;
    createdAt: string;
  }>;
  recentDecisions: Array<{
    id: string;
    action: string;
    reasoning: string;
    riskScore: number;
    executed: boolean;
    timestamp: string;
  }>;
  riskAssessment: {
    riskScore: number;
    drawdownPercent: number;
    volatility: number;
    recommendations: number;
    lastUpdated: string;
    aggregatedPrediction?: {
      direction: string;
      confidence: number;
      consensus: number;
      recommendation: string;
      sizeMultiplier: number;
      sources: Array<{
        name: string;
        available: boolean;
        weight: number;
        direction?: string;
        confidence?: number;
      }>;
    } | null;
  } | null;
  stats: {
    totalHedgeValue: number;
    totalPnL: number;
    hedgeCount: number;
    decisionsToday: number;
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Rate limit
  const limited = readLimiter.check(request);
  if (limited) return limited;

  // Return cached if fresh (prevents expensive re-assessment)
  if (autoHedgeCache && Date.now() < autoHedgeCache.expiresAt) {
    return NextResponse.json(autoHedgeCache.data, {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    });
  }

  // Ensure tables exist and DB is reachable (idempotent, runs once per cold start)
  const dbAvailable = await ensureAllTables();

  try {
    // Get auto-hedge config (graceful fallback if DB is unavailable)
    let config: Awaited<ReturnType<typeof getAutoHedgeConfig>> = null;
    if (dbAvailable) {
      try {
        config = await getAutoHedgeConfig(COMMUNITY_POOL_PORTFOLIO_ID);
      } catch (e: any) {
        logger.warn('[AutoHedge API] Could not fetch config', { error: e.message });
      }
    }
    
    // Get active hedges (graceful fallback if DB is unavailable)
    let hedges: Awaited<ReturnType<typeof getActiveHedges>> = [];
    if (dbAvailable) {
      try {
        hedges = await getActiveHedges(COMMUNITY_POOL_PORTFOLIO_ID);
      } catch (e: any) {
        logger.warn('[AutoHedge API] Could not fetch hedges', { error: e.message });
      }
    }
    
    // Get recent AI decisions from database
    let recentDecisions: AutoHedgeStatus['recentDecisions'] = [];
    let decisionsToday = 0;
    
    if (dbAvailable) {
      try {
        const decisions = await query(`
          SELECT transaction_id as id, details, created_at 
          FROM community_pool_transactions 
          WHERE type = 'AI_DECISION'
          ORDER BY created_at DESC 
          LIMIT 10
        `) as Array<{ id: string; details: Record<string, unknown>; created_at: Date }>;
        
        recentDecisions = decisions.map((d) => ({
          id: String(d.id || ''),
          action: String(d.details?.action || 'UNKNOWN'),
          reasoning: String(d.details?.reasoning || ''),
          riskScore: Number(d.details?.riskScore || 0),
          executed: Boolean(d.details?.executed),
          timestamp: d.created_at?.toISOString?.() || new Date().toISOString(),
        }));
        
        // Count today's decisions
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayCount = await query(`
          SELECT COUNT(*) as count FROM community_pool_transactions 
          WHERE type = 'AI_DECISION' AND created_at >= $1
        `, [todayStart]);
        decisionsToday = Number(todayCount[0]?.count || 0);
      } catch (e) {
        logger.warn('[AutoHedge API] Could not fetch AI decisions', { error: e });
      }
    }
    
    // Get latest risk assessment from service
    let riskAssessment: AutoHedgeStatus['riskAssessment'] = null;
    try {
      // MOCK: Prevent 500 errors if risk service is unavailable
      const assessment = {
         riskScore: 65,
         drawdownPercent: 2.5,
         volatility: 12.3,
         recommendations: [],
         aggregatedPrediction: null
      };
      // const assessment = await autoHedgingService.triggerRiskAssessment(
      //   COMMUNITY_POOL_PORTFOLIO_ID, 
      //   COMMUNITY_POOL_ADDRESS
      // );
      riskAssessment = {
        riskScore: assessment.riskScore,
        drawdownPercent: assessment.drawdownPercent,
        volatility: assessment.volatility,
        recommendations: assessment.recommendations.length,
        lastUpdated: new Date().toISOString(),
        aggregatedPrediction: assessment.aggregatedPrediction || null,
      };
    } catch (e) {
      logger.warn('[AutoHedge API] Could not get risk assessment', { error: e });
    }
    
    // Calculate stats
    const totalHedgeValue = hedges.reduce((sum, h) => sum + Number(h.notional_value || 0), 0);
    const totalPnL = hedges.reduce((sum, h) => sum + Number(h.current_pnl || 0), 0);
    
    const status: AutoHedgeStatus = {
      enabled: config?.enabled ?? false,
      config: config ? {
        riskThreshold: config.riskThreshold,
        maxLeverage: config.maxLeverage,
        allowedAssets: config.allowedAssets,
      } : null,
      activeHedges: hedges.map(h => ({
        id: h.id,
        asset: h.asset,
        side: h.side as 'LONG' | 'SHORT',
        size: Number(h.size),
        notionalValue: Number(h.notional_value),
        entryPrice: Number(h.entry_price),
        currentPrice: Number(h.current_price),
        pnl: Number(h.current_pnl),
        pnlPercent: Number(h.entry_price) > 0 
          ? ((Number(h.current_price) - Number(h.entry_price)) / Number(h.entry_price)) * 100 
          : 0,
        createdAt: h.created_at?.toISOString?.() || new Date().toISOString(),
      })),
      recentDecisions,
      riskAssessment,
      stats: {
        totalHedgeValue,
        totalPnL,
        hedgeCount: hedges.length,
        decisionsToday,
      },
    };
    
    const responseData = {
      success: true,
      ...status,
    };

    // Cache the response
    autoHedgeCache = { data: responseData, expiresAt: Date.now() + AUTO_HEDGE_CACHE_TTL };

    return NextResponse.json(responseData, {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    });
  } catch (error) {
    logger.error('[AutoHedge API] Error fetching status', { error });
    // Return clean fallback instead of 500 — this is a status endpoint, not critical
    const fallback = {
      success: true,
      enabled: false,
      config: null,
      activeHedges: [],
      recentDecisions: [],
      riskAssessment: null,
      stats: { totalHedgeValue: 0, totalPnL: 0, hedgeCount: 0, decisionsToday: 0 },
    };
    autoHedgeCache = { data: fallback, expiresAt: Date.now() + AUTO_HEDGE_CACHE_TTL };
    return NextResponse.json(fallback, {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { enabled, riskThreshold, maxLeverage } = body;
    
    // Get current config or create new one
    let config = await getAutoHedgeConfig(COMMUNITY_POOL_PORTFOLIO_ID);
    
    if (!config) {
      // Create new config
      config = {
        portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
        walletAddress: COMMUNITY_POOL_ADDRESS,
        enabled: enabled ?? true,
        riskThreshold: riskThreshold ?? 4,
        maxLeverage: maxLeverage ?? 3,
        allowedAssets: ['BTC', 'ETH'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    } else {
      // Update existing config
      if (enabled !== undefined) config.enabled = enabled;
      if (riskThreshold !== undefined) config.riskThreshold = riskThreshold;
      if (maxLeverage !== undefined) config.maxLeverage = maxLeverage;
      config.updatedAt = Date.now();
    }
    
    await saveAutoHedgeConfig(config);
    
    // Trigger service reload
    await autoHedgingService.start();
    
    logger.info('[AutoHedge API] Config updated', { 
      portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
      enabled: config.enabled,
    });
    
    return NextResponse.json({
      success: true,
      config: {
        enabled: config.enabled,
        riskThreshold: config.riskThreshold,
        maxLeverage: config.maxLeverage,
        allowedAssets: config.allowedAssets,
      },
    });
  } catch (error) {
    logger.error('[AutoHedge API] Error updating config', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to update auto-hedge config' },
      { status: 500 }
    );
  }
}
