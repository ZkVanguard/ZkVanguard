require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

(async () => {
  const connStr = process.env.DATABASE_POOL_URL || process.env.DATABASE_URL || process.env.DB_V2_DATABASE_URL;
  if (!connStr) { console.log('No DATABASE_URL found'); process.exit(1); }
  const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  
  // Check SUI NAV records
  const res = await pool.query(
    `SELECT id, share_price, total_nav, total_shares, chain, timestamp 
     FROM community_pool_nav_history 
     WHERE chain = 'sui'
     ORDER BY timestamp DESC 
     LIMIT 30`
  );
  
  console.log('SUI NAV records (most recent first):');
  for (const r of res.rows) {
    const price = Number(r.share_price).toFixed(6);
    const nav = Number(r.total_nav).toFixed(2);
    const shares = Number(r.total_shares).toFixed(2);
    const bad = Math.abs(Number(r.share_price) - 1.0) > 0.01 ? ' *** BAD' : '';
    console.log(`  id=${r.id} price=${price} nav=${nav} shares=${shares} time=${r.timestamp.toISOString()}${bad}`);
  }
  
  // Count bad records
  const badCount = await pool.query(
    `SELECT COUNT(*) as cnt FROM community_pool_nav_history 
     WHERE chain = 'sui' AND ABS(share_price - 1.0) > 0.01`
  );
  console.log(`\nBad records (price != 1.0): ${badCount.rows[0].cnt}`);
  
  // Count total SUI records
  const totalCount = await pool.query(
    `SELECT COUNT(*) as cnt FROM community_pool_nav_history WHERE chain = 'sui'`
  );
  console.log(`Total SUI records: ${totalCount.rows[0].cnt}`);
  
  await pool.end();
})();
