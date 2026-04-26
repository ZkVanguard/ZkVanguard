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
import { COMMUNITY_POOL_PORTFOLIO_ID, COMMUNITY_POOL_ADDRESS, SUI_COMMUNITY_POOL_PORTFOLIO_ID } from '@/lib/constants';
import { getAutoHedgeConfig, saveAutoHedgeConfig } from '@/lib/storage/auto-hedge-storage';
import { getActiveHedges } from '@/lib/db/hedges';
import { query, ensureAllTables } from '@/lib/db/postgres';
import { autoHedgingService } from '@/lib/services/hedging/AutoHedgingService';
import { readLimiter } from '@/lib/security/rate-limiter';
import { errMsg, errName } from '@/lib/utils/error-handler';

export const runtime = 'nodejs';

export const maxDuration = 15;
// In-memory cache for auto-hedge status (expensive risk assessment)
const autoHedgeCacheByChain = new Map<string, { data: unknown; expiresAt: number }>();
const AUTO_HEDGE_CACHE_TTL = 300_000; // 5 min — reduce DB load
const AUTO_HEDGE_SUI_CACHE_TTL = 60_000;  // 1 min for SUI — on-chain hedge state changes faster

// SUI on-chain hedge mapping
const SUI_PAIR_INDEX_TO_ASSET: Record<number, string> = { 0: 'BTC', 1: 'ETH', 2: 'SUI', 3: 'CRO' };

interface OnChainSuiHedge {
  id: string;
  asset: string;
  side: 'LONG' | 'SHORT';
  size: number;
  notionalValue: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  createdAt: string;
}

interface OnChainSuiState {
  hedges: OnChainSuiHedge[];
  enabled: boolean;
  config: { riskThreshold: number; maxLeverage: number; allowedAssets: string[] } | null;
}

/**
 * Read on-chain SUI pool state and convert active hedges into UI shape.
 * The DB `hedges` table only stores BlueFin perp hedges; the SUI pool's
 * Move-contract HedgePosition objects (from open_hedge calls) live in
 * pool.hedge_state.active_hedges and were never surfaced to the UI.
 */
async function readOnChainSuiHedges(): Promise<OnChainSuiState> {
  const empty: OnChainSuiState = { hedges: [], enabled: false, config: null };
  // Prefer the USDC pool state ID; fall back to legacy single-pool var.
  // Trim aggressively to drop any \r\n that snuck into env values.
  const trim = (v: string | undefined) => (v || '').replace(/[\s\r\n"']+/g, '').trim();
  const poolStateId =
    trim(process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE) ||
    trim(process.env.NEXT_PUBLIC_SUI_POOL_STATE_ID);
  if (!poolStateId) return empty;

  try {
    const rpcUrl = trim(process.env.NEXT_PUBLIC_SUI_RPC_URL) || 'https://fullnode.mainnet.sui.io:443';
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'sui_getObject',
        params: [poolStateId, { showContent: true, showType: true }],
      }),
      // Hard timeout — pool stats already covered upstream; this is a best-effort enrichment
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return empty;
    const json = await res.json() as { result?: { data?: { content?: { fields?: any } } } };
    const fields = json?.result?.data?.content?.fields;
    if (!fields) return empty;

    const hedgeState = fields.hedge_state?.fields || {};
    const autoCfg = hedgeState.auto_hedge_config?.fields || {};
    const activeHedges: any[] = Array.isArray(hedgeState.active_hedges) ? hedgeState.active_hedges : [];

    // Fetch live prices for each unique asset present
    let priceMap: Record<string, number> = {};
    if (activeHedges.length > 0) {
      try {
        const { getMarketDataService } = await import('@/lib/services/market-data/RealMarketDataService');
        const mds = getMarketDataService();
        const assets = Array.from(new Set(
          activeHedges
            .map(h => SUI_PAIR_INDEX_TO_ASSET[Number(h?.fields?.pair_index ?? -1)])
            .filter((a): a is string => !!a)
        ));
        await Promise.all(assets.map(async (a) => {
          try {
            const p = await mds.getTokenPrice(a);
            if (p?.price) priceMap[a] = p.price;
          } catch { /* missing price is non-fatal */ }
        }));
      } catch (err) {
        logger.warn('[AutoHedge API] Could not load market prices for on-chain hedges', { error: errMsg(err) });
      }
    }

    const hedges: OnChainSuiHedge[] = activeHedges.map((h, idx) => {
      const f = h?.fields || {};
      const pairIndex = Number(f.pair_index ?? 0);
      const asset = SUI_PAIR_INDEX_TO_ASSET[pairIndex] || `PAIR_${pairIndex}`;
      const isLong = Boolean(f.is_long);
      const collateralUsdc = Number(f.collateral_usdc || 0) / 1e6;  // USDC has 6 decimals
      const leverage = Math.max(1, Number(f.leverage || 1));
      const notional = collateralUsdc * leverage;
      const currentPrice = priceMap[asset] || 0;
      // Entry price is not stored on-chain — best-effort: use current as fallback so PnL is 0
      // until we wire a separate entry-price index.
      const entryPrice = currentPrice;
      const sizeBase = currentPrice > 0 ? notional / currentPrice : 0;
      const openTimeMs = Number(f.open_time || 0);
      // Hedge id: bytes -> hex
      let idHex: string;
      const hedgeIdBytes = Array.isArray(f.hedge_id) ? f.hedge_id : [];
      if (hedgeIdBytes.length > 0) {
        idHex = '0x' + hedgeIdBytes.map((b: number) => Number(b).toString(16).padStart(2, '0')).join('');
      } else {
        idHex = `sui-onchain-${idx}`;
      }

      return {
        id: idHex,
        asset,
        side: isLong ? 'LONG' : 'SHORT',
        size: Math.round(sizeBase * 1e8) / 1e8,
        notionalValue: Math.round(notional * 100) / 100,
        entryPrice: Math.round(entryPrice * 100) / 100,
        currentPrice: Math.round(currentPrice * 100) / 100,
        pnl: 0,
        pnlPercent: 0,
        createdAt: openTimeMs > 0 ? new Date(openTimeMs).toISOString() : new Date().toISOString(),
      };
    });

    const enabled = Boolean(autoCfg.enabled);
    const riskThresholdBps = Number(autoCfg.risk_threshold_bps || 0);
    const maxHedgeRatioBps = Number(autoCfg.max_hedge_ratio_bps || 0);
    const defaultLeverage = Number(autoCfg.default_leverage || 1);

    return {
      hedges,
      enabled,
      config: {
        // Convert bps (0-10000) to 0-10 scale used by the UI
        riskThreshold: Math.round((riskThresholdBps / 1000) * 10) / 10,
        maxLeverage: defaultLeverage,
        allowedAssets: ['BTC', 'ETH', 'SUI'],
      },
    };
  } catch (err) {
    logger.warn('[AutoHedge API] Failed to read on-chain SUI hedges (non-critical)', { error: errMsg(err) });
    return empty;
  }
}

