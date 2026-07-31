/**
 * Production health endpoint for the SUI community pool.
 *
 * Returns a single JSON object summarising every component that must be
 * healthy for the pool to safely make profit. Each component returns a
 * status + age, and the overall status is the worst of the components:
 *   - HEALTHY: every check passed
 *   - DEGRADED: at least one warning-grade component (cron stale, etc)
 *   - DOWN: at least one critical component unavailable (DB, RPC, BlueFin)
 *
 * Components:
 *   1. DB: ping Aiven, check latest cron_state + nav_history ages
 *   2. Polymarket 5-min signal: cached signal age (must be < 5min)
 *   3. SUI mainnet RPC: read pool object
 *   4. BlueFin venue: getHealth() + canTrade
 *   5. Cron freshness: last-tick age for each capital-moving cron
 *   6. NAV vs floors: is the pool above the auto-hedge floor?
 *
 * Public + rate-limited. No auth required (think of it like /api/health).
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { readLimiter } from '@/lib/security/rate-limiter';
import { query } from '@/lib/db/postgres';
import { envFlag, envFlagOnByDefault } from '@/lib/utils/env-flag';
import { notifyDiscord } from '@/lib/utils/discord-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

type CompStatus = 'ok' | 'warn' | 'down';
interface Component {
  status: CompStatus;
  latencyMs?: number;
  ageSeconds?: number;
  detail?: string;
  error?: string;
}

const HEDGE_MIN_NAV_USD = Number(process.env.HEDGE_MIN_NAV_USD || 20);

// Loud-alert dedupe. Process-scoped: cold starts re-fire, which is the
// point — a persistent outage should page every ~hour, not every ~minute.
const STALE_NAV_ALERT_INTERVAL_MS = 60 * 60 * 1000;
const STALE_NAV_AGE_THRESHOLD_S = 30 * 60;
const RPC_DOWN_ALERT_INTERVAL_MS = 30 * 60 * 1000;
let lastStaleNavAlertAt = 0;
let lastRpcDownAlertAt = 0;

async function maybeAlertStaleNav(
  navFreshness: { status: 'ok' | 'warn' | 'down'; ageSeconds?: number; navUsd?: number },
): Promise<void> {
  const age = navFreshness.ageSeconds ?? 0;
  if (age < STALE_NAV_AGE_THRESHOLD_S) return;
  const now = Date.now();
  if (now - lastStaleNavAlertAt < STALE_NAV_ALERT_INTERVAL_MS) return;
  lastStaleNavAlertAt = now;
  const mins = Math.floor(age / 60);
  try {
    await notifyDiscord(
      `NAV snapshot stale for **${mins} min** (NAV $${(navFreshness.navUsd ?? 0).toFixed(2)}). SUI cron may be failing — check /api/health/production.`,
      'ERROR',
      { ageSeconds: age, navUsd: navFreshness.navUsd },
    );
  } catch { /* notifyDiscord no-ops without webhook */ }
}

async function maybeAlertRpcDown(
  suiRpc: { status: 'ok' | 'warn' | 'down'; error?: string; activeProvider?: string; rotationCount?: number },
): Promise<void> {
  if (suiRpc.status !== 'down') return;
  const now = Date.now();
  if (now - lastRpcDownAlertAt < RPC_DOWN_ALERT_INTERVAL_MS) return;
  lastRpcDownAlertAt = now;
  try {
    await notifyDiscord(
      `SUI RPC is **DOWN across all failover providers**. Last error: ${suiRpc.error ?? 'unknown'}. Rotations attempted: ${suiRpc.rotationCount ?? 0}.`,
      'ERROR',
      { activeProvider: suiRpc.activeProvider, rotationCount: suiRpc.rotationCount },
    );
  } catch { /* notifyDiscord no-ops without webhook */ }
}

