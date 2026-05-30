#!/usr/bin/env npx tsx
/**
 * Best-effort snapshot of trader/cron state from Neon prior to Aiven cutover.
 *
 * Reads:
 *   - cron_state (all keys — polymarket-edge:active-trade, polymarket-edge:stats, etc)
 *   - agent_orchestrator_state (last row)
 *   - community_pool_nav_history (last 24h)
 *   - hedges (active rows only — we don't need closed history; reconciler will refill)
 *
 * Writes JSON to scripts/.neon-snapshot.json so we can replay into Aiven post-cutover.
 *
 * Reads NEON_DATABASE_URL from env (passed inline). Falls back to .env.neon.tmp parsing.
 * Does NOT use the project's lib/db/postgres.ts — direct pg client only, no app state.
 */
import { Pool } from 'pg';
import { readFileSync, writeFileSync, existsSync } from 'fs';

function getNeonUrl(): string {
  if (process.env.NEON_DATABASE_URL) return process.env.NEON_DATABASE_URL.trim();
  if (existsSync('.env.neon.tmp')) {
    const lines = readFileSync('.env.neon.tmp', 'utf8').split(/\r?\n/);
    const row = lines.find(l => l.startsWith('DATABASE_URL='));
    if (row) {
      let v = row.slice('DATABASE_URL='.length).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return v;
    }
  }
  throw new Error('Set NEON_DATABASE_URL or place Neon URL in .env.neon.tmp');
}

async function main() {
  const url = getNeonUrl();
  console.log('Connecting to Neon at', url.replace(/:[^:@]+@/, ':***@'));

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    statement_timeout: 12000,
    max: 1,
  });

  const snapshot: Record<string, unknown> = { capturedAt: new Date().toISOString() };

  async function tryFetch(label: string, sql: string, params: unknown[] = []) {
    try {
      const start = Date.now();
      const r = await pool.query(sql, params);
      console.log(`  ✓ ${label}: ${r.rows.length} rows (${Date.now() - start}ms)`);
      snapshot[label] = r.rows;
    } catch (e: any) {
      console.log(`  ✗ ${label}: ${e.message?.slice(0, 100)}`);
      snapshot[label] = { error: e.message };
    }
  }

  await tryFetch('cron_state', 'SELECT * FROM cron_state ORDER BY updated_at DESC NULLS LAST');
  await tryFetch('agent_orchestrator_state', 'SELECT * FROM agent_orchestrator_state ORDER BY id DESC LIMIT 5');
  await tryFetch('nav_history_24h', `SELECT * FROM community_pool_nav_history WHERE snapshot_at > NOW() - INTERVAL '24 hours' ORDER BY snapshot_at DESC`);
  await tryFetch('active_hedges', `SELECT * FROM hedges WHERE chain='sui' AND status='active'`);
  await tryFetch('community_pool_state', 'SELECT * FROM community_pool_state');

  await pool.end();

  writeFileSync('scripts/.neon-snapshot.json', JSON.stringify(snapshot, null, 2));
  console.log('\nSnapshot written to scripts/.neon-snapshot.json');
  const sizes = Object.entries(snapshot)
    .filter(([k]) => k !== 'capturedAt')
    .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.length + ' rows' : 'ERROR'}`);
  console.log(sizes.join('\n'));
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
