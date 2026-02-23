const { neon } = require('@neondatabase/serverless');
const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);
const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';
const COMMUNITY_POOL_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';

// ABI for member list and details
const POOL_ABI = [
  'function memberList(uint256) view returns (address)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinedAt, uint256 lastDepositAt, uint256 highWaterMark)',
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
];

async function syncShareholdersFromChain() {
  console.log('=== Syncing Shareholders from On-Chain ===\n');
  
  // 1. Ensure table exists and clear old data
  console.log('1. Creating/verifying community_pool_shares table...');
  await sql`
    CREATE TABLE IF NOT EXISTS community_pool_shares (
      id SERIAL PRIMARY KEY,
      wallet_address VARCHAR(255) NOT NULL UNIQUE,
      shares DECIMAL(20, 8) NOT NULL DEFAULT 0,
      cost_basis_usd DECIMAL(20, 2) NOT NULL DEFAULT 0,
      joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      last_action_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  // Clear old data to ensure fresh sync
  await sql`DELETE FROM community_pool_shares`;
  console.log('   Table ready! (old data cleared)\n');
  
  // 2. Fetch on-chain member data
  console.log('2. Fetching on-chain member data...');
  const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
  const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
  
  const stats = await pool.getPoolStats();
  const memberCount = Number(stats._memberCount);
  console.log(`   Found ${memberCount} members on-chain\n`);
  
  // 3. Sync each member
  console.log('3. Syncing member data...');
  for (let i = 0; i < memberCount; i++) {
    try {
      const memberAddress = await pool.memberList(i);
      const memberData = await pool.members(memberAddress);
      
      const shares = parseFloat(ethers.formatUnits(memberData.shares, 18));
      const depositedUSD = parseFloat(ethers.formatUnits(memberData.depositedUSD, 6));
      
      if (shares > 0) {
        // Normalize address to lowercase for consistency
        const normalizedAddress = memberAddress.toLowerCase();
        await sql`
          INSERT INTO community_pool_shares (wallet_address, shares, cost_basis_usd, last_action_at)
          VALUES (${normalizedAddress}, ${shares}, ${depositedUSD}, NOW())
          ON CONFLICT (wallet_address) 
          DO UPDATE SET shares = ${shares}, cost_basis_usd = ${depositedUSD}, last_action_at = NOW()
        `;
        console.log(`   ${normalizedAddress.slice(0, 8)}...${normalizedAddress.slice(-6)}: ${shares.toFixed(2)} shares`);
      }
    } catch (e) {
      console.log(`   Error fetching member ${i}:`, e.message);
    }
  }
  
  // 4. Verify
  console.log('\n4. Verification:');
  const shareholders = await sql`SELECT wallet_address, shares FROM community_pool_shares WHERE shares > 0 ORDER BY shares DESC`;
  console.log('   Shareholders in DB:', shareholders.length);
  shareholders.forEach((s, i) => {
    console.log(`   ${i + 1}. ${s.wallet_address.slice(0, 8)}...${s.wallet_address.slice(-6)}: ${parseFloat(s.shares).toFixed(2)} shares`);
  });
}

syncShareholdersFromChain().then(() => {
  console.log('\nDone!');
  process.exit(0);
}).catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