async function checkDb(): Promise<Component> {
  const start = Date.now();
  try {
    const r = await query<{ ok: number }>('SELECT 1::int as ok');
    if (r[0]?.ok !== 1) return { status: 'down', error: 'unexpected query result' };
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (e: any) {
    return { status: 'down', error: e?.message?.slice(0, 200) || 'unknown' };
  }
}

async function checkCronAge(key: string, warnAfterMin: number, downAfterMin: number): Promise<Component> {
  try {
    const r = await query<{ age_s: number }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - updated_at))::int as age_s
       FROM cron_state WHERE key = $1 LIMIT 1`,
      [key],
    );
    if (r.length === 0) return { status: 'warn', detail: 'no entry yet' };
    const ageSeconds = Number(r[0].age_s);
    if (ageSeconds > downAfterMin * 60) return { status: 'down', ageSeconds, detail: `> ${downAfterMin}min stale` };
    if (ageSeconds > warnAfterMin * 60) return { status: 'warn', ageSeconds, detail: `> ${warnAfterMin}min stale` };
    return { status: 'ok', ageSeconds };
  } catch (e: any) {
    return { status: 'warn', error: e?.message?.slice(0, 100) };
  }
}

async function checkPhantomRate(): Promise<Component & { ratePct?: number; total?: number; phantoms?: number; openPhantoms?: number }> {
  try {
    // Two blind spots for the same underlying failure (open call returns
    // orderHash, engine silently drops the order — see f54d5b46):
    //
    //   1. CLOSED-hedge phantom — bluefin-db-reconcile eventually marks
    //      active rows with no BlueFin match as closed w/ realized_pnl=0.
    //      Rate = phantoms / total_closed last hour.
    //
    //   2. OPEN-hedge phantom (in-flight) — before the 15-min reconciler
    //      catches an orphan, the row sits status='active' with an
    //      untouched updated_at. In that window the closed-rate above
    //      stays 0% even if the trader fires 3+ ghost opens back-to-back.
    //      Heuristic: active + notional >= $1 + older than 20min (1 recon
    //      tick + slop) + updated_at within 30s of created_at means no
    //      subsequent job touched the row. Absolute count, not a rate —
    //      ANY in-flight phantom should trip the trader halt.
    const [closedRow, openRow] = await Promise.all([
      query<{ total: string; phantoms: string }>(
        // ponytail: exclude reconstructed_* orders. bluefin-db-reconcile writes
        // these when it adopts real BlueFin trades the trader/pool cron didn't
        // register — realized_pnl is legitimately 0 because reconciler lacks
        // fill data at close time. NOT phantom fills. 2026-07-31 incident:
        // 1 real SOL trade tripped 100% phantom rate + status=down.
        `SELECT COUNT(*)::text as total,
                SUM(CASE WHEN COALESCE(realized_pnl, 0) = 0 THEN 1 ELSE 0 END)::text as phantoms
         FROM hedges
         WHERE chain='sui' AND status='closed' AND notional_value >= 1
           AND created_at > NOW() - INTERVAL '1 hour'
           AND (order_id IS NULL OR order_id NOT LIKE 'reconstructed_%')`,
      ),
      query<{ open_phantoms: string }>(
        `SELECT COUNT(*)::text as open_phantoms
         FROM hedges
         WHERE chain='sui' AND status='active' AND notional_value >= 1
           AND created_at < NOW() - INTERVAL '20 minutes'
           AND EXTRACT(EPOCH FROM (updated_at - created_at)) < 30`,
      ),
    ]);
    const total = Number(closedRow[0]?.total ?? 0);
    const phantoms = Number(closedRow[0]?.phantoms ?? 0);
    const openPhantoms = Number(openRow[0]?.open_phantoms ?? 0);
    const ratePct = total === 0 ? 0 : (phantoms / total) * 100;

    // Escalate to worst-of. Open-phantom absolute count trips independently
    // so alert-response can HALT_TRADER before the reconciler window closes.
    if (openPhantoms >= 3) return { status: 'down', ratePct, total, phantoms, openPhantoms, detail: `${openPhantoms} in-flight phantom opens — trader firing ghost orders` };
    if (ratePct > 5) return { status: 'down', ratePct, total, phantoms, openPhantoms, detail: `${ratePct.toFixed(1)}% of last-hour closes have $0 realized — exchange fills unreliable` };
    if (openPhantoms >= 1) return { status: 'warn', ratePct, total, phantoms, openPhantoms, detail: `${openPhantoms} in-flight phantom open(s) — active hedge(s) never touched by reconciler` };
    if (ratePct > 1) return { status: 'warn', ratePct, total, phantoms, openPhantoms, detail: `${ratePct.toFixed(1)}% phantom rate (> 1% threshold)` };
    if (total === 0) return { status: 'ok', ratePct: 0, total: 0, phantoms: 0, openPhantoms, detail: 'no hedges closed in last hour' };
    return { status: 'ok', ratePct, total, phantoms, openPhantoms };
  } catch (e: any) {
    return { status: 'warn', error: e?.message?.slice(0, 100) || 'unknown' };
  }
}

async function checkNavFreshness(): Promise<Component & { navUsd?: number }> {
  try {
    // Filter to chain='sui' — pool-nav-monitor also writes Cronos $0 snapshots
    // every 15min, which would otherwise drag the freshness check to a stale,
    // empty pool that's not the flagship SUI mainnet product.
    const r = await query<{ age_s: number; total_nav: string | number }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - timestamp))::int as age_s, total_nav
       FROM community_pool_nav_history
       WHERE chain = 'sui'
       ORDER BY timestamp DESC LIMIT 1`,
    );
    if (r.length === 0) return { status: 'warn', detail: 'no NAV snapshot yet' };
    const ageSeconds = Number(r[0].age_s);
    const navUsd = Number(r[0].total_nav);
    const out: Component & { navUsd?: number } = { status: 'ok', ageSeconds, navUsd };
    if (ageSeconds > 90 * 60) out.status = 'down';
    else if (ageSeconds > 45 * 60) out.status = 'warn';
    if (Number.isFinite(navUsd) && navUsd < HEDGE_MIN_NAV_USD) {
      out.detail = `NAV $${navUsd.toFixed(2)} < HEDGE_MIN_NAV_USD $${HEDGE_MIN_NAV_USD} — auto-hedge gate closed`;
      if (out.status === 'ok') out.status = 'warn';
    }
    return out;
  } catch (e: any) {
    return { status: 'warn', error: e?.message?.slice(0, 100) };
  }
}

