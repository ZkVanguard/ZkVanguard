const { ethers } = require("hardhat");

async function main() {
  const pool = await ethers.getContractAt('CommunityPool', '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30');
  
  console.log('\n=== POOL FEE & CONFIG STATUS ===\n');
  
  // Check fees
  try {
    const mgmtFees = await pool.accumulatedManagementFees();
    const perfFees = await pool.accumulatedPerformanceFees();
    const lastCollection = await pool.lastFeeCollection();
    
    console.log('Accumulated Management Fees:', ethers.formatUnits(mgmtFees, 6), 'USDC');
    console.log('Accumulated Performance Fees:', ethers.formatUnits(perfFees, 6), 'USDC');
    console.log('Last Fee Collection:', new Date(Number(lastCollection) * 1000).toISOString());
    console.log('Total Fees Pending:', ethers.formatUnits(mgmtFees + perfFees, 6), 'USDC');
  } catch (e) {
    console.log('Could not fetch fees:', e.message);
  }
  
  // Check configuration
  console.log('\n=== AI AUTO-MANAGEMENT STATUS ===\n');
  const treasury = await pool.treasury();
  const dexRouter = await pool.dexRouter();
  
  console.log('Treasury:', treasury);
  console.log('DEX Router:', dexRouter);
  
  // Check if DEX router is set (required for AI to trade)
  if (dexRouter === '0x0000000000000000000000000000000000000000') {
    console.log('\n❌ DEX Router NOT configured - AI CANNOT execute trades!');
    console.log('   The AI agent needs a DEX router to swap assets.');
    console.log('   Set via: pool.setDexRouter(routerAddress)');
  }
  
  // Check asset tokens
  console.log('\n=== ASSET CONFIGURATION ===');
  for (let i = 0; i < 4; i++) {
    try {
      const token = await pool.assetTokens(i);
      const balance = await pool.assetBalances(i);
      console.log(`Asset[${i}]: ${token} | Balance: ${ethers.formatUnits(balance, 18)}`);
    } catch (e) {
      console.log(`Asset[${i}]: Error - ${e.message}`);
    }
  }
  
  // Check Pyth price feeds
  console.log('\n=== PRICE FEED CONFIGURATION ===');
  for (let i = 0; i < 4; i++) {
    try {
      const priceId = await pool.pythPriceIds(i);
      console.log(`PriceId[${i}]: ${priceId}`);
    } catch (e) {
      console.log(`PriceId[${i}]: Error`);
    }
  }
  
  // Summary
  const stats = await pool.getPoolStats();
  console.log('\n=== SUMMARY ===');
  console.log('Total NAV:', ethers.formatUnits(stats._totalNAV, 6), 'USDC');
  console.log('Total Shares:', ethers.formatUnits(stats._totalShares, 18));
  console.log('Share Price:', ethers.formatUnits(stats._sharePrice, 6), '$/share');
  
  const expectedPrice = stats._totalShares > 0 ? (stats._totalNAV * BigInt(1e18)) / stats._totalShares : 0n;
  console.log('\nShare price dropped from $1.00 to $' + ethers.formatUnits(stats._sharePrice, 6));
  console.log('This is a decrease of:', (1 - Number(ethers.formatUnits(stats._sharePrice, 6))) * 100, '%');
}

main().catch(console.error);
