import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(__dirname, '..', '..', '.env.local') });
import { query } from '../../lib/db/postgres';

async function main() {
  const rows = await query<{ value: string; updated_at: string }>(
    `SELECT value::text as value, updated_at::text
     FROM cron_state WHERE key='polymarket-edge:last-skip' LIMIT 1`
  );
  if (!rows[0]) { console.log('no skip entry'); process.exit(0); }
  try {
    const p = JSON.parse(rows[0].value);
    console.log('Last skip at:', new Date(p.at || rows[0].updated_at).toISOString());
    console.log('Action:', p.action);
    console.log('\nFull reason:');
    console.log(p.reason);
  } catch (e: any) { console.log('parse fail:', e.message, rows[0].value); }

  const traderKeys = await query<{ key: string; value: string; updated_at: string }>(
    `SELECT key, value::text as value, updated_at::text
     FROM cron_state WHERE key LIKE 'polymarket-edge%' ORDER BY key`
  );
  console.log('\n── all polymarket-edge keys ──');
  for (const k of traderKeys) {
    const v = k.value.length > 250 ? k.value.slice(0, 250) + '...' : k.value;
    console.log(`${k.key}  updated=${k.updated_at.slice(0, 19)}`);
    console.log(`  ${v}\n`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