async function checkPolymarket(): Promise<Component> {
  const start = Date.now();
  try {
    const { Polymarket5MinService } = await import('@/lib/services/market-data/Polymarket5MinService');
    const sig = await Polymarket5MinService.getLatest5MinSignal();
    if (!sig) return { status: 'warn', detail: 'no signal' };
    return { status: 'ok', latencyMs: Date.now() - start, detail: `${(sig as any).direction} conf=${(sig as any).confidence}` };
  } catch (e: any) {
    return { status: 'down', error: e?.message?.slice(0, 100) };
  }
}

async function checkSuiRpc(): Promise<Component & { activeProvider?: string; rotationCount?: number }> {
  const start = Date.now();
  try {
    const poolStateId = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE
      || process.env.NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE
      || '').trim();
    if (!poolStateId) return { status: 'warn', detail: 'pool state id not configured' };
    const { createFailoverSuiClient, getFailoverStats } = await import('@/lib/services/sui/sui-failover-transport');
    const client = createFailoverSuiClient('mainnet');
    const obj = await client.getObject({ id: poolStateId, options: { showType: true } });
    if (!obj.data) return { status: 'down', detail: 'pool object not found' };
    const stats = getFailoverStats();
    // Any rotation in this Lambda's lifetime means the primary provider
    // failed at least once — flag it as warn so the overall health status
    // degrades and monitoring notices. Cold-start resets; a persistent
    // primary outage keeps the warn sticky across successive invocations.
    const status = stats.rotationCount > 0 ? 'warn' : 'ok';
    const detail = stats.rotationCount > 0
      ? `failover active — primary ${new URL(stats.lastRotationFromUrl ?? '').host} down, now on ${new URL(stats.activeUrl).host}`
      : undefined;
    return {
      status,
      latencyMs: Date.now() - start,
      activeProvider: stats.activeUrl ? new URL(stats.activeUrl).host : undefined,
      rotationCount: stats.rotationCount,
      ...(detail ? { detail } : {}),
    };
  } catch (e: any) {
    return { status: 'down', error: e?.message?.slice(0, 100) };
  }
}

const COLLATERAL_FLOOR_USD = Number(process.env.BLUEFIN_COLLATERAL_FLOOR_USD || 5);

