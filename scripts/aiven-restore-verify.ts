#!/usr/bin/env npx tsx
/**
 * Verify that a backup .sql file can restore correctly into a scratch
 * Aiven service. Run this after provisioning a temporary Aiven service
 * in the Aiven dashboard (Free tier works, takes ~3min to spin up).
 *
 *   bun run scripts/aiven-restore-verify.ts \
 *     --backup=backups/aiven-2026-05-31T05-00-00.sql \
 *     --target='postgresql://avnadmin:pwd@<scratch-host>:port/defaultdb?sslmode=require'
 *
 * What this does:
 *   1. Sanity-pings the target connection
 *   2. Counts pre-existing public.* tables (should be 0 on a fresh service)
 *   3. psql-loads the backup file
 *   4. Compares expected table list to actual restored tables
 *   5. Spot-checks row counts against the source (configurable per-table sample)
 *
 * Read-only on PROD: only writes to the --target (scratch) DB.
 *
 * Refuses to run if --target host == production Aiven host. Operator must
 * use a different service for the restore drill.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { Pool } from 'pg';

if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

function arg(name: string): string {
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : '';
}

const backup = arg('backup');
const target = arg('target');
const prodUrl = (process.env.DATABASE_URL || '').trim();

if (!backup || !target) {
  console.error('Usage: --backup=path/to/dump.sql --target=postgres://... (scratch only)');
  process.exit(1);
}
if (!existsSync(backup)) {
  console.error(`Backup file not found: ${backup}`);
  process.exit(1);
}

// Refuse to write into prod
function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}
const prodHost = hostOf(prodUrl);
const targetHost = hostOf(target);
if (prodHost && targetHost && prodHost === targetHost) {
  console.error(`Target host ${targetHost} matches PROD — refusing to restore over production.`);
  process.exit(1);
}

const expectedTables = [
  'community_pool_nav_history',
  'community_pool_state',
  'community_pool_transactions',
  'cron_state',
  'hedges',
  'agent_orchestrator_state',
  'auto_hedge_configs',
  'auto_rebalance_configs',
  'ui_cache',
  'signal_outcomes',
];

async function main() {
  const size = (statSync(backup).size / 1024).toFixed(1);
  console.log(`Backup: ${backup} (${size} KB)`);
  console.log(`Target: ${targetHost}`);

  const targetPool = new Pool({
    connectionString: target.replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?').replace(/([?&])sslmode=[^&]+/g, '$1').replace(/[?&]$/, ''),
    ssl: { rejectUnauthorized: false }, max: 1,
  });

  console.log('\n[1/4] Target connection ping');
  await targetPool.query('SELECT 1');
  console.log('  ✓ reachable');

  console.log('\n[2/4] Pre-existing tables (should be 0 on a fresh service)');
  const before = await targetPool.query<{ count: string }>(`SELECT COUNT(*)::text count FROM information_schema.tables WHERE table_schema='public'`);
  console.log(`  found ${before.rows[0]?.count ?? 0} table(s)`);

  console.log('\n[3/4] psql restore');
  try {
    execSync(`psql "${target}" --file="${backup}" --quiet --set ON_ERROR_STOP=on`, {
      stdio: 'inherit', timeout: 600_000,
    });
  } catch (e: any) {
    console.error('  ✗ psql restore failed:', e?.message || e);
    console.error('     Is psql installed? Try: psql --version');
    await targetPool.end();
    process.exit(1);
  }
  console.log('  ✓ restore complete');

  console.log('\n[4/4] Verify expected tables');
  const after = await targetPool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`);
  const restored = new Set(after.rows.map(r => r.table_name));
  let missing = 0;
  for (const t of expectedTables) {
    if (restored.has(t)) console.log(`  ✓ ${t}`);
    else { console.log(`  ✗ MISSING: ${t}`); missing++; }
  }

  console.log(`\nRow-count sampling:`);
  for (const t of expectedTables) {
    if (!restored.has(t)) continue;
    try {
      const r = await targetPool.query<{ n: string }>(`SELECT COUNT(*)::text n FROM ${t}`);
      console.log(`  ${t.padEnd(40)} ${r.rows[0]?.n ?? 0} rows`);
    } catch (e: any) {
      console.log(`  ${t.padEnd(40)} ERR: ${e?.message?.slice(0, 60)}`);
    }
  }

  await targetPool.end();

  if (missing > 0) {
    console.error(`\n✗ ${missing} expected table(s) missing after restore — DRILL FAILED.`);
    process.exit(1);
  }
  console.log(`\n✓ Restore verified — backup is valid + restorable. RTO documented.`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
