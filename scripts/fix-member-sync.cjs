#!/usr/bin/env node
/**
 * Fix Community Pool member sync
 * Removes stale records and updates member balances from on-chain
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.vercel.temp' });
require('dotenv').config({ path: '.env.local' });

async function main() {
  let dbUrl = process.env.DATABASE_URL || '';
  dbUrl = dbUrl.replace(/\\r\\n/g, '').replace(/\r\n/g, '').trim();
  if (dbUrl.startsWith('"')) dbUrl = dbUrl.slice(1);
  if (dbUrl.endsWith('"')) dbUrl = dbUrl.slice(0, -1);

  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  console.log('\n=== FIXING MEMBER SYNC ===\n');

  // 1. Remove stale member not on-chain
  const del = await pool.query(
    "DELETE FROM community_pool_shares WHERE wallet_address ILIKE '0x43f7a95e%'"
  );
  console.log('Deleted stale member 0x43f7a95e...:', del.rowCount, 'rows');

  // 2. Update correct member balances from on-chain data
  // On-chain data from deep-sync-verify (with 18 decimals properly formatted)
  const updates = [
    { pattern: '0xb9966f10%', shares: 15506.835189954125, deposited: 15051.14 },
    { pattern: '0x7907b38d%', shares: 400, deposited: 400 },
    { pattern: '0x9d03abe4%', shares: 330, deposited: 330 },
    { pattern: '0x38294c7c%', shares: 20.632, deposited: 20 },
  ];

  for (const u of updates) {
    const result = await pool.query(
      `UPDATE community_pool_shares 
       SET shares = $1, cost_basis_usd = $2, last_action_at = NOW() 
       WHERE wallet_address ILIKE $3`,
      [u.shares, u.deposited, u.pattern]
    );
    console.log('Updated', u.pattern.replace('%', '...'), ':', result.rowCount, 'rows');
  }

  // 3. Verify results
  console.log('\n=== VERIFICATION ===\n');
  const check = await pool.query(`
    SELECT wallet_address, shares, cost_basis_usd 
    FROM community_pool_shares 
    WHERE shares > 0 
    ORDER BY shares DESC
  `);
  
  console.log('Active members after fix:');
  let total = 0;
  check.rows.forEach(r => {
    const shares = parseFloat(r.shares);
    total += shares;
    console.log(`  ${r.wallet_address.substring(0, 12)}... ${shares.toLocaleString()} shares ($${parseFloat(r.cost_basis_usd).toLocaleString()})`);
  });
  console.log(`\nTotal shares in DB: ${total.toLocaleString()}`);

  await pool.end();
  console.log('\n✅ Member sync complete\n');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
