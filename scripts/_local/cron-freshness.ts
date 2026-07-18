import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(__dirname, '..', '..', '.env.local') });
import { query } from '../../lib/db/postgres';

async function main() {
  const rows = await query<{ key: string; v: string; updated_at: string }>(
    `SELECT key, value::text as v, updated_at::text
     FROM cron_state
     WHERE key LIKE 'cron:lastRun:%'
     ORDER BY updated_at DESC`
  );

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  CRON HEARTBEAT FRESHNESS');
  console.log(`  now: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const now = Date.now();
  for (const r of rows) {
    const route = r.key.replace('cron:lastRun:', '');
    let ts = 0;
    try { ts = Number(JSON.parse(r.v)); } catch { ts = Number(r.v); }
    if (!Number.isFinite(ts) || ts <= 0) ts = new Date(r.updated_at).getTime();
    const ageMin = Math.floor((now - ts) / 60_000);
    const mark = ageMin > 30 ? '🔴' : ageMin > 15 ? '🟡' : '🟢';
    console.log(`  ${mark} ${route.padEnd(35)}  ${ageMin} min ago`);
  }

  const halts = await query<{ key: string; v: string; updated_at: string }>(
    `SELECT key, value::text as v, updated_at::text
     FROM cron_state
     WHERE key LIKE '%:halt%' OR key LIKE '%:target%' OR key LIKE '%profit-lock%'
     ORDER BY key`
  );
  if (halts.length) {
    console.log('\n── HALT / OVERRIDE KEYS ──');
    for (const h of halts) {
      console.log(`  ${h.key.padEnd(45)}  ${h.v.slice(0, 60)}   (updated ${h.updated_at.slice(0, 19)})`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
