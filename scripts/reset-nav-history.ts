#!/usr/bin/env npx tsx
/**
 * Reset NAV History with On-Chain Contract Data
 * 
 * This script:
 * 1. Deletes all incorrect NAV history from DB
 * 2. Records a fresh snapshot using on-chain contract data
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ethers } from 'ethers';
import { query } from '../lib/db/postgres';

// Community Pool V3 Proxy Address (updated 2026-03-12)
const COMMUNITY_POOL_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function getMemberCount() view returns (uint256)',
  'function memberList(uint256) view returns (address)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinTime)',
];

async function resetNavHistory() {
  console.log('🔄 Resetting NAV History with On-Chain Data\n');
  
  // Step 1: Delete all old NAV history
  console.log('⏳ Deleting old NAV history...');
  const deleted = await query('DELETE FROM community_pool_nav_history RETURNING id');
  console.log(`✅ Deleted ${deleted.length} old snapshots\n`);
  
  // Step 2: Fetch current on-chain data
  console.log('⏳ Fetching on-chain contract data...');
  const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org');
  const contract = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
  
  const stats = await contract.getPoolStats();
  
  const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
  const totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
  const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
  const memberCount = Number(stats._memberCount);
  const allocations = {
    BTC: Number(stats._allocations[0]) / 100,
    ETH: Number(stats._allocations[1]) / 100,
    SUI: Number(stats._allocations[2]) / 100,
    CRO: Number(stats._allocations[3]) / 100,
  };
  
  console.log('✅ On-chain data fetched:');
  console.log(`   Total NAV: $${totalNAV.toFixed(2)}`);
  console.log(`   Share Price: $${sharePrice.toFixed(6)}`);
  console.log(`   Total Shares: ${totalShares.toFixed(2)}`);
  console.log(`   Members: ${memberCount}`);
  console.log(`   Allocations: BTC ${allocations.BTC}%, ETH ${allocations.ETH}%, SUI ${allocations.SUI}%, CRO ${allocations.CRO}%\n`);
  
  // Step 3: Insert baseline snapshot
  console.log('⏳ Recording baseline snapshot...');
  await query(
    `INSERT INTO community_pool_nav_history 
     (total_nav, share_price, total_shares, member_count, allocations, source, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      totalNAV,
      sharePrice,
      totalShares,
      memberCount,
      JSON.stringify(allocations),
      'onchain-contract-baseline',
    ]
  );
  
  console.log('✅ Baseline snapshot recorded\n');
  
  // Step 4: Verify
  console.log('⏳ Verifying new snapshot...');
  const verify = await query('SELECT * FROM community_pool_nav_history ORDER BY timestamp DESC LIMIT 1');
  
  console.log('✅ Verification:');
  console.log(`   Share Price: $${parseFloat(verify[0].share_price).toFixed(6)}`);
  console.log(`   Total NAV: $${parseFloat(verify[0].total_nav).toFixed(2)}`);
  console.log(`   Source: ${verify[0].source}`);
  console.log(`   Timestamp: ${new Date(verify[0].timestamp).toLocaleString()}\n`);
  
  console.log('✅ NAV history reset complete!');
  console.log('   All future snapshots will use on-chain contract data.');
  
  process.exit(0);
}

resetNavHistory().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