interface AutoHedgeStatus {
  enabled: boolean;
  config: {
    riskThreshold: number;
    maxLeverage: number;
    allowedAssets: string[];
  } | null;
  activeHedges: Array<{
    id: number | string;
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

  const chain = request.nextUrl.searchParams.get('chain') || 'cronos';
  const isSui = chain === 'sui';
  const portfolioId = isSui ? SUI_COMMUNITY_POOL_PORTFOLIO_ID : COMMUNITY_POOL_PORTFOLIO_ID;

  // Return cached if fresh (prevents expensive re-assessment)
  const autoHedgeCache = autoHedgeCacheByChain.get(chain);
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
        config = await getAutoHedgeConfig(portfolioId);
        
        // MAINNET: Auto-seed default config if none exists
        // This ensures auto-hedge is always configured for the community pool
        if (!config) {
          const defaultConfig = {
            portfolioId: portfolioId,
            walletAddress: COMMUNITY_POOL_ADDRESS,
            enabled: true,
            riskThreshold: 4,
            maxLeverage: 3,
            allowedAssets: ['BTC', 'ETH', 'CRO', 'SUI'],
            riskTolerance: 30,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          try {
            await saveAutoHedgeConfig(defaultConfig);
            config = defaultConfig;
            logger.info('[AutoHedge API] Auto-seeded default config for community pool');
          } catch (seedErr) {
            logger.warn('[AutoHedge API] Could not seed default config', { error: seedErr });
          }
        }
      } catch (e: unknown) {
        logger.warn('[AutoHedge API] Could not fetch config', { error: errMsg(e) });
      }
    }
    
    // Get active hedges (graceful fallback if DB is unavailable)
    let hedges: Awaited<ReturnType<typeof getActiveHedges>> = [];
    if (dbAvailable) {
      try {
        hedges = await getActiveHedges(portfolioId, isSui ? 'sui' : undefined);
      } catch (e: unknown) {
        logger.warn('[AutoHedge API] Could not fetch hedges', { error: errMsg(e) });
      }
    }