async function checkBluefin(): Promise<Component & {
  freeCollateral?: number;
  positionsCount?: number;
  totalMarginUsd?: number;
  positionsSummary?: string;
  source?: 'live' | 'cache' | 'unknown';
  cacheAgeMs?: number;
}> {
  const start = Date.now();
  try {
    const network: 'mainnet' | 'testnet' =
      (process.env.SUI_NETWORK as 'mainnet' | 'testnet') === 'testnet' ? 'testnet' : 'mainnet';
    // Read the canonical on-chain hedge state so the safe-snapshot helper can
    // distinguish "venue truly empty" from "venue read suspicious." Best-effort;
    // health endpoint shouldn't fail just because RPC is slow.
    let onChainHasExposure = false;
    try {
      const poolStateId = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE
        || process.env.NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE
        || '').trim();
      if (poolStateId) {
        const { createFailoverSuiClient } = await import('@/lib/services/sui/sui-failover-transport');
        const client = createFailoverSuiClient('mainnet');
        const obj = await client.getObject({ id: poolStateId, options: { showContent: true } });
        type SuiContentFields = { hedge_state?: { fields?: { total_hedged_value?: string; active_hedges?: unknown[] } } };
        const fields = (obj.data?.content as { fields?: SuiContentFields } | null)?.fields;
        const hedgedRaw = Number(fields?.hedge_state?.fields?.total_hedged_value || 0);
        const activeCount = fields?.hedge_state?.fields?.active_hedges?.length ?? 0;
        onChainHasExposure = hedgedRaw > 0 || activeCount > 0;
      }
    } catch { /* best-effort */ }

    const { safeBluefinSnapshot } = await import('@/lib/services/sui/bluefin-read-safe');
    const snap = await safeBluefinSnapshot({ network, onChainHasExposure });

    if (snap.source === 'unknown') {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        detail: snap.warning || 'BlueFin snapshot unavailable',
        freeCollateral: 0,
        positionsCount: 0,
        totalMarginUsd: 0,
        positionsSummary: 'unavailable',
        source: snap.source,
      };
    }

    const balance = snap.free;
    const positionsCount = snap.positionsCount;
    const totalMargin = snap.lockedMargin;
    const summary = snap.positions
      .map(p => {
        const pp = p as unknown as Record<string, unknown>;
        return `${pp.symbol || '?'} ${pp.side || '?'} ${Number(pp.size ?? 0).toFixed(4)}`;
      })
      .join(', ') || (snap.source === 'cache' ? `${positionsCount} cached` : 'none');

    const tooLow = balance < COLLATERAL_FLOOR_USD && positionsCount > 0;
    const cacheWarn = snap.source === 'cache';
    const status: CompStatus = tooLow || cacheWarn ? 'warn' : 'ok';
    const detail =
      `freeCollateral=$${balance.toFixed(2)}, positions=${positionsCount}, margin=$${totalMargin.toFixed(2)}` +
      (tooLow ? ` (BELOW FLOOR $${COLLATERAL_FLOOR_USD} with positions open)` : '') +
      (cacheWarn ? ` (source=cache, age=${Math.round((snap.ageMs ?? 0) / 1000)}s)` : '');

    return {
      status,
      latencyMs: Date.now() - start,
      detail,
      freeCollateral: balance,
      positionsCount,
      totalMarginUsd: Number(totalMargin.toFixed(4)),
      positionsSummary: summary,
      source: snap.source,
      ...(snap.ageMs !== undefined ? { cacheAgeMs: snap.ageMs } : {}),
    };
  } catch (e: any) {
    return { status: 'down', error: e?.message?.slice(0, 100) };
  }
}

function worstStatus(comps: Component[]): CompStatus {
  if (comps.some(c => c.status === 'down')) return 'down';
  if (comps.some(c => c.status === 'warn')) return 'warn';
  return 'ok';
}

