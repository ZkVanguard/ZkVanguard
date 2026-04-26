/**
 * Clean up:
 * 1. Delete all 241 fake BlueFin perp hedge records from DB
 * 2. Update auto_hedge_configs threshold to 10 (effectively disabled)
 * 3. Check old pool hedge state
 */
const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: 'postgresql://neondb_owner:npg_1mRrCDxHT3lU@ep-frosty-heart-amx8tu79-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function cleanup() {
  console.log('=== PRE-CLEANUP STATE ===');
  
  // Count hedges
  const before = await pool.query('SELECT COUNT(*) as cnt FROM hedges WHERE portfolio_id = -2');
  console.log('SUI pool hedges (portfolio -2):', before.rows[0].cnt);

  // Check auto_hedge_configs
  const configs = await pool.query('SELECT portfolio_id, enabled, risk_threshold, max_leverage FROM auto_hedge_configs');
  console.log('\nAuto-hedge configs:');
  configs.rows.forEach(r => console.log('  portfolio', r.portfolio_id, '- enabled:', r.enabled, 'threshold:', r.risk_threshold, 'leverage:', r.max_leverage));

  // ========== 1. DELETE ALL FAKE HEDGES ==========
  console.log('\n=== DELETING FAKE HEDGES ===');
  const deleteResult = await pool.query('DELETE FROM hedges WHERE portfolio_id = -2 RETURNING id');
  console.log('Deleted', deleteResult.rowCount, 'hedge records');

  // ========== 2. UPDATE AUTO-HEDGE THRESHOLD ==========
  console.log('\n=== UPDATING AUTO-HEDGE CONFIG ===');
  const updateResult = await pool.query(
    'UPDATE auto_hedge_configs SET risk_threshold = 10, enabled = false WHERE portfolio_id = -2 RETURNING portfolio_id, risk_threshold, enabled'
  );
  if (updateResult.rowCount > 0) {
    console.log('Updated:', JSON.stringify(updateResult.rows[0]));
  } else {
    console.log('No config found for portfolio -2, trying to insert disabled config');
    await pool.query(
      "INSERT INTO auto_hedge_configs (portfolio_id, wallet_address, enabled, risk_threshold, max_leverage) VALUES (-2, '', false, 10, 3) ON CONFLICT (portfolio_id) DO UPDATE SET enabled = false, risk_threshold = 10"
    );
    console.log('Config set to disabled, threshold=10');
  }

  // ========== 3. VERIFY ==========
  console.log('\n=== POST-CLEANUP STATE ===');
  const after = await pool.query('SELECT COUNT(*) as cnt FROM hedges WHERE portfolio_id = -2');
  console.log('SUI pool hedges remaining:', after.rows[0].cnt);

  const newConfigs = await pool.query('SELECT portfolio_id, enabled, risk_threshold FROM auto_hedge_configs');
  console.log('Auto-hedge configs:');
  newConfigs.rows.forEach(r => console.log('  portfolio', r.portfolio_id, '- enabled:', r.enabled, 'threshold:', r.risk_threshold));

  // ========== 4. CHECK SHARES/POOL STATE ==========
  console.log('\n=== POOL STATE CHECK ===');
  const shares = await pool.query("SELECT wallet_address, shares, cost_basis_usd FROM community_pool_shares WHERE chain = 'sui'");
  console.log('SUI shares:');
  let totalShares = 0;
  shares.rows.forEach(r => {
    totalShares += Number(r.shares);
    console.log('  ', r.wallet_address.slice(0, 12) + '...', 'shares:', Number(r.shares).toFixed(6), 'costBasis:', r.cost_basis_usd);
  });
  console.log('  Total shares:', totalShares.toFixed(6));

  await pool.end();
  console.log('\n✅ Cleanup complete');
}

cleanup().catch(e => { console.error('ERROR:', e); process.exit(1); });
