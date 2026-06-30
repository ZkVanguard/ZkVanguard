/**
 * Platform Risk Overview API
 *
 * Public, investor-facing aggregation of platform-wide risk metrics. Mirrors
 * BlackRock's Aladdin client-portal model: one endpoint, everything an LP or
 * grant reviewer needs to assess fund health at a glance.
 *
 * Strictly READ-ONLY. No mutations. Reuses existing DB tables + the cached
 * NAV snapshot stream maintained by sui-community-pool cron.
 *
 * GET /api/platform/risk-overview
 *
 * Returns:
 *   - platform.tvl: total NAV across all products (currently SUI USDC pool)
 *   - platform.drawdownPct: pool share price drawdown from ATH
 *   - platform.peakSharePrice + current
 *   - hedge.totalNotional + totalUnrealizedPnl + count
 *   - hedge.coverageRatio: hedgeNotional / poolNAV
 *   - reconciliation.cronHealth: per-cron staleness summary
 *   - zkAttestations: recent ZK proof commitments (count over last 24h + last 10 feed)
 *   - signals: latest per-asset prediction direction
 *   - asOf
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { readLimiter } from '@/lib/security/rate-limiter';
import { query } from '@/lib/db/postgres';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface CronHealth {
  key: string;
  ageMinutes: number;
  status: 'ok' | 'warn' | 'stale';
}

interface HedgeRow {
  market: string;
  side: 'LONG' | 'SHORT';
  notionalUsd: number;
  unrealizedPnlUsd: number;
  leverage: number;
  ageMinutes: number;
}

interface ZkAttestationRow {
  market: string;
  side: string;
  zkProofHash: string;
  createdAt: string;
}

interface RiskOverviewResponse {
  asOf: string;
  platform: {
    tvlUsd: number;
    netCapitalDeposited: number;
    netCapitalReturn: { absoluteUsd: number; percent: number };
    memberCount: number;
    sharePrice: number;
    peakSharePrice: number;
    drawdownPct: number;
    sharePriceReturn: number;
  };
  hedge: {
    activeCount: number;
    totalNotionalUsd: number;
    totalUnrealizedPnlUsd: number;
    coverageRatio: number;
    positions: HedgeRow[];
  };
  reconciliation: {
    cronHealth: CronHealth[];
    healthyCount: number;
    warnCount: number;
    staleCount: number;
  };
  zkAttestations: {
    last24hCount: number;
    recentFeed: ZkAttestationRow[];
  };
  signals: {
    BTC?: { direction: string; confidence: number };
    ETH?: { direction: string; confidence: number };
  };
  agents: {
    cycle: {
      ranAt: string | null;
      ageMinutes: number | null;
      riskScore: number | null;
      riskLevel: string | null;
      summary: string | null;
    };
    directives: Array<{
      asset: string;
      recommendedSide: 'LONG' | 'SHORT' | null;
      confidence: number;
      shouldHedge: boolean;
      reason: string;
    }>;
    scorecard: {
      totalDecisions: number;
      approvedCount: number;
      rejectedCount: number;
      actedOnCount: number;
      settledCount: number;
      netPnlUsd: number;
      winRate: number | null;
    };
  };
}

const POOL_INCEPTION_SHARE_PRICE = 1.0;

/**
 * Live agent activity surface — what the 7-agent system is recommending
 * right now, plus how well its past recommendations have done. Drives the
 * "AI Agent Activity" panel on /dashboard/risk.
 */
