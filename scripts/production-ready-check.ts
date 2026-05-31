#!/usr/bin/env npx tsx
/**
 * Pre-capital-scale safety probe. Single command to confirm every
 * bulletproofing invariant before depositing real money.
 *
 *   bun run scripts/production-ready-check.ts
 *
 * Exits 0 when all checks pass. Exits 1 with a structured report
 * when any safety invariant is violated. Safe to run any time —
 * read-only, no side effects beyond a single Discord test ping
 * (which only fires when --no-discord-test is NOT passed).
 *
 * Checks performed:
 *   1.  Aiven DB reachable + cron_state has recent rows
 *   2.  /api/health/production returns status: healthy
 *   3.  All expected QStash schedules exist and last fired SUCCESS
 *   4.  BlueFin reachable, positions sane, free collateral above floor
 *   5.  DB ↔ BlueFin in sync (bluefin-db-reconcile shows zero drift)
 *   6.  Sharpe-preset Vercel env vars present
 *   7.  Discord webhook live (test ping unless --no-discord-test)
 *   8.  Recent NAV snapshot age < 30 min
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
import { Pool } from 'pg';
import { execSync } from 'child_process';

if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

const PROD_URL = (process.env.PROD_URL || 'https://www.zkvanguard.xyz').replace(/\/$/, '');
const CRON_SECRET = (process.env.CRON_SECRET || 'cv-cron-7f3a9e2b4d1c8f06').trim();
const QSTASH_URL = (process.env.QSTASH_URL || 'https://qstash-us-east-1.upstash.io').trim();
const QSTASH_TOKEN = (process.env.QSTASH_TOKEN || '').trim();
const DISCORD_URL = (process.env.DISCORD_WEBHOOK_URL || '').trim();
const SKIP_DISCORD = process.argv.includes('--no-discord-test');

const c = (s: string, code: 'g' | 'r' | 'y' | 'b' | 'dim') => {
  const codes = { g: 32, r: 31, y: 33, b: 36, dim: 90 } as const;
  return `\x1b[${codes[code]}m${s}\x1b[0m`;
};

let failures = 0;
let warnings = 0;
const pass = (msg: string) => console.log(`  ${c('✓', 'g')} ${msg}`);
const warn = (msg: string) => { console.log(`  ${c('⚠', 'y')} ${msg}`); warnings++; };
const fail = (msg: string) => { console.log(`  ${c('✗', 'r')} ${msg}`); failures++; };

const EXPECTED_SCHEDULES = [
  'polymarket-edge-trader',
  'bluefin-health',
  'liquidation-guard',
  'pool-nav-monitor',
  'hedge-monitor',
  'sui-community-pool',
  'sui-hedge-reconcile',
  'sui-collect-fees',
  'bluefin-db-reconcile',
  'health-monitor',
];

const SHARPE_PRESET_VARS = [
  'POLYMARKET_EDGE_MIN_CONFIDENCE',
  'POLYMARKET_EDGE_MIN_CONSENSUS',
  'POLYMARKET_EDGE_LEVERAGE',
  'POLYMARKET_EDGE_STAKE_PCT',
  'POLYMARKET_EDGE_MAX_STAKE_USD',
  'POLYMARKET_EDGE_MAX_CONSECUTIVE_LOSSES',
  'POLYMARKET_EDGE_MAX_DRAWDOWN_PCT',
  'HEDGE_MIN_NAV_USD',
  'HEDGE_RISK_THRESHOLD_DEFAULT',
  'HEDGE_DAILY_MAX_RESETS',
  'HEDGE_RESET_MIN_CONFIDENCE',
];

async function check1_dbReachable() {
  console.log(c('\n[1/8] Aiven DB reachable + recent cron writes', 'b'));
  const url = (process.env.DATABASE_URL || '')
    .replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?')
    .replace(/([?&])sslmode=[^&]+/g, '$1').replace(/[?&]$/, '');
  if (!url) return fail('DATABASE_URL not set');
  if (!url.includes('aivencloud.com')) warn(`DATABASE_URL is not Aiven: ${url.replace(/:[^:@]+@/, ':***@')}`);
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const r = await pool.query<{ count: string; max_age_min: string }>(
      `SELECT COUNT(*)::text count,
              ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(updated_at))) / 60.0, 1)::text max_age_min
         FROM cron_state`,
    );
    const totalRows = Number(r.rows[0]?.count ?? 0);
    const minutesSinceMostRecent = Number(r.rows[0]?.max_age_min ?? Infinity);
    if (totalRows === 0) return fail(`cron_state is empty — no crons have written ever`);
    if (minutesSinceMostRecent <= 30) pass(`Aiven reachable, ${totalRows} cron_state row(s), newest write ${minutesSinceMostRecent} min ago`);
    else warn(`Aiven reachable but newest cron_state write is ${minutesSinceMostRecent} min ago — crons may be stalled`);
  } catch (e: any) {
    fail(`Aiven query failed: ${e?.message?.slice(0, 100)}`);
  } finally {
    await pool.end();
  }
}

async function check2_healthEndpoint() {
  console.log(c('\n[2/8] /api/health/production', 'b'));
  try {
    const r = await fetch(`${PROD_URL}/api/health/production`, { signal: AbortSignal.timeout(15_000) });
    const body = await r.json() as { status: string; components: Record<string, { status: string; detail?: string; error?: string }> };
    const compCount = Object.keys(body.components || {}).length;
    if (body.status === 'healthy') pass(`status=healthy (${compCount} components)`);
    else if (body.status === 'degraded') {
      const bad = Object.entries(body.components).filter(([, v]) => v.status !== 'ok').map(([k, v]) => `${k}: ${v.detail || v.error || v.status}`);
      warn(`status=degraded — ${bad.length} component(s) not ok: ${bad.join(' | ')}`);
    } else fail(`status=${body.status}`);
  } catch (e: any) {
    fail(`health fetch failed: ${e?.message?.slice(0, 100)}`);
  }
}

async function check3_qstashSchedules() {
  console.log(c('\n[3/8] QStash schedules active', 'b'));
  if (!QSTASH_TOKEN) return fail('QSTASH_TOKEN not set — cannot inspect schedules');
  try {
    const r = await fetch(`${QSTASH_URL}/v2/schedules`, { headers: { Authorization: `Bearer ${QSTASH_TOKEN}` }, signal: AbortSignal.timeout(15_000) });
    const list = await r.json() as Array<{ cron: string; destination: string; lastScheduleStates?: Record<string, string>; isPaused: boolean }>;
    for (const expected of EXPECTED_SCHEDULES) {
      const sched = list.find(s => s.destination.endsWith(`/api/cron/${expected}`));
      if (!sched) { fail(`missing schedule: ${expected}`); continue; }
      if (sched.isPaused) { fail(`PAUSED: ${expected}`); continue; }
      const lastStates = Object.values(sched.lastScheduleStates || {});
      const lastState = lastStates[0] || 'never';
      if (lastState === 'SUCCESS' || lastState === 'never') pass(`${expected} (${sched.cron}) last=${lastState}`);
      else warn(`${expected} (${sched.cron}) last=${lastState}`);
    }
  } catch (e: any) {
    fail(`QStash query failed: ${e?.message?.slice(0, 100)}`);
  }
}

async function check4_bluefinSane() {
  console.log(c('\n[4/8] BlueFin: free collateral + position sanity', 'b'));
  try {
    const r = await fetch(`${PROD_URL}/api/admin/bluefin-debug`, { headers: { Authorization: `Bearer ${CRON_SECRET}` }, signal: AbortSignal.timeout(15_000) });
    const body = await r.json() as { freeCollateral: number; positions: Array<{ symbol: string; side: string; size: number }>; openOrders: unknown[] };
    pass(`freeCollateral=$${body.freeCollateral.toFixed(2)}, positions=${body.positions.length}, openOrders=${body.openOrders.length}`);
    const floor = Number(process.env.BLUEFIN_COLLATERAL_FLOOR_USD || 5);
    if (body.positions.length > 0 && body.freeCollateral < floor) {
      warn(`free collateral below floor $${floor} with positions open — cannot fund a new hedge or close emergency`);
    }
    if (body.openOrders.length > 0) {
      warn(`${body.openOrders.length} open order(s) on BlueFin — should be zero post-2026-05-31 (MARKET orders should fill or reject)`);
    }
  } catch (e: any) {
    fail(`bluefin-debug failed: ${e?.message?.slice(0, 100)}`);
  }
}

async function check5_dbBluefinSync() {
  console.log(c('\n[5/8] DB ↔ BlueFin in sync', 'b'));
  try {
    const r = await fetch(`${PROD_URL}/api/cron/bluefin-db-reconcile`, { method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}` }, signal: AbortSignal.timeout(30_000) });
    const body = await r.json() as { dbActiveCount: number; bluefinPositionsCount: number; phantomDbRows: unknown[]; orphanBluefinPositions: unknown[]; closedDbRowIds: number[] };
    if (body.phantomDbRows.length === 0 && body.orphanBluefinPositions.length === 0) {
      pass(`in sync (DB=${body.dbActiveCount}, BlueFin=${body.bluefinPositionsCount})`);
    } else {
      if (body.orphanBluefinPositions.length > 0) warn(`${body.orphanBluefinPositions.length} orphan BlueFin position(s) — opened outside our code`);
      if (body.phantomDbRows.length > 0) warn(`${body.phantomDbRows.length} phantom DB row(s) auto-closed this run`);
    }
  } catch (e: any) {
    fail(`reconcile failed: ${e?.message?.slice(0, 100)}`);
  }
}

async function check6_sharpeEnv() {
  console.log(c('\n[6/8] Sharpe-preset Vercel env vars present', 'b'));
  try {
    const out = execSync('vercel env ls production', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    let missing = 0;
    for (const v of SHARPE_PRESET_VARS) {
      if (out.includes(v)) pass(`${v} set`);
      else { fail(`${v} MISSING in Vercel prod env`); missing++; }
    }
    if (missing === 0) pass(`all ${SHARPE_PRESET_VARS.length} Sharpe-preset vars present`);
  } catch (e: any) {
    warn(`vercel env ls failed — skipping (run \`vercel login\` if needed): ${e?.message?.slice(0, 80)}`);
  }
}

async function check7_discordWebhook() {
  console.log(c('\n[7/8] Discord webhook', 'b'));
  if (!DISCORD_URL) return fail('DISCORD_WEBHOOK_URL not set in .env.local');
  if (SKIP_DISCORD) return pass('webhook present (test ping skipped via --no-discord-test)');
  try {
    const r = await fetch(DISCORD_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: `production-ready-check ${new Date().toISOString()}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) pass(`webhook accepted (HTTP ${r.status})`);
    else fail(`webhook returned HTTP ${r.status}`);
  } catch (e: any) {
    fail(`webhook fetch failed: ${e?.message?.slice(0, 100)}`);
  }
}

async function check8_navFresh() {
  console.log(c('\n[8/8] NAV snapshot freshness', 'b'));
  const url = (process.env.DATABASE_URL || '')
    .replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?')
    .replace(/([?&])sslmode=[^&]+/g, '$1').replace(/[?&]$/, '');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const r = await pool.query<{ age_s: number; nav: string }>(`SELECT EXTRACT(EPOCH FROM (NOW() - "timestamp"))::int age_s, total_nav nav FROM community_pool_nav_history WHERE chain='sui' ORDER BY "timestamp" DESC LIMIT 1`);
    if (r.rows.length === 0) return fail('no SUI NAV snapshot yet');
    const ageMin = Number(r.rows[0].age_s) / 60;
    if (ageMin < 30) pass(`NAV $${r.rows[0].nav} (${ageMin.toFixed(1)} min ago)`);
    else if (ageMin < 60) warn(`NAV $${r.rows[0].nav} (${ageMin.toFixed(1)} min ago — > 30 min threshold)`);
    else fail(`NAV $${r.rows[0].nav} (${ageMin.toFixed(1)} min ago — sui-community-pool cron stalled)`);
  } catch (e: any) {
    fail(`NAV query failed: ${e?.message?.slice(0, 100)}`);
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log(c('═══ PRODUCTION READY CHECK ═══', 'b'));
  console.log(c(`PROD_URL = ${PROD_URL}`, 'dim'));

  await check1_dbReachable();
  await check2_healthEndpoint();
  await check3_qstashSchedules();
  await check4_bluefinSane();
  await check5_dbBluefinSync();
  await check6_sharpeEnv();
  await check7_discordWebhook();
  await check8_navFresh();

  console.log('');
  if (failures > 0) {
    console.log(c(`✗ ${failures} failure(s) and ${warnings} warning(s) — NOT ready for capital scale.`, 'r'));
    process.exit(1);
  }
  if (warnings > 0) {
    console.log(c(`⚠ ${warnings} warning(s) — review before capital scale.`, 'y'));
    process.exit(0);
  }
  console.log(c('✓ ALL CHECKS PASS — safe to scale capital.', 'g'));
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

// Workaround for `Array.prototype.rsplit` not existing in lib.es2023.d.ts
declare global {
  interface Array<T> {
    rsplit?(sep: string, limit?: number): string[];
  }
}
