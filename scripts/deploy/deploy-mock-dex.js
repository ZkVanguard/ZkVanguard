/**
 * Deploy Mock DEX Infrastructure for CommunityPool
 * 
 * Deploys:
 * 1. MockWrappedToken contracts for BTC, ETH, CRO, SUI
 * 2. MockDEXRouter that uses Pyth oracle for pricing
 * 3. Configures CommunityPool to use the mock DEX
 * 
 * Run: npx hardhat run scripts/deploy/deploy-mock-dex.js --network cronosTestnet
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

// Addresses on Cronos Testnet
const CONFIG = {
  communityPool: '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B',
  mockUSDC: '0x28217DAddC55e3C4831b4A48A00Ce04880786967',
  pythOracle: '0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320',
  
  // Pyth mainnet price feed IDs (work on all networks)
  // https://pyth.network/developers/price-feed-ids
  pythPriceIds: {
    BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC/USD
    ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH/USD
    CRO: '0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71', // CRO/USD
    SUI: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744', // SUI/USD
  },
  
  // Token decimals
  decimals: {
    BTC: 8,
    ETH: 18,
    CRO: 18,
    SUI: 9,
  }
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying mock DEX infrastructure with account:', deployer.address);
  console.log('Account balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'CRO');
  
  // Compile contracts
  console.log('\n1. Compiling contracts...');
  
  // Deploy MockWrappedToken for each asset
  console.log('\n2. Deploying mock wrapped tokens...');
  
  const MockWrappedToken = await ethers.getContractFactory('MockWrappedToken');
  
  const tokens = {};
  const assets = ['BTC', 'ETH', 'CRO', 'SUI'];
  
  for (const asset of assets) {
    console.log(`   Deploying Mock${asset}...`);
    const token = await MockWrappedToken.deploy(
      `Mock Wrapped ${asset}`,
      `M${asset}`,
      CONFIG.decimals[asset]
    );
    await token.waitForDeployment();
    tokens[asset] = await token.getAddress();
    console.log(`   ✅ Mock${asset} deployed at: ${tokens[asset]}`);
  }
  
  // Deploy MockDEXRouter
  console.log('\n3. Deploying MockDEXRouter...');
  
  const MockDEXRouter = await ethers.getContractFactory('MockDEXRouter');
  const router = await MockDEXRouter.deploy(CONFIG.pythOracle, CONFIG.mockUSDC);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log('   ✅ MockDEXRouter deployed at:', routerAddress);
  
  // Configure assets in router
  console.log('\n4. Configuring assets in MockDEXRouter...');
  
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    console.log(`   Configuring ${asset}...`);
    
    // First, grant minter role to router (must be called by token owner = deployer)
    const tokenContract = await ethers.getContractAt('MockWrappedToken', tokens[asset]);
    const mintTx = await tokenContract.setMinter(routerAddress, true);
    await mintTx.wait();
    console.log(`   ✅ ${asset} minter role granted to router`);
    
    // Now configure in router (stores token address, price ID, decimals)
    const tx = await router.configureAsset(
      i, // assetIndex
      tokens[asset],
      CONFIG.pythPriceIds[asset],
      CONFIG.decimals[asset]
    );
    await tx.wait();
    console.log(`   ✅ ${asset} configured with Pyth price feed`);
  }
  
  // Fund router with USDC for sells
  console.log('\n5. Funding MockDEXRouter with USDC...');
  
  const mockUSDC = await ethers.getContractAt('MockUSDC', CONFIG.mockUSDC);
  
  // Mint USDC to deployer first
  const fundAmount = ethers.parseUnits('1000000', 6); // 1M USDC
  let tx = await mockUSDC.mint(deployer.address, fundAmount);
  await tx.wait();
  console.log('   Minted 1M USDC to deployer');
  
  // Approve and fund router
  tx = await mockUSDC.approve(routerAddress, fundAmount);
  await tx.wait();
  tx = await router.fundUSDC(fundAmount);
  await tx.wait();
  console.log('   ✅ Funded router with 1M USDC');
  
  // Configure CommunityPool
  console.log('\n6. Configuring CommunityPool...');
  
  const pool = await ethers.getContractAt([
    'function setDexRouter(address) external',
    'function configureAsset(uint8,address,uint8) external',
    'function configurePythFeed(uint8,bytes32) external',
    'function dexRouter() view returns (address)',
    'function assetTokens(uint8) view returns (address)',
    'function pythPriceIds(uint8) view returns (bytes32)',
  ], CONFIG.communityPool);
  
  // Set DEX router
  console.log('   Setting DEX router...');
  tx = await pool.setDexRouter(routerAddress);
  await tx.wait();
  console.log('   ✅ DEX router set');
  
  // Configure each asset token
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    console.log(`   Configuring asset ${asset} (index ${i})...`);
    
    tx = await pool.configureAsset(i, tokens[asset], CONFIG.decimals[asset]);
    await tx.wait();
    console.log(`   ✅ ${asset} token configured`);
    
    tx = await pool.configurePythFeed(i, CONFIG.pythPriceIds[asset]);
    await tx.wait();
    console.log(`   ✅ ${asset} Pyth feed configured`);
  }
  
  // Verify configuration
  console.log('\n7. Verifying configuration...');
  
  const dexRouter = await pool.dexRouter();
  console.log(`   DEX Router: ${dexRouter} (expected: ${routerAddress})`);
  
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const tokenAddr = await pool.assetTokens(i);
    const priceId = await pool.pythPriceIds(i);
    console.log(`   ${asset}: token=${tokenAddr}, priceId=${priceId.slice(0, 10)}...`);
  }
  
  // Save deployment addresses
  const deployment = {
    network: 'cronos-testnet',
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      mockDEXRouter: routerAddress,
      mockBTC: tokens.BTC,
      mockETH: tokens.ETH,
      mockCRO: tokens.CRO,
      mockSUI: tokens.SUI,
    },
    pythPriceIds: CONFIG.pythPriceIds,
    communityPool: CONFIG.communityPool,
  };
  
  const deploymentPath = path.join(__dirname, '../../deployments/mock-dex-testnet.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`\n✅ Deployment saved to ${deploymentPath}`);
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('MOCK DEX INFRASTRUCTURE DEPLOYED SUCCESSFULLY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`MockDEXRouter: ${routerAddress}`);
  console.log(`MockBTC:       ${tokens.BTC}`);
  console.log(`MockETH:       ${tokens.ETH}`);
  console.log(`MockCRO:       ${tokens.CRO}`);
  console.log(`MockSUI:       ${tokens.SUI}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\nCommunityPool can now execute real on-chain trades!');
  console.log('Share price will reflect actual market movements via Pyth oracle.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
