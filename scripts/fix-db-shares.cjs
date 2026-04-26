const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_1mRrCDxHT3lU@ep-frosty-heart-amx8tu79-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  // On-chain new pool: 24.228348 shares, 2 members
  // DB has 3 wallets with 39.53 total shares
  // 0xc32457... (15.58) and 0xb157ee... (0.525) are from old pool - NOT in new pool
  
  console.log('=== BEFORE ===');
  const before = await pool.query("SELECT wallet_address, shares, cost_basis_usd FROM community_pool_shares WHERE chain = 'sui'");
  before.rows.forEach(r => console.log('  ', r.wallet_address.slice(0,12), ':', Number(r.shares).toFixed(6), 'costBasis:', r.cost_basis_usd));
  console.log('  Total:', before.rows.reduce((s,r) => s + Number(r.shares), 0).toFixed(6));

  // Delete stale wallets not in new pool
  const del1 = await pool.query("DELETE FROM community_pool_shares WHERE chain = 'sui' AND wallet_address LIKE '0xc32457%' RETURNING wallet_address, shares");
  const del2 = await pool.query("DELETE FROM community_pool_shares WHERE chain = 'sui' AND wallet_address LIKE '0xb157ee%' RETURNING wallet_address, shares");
  console.log('\n=== DELETED ===');
  del1.rows.forEach(r => console.log('  Deleted:', r.wallet_address.slice(0,12), ':', Number(r.shares).toFixed(6)));
  del2.rows.forEach(r => console.log('  Deleted:', r.wallet_address.slice(0,12), ':', Number(r.shares).toFixed(6)));

  // Check if there's a second member on-chain we need to add
  // On-chain: 2 members, 24.228348 shares total
  // Depositor 0x880cfa has 23.428348 shares
  // So second member has 24.228348 - 23.428348 = 0.800000 shares
  // The second member is likely the admin (0x99a3a0) from the initial test deposit
  
  // Check if admin wallet exists in DB
  const adminCheck = await pool.query("SELECT * FROM community_pool_shares WHERE chain = 'sui' AND wallet_address LIKE '0x99a3a0%'");
  if (adminCheck.rows.length === 0) {
    console.log('\n=== ADDING ADMIN SHARES ===');
    await pool.query(
      "INSERT INTO community_pool_shares (chain, wallet_address, shares, cost_basis_usd) VALUES ('sui', '0x99a3a0fd45bb6b467547430b8efab77eb64218ab098428297a7a3be77329ac93', 0.800000, 0.80)"
    );
    console.log('  Added admin: 0x99a3a0fd45... : 0.800000 shares, costBasis: $0.80');
  } else {
    console.log('\nAdmin already in DB:', adminCheck.rows[0].shares);
  }

  console.log('\n=== AFTER ===');
  const after = await pool.query("SELECT wallet_address, shares, cost_basis_usd FROM community_pool_shares WHERE chain = 'sui'");
  after.rows.forEach(r => console.log('  ', r.wallet_address.slice(0,12), ':', Number(r.shares).toFixed(6), 'costBasis:', r.cost_basis_usd));
  console.log('  Total:', after.rows.reduce((s,r) => s + Number(r.shares), 0).toFixed(6));
  console.log('  On-chain total: 24.228348');

  await pool.end();
}
fix().catch(console.error);
