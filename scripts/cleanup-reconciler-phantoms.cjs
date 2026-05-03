// One-time cleanup of phantom BF_RECONCILE_* rows.
// The reconciler bug (fixed in this commit) inserted a fresh DB row each
// 30-min cycle for the same live Bluefin perp position. We keep ONE row per
// (chain, asset, side, market) — the most recent — and mark the rest closed.
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const cs = process.env.DATABASE_URL || process.env.DB_V2_DATABASE_URL || process.env.DB_V2_POSTGRES_URL;
const p = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });

(async () => {
  const dryRun = process.argv.includes('--dry-run');

  // Show duplicates per (asset, side) among reconciler rows
  const r1 = await p.query(`
    SELECT asset, side, market, COUNT(*) AS n,
           MIN(created_at) AS first, MAX(created_at) AS last
    FROM hedges
    WHERE order_id LIKE 'BF_RECONCILE_%' AND status = 'active'
    GROUP BY asset, side, market
    ORDER BY n DESC
  `);
  console.log('=== Reconciler-row groups ===');
  for (const r of r1.rows) {
    console.log(`${r.asset} ${r.side} ${r.market} | n=${r.n} | ${r.first.toISOString().slice(0,10)} → ${r.last.toISOString().slice(0,10)}`);
  }

  // Identify the rows to keep (one most recent per group) and rows to close
  const r2 = await p.query(`
    WITH ranked AS (
      SELECT id, asset, side, market, created_at,
             ROW_NUMBER() OVER (PARTITION BY asset, side, market ORDER BY created_at DESC) AS rn
      FROM hedges
      WHERE order_id LIKE 'BF_RECONCILE_%' AND status = 'active'
    )
    SELECT id, asset, side, market FROM ranked WHERE rn > 1
  `);
  console.log(`\nWould close ${r2.rows.length} duplicate rows (keeping most recent per asset/side/market).`);

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made. Re-run without --dry-run to apply.');
    await p.end();
    return;
  }

  if (r2.rows.length === 0) {
    console.log('\nNo phantom rows to clean.');
    await p.end();
    return;
  }

  const ids = r2.rows.map(r => r.id);
  const upd = await p.query(
    `UPDATE hedges
        SET status = 'closed',
            closed_at = NOW(),
            close_reason = 'reconciler-dedup-cleanup',
            updated_at = NOW()
      WHERE id = ANY($1::int[])`,
    [ids],
  );
  console.log(`\n✅ Closed ${upd.rowCount} phantom reconciler rows.`);

  // Verify
  const r3 = await p.query(`
    SELECT asset, side, COUNT(*) AS n
    FROM hedges
    WHERE order_id LIKE 'BF_RECONCILE_%' AND status = 'active'
    GROUP BY asset, side
  `);
  console.log('\n=== After cleanup (active reconciler rows) ===');
  for (const r of r3.rows) console.log(`  ${r.asset} ${r.side} | n=${r.n}`);

  await p.end();
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
