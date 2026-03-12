/**
 * Configure CommunityPool with Mock DEX and Assets
 */
require('dotenv').config({ path: '.env.local' });
const { ethers } = require('hardhat');

const CONFIG = {
  communityPoolProxy: '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30',
  mockDEXRouter: '0xaf1e47949eF0fb7E04c5c258C99BAE4660Bcc3d9',
  
  assetTokens: [
    '0x851837c11DC08E127a1dF738A3a1AC9770c1D01e', // BTC (index 0)
    '0x8ef76152429665773f7646aF5b394295Ff3956E1', // ETH (index 1)
    '0x42117b8AC627F296c4095fB930A0DDcC38985429', // SUI (index 2)
    '0xb56D096A12f5b809EB2799A8d9060CE87fE44665', // CRO (index 3)
  ],
  
  pythPriceIds: [
    '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC
    '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH
    '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744', // SUI
    '0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71', // CRO
  ]
};

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  console.log('Configuring with account:', deployer.address);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'CRO');
  
  const pool = await ethers.getContractAt('CommunityPool', CONFIG.communityPoolProxy);
  
  // Check current state
  console.log('\n=== CURRENT STATE ===');
  const currentRouter = await pool.dexRouter();
  console.log('Current DEX Router:', currentRouter);
  
  // Set DEX router if not set
  if (currentRouter === '0x0000000000000000000000000000000000000000') {
    console.log('\n1. Setting DEX Router...');
    const tx1 = await pool.setDexRouter(CONFIG.mockDEXRouter);
    await tx1.wait();
    console.log('✅ DEX Router set to:', CONFIG.mockDEXRouter);
  } else {
    console.log('DEX Router already set');
  }
  
  // Configure asset tokens
  console.log('\n2. Configuring Asset Tokens...');
  const assets = ['BTC', 'ETH', 'SUI', 'CRO'];
  
  for (let i = 0; i < 4; i++) {
    const currentToken = await pool.assetTokens(i);
    if (currentToken === '0x0000000000000000000000000000000000000000') {
      console.log(`   Setting asset[${i}] (${assets[i]}): ${CONFIG.assetTokens[i]}`);
      try {
        const tx = await pool.setAssetToken(i, CONFIG.assetTokens[i]); // Only 2 args
        await tx.wait();
        console.log(`   ✅ Asset[${i}] set`);
      } catch (e) {
        console.log(`   ❌ Failed: ${e.message}`);
      }
    } else {
      console.log(`   Asset[${i}] already set: ${currentToken}`);
    }
  }
  
  // Verify configuration
  console.log('\n=== FINAL STATE ===');
  console.log('DEX Router:', await pool.dexRouter());
  
  for (let i = 0; i < 4; i++) {
    const token = await pool.assetTokens(i);
    const priceId = await pool.pythPriceIds(i);
    console.log(`Asset[${i}] (${assets[i]}): ${token}`);
    console.log(`  PriceId: ${priceId}`);
  }
  
  const stats = await pool.getPoolStats();
  console.log('\nPool NAV:', ethers.formatUnits(stats._totalNAV, 6), 'USDC');
  console.log('Share Price:', ethers.formatUnits(stats._sharePrice, 6), '$/share');
  
  console.log('\n✅ Pool is now configured for AI auto-management!');
}

main().catch(console.error);
