/**
 * Continue Mock DEX Configuration
 * 
 * Uses already-deployed contracts:
 * - MockBTC: 0x851837c11DC08E127a1dF738A3a1AC9770c1D01e
 * - MockETH: 0x8ef76152429665773f7646aF5b394295Ff3956E1
 * - MockCRO: 0xb56D096A12f5b809EB2799A8d9060CE87fE44665
 * - MockSUI: 0x42117b8AC627F296c4095fB930A0DDcC38985429
 * - MockDEXRouter: 0x4A48925e12159973C149c2034259C178F6Ea89BF
 * 
 * Run: npx hardhat run scripts/deploy/configure-mock-dex.js --network cronos-testnet
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

// Already deployed addresses
const DEPLOYED = {
  mockDEXRouter: '0x4A48925e12159973C149c2034259C178F6Ea89BF',
  mockBTC: '0x851837c11DC08E127a1dF738A3a1AC9770c1D01e',
  mockETH: '0x8ef76152429665773f7646aF5b394295Ff3956E1',
  mockCRO: '0xb56D096A12f5b809EB2799A8d9060CE87fE44665',
  mockSUI: '0x42117b8AC627F296c4095fB930A0DDcC38985429',
};

const CONFIG = {
  communityPool: '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B',
  mockUSDC: '0x28217DAddC55e3C4831b4A48A00Ce04880786967',
  
  // Pyth mainnet price feed IDs (work on all networks)
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

const MOCK_WRAPPED_TOKEN_ABI = [
  'function setMinter(address minter, bool allowed) external',
  'function minters(address) view returns (bool)',
  'function owner() view returns (address)',
];

const MOCK_DEX_ROUTER_ABI = [
  'function configureAsset(uint8 assetIndex, address token, bytes32 priceId, uint8 tokenDecimals) external',
  'function pythPriceIds(uint8) view returns (bytes32)',
  'function assetTokens(uint8) view returns (address)',
  'function fundUSDC(uint256 amount) external',
  'function owner() view returns (address)',
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Configuring mock DEX with account:', deployer.address);
  
  const tokens = {
    BTC: DEPLOYED.mockBTC,
    ETH: DEPLOYED.mockETH,
    CRO: DEPLOYED.mockCRO,
    SUI: DEPLOYED.mockSUI,
  };
  const assets = ['BTC', 'ETH', 'CRO', 'SUI'];
  const routerAddress = DEPLOYED.mockDEXRouter;
  
  // Get router contract
  const router = await ethers.getContractAt(MOCK_DEX_ROUTER_ABI, routerAddress);
  
  // Step 4: Configure assets
  console.log('\n4. Configuring assets in MockDEXRouter...');
  
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    console.log(`   Configuring ${asset}...`);
    
    // First, grant minter role to router (must be called by token owner = deployer)
    const tokenContract = await ethers.getContractAt(MOCK_WRAPPED_TOKEN_ABI, tokens[asset]);
    
    // Check if already a minter
    const isMinter = await tokenContract.minters(routerAddress);
    if (!isMinter) {
      const mintTx = await tokenContract.setMinter(routerAddress, true);
      await mintTx.wait();
      console.log(`   ✅ ${asset} minter role granted to router`);
    } else {
      console.log(`   ✅ ${asset} already has minter role`);
    }
    
    // Check if already configured
    const currentToken = await router.assetTokens(i);
    if (currentToken.toLowerCase() !== tokens[asset].toLowerCase()) {
      const tx = await router.configureAsset(
        i,
        tokens[asset],
        CONFIG.pythPriceIds[asset],
        CONFIG.decimals[asset]
      );
      await tx.wait();
      console.log(`   ✅ ${asset} configured with Pyth price feed`);
    } else {
      console.log(`   ✅ ${asset} already configured in router`);
    }
  }
  
  // Step 5: Fund router with USDC
  console.log('\n5. Funding MockDEXRouter with USDC...');
  
  const mockUSDC = await ethers.getContractAt([
    'function mint(address to, uint256 amount) external',
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function balanceOf(address) view returns (uint256)',
  ], CONFIG.mockUSDC);
  
  // Check current balance
  const routerBalance = await mockUSDC.balanceOf(routerAddress);
  console.log(`   Router USDC balance: ${ethers.formatUnits(routerBalance, 6)}`);
  
  if (routerBalance < ethers.parseUnits('100000', 6)) {
    // Mint USDC to deployer
    const fundAmount = ethers.parseUnits('1000000', 6);
    let tx = await mockUSDC.mint(deployer.address, fundAmount);
    await tx.wait();
    console.log('   Minted 1M USDC to deployer');
    
    // Approve and fund router
    tx = await mockUSDC.approve(routerAddress, fundAmount);
    await tx.wait();
    tx = await router.fundUSDC(fundAmount);
    await tx.wait();
    console.log('   ✅ Funded router with 1M USDC');
  } else {
    console.log('   ✅ Router already has sufficient USDC');
  }
  
  // Step 6: Configure CommunityPool
  console.log('\n6. Configuring CommunityPool...');
  
  const pool = await ethers.getContractAt([
    'function setDexRouter(address) external',
    'function configureAsset(uint8,address,uint8) external',
    'function configurePythFeed(uint8,bytes32) external',
    'function dexRouter() view returns (address)',
    'function assetTokens(uint8) view returns (address)',
    'function pythPriceIds(uint8) view returns (bytes32)',
  ], CONFIG.communityPool);
  
  // Check/Set DEX router
  const currentRouter = await pool.dexRouter();
  if (currentRouter.toLowerCase() !== routerAddress.toLowerCase()) {
    console.log('   Setting DEX router...');
    const tx = await pool.setDexRouter(routerAddress);
    await tx.wait();
    console.log('   ✅ DEX router set');
  } else {
    console.log('   ✅ DEX router already set');
  }
  
  // Configure each asset token and Pyth feed
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    console.log(`   Configuring ${asset} in pool...`);
    
    try {
      // Configure asset token
      const currentAsset = await pool.assetTokens(i);
      if (currentAsset.toLowerCase() !== tokens[asset].toLowerCase()) {
        const tx1 = await pool.configureAsset(i, tokens[asset], CONFIG.decimals[asset]);
        await tx1.wait();
        console.log(`   ✅ ${asset} token configured`);
      } else {
        console.log(`   ✅ ${asset} token already configured`);
      }
    } catch (e) {
      console.log(`   ⚠️  ${asset} token config: ${e.message.slice(0, 50)}...`);
    }
    
    try {
      // Configure Pyth feed
      const tx2 = await pool.configurePythFeed(i, CONFIG.pythPriceIds[asset]);
      await tx2.wait();
      console.log(`   ✅ ${asset} Pyth feed configured`);
    } catch (e) {
      console.log(`   ⚠️  ${asset} Pyth config: ${e.message.slice(0, 50)}...`);
    }
  }
  
  // Verify configuration
  console.log('\n7. Verifying configuration...');
  console.log(`   DEX Router: ${await pool.dexRouter()}`);
  
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    try {
      const tokenAddr = await pool.assetTokens(i);
      const priceId = await pool.pythPriceIds(i);
      console.log(`   ${asset}: token=${tokenAddr.slice(0,10)}..., priceId=${priceId.slice(0, 18)}...`);
    } catch (e) {
      console.log(`   ${asset}: ERROR - ${e.message.slice(0, 50)}`);
    }
  }
  
  // Save deployment
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
  console.log('MOCK DEX CONFIGURATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`MockDEXRouter: ${routerAddress}`);
  console.log(`MockBTC:       ${tokens.BTC}`);
  console.log(`MockETH:       ${tokens.ETH}`);
  console.log(`MockCRO:       ${tokens.CRO}`);
  console.log(`MockSUI:       ${tokens.SUI}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Configuration failed:', error);
    process.exit(1);
  });
