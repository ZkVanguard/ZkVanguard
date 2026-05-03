require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pg = new Pool({ connectionString: process.env.DB_V2_DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await pg.query(`SELECT order_id, asset, side, size, leverage, entry_price, close_price, realized_pnl, reason, close_reason, created_at, closed_at FROM hedges WHERE chain='sui' AND order_id LIKE 'sui_%' ORDER BY created_at DESC LIMIT 5`);
  console.log('=== Most recent sui_* (AI-opened) hedges ===');
  for (const h of r.rows) {
    console.log(h.created_at.toISOString(), '|', h.asset, h.side, 'sz=' + h.size, 'lev=' + h.leverage + 'x', '@', h.entry_price, '->', h.close_price, 'pnl=$' + h.realized_pnl);
    console.log('   open reason:', h.reason || '-');
    console.log('   close reason:', h.close_reason || '-');
  }
  const c = await pg.query(`SELECT COUNT(*) AS n, SUM(realized_pnl) AS pnl FROM hedges WHERE chain='sui' AND order_id LIKE 'sui_%' AND status='closed'`);
  console.log('\n=== Cumulative sui_* (AI-opened) ===');
  console.log('Closed count:', c.rows[0].n);
  console.log('Sum realized_pnl: $' + Number(c.rows[0].pnl || 0).toFixed(4));

  // Also count BF_RECONCILE rows by created_at AFTER my cleanup time (the cleanup ran at ~15:42 UTC)
  const recent = await pg.query(`SELECT COUNT(*) AS n FROM hedges WHERE chain='sui' AND order_id LIKE 'BF_RECONCILE_%' AND created_at > '2026-05-03 15:42:00'`);
  console.log('\n=== Phantom rows created AFTER my cleanup (proof fix not yet live) ===');
  console.log('New BF_RECONCILE rows since 15:42 UTC:', recent.rows[0].n);

  await pg.end();
})().catch(e => { console.error(e); process.exit(1); });