async function getAgentSection(): Promise<RiskOverviewResponse['agents']> {
  const empty = {
    cycle: { ranAt: null, ageMinutes: null, riskScore: null, riskLevel: null, summary: null },
    directives: [] as RiskOverviewResponse['agents']['directives'],
    scorecard: { totalDecisions: 0, approvedCount: 0, rejectedCount: 0, actedOnCount: 0, settledCount: 0, netPnlUsd: 0, winRate: null },
  };
  try {
    const [{ getCronState }, { getLatestDirectives }, { getRecentAgentScorecard }] = await Promise.all([
      import('@/lib/db/cron-state'),
      import('@/lib/services/agents/agent-trade-guard'),
      import('@/lib/db/agent-decisions'),
    ]);
    const [lastCycle, directives, scorecard] = await Promise.all([
      getCronState<{ ts: number; success: boolean; riskScore?: number; riskLevel?: string; leadSummary?: string }>('lead-cycle:last-decision'),
      getLatestDirectives(),
      getRecentAgentScorecard('sui', 7),
    ]);
    const cycleAgeMin = lastCycle?.ts ? Math.floor((Date.now() - lastCycle.ts) / 60_000) : null;
    return {
      cycle: {
        ranAt: lastCycle?.ts ? new Date(lastCycle.ts).toISOString() : null,
        ageMinutes: cycleAgeMin,
        riskScore: lastCycle?.riskScore ?? null,
        riskLevel: lastCycle?.riskLevel ?? null,
        summary: lastCycle?.leadSummary ?? null,
      },
      directives: directives
        ? Object.values(directives.byAsset).map((d) => ({
            asset: d.asset,
            recommendedSide: d.recommendedSide,
            confidence: d.confidence,
            shouldHedge: d.shouldHedge,
            reason: d.reason,
          }))
        : [],
      scorecard,
    };
  } catch (e) {
    logger.warn('[Risk Overview] agent section failed', { error: String(e).slice(0, 200) });
    return empty;
  }
}

/**
 * Read pool's lifetime deposits/withdrawals + ATH directly from the on-chain
 * object via JSON-RPC. Avoids the expensive BlueFin auth path that
 * SuiUsdcPoolService.getPoolStats() triggers.
 */
async function readPoolStaticsOnChain(): Promise<{
  totalDeposited: number; totalWithdrawn: number; allTimeHighSharePrice: number;
} | null> {
  const poolStateId = (
    process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE ||
    process.env.NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE ||
    ''
  ).trim();
  if (!poolStateId) return null;
  const rpcUrl = (process.env.SUI_MAINNET_RPC || 'https://fullnode.mainnet.sui.io:443').trim();
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'sui_getObject',
        params: [poolStateId, { showContent: true }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const fields = json?.result?.data?.content?.fields;
    if (!fields) return null;
    // Decimal handling: USDC has 6 decimals, share price stored in higher precision
    return {
      totalDeposited: Number(fields.total_deposited ?? 0) / 1e6,
      totalWithdrawn: Number(fields.total_withdrawn ?? 0) / 1e6,
      allTimeHighSharePrice: Number(fields.all_time_high_nav ?? 0) / 1e6,
    };
  } catch {
    return null;
  }
}

async function getPoolMetrics() {
  // Primary source: the authoritative DB snapshot written by sui-community-pool
  // cron (source='sui-usdc-pool'). Lifetime totals + ATH come from a direct
  // on-chain RPC read so we don't pay the BlueFin auth cost.
  try {
    const [latest, onChain] = await Promise.all([
      query<{ total_nav: string; share_price: string; member_count: number }>(
        `SELECT total_nav, share_price, member_count FROM community_pool_nav_history
          WHERE chain = 'sui' AND source = 'sui-usdc-pool'
          ORDER BY timestamp DESC LIMIT 1`,
      ),
      readPoolStaticsOnChain(),
    ]);
    const navUsd = Number(latest[0]?.total_nav) || 0;
    const sharePrice = Number(latest[0]?.share_price) || 1;
    const memberCount = Number(latest[0]?.member_count) || 0;
    const peakSharePrice = onChain?.allTimeHighSharePrice && onChain.allTimeHighSharePrice > 0
      ? onChain.allTimeHighSharePrice
      : sharePrice;
    const netCapital = onChain ? onChain.totalDeposited - onChain.totalWithdrawn : 0;
    const drawdownPct = peakSharePrice > 0
      ? Math.max(0, ((peakSharePrice - sharePrice) / peakSharePrice) * 100)
      : 0;
    const sharePriceReturn = ((sharePrice - POOL_INCEPTION_SHARE_PRICE) / POOL_INCEPTION_SHARE_PRICE) * 100;
    return { navUsd, sharePrice, peakSharePrice, drawdownPct, sharePriceReturn, memberCount, netCapital };
  } catch (e: unknown) {
    logger.warn('[risk-overview] pool metrics failed', { error: String(e) });
    return { navUsd: 0, sharePrice: 1, peakSharePrice: 1, drawdownPct: 0, sharePriceReturn: 0, memberCount: 0, netCapital: 0 };
  }
}

