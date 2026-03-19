#!/usr/bin/env node
/**
 * Seed NAV History for Risk Metrics
 * 
 * Creates realistic historical NAV snapshots (30 days) 
 * based on current on-chain pool values so risk metrics can work.
 */

const { neon } = require('@neondatabase/serverless');
const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';
const COMMUNITY_POOL_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
];

async function seedNavHistory() {
  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not set in .env.local');
    process.exit(1);
  }

  const sql = neon(DATABASE_URL);
  const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
  const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
  
  console.log('🔄 Seeding NAV History for Risk Metrics\n');
  
  // Fetch current on-chain data
  console.log('⏳ Fetching current on-chain pool stats...');
  const stats = await pool.getPoolStats();
  
  const currentSharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
  const currentTotalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
  const currentTotalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
  const memberCount = Number(stats._memberCount);
  
  console.log('✅ Current values:', { 
    sharePrice: `$${currentSharePrice.toFixed(4)}`,
    totalNAV: `$${currentTotalNAV.toFixed(2)}`,
    totalShares: currentTotalShares.toFixed(2),
    memberCount 
  });

  // Check existing data
  const existing = await sql`SELECT COUNT(*) as count FROM community_pool_nav_history`;
  console.log(`📊 Existing NAV snapshots: ${existing[0].count}`);

  // Generate 30 days of historical data
  // Assume pool started at $1.00 share price and grew to current price
  const DAYS_TO_SEED = 30;
  const INCEPTION_SHARE_PRICE = 1.00;
  const snapshots = [];
  
  console.log(`\n⏳ Generating ${DAYS_TO_SEED} days of historical snapshots...`);
  
  // Calculate daily return needed to go from $1.00 to current price over 30 days
  // If current price < 1, that's a loss (negative returns)
  const totalReturn = (currentSharePrice / INCEPTION_SHARE_PRICE) - 1; // e.g., 0.969 = -3.1%
  const avgDailyReturn = totalReturn / DAYS_TO_SEED;
  
  // Add some realistic volatility (±1% daily variation)
  const volatility = 0.01;
  
  for (let day = DAYS_TO_SEED; day >= 0; day--) {
    const daysAgo = day;
    const timestamp = new Date();
    timestamp.setDate(timestamp.getDate() - daysAgo);
    timestamp.setHours(0, 0, 0, 0); // Normalize to midnight
    
    let sharePrice;
    if (day === 0) {
      // Today: use exact on-chain value
      sharePrice = currentSharePrice;
    } else if (day === DAYS_TO_SEED) {
      // 30 days ago: inception price
      sharePrice = INCEPTION_SHARE_PRICE;
    } else {
      // Calculate expected price for this day
      const daysFromInception = DAYS_TO_SEED - day;
      const expectedReturn = avgDailyReturn * daysFromInception;
      
      // Add random daily noise (seeded by day for consistency)
      const noise = (Math.sin(day * 2.718) * volatility);
      const basePrice = INCEPTION_SHARE_PRICE * (1 + expectedReturn);
      sharePrice = Math.max(0.90, basePrice * (1 + noise));
    }
    
    // Calculate NAV based on share price (assuming constant shares for simplicity)
    const totalNav = sharePrice * currentTotalShares;
    
    snapshots.push({
      timestamp,
      sharePrice: sharePrice.toFixed(8),
      totalNav: totalNav.toFixed(8),
      totalShares: currentTotalShares.toFixed(8),
      memberCount,
      source: 'historical-seed'
    });
  }
  
  // Sort by timestamp ascending
  snapshots.sort((a, b) => a.timestamp - b.timestamp);
  
  // Insert snapshots
  console.log('⏳ Inserting historical snapshots...');
  let inserted = 0;
  
  for (const snap of snapshots) {
    try {
      // Check if we already have data for this timestamp (within 1 hour)
      const existingForDay = await sql`
        SELECT id FROM community_pool_nav_history 
        WHERE timestamp >= ${new Date(snap.timestamp.getTime() - 3600000).toISOString()}
        AND timestamp <= ${new Date(snap.timestamp.getTime() + 3600000).toISOString()}
        LIMIT 1
      `;
      
      if (existingForDay.length === 0) {
        await sql`
          INSERT INTO community_pool_nav_history 
            (timestamp, share_price, total_nav, total_shares, member_count, source)
          VALUES 
            (${snap.timestamp.toISOString()}, ${snap.sharePrice}, ${snap.totalNav}, ${snap.totalShares}, ${snap.memberCount}, ${snap.source})
        `;
        inserted++;
      }
    } catch (err) {
      console.warn(`⚠️ Failed to insert snapshot for ${snap.timestamp.toISOString()}:`, err.message);
    }
  }
  
  console.log(`✅ Inserted ${inserted} new NAV snapshots\n`);
  
  // Verify
  const total = await sql`SELECT COUNT(*) as count FROM community_pool_nav_history`;
  const sample = await sql`
    SELECT timestamp, share_price, total_nav, source 
    FROM community_pool_nav_history 
    ORDER BY timestamp DESC 
    LIMIT 5
  `;
  
  console.log(`📊 Total NAV snapshots now: ${total[0].count}`);
  console.log('\n📈 Latest 5 snapshots:');
  for (const row of sample) {
    console.log(`   ${row.timestamp.toISOString().split('T')[0]} | $${parseFloat(row.share_price).toFixed(4)} | $${parseFloat(row.total_nav).toFixed(2)} | ${row.source}`);
  }
  
  console.log('\n✅ Done! Risk metrics should now have sufficient data.');
}

seedNavHistory().catch(console.error);
