require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pg = new Pool({ connectionString: process.env.DB_V2_DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  // Get most recent transaction's rebalanceQuotes structure verbatim
  const r = await pg.query(`
    SELECT created_at, details->'rebalanceQuotes' AS rq
    FROM community_pool_transactions
    WHERE type='AI_DECISION' AND details->>'chain'='sui'
    ORDER BY created_at DESC LIMIT 3
  `);
  for (const row of r.rows) {
    console.log('───', row.created_at.toISOString(), '───');
    console.log(JSON.stringify(row.rq, null, 2));
  }
  await pg.end();
})().catch(e => { console.error(e); process.exit(1); });
