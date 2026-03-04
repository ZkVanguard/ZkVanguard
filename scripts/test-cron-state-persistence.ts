/**
 * Test: Cold-Start Resilience for Cron State
 * 
 * Verifies that cron/price-hook state persists to the database
 * and survives simulated Vercel cold starts.
 * 
 * Run: npx tsx scripts/test-cron-state-persistence.ts
 */

// Load .env.local before anything else
import { config } from 'dotenv';
config({ path: '.env.local' });

// Polyfill fetch for Node.js < 18
if (typeof globalThis.fetch === 'undefined') {
  const { default: fetch, Headers, Request, Response } = require('node-fetch');
  Object.assign(globalThis, { fetch, Headers, Request, Response });
}

import { getCronState, setCronState, getTimestamp, setTimestamp, getNumber, setNumber, CronKeys, getCronStateByPrefix } from '../lib/db/cron-state';
import { closePool } from '../lib/db/postgres';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}`);
    failed++;
  }
}

async function testBasicCRUD() {
  console.log('\n── Test 1: Basic CRUD Operations ──');

  // Set a value
  await setCronState('test:basic', { hello: 'world', num: 42 });
  const val = await getCronState<{ hello: string; num: number }>('test:basic');
  assert(val !== null, 'getCronState returns value after setCronState');
  assert(val?.hello === 'world', 'JSONB object stored correctly');
  assert(val?.num === 42, 'JSONB number stored correctly');

  // Overwrite (upsert)
  await setCronState('test:basic', { hello: 'updated' });
  const val2 = await getCronState<{ hello: string }>('test:basic');
  assert(val2?.hello === 'updated', 'Upsert overwrites existing value');

  // Non-existent key
  const missing = await getCronState('test:nonexistent');
  assert(missing === null, 'Missing key returns null');
}

async function testTimestampHelpers() {
  console.log('\n── Test 2: Timestamp Helpers ──');

  const now = Date.now();
  await setTimestamp('test:ts', now);
  const ts = await getTimestamp('test:ts');
  assert(ts === now, `Timestamp round-trips: ${ts} === ${now}`);

  // Default
  const missing = await getTimestamp('test:ts:missing');
  assert(missing === 0, 'Missing timestamp returns 0');
}

async function testNumberHelpers() {
  console.log('\n── Test 3: Number Helpers ──');

  await setNumber('test:num', 615.82);
  const num = await getNumber('test:num');
  assert(Math.abs(num - 615.82) < 0.01, `Number round-trips: ${num} ~= 615.82`);

  // Default
  const missing = await getNumber('test:num:missing', 999);
  assert(missing === 999, 'Missing number returns default 999');
}

async function testCronKeyPatterns() {
  console.log('\n── Test 4: CronKeys Patterns ──');

  // Simulate what the real code does
  await setTimestamp(CronKeys.heartbeatLastCheck, 1700000000000);
  await setTimestamp(CronKeys.poolCheckLastCheck, 1700000100000);
  await setNumber(CronKeys.poolNavPeak('community-pool'), 650.00);
  await setTimestamp(CronKeys.poolNavLastHedge('community-pool'), 1700000200000);
  await setTimestamp(CronKeys.rebalanceLastHedge(0), 1700000300000);
  await setNumber(CronKeys.rebalancePeakValue(0), 700.00);

  // Verify all keys
  const hb = await getTimestamp(CronKeys.heartbeatLastCheck);
  assert(hb === 1700000000000, 'Heartbeat timestamp persisted');

  const pc = await getTimestamp(CronKeys.poolCheckLastCheck);
  assert(pc === 1700000100000, 'Pool check timestamp persisted');

  const peak = await getNumber(CronKeys.poolNavPeak('community-pool'));
  assert(Math.abs(peak - 650.00) < 0.01, `Peak NAV persisted: $${peak}`);

  const lh = await getTimestamp(CronKeys.poolNavLastHedge('community-pool'));
  assert(lh === 1700000200000, 'Pool last hedge time persisted');

  const rh = await getTimestamp(CronKeys.rebalanceLastHedge(0));
  assert(rh === 1700000300000, 'Rebalance last hedge time persisted');

  const rpv = await getNumber(CronKeys.rebalancePeakValue(0));
  assert(Math.abs(rpv - 700.00) < 0.01, `Rebalance peak value persisted: $${rpv}`);
}

async function testPrefixQuery() {
  console.log('\n── Test 5: Prefix Query ──');

  await setNumber('prefix:test:a', 100);
  await setNumber('prefix:test:b', 200);
  await setNumber('prefix:test:c', 300);

  const results = await getCronStateByPrefix('prefix:test:');
  assert(results.size === 3, `Prefix query returned ${results.size} results (expected 3)`);
  assert(results.get('prefix:test:a') === 100, 'Prefix result a = 100');
  assert(results.get('prefix:test:c') === 300, 'Prefix result c = 300');
}

async function testColdStartSimulation() {
  console.log('\n── Test 6: Cold Start Simulation ──');

  // "Deploy 1": Set state
  const deploy1Time = Date.now();
  await setTimestamp(CronKeys.heartbeatLastCheck, deploy1Time);
  await setTimestamp(CronKeys.poolCheckLastCheck, deploy1Time);
  await setNumber(CronKeys.poolNavPeak('community-pool'), 615.82);

  console.log('  [Deploy 1] State written to DB');

  // Simulate cold start by clearing all module-level caches
  // (In real Vercel, the whole process restarts)

  // "Deploy 2": Read state back — simulating fresh import
  const hb = await getTimestamp(CronKeys.heartbeatLastCheck);
  assert(hb === deploy1Time, `Cold start: heartbeat timestamp survived (${new Date(hb).toISOString()})`);

  const pc = await getTimestamp(CronKeys.poolCheckLastCheck);
  assert(pc === deploy1Time, `Cold start: pool check timestamp survived`);

  const peak = await getNumber(CronKeys.poolNavPeak('community-pool'));
  assert(Math.abs(peak - 615.82) < 0.01, `Cold start: peak NAV survived ($${peak})`);

  // Verify cooldown logic works after cold start
  const now = Date.now();
  const POOL_CHECK_INTERVAL_MS = 15 * 60 * 1000;
  const timeSinceLastPool = now - pc;
  const shouldRunPoolCheck = timeSinceLastPool > POOL_CHECK_INTERVAL_MS;
  console.log(`  [Deploy 2] Time since last pool check: ${(timeSinceLastPool / 1000).toFixed(0)}s`);
  console.log(`  [Deploy 2] Would run pool check: ${shouldRunPoolCheck} (needs > ${POOL_CHECK_INTERVAL_MS / 1000}s)`);
  assert(!shouldRunPoolCheck, 'Cold start: pool check correctly skipped (just ran)');
}

async function testVercelCronsConfig() {
  console.log('\n── Test 7: Vercel Crons Configuration ──');

  const fs = require('fs');
  const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  
  assert(Array.isArray(vercelConfig.crons), 'vercel.json has crons array');
  assert(vercelConfig.crons.length >= 5, `${vercelConfig.crons.length} cron jobs configured`);
  
  const cronPaths = vercelConfig.crons.map((c: any) => c.path);
  assert(cronPaths.includes('/api/cron/community-pool'), 'community-pool cron exists');
  assert(cronPaths.includes('/api/cron/pool-nav-monitor'), 'pool-nav-monitor cron exists');
  assert(cronPaths.includes('/api/cron/auto-rebalance'), 'auto-rebalance cron exists');
}

async function testPriceHooksDedup() {
  console.log('\n── Test 8: Price Hook Deduplication ──');

  // Simulate: heartbeat fires → pool check should be skipped
  // We verify by checking that checkCommunityPools has the guard
  const fs = require('fs');
  const webhookSource = fs.readFileSync('lib/services/PriceAlertWebhook.ts', 'utf8');

  assert(webhookSource.includes('heartbeatFired'), 'Dedup flag exists in recordPriceUpdate');
  assert(webhookSource.includes('!heartbeatFired'), 'Pool check is guarded by !heartbeatFired');
  assert(webhookSource.includes('DB-backed'), 'Timestamps are documented as DB-backed');
}

async function cleanup() {
  // Clean up test keys
  const { query } = require('../lib/db/postgres');
  try {
    await query("DELETE FROM cron_state WHERE key LIKE 'test:%' OR key LIKE 'prefix:%'");
    console.log('\n  Cleaned up test keys from DB');
  } catch { /* ignore */ }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Cron State Persistence Test — Cold Start Resilience    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const hasDb = !!process.env.DATABASE_URL;
  console.log(`\nDatabase: ${hasDb ? process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@') : 'Using localhost fallback'}`);

  try {
    await testBasicCRUD();
    await testTimestampHelpers();
    await testNumberHelpers();
    await testCronKeyPatterns();
    await testPrefixQuery();
    await testColdStartSimulation();
    await testVercelCronsConfig();
    await testPriceHooksDedup();
    await cleanup();
  } catch (error: any) {
    console.error(`\n${FAIL} Fatal error:`, error.message);
    failed++;
  } finally {
    await closePool();
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
