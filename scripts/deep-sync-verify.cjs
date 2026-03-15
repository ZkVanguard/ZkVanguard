#!/usr/bin/env node
/**
 * Deep Community Pool Sync Verification
 * 
 * Compares on-chain V3 contract data vs database records
 * to ensure everything is properly synchronized.
 */

const { ethers } = require('ethers');
const { Pool } = require('pg');

// Load env
require('dotenv').config({ path: '.env.vercel.temp' });
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

// V3 Contract
const V3_PROXY = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';

// Simplified ABI for read operations
const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function getMemberCount() view returns (uint256)',
  'function memberList(uint256 index) view returns (address)',
  'function members(address) view returns (uint256 shares, uint128 depositedUSD, uint64 investedAt, bool active)',
  'function totalPooledUSD() view returns (uint256)',
  'function assetBalances(uint256 idx) view returns (uint256)',
];

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  🔍 DEEP COMMUNITY POOL SYNC VERIFICATION');
  console.log('═'.repeat(70));
  console.log(`  Contract: ${V3_PROXY}`);
  console.log(`  Network:  Cronos Testnet (338)`);
  console.log('═'.repeat(70) + '\n');

  // Setup connections
  const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
  const contract = new ethers.Contract(V3_PROXY, POOL_ABI, provider);

  let dbUrl = process.env.DATABASE_URL || '';
  dbUrl = dbUrl.replace(/\\r\\n/g, '').replace(/\r\n/g, '').trim();
  if (dbUrl.startsWith('"')) dbUrl = dbUrl.slice(1);
  if (dbUrl.endsWith('"')) dbUrl = dbUrl.slice(0, -1);

  if (!dbUrl) {
    console.log('❌ DATABASE_URL not found');
    return;
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  const issues = [];
  const warnings = [];

  // ============================================
  // 1. ON-CHAIN DATA
  // ============================================
  console.log('1️⃣  FETCHING ON-CHAIN DATA...\n');
  
  let onChainStats;
  try {
    const stats = await contract.getPoolStats();
    // Contract uses: SHARE_DECIMALS=18, USDC_DECIMALS=6
    onChainStats = {
      totalShares: parseFloat(ethers.formatUnits(stats[0], 18)),
      totalNAV: parseFloat(ethers.formatUnits(stats[1], 6)),
      memberCount: Number(stats[2]),
      sharePrice: parseFloat(ethers.formatUnits(stats[3], 6)),
    };
    console.log('   On-Chain Pool Stats:');
    console.log(`   • Total Shares: ${onChainStats.totalShares.toLocaleString()}`);
    console.log(`   • Total NAV:    $${onChainStats.totalNAV.toLocaleString()}`);
    console.log(`   • Member Count: ${onChainStats.memberCount}`);
    console.log(`   • Share Price:  $${onChainStats.sharePrice.toFixed(8)}`);
  } catch (e) {
    console.log('   ❌ Failed to fetch on-chain stats:', e.message);
    issues.push('Cannot read on-chain stats');
    return;
  }

  // Fetch members from chain
  console.log('\n   Fetching member list from chain...');
  const onChainMembers = new Map();
  try {
    const count = await contract.getMemberCount();
    for (let i = 0; i < Number(count); i++) {
      const addr = await contract.memberList(i);
      const member = await contract.members(addr);
      if (member.active) {
        const shares = parseFloat(ethers.formatUnits(member.shares, 18));
        const key = addr.toLowerCase();
        if (!onChainMembers.has(key) || onChainMembers.get(key).shares < shares) {
          onChainMembers.set(key, {
            address: addr,
            shares,
            depositedUSD: parseFloat(ethers.formatUnits(member.depositedUSD, 6)),
            investedAt: new Date(Number(member.investedAt) * 1000).toISOString(),
            active: member.active,
          });
        }
      }
    }
    console.log(`   ✅ Found ${onChainMembers.size} unique active members on-chain`);
    for (const [addr, m] of onChainMembers) {
      const pct = (m.shares / onChainStats.totalShares * 100).toFixed(2);
      console.log(`      • ${addr.slice(0, 10)}... ${m.shares.toLocaleString()} shares (${pct}%)`);
    }
  } catch (e) {
    console.log('   ⚠️ Error fetching members:', e.message);
    warnings.push('Could not fetch complete member list');
  }

  // ============================================
  // 2. DATABASE DATA
  // ============================================
  console.log('\n2️⃣  FETCHING DATABASE DATA...\n');

  // Pool state
  let dbState;
  try {
    const result = await pool.query('SELECT * FROM community_pool_state WHERE id = 1');
    if (result.rows.length > 0) {
      dbState = result.rows[0];
      console.log('   Database Pool State:');
      console.log(`   • Total Value: $${parseFloat(dbState.total_value_usd || 0).toLocaleString()}`);
      console.log(`   • Total Shares: ${parseFloat(dbState.total_shares || 0).toLocaleString()}`);
      console.log(`   • Share Price:  $${parseFloat(dbState.share_price || 1).toFixed(8)}`);
      console.log(`   • Last Updated: ${dbState.updated_at}`);
    } else {
      console.log('   ⚠️ No pool state in database');
      warnings.push('No pool state in database');
    }
  } catch (e) {
    console.log('   ❌ Error reading pool state:', e.message);
    issues.push('Cannot read database pool state');
  }

  // Members in DB
  let dbMembers;
  try {
    const result = await pool.query(`
      SELECT wallet_address, shares, cost_basis_usd, joined_at, last_action_at 
      FROM community_pool_shares 
      ORDER BY shares DESC
    `);
    dbMembers = result.rows;
    console.log(`\n   Database Members (community_pool_shares): ${dbMembers.length}`);
    for (const m of dbMembers) {
      console.log(`      • ${m.wallet_address.slice(0, 10)}... ${parseFloat(m.shares).toLocaleString()} shares`);
    }
  } catch (e) {
    console.log('   ❌ Error reading members:', e.message);
    issues.push('Cannot read database members');
  }

  // NAV history count
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count, 
             MAX(id) as latest_id,
             MIN(created_at) as oldest,
             MAX(created_at) as newest
      FROM community_pool_nav_history
    `);
    const h = result.rows[0];
    console.log(`\n   NAV History Records: ${h.count}`);
    console.log(`   • Oldest: ${h.oldest || 'N/A'}`);
    console.log(`   • Newest: ${h.newest || 'N/A'}`);
  } catch (e) {
    console.log('   ⚠️ NAV history:', e.message.substring(0, 50));
  }

  // Auto-hedge config
  try {
    const result = await pool.query(`SELECT * FROM auto_hedge_configs WHERE portfolio_id = -1`);
    if (result.rows.length > 0) {
      const cfg = result.rows[0];
      console.log(`\n   Auto-Hedge Config:`);
      console.log(`   • Wallet: ${cfg.wallet_address}`);
      console.log(`   • Enabled: ${cfg.enabled}`);
      console.log(`   • Threshold: ${cfg.risk_threshold}/10`);
      
      // Check if it matches V3
      if (cfg.wallet_address?.toLowerCase() !== V3_PROXY.toLowerCase()) {
        issues.push(`Auto-hedge config wallet mismatch! DB: ${cfg.wallet_address}, Expected: ${V3_PROXY}`);
        console.log('   ❌ MISMATCH: Wallet does not match V3 proxy!');
      } else {
        console.log('   ✅ Wallet matches V3 proxy');
      }
    }
  } catch (e) {
    console.log('   ⚠️ Auto-hedge config:', e.message.substring(0, 50));
  }

  // ============================================
  // 3. COMPARISON
  // ============================================
  console.log('\n3️⃣  DATA COMPARISON...\n');

  if (dbState && onChainStats) {
    const dbNAV = parseFloat(dbState.total_value_usd || 0);
    const chainNAV = onChainStats.totalNAV;
    const navDiff = Math.abs(dbNAV - chainNAV);
    const navDiffPct = chainNAV > 0 ? (navDiff / chainNAV * 100) : 0;

    console.log('   NAV Comparison:');
    console.log(`   • On-Chain: $${chainNAV.toLocaleString()}`);
    console.log(`   • Database: $${dbNAV.toLocaleString()}`);
    console.log(`   • Diff:     $${navDiff.toFixed(2)} (${navDiffPct.toFixed(2)}%)`);

    if (navDiffPct > 5) {
      issues.push(`NAV difference >5%: Chain=$${chainNAV}, DB=$${dbNAV}`);
      console.log('   ❌ CRITICAL: NAV difference exceeds 5%!');
    } else if (navDiffPct > 1) {
      warnings.push(`NAV difference >1%: ${navDiffPct.toFixed(2)}%`);
      console.log('   ⚠️  WARNING: NAV difference exceeds 1%');
    } else {
      console.log('   ✅ NAV values are in sync');
    }

    // Share price comparison
    const dbSharePrice = parseFloat(dbState.share_price || 1);
    const chainSharePrice = onChainStats.sharePrice;
    const priceDiff = Math.abs(dbSharePrice - chainSharePrice);
    const priceDiffPct = chainSharePrice > 0 ? (priceDiff / chainSharePrice * 100) : 0;

    console.log('\n   Share Price Comparison:');
    console.log(`   • On-Chain: $${chainSharePrice.toFixed(8)}`);
    console.log(`   • Database: $${dbSharePrice.toFixed(8)}`);
    console.log(`   • Diff:     ${priceDiffPct.toFixed(4)}%`);

    if (priceDiffPct > 1) {
      warnings.push(`Share price difference: ${priceDiffPct.toFixed(4)}%`);
    }
  }

  // Member comparison
  if (dbMembers && onChainMembers.size > 0) {
    console.log('\n   Member Comparison:');
    console.log(`   • On-Chain: ${onChainMembers.size} unique members`);
    console.log(`   • Database: ${dbMembers.length} records`);

    let missingInDb = 0;
    let extraInDb = 0;

    for (const [addr, _] of onChainMembers) {
      const inDb = dbMembers.find(m => m.wallet_address.toLowerCase() === addr);
      if (!inDb) {
        missingInDb++;
        console.log(`   ⚠️ Missing in DB: ${addr}`);
      }
    }

    for (const m of dbMembers) {
      if (!onChainMembers.has(m.wallet_address.toLowerCase())) {
        extraInDb++;
        console.log(`   ⚠️ Extra in DB (not on-chain): ${m.wallet_address}`);
      }
    }

    if (missingInDb > 0) {
      issues.push(`${missingInDb} members on-chain but missing in database`);
    }
    if (extraInDb > 0) {
      warnings.push(`${extraInDb} members in DB but not active on-chain`);
    }
    if (missingInDb === 0 && extraInDb === 0) {
      console.log('   ✅ Member lists match');
    }
  }

  // ============================================
  // 4. SUMMARY
  // ============================================
  console.log('\n' + '═'.repeat(70));
  console.log('  📊 SYNC VERIFICATION SUMMARY');
  console.log('═'.repeat(70));

  if (issues.length === 0 && warnings.length === 0) {
    console.log('\n  ✅ ALL SYSTEMS IN SYNC - No issues found!\n');
  } else {
    if (issues.length > 0) {
      console.log('\n  ❌ CRITICAL ISSUES:');
      issues.forEach(i => console.log(`     • ${i}`));
    }
    if (warnings.length > 0) {
      console.log('\n  ⚠️  WARNINGS:');
      warnings.forEach(w => console.log(`     • ${w}`));
    }
    
    console.log('\n  💡 RECOMMENDED ACTIONS:');
    if (issues.some(i => i.includes('NAV'))) {
      console.log('     • Run: node scripts/direct-reset.cjs to resync from on-chain');
    }
    if (issues.some(i => i.includes('members'))) {
      console.log('     • Run: node scripts/sync-pool-db.cjs to sync members');
    }
    if (issues.some(i => i.includes('Auto-hedge'))) {
      console.log('     • Run: node scripts/update-auto-hedge-config.cjs to fix config');
    }
  }

  console.log('\n' + '═'.repeat(70) + '\n');

  await pool.end();
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