export async function GET(req: NextRequest) {
  const limited = readLimiter.check(req);
  if (limited) return limited;

  const start = Date.now();
  // External HTTP checks fire in parallel — they don't touch the DB pool.
  const [polymarket, suiRpc, bluefin] = await Promise.all([
    checkPolymarket(),
    checkSuiRpc(),
    checkBluefin(),
  ]);

  // DB-touching checks run sequentially. Aiven's plan-wide connection_limit=20
  // is shared across every Vercel instance, so a single Promise.all of 6 DB
  // queries can saturate the pool and tip the endpoint into the same
  // `remaining connection slots are reserved...` error it's meant to diagnose.
  // Six fast queries serialized cost ~600ms total — acceptable for a health probe.
  //
  // Heartbeat keys written by each cron's tryClaimCronRun or explicit
  // setCronState, NOT the bare route names. The trader writes
  // polymarket-edge:* only on trade state changes; an idle WAIT tick writes
  // nothing, so we fall back to its daily stats key which updates on every
  // realized trade.
  const db = await checkDb();
  const navFreshness = await checkNavFreshness();
  const suiPoolCron = await checkCronAge('cron:lastRun:sui-community-pool', 45, 90);
  // FIX 2026-06-22: was reading 'polymarket-edge:daily' (a stats key only
  // written on actual trade execution), so cron 'no entry yet' even though
  // the trader was firing every 5 min. Use the real heartbeat key the
  // trader route writes at the top of every invocation.
  const traderCron = await checkCronAge('cron:lastRun:polymarket-edge-trader', 15, 30);
  const hedgeReconcileCron = await checkCronAge('cron:lastRun:sui-hedge-reconcile', 120, 240);
  const bluefinHealthCron = await checkCronAge('bluefin-health:consecutiveDegraded', 15, 30);
  const bluefinDbReconcileCron = await checkCronAge('cron:lastRun:bluefin-db-reconcile', 30, 60);

  // v0.3.0 defense: phantom hedge rate over last hour. Proxies via closed
  // hedges with $0 realized_pnl and notional ≥ $1 — the same query the
  // bulletproof drawdown test uses as its meta-invariant. > 1% warns;
  // > 5% is down (exchange fills unreliable → auto-halt trader gate).
  const phantomRate = await checkPhantomRate();

  const components = { db, polymarket, suiRpc, bluefin, navFreshness, suiPoolCron, traderCron, hedgeReconcileCron, bluefinHealthCron, bluefinDbReconcileCron, phantomRate };
  const overall = worstStatus(Object.values(components));

  const body = {
    status: overall === 'ok' ? 'healthy' : overall === 'warn' ? 'degraded' : 'down',
    timestamp: new Date().toISOString(),
    responseTimeMs: Date.now() - start,
    components,
    config: {
      hedgeMinNavUsd: HEDGE_MIN_NAV_USD,
      network: (process.env.SUI_NETWORK || 'mainnet').trim(),
    },
    // Deployed commit — surfaces "wait, prod is on old sha" for silent
    // Vercel deploy failures. Fell into this on 2026-07-20 when the
    // tsconfig types drift bailed two prod deploys unnoticed for 2 days.
    build: {
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 8) || 'local',
      branch: process.env.VERCEL_GIT_COMMIT_REF || 'unknown',
    },
    // v0.3.0 defense gate footprint — answers "is the safety off or on
    // in prod?" without hitting Vercel env dashboard. INFO/TRADE logs
    // don't ring-buffer, so DB inspection can't tell. This does.
    gates: {
      portfolioDriverExecute: envFlagOnByDefault('PORTFOLIO_DRIVER_EXECUTE'),
      staleHedgeAutoClose: envFlagOnByDefault('STALE_HEDGE_AUTO_CLOSE'),
      alertResponseExecute: envFlagOnByDefault('ALERT_RESPONSE_EXECUTE'),
      alertResponseExecuteHalt: envFlag('ALERT_RESPONSE_EXECUTE_HALT'),
      regretTrackerDisable: envFlag('REGRET_TRACKER_DISABLE'),
      suiAutoHedgeDisable: envFlag('SUI_AUTO_HEDGE_DISABLE'),
      profitLockDisable: envFlag('PROFIT_LOCK_DISABLE'),
    },
  };

  if (overall !== 'ok') {
    logger.warn('[health/production] degraded', { overall, components });
  }

  // Loud stale-NAV alert. When the NAV snapshot is > 30 min old the pool
  // is flying blind — trader can't gate against real capital, dashboard
  // is misleading, and (before the failover transport shipped) this was
  // the class of silent outage that killed weeks of profit. Fires
  // Discord ERROR once per hour per process; cold starts re-fire.
  await maybeAlertStaleNav(navFreshness);
  // Same treatment for suiRpc — a rotation is already alerted from
  // inside the transport, but if RPC is DOWN entirely (all providers
  // failed) the transport can't fire; catch it here.
  await maybeAlertRpcDown(suiRpc);

  const httpStatus = overall === 'down' ? 503 : 200;
  return NextResponse.json(body, {
    status: httpStatus,
    headers: { 'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=40' },
  });
}
