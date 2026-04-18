require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

(async () => {
  const connStr = process.env.DATABASE_POOL_URL || process.env.DATABASE_URL || process.env.DB_V2_DATABASE_URL;
  if (!connStr) { console.log('No DATABASE_URL found'); process.exit(1); }
  const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  
  // Fix bad SUI NAV records where share_price != 1.0 
  // The pool had $50 USDC with 50 shares, so share price should always be $1.00
  // Records 130-133 had NAV=$42.88 because total_hedged_value wasn't included
  // Record 123 had NAV=$14.54 because wrong pool service was used
  const result = await pool.query(
    `UPDATE community_pool_nav_history 
     SET share_price = 1.0, total_nav = 50.0
     WHERE chain = 'sui' AND ABS(share_price - 1.0) > 0.01
     RETURNING id, share_price, total_nav`
  );
  
  console.log(`Fixed ${result.rowCount} bad NAV records:`);
  for (const r of result.rows) {
    console.log(`  id=${r.id} -> price=${r.share_price} nav=${r.total_nav}`);
  }
  
  // Verify
  const check = await pool.query(
    `SELECT MIN(share_price) as min_price, MAX(share_price) as max_price, COUNT(*) as total
     FROM community_pool_nav_history WHERE chain = 'sui'`
  );
  console.log(`\nVerification: prices range ${Number(check.rows[0].min_price).toFixed(4)} - ${Number(check.rows[0].max_price).toFixed(4)}, total records: ${check.rows[0].total}`);
  
  await pool.end();
})();
