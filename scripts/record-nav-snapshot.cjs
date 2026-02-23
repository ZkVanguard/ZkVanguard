const { neon } = require('@neondatabase/serverless');
const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';
const COMMUNITY_POOL_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
];

async function recordNAVSnapshot() {
  const sql = neon(DATABASE_URL);
  const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
  const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
  
  console.log('Fetching on-chain pool stats...');
  const stats = await pool.getPoolStats();
  
  const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
  const totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
  const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
  const memberCount = Number(stats._memberCount);
  
  console.log('On-chain values:', { sharePrice, totalNAV, totalShares, memberCount });
  
  // Ensure table exists
  await sql`
    CREATE TABLE IF NOT EXISTS community_pool_nav_history (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      share_price DECIMAL(18,8) NOT NULL,
      total_nav DECIMAL(18,8) NOT NULL,
      total_shares DECIMAL(18,8) NOT NULL,
      member_count INT NOT NULL,
      allocations JSONB,
      source VARCHAR(50) DEFAULT 'on-chain',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  
  // Insert NAV snapshot
  await sql`
    INSERT INTO community_pool_nav_history 
      (share_price, total_nav, total_shares, member_count, source)
    VALUES 
      (${sharePrice}, ${totalNAV}, ${totalShares}, ${memberCount}, 'manual-sync')
  `;
  
  console.log('NAV snapshot recorded!');
  
  // Also add a PRICE_UPDATE transaction to capture current price in transaction history
  const txId = `price-sync-${Date.now()}`;
  await sql`
    INSERT INTO community_pool_transactions 
      (transaction_id, type, wallet_address, share_price, created_at)
    VALUES 
      (${txId}, 'PRICE_UPDATE', 'SYSTEM', ${sharePrice}, NOW())
  `;
  
  console.log('Price update transaction recorded!');
  
  // Verify
  const recent = await sql`
    SELECT share_price, total_nav, timestamp, source 
    FROM community_pool_nav_history 
    ORDER BY timestamp DESC 
    LIMIT 5
  `;
  console.log('Recent NAV history:', JSON.stringify(recent, null, 2));
  
  const recentTx = await sql`
    SELECT id, type, share_price, created_at
    FROM community_pool_transactions 
    ORDER BY created_at DESC 
    LIMIT 5
  `;
  console.log('Recent transactions:', JSON.stringify(recentTx, null, 2));
}

recordNAVSnapshot()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
