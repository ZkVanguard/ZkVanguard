require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pg = new Pool({ connectionString: process.env.DB_V2_DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  // Did the AI's REBALANCE decisions actually execute swaps?
  const r = await pg.query(`
    SELECT created_at, details
    FROM community_pool_transactions
    WHERE type='AI_DECISION' AND details->>'chain'='sui'
      AND details->>'action'='REBALANCE'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log('=== Recent REBALANCE decisions and their swap outcomes ===\n');
  for (const row of r.rows) {
    const d = row.details || {};
    const rq = d.rebalanceQuotes || {};
    const allocs = d.allocations || {};
    console.log(`${row.created_at.toISOString()} | conf=${d.confidence}% NAV=$${(d.poolNAV_USDC || 0).toFixed(2)} alloc=BTC${allocs.BTC}/ETH${allocs.ETH}/SUI${allocs.SUI}`);
    console.log(`  reasoning: ${(d.reasoning || '').slice(0, 130)}`);
    if (rq.poolTransfer) console.log(`  poolTransfer: requested=${rq.poolTransfer.requested} success=${rq.poolTransfer.success} ${rq.poolTransfer.error ? 'err='+rq.poolTransfer.error : ''}`);
    if (Array.isArray(rq.swaps)) {
      console.log(`  swaps: ${rq.swaps.length} planned`);
      for (const s of rq.swaps) console.log(`    ${s.from || s.fromAsset || '?'}->${s.to || s.toAsset || '?'} amt=${s.amount || s.fromAmount || '?'} success=${s.success}`);
    } else if (rq.skipped) {
      console.log(`  swaps: skipped — ${rq.skipped}`);
    } else {
      console.log(`  swaps: (no swap data in transaction)`);
    }
  }

  // Total executed swaps in last 24h
  console.log('\n=== Swap executions last 24h ===');
  const sw = await pg.query(`
    SELECT created_at, details->'rebalanceQuotes' AS rq
    FROM community_pool_transactions
    WHERE type='AI_DECISION' AND details->>'chain'='sui'
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
  `);
  let totalSwapsExecuted = 0, totalTransfersOk = 0, totalTransfersFail = 0;
  for (const row of sw.rows) {
    const rq = row.rq || {};
    if (rq.poolTransfer) {
      if (rq.poolTransfer.success) totalTransfersOk++; else totalTransfersFail++;
    }
    if (Array.isArray(rq.swaps)) totalSwapsExecuted += rq.swaps.filter(s => s.success).length;
  }
  console.log(`  Total cron cycles: ${sw.rows.length}`);
  console.log(`  Pool→admin transfers ok: ${totalTransfersOk}, failed: ${totalTransfersFail}`);
  console.log(`  Successful spot swaps: ${totalSwapsExecuted}`);

  await pg.end();
})().catch(e => { console.error(e); process.exit(1); });
