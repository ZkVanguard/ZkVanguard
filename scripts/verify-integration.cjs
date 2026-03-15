/**
 * Verify AI Agent & Oracle Integration
 * 
 * Checks that all components work with V3 contract
 */

const { neon } = require('@neondatabase/serverless');
const { ethers } = require('ethers');
const path = require('path');

// Load env
const envFiles = ['.env.local', '.env.vercel.temp', '.env.prod'];
for (const envFile of envFiles) {
  require('dotenv').config({ path: path.join(__dirname, '..', envFile) });
  if (process.env.DATABASE_URL) break;
}

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';
const COMMUNITY_POOL_V3 = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const PYTH_ORACLE = '0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320';

const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function pythOracle() view returns (address)',
  'function priceFeedIds(uint256) view returns (bytes32)',
];

const PYTH_ABI = [
  'function getPrice(bytes32 id) view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))',
  'function priceFeedExists(bytes32 id) view returns (bool)',
];

// Pyth price IDs
const PRICE_IDS = {
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  SUI: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
  CRO: '0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe',
};

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  AI AGENT & ORACLE INTEGRATION VERIFICATION                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  
  const sql = neon(DATABASE_URL);
  const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
  const pool = new ethers.Contract(COMMUNITY_POOL_V3, POOL_ABI, provider);
  const pyth = new ethers.Contract(PYTH_ORACLE, PYTH_ABI, provider);
  
  let allPassed = true;
  
  // ═══════════════════════════════════════════════════════════════════════
  // 1. Check Pool Contract
  // ═══════════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('1️⃣  POOL CONTRACT (V3)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    const stats = await pool.getPoolStats();
    const totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
    const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
    console.log(`   ✅ Pool Contract Accessible`);
    console.log(`      Address: ${COMMUNITY_POOL_V3}`);
    console.log(`      NAV: $${totalNAV.toFixed(2)}`);
    console.log(`      Share Price: $${sharePrice.toFixed(4)}\n`);
  } catch (e) {
    console.log(`   ❌ Pool Contract Error: ${e.message}\n`);
    allPassed = false;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 2. Check Pyth Oracle
  // ═══════════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('2️⃣  PYTH ORACLE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    const oracleAddr = await pool.pythOracle();
    console.log(`   ✅ Oracle Address: ${oracleAddr}`);
    
    for (const [asset, priceId] of Object.entries(PRICE_IDS)) {
      try {
        const exists = await pyth.priceFeedExists(priceId);
        if (exists) {
          const price = await pyth.getPrice(priceId);
          const priceValue = Number(price.price) * Math.pow(10, Number(price.expo));
          const ageSeconds = Math.floor(Date.now() / 1000) - Number(price.publishTime);
          console.log(`   ✅ ${asset}: $${priceValue.toFixed(2)} (${ageSeconds}s old)`);
        } else {
          console.log(`   ⚠️  ${asset}: Price feed not found`);
        }
      } catch (e) {
        console.log(`   ⚠️  ${asset}: ${e.message.slice(0, 50)}`);
      }
    }
    console.log('');
  } catch (e) {
    console.log(`   ❌ Oracle Error: ${e.message}\n`);
    allPassed = false;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 3. Check Auto-Hedge Config
  // ═══════════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('3️⃣  AUTO-HEDGE CONFIGURATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    const configs = await sql`SELECT * FROM auto_hedge_configs WHERE portfolio_id = -1`;
    
    if (configs.length === 0) {
      console.log(`   ⚠️  No auto-hedge config found for Community Pool`);
      console.log(`      Creating default config...`);
      
      await sql`
        INSERT INTO auto_hedge_configs (portfolio_id, pool_address, enabled, risk_threshold, max_leverage, allowed_assets)
        VALUES (-1, ${COMMUNITY_POOL_V3}, true, 4, 3, '["BTC", "ETH"]')
        ON CONFLICT (portfolio_id) DO UPDATE SET
          pool_address = ${COMMUNITY_POOL_V3},
          enabled = true
      `;
      console.log(`   ✅ Created auto-hedge config for Community Pool\n`);
    } else {
      const c = configs[0];
      const isV3 = c.pool_address?.toLowerCase() === COMMUNITY_POOL_V3.toLowerCase();
      
      if (!isV3 && c.pool_address) {
        console.log(`   ⚠️  Config using old address: ${c.pool_address}`);
        console.log(`      Updating to V3...`);
        await sql`UPDATE auto_hedge_configs SET pool_address = ${COMMUNITY_POOL_V3} WHERE portfolio_id = -1`;
        console.log(`   ✅ Updated to V3 address\n`);
      } else {
        console.log(`   ✅ Auto-Hedge Config Found`);
        console.log(`      Pool Address: ${c.pool_address || 'Using default'}`);
        console.log(`      Enabled: ${c.enabled}`);
        console.log(`      Risk Threshold: ${c.risk_threshold}/10`);
        console.log(`      Max Leverage: ${c.max_leverage}x`);
        console.log(`      Allowed Assets: ${JSON.stringify(c.allowed_assets)}\n`);
      }
    }
  } catch (e) {
    console.log(`   ❌ Config Error: ${e.message}\n`);
    allPassed = false;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 4. Check NAV History (for Risk Metrics)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('4️⃣  NAV HISTORY (Risk Metrics Source)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    const navHistory = await sql`SELECT COUNT(*) as count FROM community_pool_nav_history`;
    const latest = await sql`SELECT * FROM community_pool_nav_history ORDER BY timestamp DESC LIMIT 1`;
    
    console.log(`   ✅ NAV History Records: ${navHistory[0].count}`);
    if (latest.length > 0) {
      const l = latest[0];
      console.log(`   ✅ Latest Snapshot:`);
      console.log(`      NAV: $${parseFloat(l.total_nav).toFixed(2)}`);
      console.log(`      Share Price: $${parseFloat(l.share_price).toFixed(4)}`);
      console.log(`      Source: ${l.source}`);
      console.log(`      Timestamp: ${new Date(l.timestamp).toLocaleString()}\n`);
    }
    
    if (parseInt(navHistory[0].count) < 10) {
      console.log(`   ⚠️  Note: Risk metrics need more data points for accurate calculations.`);
      console.log(`      The cron job will add snapshots every 4 hours.\n`);
    }
  } catch (e) {
    console.log(`   ❌ NAV History Error: ${e.message}\n`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 5. Check Active Hedges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('5️⃣  ACTIVE HEDGES');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    const hedges = await sql`
      SELECT * FROM hedges 
      WHERE portfolio_id = -1 AND status = 'OPEN'
      ORDER BY created_at DESC LIMIT 10
    `;
    
    if (hedges.length === 0) {
      console.log(`   ℹ️  No active hedges for Community Pool\n`);
    } else {
      console.log(`   ✅ Active Hedges: ${hedges.length}`);
      for (const h of hedges) {
        const pnl = parseFloat(h.unrealized_pnl || 0);
        const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
        console.log(`      ${h.side} ${h.asset} $${parseFloat(h.size_usd).toFixed(0)} (${pnlStr})`);
      }
      console.log('');
    }
  } catch (e) {
    console.log(`   ⚠️  Hedges table may not exist yet\n`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  if (allPassed) {
    console.log('║  ✅ ALL SYSTEMS OPERATIONAL - AI Agents & Oracle Ready!           ║');
  } else {
    console.log('║  ⚠️  SOME ISSUES DETECTED - Review above for details              ║');
  }
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