    // For SUI: also read on-chain HedgePosition objects from the Move pool state.
    // The DB `hedges` table only stores BlueFin perp hedges. SUI's actual pool
    // hedges are Move-contract objects in pool.hedge_state.active_hedges and
    // were never surfaced to the UI before this branch.
    let onChainSui: OnChainSuiState = { hedges: [], enabled: false, config: null };
    if (isSui) {
      onChainSui = await readOnChainSuiHedges();
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
            AND (details->>'chain' = $1 OR ($1 = 'cronos' AND details->>'chain' IS NULL))
          ORDER BY created_at DESC 
          LIMIT 10
        `, [chain]) as Array<{ id: string; details: Record<string, unknown>; created_at: Date }>;
        
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
            AND (details->>'chain' = $2 OR ($2 = 'cronos' AND details->>'chain' IS NULL))
        `, [todayStart, chain]);
        decisionsToday = Number(todayCount[0]?.count || 0);
      } catch (e) {
        logger.warn('[AutoHedge API] Could not fetch AI decisions', { error: e });
      }
    }
    
    // Get latest risk assessment from service (LIVE — no mock data)
    // Use timeout to prevent Vercel 504 — risk assessment involves multiple external APIs
    let riskAssessment: AutoHedgeStatus['riskAssessment'] = null;
    try {
      const RISK_TIMEOUT_MS = 8_000;
      const assessment = await Promise.race([
        autoHedgingService.triggerRiskAssessment(
          portfolioId, 
          COMMUNITY_POOL_ADDRESS,
          isSui ? 'sui' : undefined
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Risk assessment timed out')), RISK_TIMEOUT_MS)
        ),
      ]);
      riskAssessment = {
        riskScore: Math.round(assessment.riskScore * 100) / 100,
        drawdownPercent: Math.round(assessment.drawdownPercent * 100) / 100,
        volatility: Math.round(assessment.volatility * 100) / 100,
        recommendations: assessment.recommendations.length,
        lastUpdated: new Date().toISOString(),
        aggregatedPrediction: assessment.aggregatedPrediction ? {
          ...assessment.aggregatedPrediction,
          confidence: Math.round(assessment.aggregatedPrediction.confidence * 100) / 100,
          consensus: Math.round(assessment.aggregatedPrediction.consensus * 100) / 100,
          sizeMultiplier: Math.round(assessment.aggregatedPrediction.sizeMultiplier * 100) / 100,
        } : null,
      };
    } catch (e) {
      logger.warn('[AutoHedge API] Could not get risk assessment — returning null (no mock data)', { error: e });
      // riskAssessment stays null — frontend must handle null gracefully
    }
    
    // Calculate stats
    const totalHedgeValue = hedges.reduce((sum, h) => sum + Number(h.notional_value || 0), 0);
    const totalPnL = hedges.reduce((sum, h) => sum + Number(h.current_pnl || 0), 0);

    // Merge DB-recorded BlueFin hedges with on-chain SUI Move hedges (if any).
    const dbActiveHedges = hedges.map(h => ({
      id: String(h.id),
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
    }));
    const mergedActiveHedges = [...dbActiveHedges, ...onChainSui.hedges];
    const onChainHedgeValue = onChainSui.hedges.reduce((sum, h) => sum + h.notionalValue, 0);

    // For SUI, the on-chain auto_hedge_config is the source of truth for `enabled`.
    // Fall back to the DB config only if on-chain read failed (no hedges and no config).
    const effectiveEnabled = isSui
      ? (onChainSui.config !== null ? onChainSui.enabled : (config?.enabled ?? false))
      : (config?.enabled ?? false);
    const effectiveConfig = isSui && onChainSui.config !== null
      ? onChainSui.config
      : (config ? { riskThreshold: config.riskThreshold, maxLeverage: config.maxLeverage, allowedAssets: config.allowedAssets } : null);

    const status: AutoHedgeStatus = {
      enabled: effectiveEnabled,
      config: effectiveConfig,
      activeHedges: mergedActiveHedges,
      recentDecisions,
      riskAssessment,
      stats: {
        totalHedgeValue: Math.round((totalHedgeValue + onChainHedgeValue) * 100) / 100,
        totalPnL: Math.round(totalPnL * 100) / 100,
        hedgeCount: hedges.length + onChainSui.hedges.length,
        decisionsToday,
      },
    };
    
    const responseData = {
      success: true,
      ...status,
    };

    // Cache the response
    autoHedgeCacheByChain.set(chain, { data: responseData, expiresAt: Date.now() + (isSui ? AUTO_HEDGE_SUI_CACHE_TTL : AUTO_HEDGE_CACHE_TTL) });

    return NextResponse.json(responseData, {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    });
  } catch (error) {
    logger.error('[AutoHedge API] Error fetching status', { error });
    // Return error with 503 — do NOT cache or return fake "success" data
    logger.error('[AutoHedge API] Returning 503 — no mock/fallback data allowed', { error });
    return NextResponse.json({
      success: false,
      error: 'Auto-hedge service temporarily unavailable',
      enabled: false,
      config: null,
      activeHedges: [],
      recentDecisions: [],
      riskAssessment: null,
      stats: null,
    }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
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
