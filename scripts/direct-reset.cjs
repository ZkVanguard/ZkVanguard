#!/usr/bin/env node
/**
 * Direct Reset Script - Community Pool V3
 * 
 * This script directly resets all database data to match on-chain V3 contract.
 * Does NOT require the Next.js server to be running.
 * 
 * Usage: node scripts/direct-reset.cjs
 */

const { neon } = require('@neondatabase/serverless');
const { ethers } = require('ethers');
const path = require('path');

// Try multiple env files
const envFiles = ['.env.local', '.env.vercel.temp', '.env.prod', '.env'];
for (const envFile of envFiles) {
  require('dotenv').config({ path: path.join(__dirname, '..', envFile) });
  if (process.env.DATABASE_URL) break;
}

// Configuration
const DATABASE_URL = process.env.DATABASE_URL?.trim();
const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';

// CommunityPool V3 Proxy (upgraded 2026-03-12)
const COMMUNITY_POOL_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';

const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function getMemberCount() view returns (uint256)',
  'function memberList(uint256) view returns (address)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinTime)',
  'function calculateTotalNAV() view returns (uint256)',
  'function getNavPerShare() view returns (uint256)',
  'function targetAllocationBps(uint256) view returns (uint256)',
];

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  COMMUNITY POOL V3 - COMPLETE DATA RESET                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  
  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in .env.local');
    process.exit(1);
  }
  
  const sql = neon(DATABASE_URL);
  const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
  const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
  
  console.log('🔗 Connected to Cronos Testnet');
  console.log(`📍 Pool Address: ${COMMUNITY_POOL_ADDRESS}\n`);
  
  // ==== Step 1: Fetch On-Chain Data ====
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 STEP 1: Fetching on-chain data from V3 contract...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const stats = await pool.getPoolStats();
  const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
  const totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
  const memberCount = Number(stats._memberCount);
  const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
  
  // Get allocations
  const allocBps = [
    Number(stats._allocations[0]),
    Number(stats._allocations[1]),
    Number(stats._allocations[2]),
    Number(stats._allocations[3]),
  ];
  const allocations = {
    BTC: allocBps[0] / 100,
    ETH: allocBps[1] / 100,
    SUI: allocBps[2] / 100,
    CRO: allocBps[3] / 100,
  };
  
  console.log('   ✅ Pool Stats:');
  console.log(`      Total NAV:      $${totalNAV.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`      Share Price:    $${sharePrice.toFixed(4)}`);
  console.log(`      Total Shares:   ${totalShares.toFixed(4)}`);
  console.log(`      Member Count:   ${memberCount}`);
  console.log(`      Allocations:    BTC ${allocations.BTC}% | ETH ${allocations.ETH}% | SUI ${allocations.SUI}% | CRO ${allocations.CRO}%\n`);
  
  // ==== Step 2: Fetch All On-Chain Members ====
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('👥 STEP 2: Fetching all on-chain members...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const members = [];
  for (let i = 0; i < memberCount; i++) {
    const addr = await pool.memberList(i);
    const memberData = await pool.members(addr);
    const shares = parseFloat(ethers.formatUnits(memberData.shares, 18));
    const depositedUSD = parseFloat(ethers.formatUnits(memberData.depositedUSD, 6));
    
    if (shares > 0) {
      members.push({
        address: addr.toLowerCase(),
        shares,
        depositedUSD,
        joinTime: Number(memberData.joinTime),
      });
      console.log(`   ✅ ${addr.slice(0,6)}...${addr.slice(-4)}: ${shares.toFixed(4)} shares ($${depositedUSD.toFixed(2)} deposited)`);
    }
  }
  
  console.log(`\n   📈 Found ${members.length} active members with shares > 0\n`);
  
  // ==== Step 3: Clear All Stale Data ====
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🗑️  STEP 3: Clearing all stale database data...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Delete all user shares
  const deletedUsers = await sql`DELETE FROM community_pool_shares RETURNING wallet_address`;
  console.log(`   ✅ Deleted ${deletedUsers.length} stale user records`);
  
  // Delete all NAV history
  const deletedNav = await sql`DELETE FROM community_pool_nav_history RETURNING id`;
  console.log(`   ✅ Deleted ${deletedNav.length} NAV history records`);
  
  // Delete all transactions (optional - keeps audit trail if commented out)
  // const deletedTx = await sql`DELETE FROM community_pool_transactions RETURNING id`;
  // console.log(`   ✅ Deleted ${deletedTx.length} transaction records`);
  
  console.log('');
  
  // ==== Step 4: Insert Fresh Data ====
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📥 STEP 4: Inserting fresh on-chain data...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Insert pool state
  const allocationsJson = JSON.stringify({
    BTC: { percentage: allocations.BTC, valueUSD: totalNAV * allocations.BTC / 100, amount: 0, price: 0 },
    ETH: { percentage: allocations.ETH, valueUSD: totalNAV * allocations.ETH / 100, amount: 0, price: 0 },
    SUI: { percentage: allocations.SUI, valueUSD: totalNAV * allocations.SUI / 100, amount: 0, price: 0 },
    CRO: { percentage: allocations.CRO, valueUSD: totalNAV * allocations.CRO / 100, amount: 0, price: 0 },
  });
  
  await sql`
    INSERT INTO community_pool_state (id, total_value_usd, total_shares, share_price, allocations, updated_at)
    VALUES (1, ${totalNAV}, ${totalShares}, ${sharePrice}, ${allocationsJson}::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE SET
      total_value_usd = ${totalNAV},
      total_shares = ${totalShares},
      share_price = ${sharePrice},
      allocations = ${allocationsJson}::jsonb,
      updated_at = NOW()
  `;
  console.log('   ✅ Pool state updated');
  
  // Insert all active members
  for (const member of members) {
    await sql`
      INSERT INTO community_pool_shares (wallet_address, shares, cost_basis_usd, joined_at, last_action_at)
      VALUES (${member.address}, ${member.shares}, ${member.depositedUSD}, to_timestamp(${member.joinTime}), NOW())
      ON CONFLICT (wallet_address) DO UPDATE SET
        shares = ${member.shares},
        cost_basis_usd = ${member.depositedUSD},
        last_action_at = NOW()
    `;
  }
  console.log(`   ✅ Inserted ${members.length} member records`);
  
  // Insert fresh NAV snapshot
  const navAllocJson = JSON.stringify(allocations);
  await sql`
    INSERT INTO community_pool_nav_history 
    (timestamp, share_price, total_nav, total_shares, member_count, allocations, source)
    VALUES (NOW(), ${sharePrice}, ${totalNAV}, ${totalShares}, ${members.length}, ${navAllocJson}::jsonb, 'v3-reset')
  `;
  console.log('   ✅ Inserted baseline NAV snapshot\n');
  
  // ==== Step 5: Verify ====
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✔️  STEP 5: Verification...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const verifyPool = await sql`SELECT * FROM community_pool_state WHERE id = 1`;
  console.log('   Pool State:');
  console.log(`      Total NAV:    $${parseFloat(verifyPool[0].total_value_usd).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`      Share Price:  $${parseFloat(verifyPool[0].share_price).toFixed(4)}`);
  console.log(`      Total Shares: ${parseFloat(verifyPool[0].total_shares).toFixed(4)}`);
  
  const verifyMembers = await sql`SELECT wallet_address, shares FROM community_pool_shares ORDER BY shares DESC`;
  console.log(`\n   Members (${verifyMembers.length} total):`);
  for (const m of verifyMembers) {
    const shortAddr = m.wallet_address.slice(0,6) + '...' + m.wallet_address.slice(-4);
    console.log(`      ${shortAddr}: ${parseFloat(m.shares).toFixed(4)} shares`);
  }
  
  const verifyNav = await sql`SELECT COUNT(*) as count FROM community_pool_nav_history`;
  console.log(`\n   NAV History: ${verifyNav[0].count} snapshot(s)`);
  
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ RESET COMPLETE - All data synced with on-chain V3 contract    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