async function getActiveHedges(): Promise<HedgeRow[]> {
  try {
    const rows = await query<{
      market: string;
      side: string;
      notional_value: string;
      current_pnl: string;
      leverage: string;
      created_at: Date;
    }>(
      `SELECT market, side, notional_value, current_pnl, leverage, created_at
         FROM hedges
        WHERE chain = 'sui'
          AND status = 'active'
          AND market LIKE '%-PERP'
          AND COALESCE(notional_value, 0) >= 1
        ORDER BY notional_value DESC
        LIMIT 30`,
    );
    return rows.map((r) => ({
      market: String(r.market),
      side: (String(r.side).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG') as 'LONG' | 'SHORT',
      notionalUsd: Number(r.notional_value) || 0,
      unrealizedPnlUsd: Number(r.current_pnl) || 0,
      leverage: Number(r.leverage) || 1,
      ageMinutes: Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000),
    }));
  } catch {
    return [];
  }
}

async function getCronHealth(): Promise<CronHealth[]> {
  // The crons that actually move capital or gate risk
  const critical = [
    { key: 'cron:lastRun:sui-community-pool', warnMin: 45, staleMin: 90 },
    { key: 'cron:lastRun:polymarket-edge-trader', warnMin: 12, staleMin: 30 },
    { key: 'cron:lastRun:bluefin-health', warnMin: 12, staleMin: 30 },
    { key: 'cron:lastRun:bluefin-db-reconcile', warnMin: 30, staleMin: 60 },
    { key: 'cron:lastRun:sui-hedge-reconcile', warnMin: 90, staleMin: 180 },
    { key: 'cron:lastRun:pool-nav-monitor', warnMin: 25, staleMin: 60 },
    { key: 'cron:lastRun:hedge-monitor', warnMin: 25, staleMin: 60 },
    { key: 'cron:lastRun:liquidation-guard', warnMin: 20, staleMin: 60 },
    { key: 'cron:lastRun:health-monitor', warnMin: 20, staleMin: 60 },
  ];

  try {
    const rows = await query<{ key: string; value: string }>(
      `SELECT key, value FROM cron_state WHERE key = ANY($1::text[])`,
      [critical.map((c) => c.key)],
    );
    const byKey = new Map(rows.map((r) => [r.key, Number(r.value)]));
    const now = Date.now();
    return critical.map(({ key, warnMin, staleMin }) => {
      const ts = byKey.get(key);
      if (!ts) {
        return { key: key.replace('cron:lastRun:', ''), ageMinutes: Infinity, status: 'stale' };
      }
      const ageMinutes = (now - ts) / 60000;
      const status: 'ok' | 'warn' | 'stale' =
        ageMinutes > staleMin ? 'stale' : ageMinutes > warnMin ? 'warn' : 'ok';
      return { key: key.replace('cron:lastRun:', ''), ageMinutes: Math.round(ageMinutes * 10) / 10, status };
    });
  } catch {
    return [];
  }
}

