#!/usr/bin/env node
/**
 * Trigger immediate risk assessment and hedging for Community Pool
 * 
 * This script forces the AI to evaluate the current share price vs $1.00
 * and trigger protective hedging if needed.
 */

const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env.vercel.temp' });

const V3_PROXY = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const CRONOS_RPC = 'https://evm-t3.cronos.org';

const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
];

async function main() {
  console.log('\n' + '═'.repeat(65));
  console.log('  🚨 RISK ASSESSMENT TRIGGER');
  console.log('═'.repeat(65));

  // Get current pool stats
  const provider = new ethers.JsonRpcProvider(CRONOS_RPC);
  const contract = new ethers.Contract(V3_PROXY, POOL_ABI, provider);

  const stats = await contract.getPoolStats();
  const sharePrice = parseFloat(ethers.formatUnits(stats[3], 6));
  const totalNAV = parseFloat(ethers.formatUnits(stats[1], 6));

  console.log('\n📊 Current Pool State:');
  console.log(`   Share Price: $${sharePrice.toFixed(6)}`);
  console.log(`   Total NAV:   $${totalNAV.toLocaleString()}`);

  // Calculate deviation from $1.00
  const PAR_VALUE = 1.00;
  const deviation = PAR_VALUE - sharePrice;
  const deviationPercent = (deviation / PAR_VALUE) * 100;

  console.log(`\n⚠️  SHARE PRICE ANALYSIS:`);
  console.log(`   Par Value:   $${PAR_VALUE.toFixed(2)}`);
  console.log(`   Current:     $${sharePrice.toFixed(6)}`);
  console.log(`   Deviation:   ${deviationPercent >= 0 ? '-' : '+'}${Math.abs(deviationPercent).toFixed(2)}%`);

  if (deviationPercent > 0) {
    console.log(`\n🔴 SHARE PRICE IS ${deviationPercent.toFixed(2)}% BELOW PAR VALUE!`);
    console.log('   AI agents should be hedging to protect against further losses.');
    
    // Calculate expected risk score
    let riskScore = 1;
    if (deviationPercent >= 5) riskScore += 4;
    else if (deviationPercent >= 3) riskScore += 3;
    else if (deviationPercent >= 2) riskScore += 3;
    else if (deviationPercent >= 1) riskScore += 2;
    else riskScore += 1;

    console.log(`\n   Expected Risk Score: ${riskScore}/10`);
    console.log(`   Risk Threshold:      2/10`);
    console.log(`   Should Hedge:        ${riskScore >= 2 ? '✅ YES' : '❌ NO'}`);
  } else {
    console.log(`\n🟢 Share price is at or above par value - no hedging needed.`);
  }

  // Trigger the API endpoint
  console.log('\n' + '─'.repeat(65));
  console.log('🔄 Triggering pool-nav-monitor cron...\n');

  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.log('⚠️  CRON_SECRET not set - cannot trigger production cron');
    console.log('   To trigger manually in production:');
    console.log('   curl -H "Authorization: Bearer $CRON_SECRET" ' + baseUrl + '/api/cron/pool-nav-monitor');
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/api/cron/pool-nav-monitor`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
      },
    });

    if (response.ok) {
      const result = await response.json();
      console.log('✅ Pool NAV Monitor triggered successfully!');
      console.log('\n   Summary:');
      console.log('   - Pools checked:', result.summary?.totalPools || 1);
      console.log('   - Alerts:', result.alerts?.length || 0);
      
      if (result.alerts && result.alerts.length > 0) {
        console.log('\n   Alerts Generated:');
        result.alerts.forEach(a => console.log(`     [${a.severity}] ${a.message}`));
      }
    } else {
      console.log('❌ Failed to trigger cron:', response.status, await response.text());
    }
  } catch (e) {
    console.log('❌ Error:', e.message);
    console.log('   (Server may not be running locally)');
  }

  console.log('\n' + '═'.repeat(65));
  console.log('  📝 SUMMARY');
  console.log('═'.repeat(65));
  console.log(`
  Current share price ($${sharePrice.toFixed(4)}) is ${deviationPercent.toFixed(2)}% below $1.00.
  
  With the updated AI configuration:
  - Risk threshold lowered to 2/10 (from 3)
  - Share price deviation tracking added
  - More aggressive hedge triggers
  
  The AI should now:
  1. Detect share price below par
  2. Calculate elevated risk score (4+)
  3. Trigger protective SHORT hedges
  4. Switch positions to protect against further losses
  
  Next steps:
  1. Run 'npm run dev' to start local server
  2. Wait for pool-nav-monitor cron (every 15 min) or trigger manually
  3. Check database for new hedge positions
  `);

  console.log('═'.repeat(65) + '\n');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
