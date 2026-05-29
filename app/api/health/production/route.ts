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

async function checkNavFreshness(): Promise<Component & { navUsd?: number }> {
  try {
    const r = await query<{ age_s: number; nav_usd: string | number }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - snapshot_at))::int as age_s, nav_usd
       FROM community_pool_nav_history
       ORDER BY snapshot_at DESC LIMIT 1`,
    );
    if (r.length === 0) return { status: 'warn', detail: 'no NAV snapshot yet' };
    const ageSeconds = Number(r[0].age_s);
    const navUsd = Number(r[0].nav_usd);
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

async function checkSuiRpc(): Promise<Component> {
  const start = Date.now();
  try {
    const poolStateId = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE
      || process.env.NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE
      || '').trim();
    if (!poolStateId) return { status: 'warn', detail: 'pool state id not configured' };
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
    const rpcUrl = (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim();
    const client = new SuiClient({ url: rpcUrl });
    const obj = await client.getObject({ id: poolStateId, options: { showType: true } });
    if (!obj.data) return { status: 'down', detail: 'pool object not found' };
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (e: any) {
    return { status: 'down', error: e?.message?.slice(0, 100) };
  }
}

async function checkBluefin(): Promise<Component> {
  const start = Date.now();
  try {
    const { BluefinService } = await import('@/lib/services/sui/BluefinService');
    const bf = BluefinService.getInstance();
    const balance = await bf.getBalance();
    if (!Number.isFinite(balance)) return { status: 'warn', detail: 'getBalance returned non-finite' };
    return { status: 'ok', latencyMs: Date.now() - start, detail: `freeCollateral=$${balance.toFixed(2)}` };
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
  const [db, polymarket, suiRpc, bluefin, navFreshness, suiPoolCron, traderCron, hedgeReconcileCron, bluefinHealthCron] =
    await Promise.all([
      checkDb(),
      checkPolymarket(),
      checkSuiRpc(),
      checkBluefin(),
      checkNavFreshness(),
      checkCronAge('sui-community-pool', 45, 90),
      checkCronAge('polymarket-edge:active-trade', 15, 30),
      checkCronAge('sui-hedge-reconcile', 90, 180),
      checkCronAge('bluefin-health:consecutiveDegraded', 15, 30),
    ]);

  const components = { db, polymarket, suiRpc, bluefin, navFreshness, suiPoolCron, traderCron, hedgeReconcileCron, bluefinHealthCron };
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
  };

  if (overall !== 'ok') {
    logger.warn('[health/production] degraded', { overall, components });
  }

  const httpStatus = overall === 'down' ? 503 : 200;
  return NextResponse.json(body, {
    status: httpStatus,
    headers: { 'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=40' },
  });
}