async function getZkAttestations(): Promise<{ last24hCount: number; recentFeed: ZkAttestationRow[] }> {
  try {
    const [countRow, recent] = await Promise.all([
      query<{ c: string }>(
        `SELECT COUNT(*)::text as c
           FROM hedges
          WHERE zk_proof_hash IS NOT NULL
            AND zk_proof_hash != ''
            AND created_at > NOW() - INTERVAL '24 hours'`,
      ),
      query<{ market: string; side: string; zk_proof_hash: string; created_at: Date }>(
        `SELECT market, side, zk_proof_hash, created_at
           FROM hedges
          WHERE zk_proof_hash IS NOT NULL
            AND zk_proof_hash != ''
          ORDER BY created_at DESC LIMIT 10`,
      ),
    ]);
    return {
      last24hCount: Number(countRow[0]?.c) || 0,
      recentFeed: recent.map((r) => ({
        market: String(r.market),
        side: String(r.side),
        zkProofHash: String(r.zk_proof_hash).slice(0, 16) + '…',
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  } catch {
    return { last24hCount: 0, recentFeed: [] };
  }
}

async function getLatestSignals(): Promise<RiskOverviewResponse['signals']> {
  try {
    // The aggregator returns one fused cross-asset prediction; BTC and ETH
    // share it for the dashboard summary (per-asset breakdown lives at
    // /api/predictions/per-asset for users who want the deeper view).
    const { PredictionAggregatorService } = await import(
      '@/lib/services/market-data/PredictionAggregatorService'
    );
    const p = await PredictionAggregatorService.getAggregatedPrediction();
    if (!p) return {};
    const direction = String(p.direction || 'NEUTRAL');
    const confidence = Math.round(Number(p.confidence) || 0);
    return {
      BTC: { direction, confidence },
      ETH: { direction, confidence },
    };
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest): Promise<NextResponse<RiskOverviewResponse | { error: string }>> {
  const limited = readLimiter.check(request);
  if (limited) return limited as NextResponse<RiskOverviewResponse | { error: string }>;

  try {
    const [pool, hedges, cronHealth, zkAttestations, signals] = await Promise.all([
      getPoolMetrics(),
      getActiveHedges(),
      getCronHealth(),
      getZkAttestations(),
      getLatestSignals(),
    ]);
    const netCapital = pool.netCapital;

    const totalHedgeNotional = hedges.reduce((s, h) => s + h.notionalUsd, 0);
    const totalHedgePnl = hedges.reduce((s, h) => s + h.unrealizedPnlUsd, 0);

    const response: RiskOverviewResponse = {
      asOf: new Date().toISOString(),
      platform: {
        tvlUsd: pool.navUsd,
        netCapitalDeposited: netCapital,
        netCapitalReturn: {
          absoluteUsd: pool.navUsd - netCapital,
          percent: netCapital > 0 ? ((pool.navUsd - netCapital) / netCapital) * 100 : 0,
        },
        memberCount: pool.memberCount,
        sharePrice: pool.sharePrice,
        peakSharePrice: pool.peakSharePrice,
        drawdownPct: pool.drawdownPct,
        sharePriceReturn: pool.sharePriceReturn,
      },
      hedge: {
        activeCount: hedges.length,
        totalNotionalUsd: totalHedgeNotional,
        totalUnrealizedPnlUsd: totalHedgePnl,
        coverageRatio: pool.navUsd > 0 ? totalHedgeNotional / pool.navUsd : 0,
        positions: hedges,
      },
      reconciliation: {
        cronHealth,
        healthyCount: cronHealth.filter((c) => c.status === 'ok').length,
        warnCount: cronHealth.filter((c) => c.status === 'warn').length,
        staleCount: cronHealth.filter((c) => c.status === 'stale').length,
      },
      zkAttestations,
      signals,
      agents: await getAgentSection(),
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    return safeErrorResponse(error, 'Platform risk overview') as NextResponse<RiskOverviewResponse | { error: string }>;
  }
}
