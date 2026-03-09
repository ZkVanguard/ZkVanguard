/**
 * Upgrade CommunityPool and Configure Mock DEX Assets
 * 
 * 1. Deploys new implementation with setAssetToken() function
 * 2. Upgrades the proxy
 * 3. Configures asset tokens and Pyth price IDs
 * 
 * Run: npx hardhat run scripts/deploy/upgrade-pool-mock-dex.js --network cronos-testnet
 */

const { ethers, upgrades } = require('hardhat');
const fs = require('fs');
const path = require('path');

// Deployed addresses
const CONFIG = {
  communityPoolProxy: '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B',
  mockDEXRouter: '0xaf1e47949eF0fb7E04c5c258C99BAE4660Bcc3d9',
  
  assetTokens: {
    BTC: '0x851837c11DC08E127a1dF738A3a1AC9770c1D01e',
    ETH: '0x8ef76152429665773f7646aF5b394295Ff3956E1',
    SUI: '0x42117b8AC627F296c4095fB930A0DDcC38985429',
    CRO: '0xb56D096A12f5b809EB2799A8d9060CE87fE44665',
  },
  
  // Pyth price IDs - order: BTC(0), ETH(1), SUI(2), CRO(3)
  pythPriceIds: [
    '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC
    '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH
    '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744', // SUI
    '0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71', // CRO
  ]
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Upgrading with account:', deployer.address);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'CRO');
  
  const assets = ['BTC', 'ETH', 'SUI', 'CRO']; // Order: 0=BTC, 1=ETH, 2=SUI, 3=CRO
  
  // Step 1: Deploy new implementation
  console.log('\n1. Deploying new CommunityPool implementation...');
  
  const CommunityPool = await ethers.getContractFactory('CommunityPool');
  
  // Upgrade the proxy
  const upgraded = await upgrades.upgradeProxy(CONFIG.communityPoolProxy, CommunityPool, {
    unsafeAllow: ['delegatecall'],
    redeployImplementation: 'always',
  });
  await upgraded.waitForDeployment();
  
  const newImpl = await upgrades.erc1967.getImplementationAddress(CONFIG.communityPoolProxy);
  console.log('   ✅ Upgraded! New implementation:', newImpl);
  
  // Step 2: Configure asset tokens
  console.log('\n2. Configuring asset tokens...');
  
  const pool = await ethers.getContractAt('CommunityPool', CONFIG.communityPoolProxy);
  
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const tokenAddr = CONFIG.assetTokens[asset];
    console.log(`   Setting ${asset} (index ${i}) = ${tokenAddr.slice(0,10)}...`);
    
    try {
      const tx = await pool.setAssetToken(i, tokenAddr);
      await tx.wait();
      console.log(`   ✅ ${asset} token configured`);
    } catch (e) {
      console.log(`   ⚠️  ${asset}: ${e.message?.slice(0, 60) || 'error'}`);
    }
  }
  
  // Step 3: Configure Pyth price IDs
  console.log('\n3. Configuring Pyth price IDs...');
  
  try {
    const tx = await pool.setAllPriceIds(CONFIG.pythPriceIds);
    await tx.wait();
    console.log('   ✅ All Pyth price IDs configured');
  } catch (e) {
    console.log(`   ⚠️  Pyth IDs: ${e.message?.slice(0, 60) || 'error'}`);
  }
  
  // Step 4: Verify configuration
  console.log('\n4. Verifying configuration...');
  
  console.log(`   DEX Router: ${await pool.dexRouter()}`);
  
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    try {
      const tokenAddr = await pool.assetTokens(i);
      const priceId = await pool.pythPriceIds(i);
      const decimals = await pool.assetDecimals(i);
      console.log(`   ${asset}: token=${tokenAddr.slice(0,10)}..., decimals=${decimals}, priceId=${priceId.slice(0,18)}...`);
    } catch (e) {
      console.log(`   ${asset}: ERROR`);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('COMMUNITY POOL UPGRADED & CONFIGURED');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Proxy: ${CONFIG.communityPoolProxy}`);
  console.log(`New Implementation: ${newImpl}`);
  console.log('');
  console.log('CommunityPool is now ready for:');
  console.log('  - executeRebalanceTrade() with mock DEX + Pyth prices');
  console.log('  - On-chain portfolio rebalancing');
  console.log('  - Real market-adjusted NAV and share price');
  console.log('═══════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Upgrade failed:', error);
    process.exit(1);
  });
