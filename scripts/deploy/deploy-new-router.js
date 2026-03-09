/**
 * Deploy NEW MockDEXRouter and Configure CommunityPool
 * 
 * Uses already-deployed token contracts but deploys a fresh router
 * 
 * Run: npx hardhat run scripts/deploy/deploy-new-router.js --network cronos-testnet
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

// Already deployed addresses
const DEPLOYED_TOKENS = {
  BTC: '0x851837c11DC08E127a1dF738A3a1AC9770c1D01e',
  ETH: '0x8ef76152429665773f7646aF5b394295Ff3956E1',
  CRO: '0xb56D096A12f5b809EB2799A8d9060CE87fE44665',
  SUI: '0x42117b8AC627F296c4095fB930A0DDcC38985429',
};

const CONFIG = {
  communityPool: '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B',
  mockUSDC: '0x28217DAddC55e3C4831b4A48A00Ce04880786967',
  pythOracle: '0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320',
  
  pythPriceIds: {
    BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    CRO: '0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71',
    SUI: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
  },
  
  decimals: {
    BTC: 8,
    ETH: 18,
    CRO: 18,
    SUI: 9,
  }
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying with account:', deployer.address);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'CRO');
  
  const assets = ['BTC', 'ETH', 'CRO', 'SUI'];
  
  // Deploy NEW MockDEXRouter
  console.log('\n1. Deploying NEW MockDEXRouter...');
  const MockDEXRouter = await ethers.getContractFactory('MockDEXRouter');
  const router = await MockDEXRouter.deploy(CONFIG.pythOracle, CONFIG.mockUSDC);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log('   ✅ NEW MockDEXRouter deployed at:', routerAddress);
  
  // Grant minter roles and configure router
  console.log('\n2. Granting minter roles to router...');
  
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const tokenAddr = DEPLOYED_TOKENS[asset];
    console.log(`   Configuring ${asset}...`);
    
    const token = await ethers.getContractAt('MockWrappedToken', tokenAddr);
    
    // Grant minter role
    let tx = await token.setMinter(routerAddress, true);
    await tx.wait();
    console.log(`   ✅ ${asset} minter role granted`);
    
    // Configure in router
    tx = await router.configureAsset(
      i,
      tokenAddr,
      CONFIG.pythPriceIds[asset],
      CONFIG.decimals[asset]
    );
    await tx.wait();
    console.log(`   ✅ ${asset} configured in router`);
  }
  
  // Fund router with USDC
  console.log('\n3. Funding router with USDC...');
  const mockUSDC = await ethers.getContractAt([
    'function mint(address,uint256) external',
    'function approve(address,uint256) external returns (bool)',
    'function balanceOf(address) view returns (uint256)',
  ], CONFIG.mockUSDC);
  
  const fundAmount = ethers.parseUnits('1000000', 6);
  let tx = await mockUSDC.mint(deployer.address, fundAmount);
  await tx.wait();
  tx = await mockUSDC.approve(routerAddress, fundAmount);
  await tx.wait();
  tx = await router.fundUSDC(fundAmount);
  await tx.wait();
  console.log('   ✅ Funded router with 1M USDC');
  
  // Configure CommunityPool
  console.log('\n4. Configuring CommunityPool...');
  const pool = await ethers.getContractAt([
    'function setDexRouter(address) external',
    'function configureAsset(uint8,address,uint8) external',
    'function configurePythFeed(uint8,bytes32) external',
    'function dexRouter() view returns (address)',
    'function assetTokens(uint8) view returns (address)',
    'function pythPriceIds(uint8) view returns (bytes32)',
  ], CONFIG.communityPool);
  
  // Set DEX router
  tx = await pool.setDexRouter(routerAddress);
  await tx.wait();
  console.log('   ✅ DEX router set');
  
  // Configure each asset
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    console.log(`   Configuring ${asset} in pool...`);
    
    try {
      tx = await pool.configureAsset(i, DEPLOYED_TOKENS[asset], CONFIG.decimals[asset]);
      await tx.wait();
      console.log(`   ✅ ${asset} token configured`);
    } catch (e) {
      console.log(`   ⚠️  ${asset} token: ${e.message?.slice(0, 60) || 'error'}`);
    }
    
    try {
      tx = await pool.configurePythFeed(i, CONFIG.pythPriceIds[asset]);
      await tx.wait();
      console.log(`   ✅ ${asset} Pyth feed configured`);
    } catch (e) {
      console.log(`   ⚠️  ${asset} Pyth: ${e.message?.slice(0, 60) || 'error'}`);
    }
  }
  
  // Verify
  console.log('\n5. Verifying configuration...');
  console.log(`   DEX Router: ${await pool.dexRouter()}`);
  for (let i = 0; i < assets.length; i++) {
    try {
      const t = await pool.assetTokens(i);
      const p = await pool.pythPriceIds(i);
      console.log(`   ${assets[i]}: token=${t.slice(0,10)}... priceId=${p.slice(0,18)}...`);
    } catch (e) {
      console.log(`   ${assets[i]}: ERROR`);
    }
  }
  
  // Save deployment
  const deployment = {
    network: 'cronos-testnet',
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      mockDEXRouter: routerAddress,
      mockBTC: DEPLOYED_TOKENS.BTC,
      mockETH: DEPLOYED_TOKENS.ETH,
      mockCRO: DEPLOYED_TOKENS.CRO,
      mockSUI: DEPLOYED_TOKENS.SUI,
    },
    pythPriceIds: CONFIG.pythPriceIds,
    communityPool: CONFIG.communityPool,
  };
  
  const deploymentPath = path.join(__dirname, '../../deployments/mock-dex-testnet.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`\n✅ Saved to ${deploymentPath}`);
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('MOCK DEX DEPLOYED & CONFIGURED');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`MockDEXRouter: ${routerAddress}`);
  console.log('CommunityPool can now execute on-chain trades with Pyth prices!');
  console.log('═══════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
