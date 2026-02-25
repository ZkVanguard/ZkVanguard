const { neon } = require('@neondatabase/serverless');
const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.log('No DATABASE_URL');
  process.exit(1);
}

const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';
const COMMUNITY_POOL_ADDRESS = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B'; // V2
const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
];

const sql = neon(DATABASE_URL);

async function fixDatabase() {
  console.log('\\n=== Fixing Database from On-Chain Data ===\\n');
  
  // 1. Fetch on-chain data
  console.log('1. Fetching on-chain pool stats...');
  const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
  const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
  const stats = await pool.getPoolStats();
  
  const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
  const totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
  const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
  
  console.log('On-chain values:');
  console.log('  - Total Shares:', totalShares);
  console.log('  - Total NAV:', totalNAV);
  console.log('  - Share Price:', sharePrice);
  
  // 2. Update pool state
  console.log('\\n2. Updating community_pool_state...');
  await sql('UPDATE community_pool_state SET total_shares = $1, total_value_usd = $2, share_price = $3, updated_at = NOW() WHERE id = 1', 
    [totalShares, totalNAV, sharePrice]);
  console.log('   Done!');
  
  // 3. Fix transaction share prices (scale by 1e6 to convert raw to human-readable)
  console.log('\\n3. Fixing transaction share prices...');
  await sql('UPDATE community_pool_transactions SET share_price = share_price * 1000000 WHERE share_price < 0.001');
  console.log('   Done!');
  
  // 4. Verify fix
  console.log('\\n4. Verifying fix...');
  const state = await sql('SELECT total_shares, share_price, total_value_usd FROM community_pool_state WHERE id = 1');
  console.log('   New pool state:', JSON.stringify(state[0], null, 2));
  
  const prices = await sql('SELECT DISTINCT share_price, COUNT(*) as count FROM community_pool_transactions WHERE share_price IS NOT NULL GROUP BY share_price ORDER BY share_price');
  console.log('   Transaction share prices:', JSON.stringify(prices, null, 2));
}

async function main() {
  console.log('\\n=== Database Debug & Fix ===\\n');
  
  // Show current state
  try {
    const tx = await sql('SELECT id, type, share_price, created_at FROM community_pool_transactions ORDER BY created_at DESC LIMIT 5');
    console.log('Current Transactions (last 5):', JSON.stringify(tx, null, 2));
    
    const state = await sql('SELECT total_shares, share_price, total_value_usd FROM community_pool_state WHERE id = 1');
    console.log('\\nCurrent Pool State:', JSON.stringify(state[0], null, 2));
  } catch (e) {
    console.log('Error:', e.message);
  }
  
  // Ask to fix
  const args = process.argv.slice(2);
  if (args.includes('--fix')) {
    await fixDatabase();
  } else {
    console.log('\\nTo fix the database, run: node scripts/debug-nav.cjs --fix');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
