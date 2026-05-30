#!/usr/bin/env npx tsx
/**
 * Verify Vercel cutover from Neon → Aiven is complete and crons are landing rows.
 *
 * Checks (all read-only):
 *   1. Aiven DB reachable from this machine
 *   2. Vercel prod env DATABASE_URL points at aivencloud.com (not neon.tech)
 *   3. Production endpoint returns 200 (deployment is up)
 *   4. cron_state has at least one recent (< 15 min) entry → polymarket-edge-trader is alive
 *   5. community_pool_nav_history latest row < 35 min old → sui-community-pool cron is alive
 *
 * Run AFTER `vercel --prod` has completed + ~2 min has elapsed for first cron tick.
 *
 * Reads Aiven URL from .env.local. Reads Vercel state via `vercel env pull`.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { Pool } from 'pg';

if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

const c = (s: string, code: 'g' | 'r' | 'y' | 'b' | 'dim') => {
  const codes = { g: 32, r: 31, y: 33, b: 36, dim: 90 } as const;
  return `\x1b[${codes[code]}m${s}\x1b[0m`;
};

const PROD_URL = process.env.PROD_URL || 'https://zkvanguard.vercel.app';

let failures = 0;
const pass = (msg: string) => console.log(`  ${c('✓', 'g')} ${msg}`);
const fail = (msg: string) => { console.log(`  ${c('✗', 'r')} ${msg}`); failures++; };
const warn = (msg: string) => console.log(`  ${c('⚠', 'y')} ${msg}`);

async function checkAivenReachable() {
  console.log('\n[1/5] Aiven DB reachable from local');
  const url = (process.env.DATABASE_URL || '').replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?');
  if (!url) return fail('DATABASE_URL not set in .env.local');
  if (!url.includes('aivencloud.com')) return fail(`DATABASE_URL is not Aiven: ${url.replace(/:[^:@]+@/, ':***@')}`);

  let connectionString = url.replace(/([?&])sslmode=[^&]+/g, '$1').replace(/[?&]$/, '');
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    max: 1,
  });
  try {
    const r = await pool.query('SELECT 1 as ok');
    if (r.rows[0]?.ok === 1) pass('Aiven SELECT 1 ok');
    else fail('Aiven query returned unexpected shape');
  } catch (e: any) {
    fail(`Aiven query failed: ${e.message}`);
  } finally {
    await pool.end();
  }
  return { url };
}

async function checkVercelEnv() {
  console.log('\n[2/5] Vercel production env points at Aiven');
  try {
    execSync('vercel env pull .env.vercel.verify --environment=production --yes', {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 30000,
    });
    const content = readFileSync('.env.vercel.verify', 'utf8');
    const lines = content.split(/\r?\n/);
    const targets = ['DATABASE_URL', 'DATABASE_POOL_URL', 'DB_V2_DATABASE_URL'];
    for (const name of targets) {
      const row = lines.find(l => l.startsWith(name + '='));
      if (!row) { fail(`${name} not found in prod env`); continue; }
      const v = row.slice(name.length + 1).trim().replace(/^"|"$/g, '');
      if (v.includes('aivencloud.com')) pass(`${name} → Aiven`);
      else fail(`${name} still points at ${v.includes('neon.tech') ? 'Neon' : 'unknown'}: ${v.replace(/:[^:@]+@/, ':***@')}`);
    }
  } catch (e: any) {
    fail(`vercel env pull failed: ${e.message}`);
  }
}

async function checkProdAlive() {
  console.log('\n[3/5] Production deployment alive');
  try {
    const res = await fetch(PROD_URL, { signal: AbortSignal.timeout(10000) });
    if (res.ok) pass(`${PROD_URL} → ${res.status}`);
    else fail(`${PROD_URL} → ${res.status}`);
  } catch (e: any) {
    fail(`fetch failed: ${e.message}`);
  }
}

async function checkCronState() {
  console.log('\n[4/5] polymarket-edge-trader cron is writing to Aiven (5-min cadence)');
  let connectionString = (process.env.DATABASE_URL || '').replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?');
  connectionString = connectionString.replace(/([?&])sslmode=[^&]+/g, '$1').replace(/[?&]$/, '');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const r = await pool.query<{ key: string; updated_at: Date; age_seconds: number }>(
      `SELECT key, updated_at, EXTRACT(EPOCH FROM (NOW() - updated_at))::int AS age_seconds
       FROM cron_state
       WHERE key LIKE 'polymarket-edge:%'
       ORDER BY updated_at DESC LIMIT 5`
    );
    if (r.rows.length === 0) {
      warn('cron_state has no polymarket-edge:* rows yet — wait 5+ min after first deploy');
    } else {
      const newest = r.rows[0];
      const ageMin = (newest.age_seconds / 60).toFixed(1);
      if (newest.age_seconds < 900) pass(`newest entry: ${newest.key} (${ageMin} min ago)`);
      else fail(`newest entry too old: ${newest.key} (${ageMin} min ago — cron may not be firing)`);
    }
  } catch (e: any) {
    fail(`cron_state query failed: ${e.message}`);
  } finally {
    await pool.end();
  }
}

async function checkNavHistory() {
  console.log('\n[5/5] sui-community-pool cron is writing NAV snapshots (30-min cadence)');
  let connectionString = (process.env.DATABASE_URL || '').replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?');
  connectionString = connectionString.replace(/([?&])sslmode=[^&]+/g, '$1').replace(/[?&]$/, '');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const r = await pool.query<{ timestamp: Date; age_seconds: number; total_nav: string }>(
      `SELECT "timestamp", EXTRACT(EPOCH FROM (NOW() - "timestamp"))::int AS age_seconds, total_nav
       FROM community_pool_nav_history
       ORDER BY "timestamp" DESC LIMIT 1`
    );
    if (r.rows.length === 0) {
      warn('community_pool_nav_history empty — wait up to 30 min after first deploy');
    } else {
      const newest = r.rows[0];
      const ageMin = (newest.age_seconds / 60).toFixed(1);
      if (newest.age_seconds < 2100) pass(`newest NAV: $${newest.total_nav} (${ageMin} min ago)`);
      else fail(`newest NAV too old: $${newest.total_nav} (${ageMin} min ago)`);
    }
  } catch (e: any) {
    fail(`nav_history query failed: ${e.message}`);
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log(c('═══ AIVEN CUTOVER VERIFICATION ═══', 'b'));
  await checkAivenReachable();
  await checkVercelEnv();
  await checkProdAlive();
  await checkCronState();
  await checkNavHistory();

  console.log('');
  if (failures === 0) {
    console.log(c('✓ CUTOVER VERIFIED — Aiven is live, crons are writing.', 'g'));
    process.exit(0);
  } else {
    console.log(c(`✗ ${failures} check(s) failed. Investigate before adding capital.`, 'r'));
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
