const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: 'postgresql://neondb_owner:npg_1mRrCDxHT3lU@ep-frosty-heart-amx8tu79-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function check() {
  // Count hedges
  const countRes = await pool.query('SELECT COUNT(*) as total, portfolio_id FROM hedges GROUP BY portfolio_id');
  console.log('=== HEDGE COUNTS BY PORTFOLIO ===');
  countRes.rows.forEach(r => console.log('  portfolio', r.portfolio_id, ':', r.total));

  // Check schema
  const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'hedges' ORDER BY ordinal_position");
  console.log('\n=== HEDGES TABLE COLUMNS ===');
  console.log(cols.rows.map(r => r.column_name).join(', '));

  // Check if they're real BlueFin orders or DB-only
  const sample = await pool.query('SELECT * FROM hedges ORDER BY created_at DESC LIMIT 3');
  console.log('\n=== SAMPLE HEDGES (latest 3) ===');
  sample.rows.forEach(r => console.log(JSON.stringify(r)));

  // Statuses
  const statuses = await pool.query('SELECT status, COUNT(*) as cnt FROM hedges GROUP BY status');
  console.log('\n=== HEDGE STATUSES ===');
  statuses.rows.forEach(r => console.log('  ', r.status, ':', r.cnt));

  // Check pool state in DB
  const poolState = await pool.query("SELECT * FROM community_pool_state WHERE chain = 'sui' ORDER BY updated_at DESC LIMIT 1");
  console.log('\n=== DB POOL STATE (SUI) ===');
  if (poolState.rows[0]) {
    const s = poolState.rows[0];
    console.log('total_value_usd:', s.total_value_usd);
    console.log('share_price:', s.share_price);
    console.log('total_shares:', s.total_shares);
    console.log('updated_at:', s.updated_at);
  }

  // Check shares
  const shares = await pool.query("SELECT wallet_address, shares, cost_basis_usd, chain FROM community_pool_shares WHERE chain = 'sui'");
  console.log('\n=== SUI SHARES ===');
  shares.rows.forEach(r => console.log('  ', r.wallet_address.slice(0,10) + '...', 'shares:', r.shares, 'costBasis:', r.cost_basis_usd));

  // Check old pool state
  const oldPool = await pool.query("SELECT * FROM community_pool_state WHERE chain != 'sui' OR chain IS NULL ORDER BY updated_at DESC LIMIT 3");
  console.log('\n=== OTHER POOL STATES ===');
  oldPool.rows.forEach(r => console.log('  chain:', r.chain, 'val:', r.total_value_usd, 'shares:', r.total_shares));

  await pool.end();
}
check().catch(e => { console.error(e); process.exit(1); });
