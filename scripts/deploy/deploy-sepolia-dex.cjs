/**
 * Deploy SimpleMockDEX + Asset Tokens on Sepolia
 * 
 * This allows the Community Pool to swap USDT → BTC/ETH/CRO/SUI
 * 
 * Run: npx hardhat run scripts/deploy/deploy-sepolia-dex.cjs --network sepolia
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  // Sepolia Community Pool (WDK USDT)
  communityPool: '0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086',
  
  // WDK USDT on Sepolia
  usdt: '0xd077a400968890eacc75cdc901f0356c943e4fdb',
  
  // Token configs
  assets: [
    { name: 'Mock Bitcoin', symbol: 'mBTC', decimals: 8, price: 100000 * 1e6 },  // $100,000
    { name: 'Mock Ethereum', symbol: 'mETH', decimals: 18, price: 2500 * 1e6 },   // $2,500
    { name: 'Mock Cronos', symbol: 'mCRO', decimals: 18, price: 1e5 },            // $0.10
    { name: 'Mock Sui', symbol: 'mSUI', decimals: 9, price: 35 * 1e5 },           // $3.50
  ],
  
  // Target allocation percentages (must sum to 100)
  targetAllocation: {
    BTC: 30,
    ETH: 30,
    CRO: 20,
    SUI: 20,
  }
};

const POOL_ABI = [
  'function dexRouter() view returns (address)',
  'function setDexRouter(address) external',
  'function assetTokens(uint8) view returns (address)',
  'function setAssetToken(uint8 assetIndex, address token) external',
  'function owner() view returns (address)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function REBALANCER_ROLE() view returns (bytes32)',
  'function grantRole(bytes32 role, address account) external',
  'function depositToken() view returns (address)',
];

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║    SEPOLIA SimpleMockDEX + Asset Tokens Deployment         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Deployer:', deployer.address);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'ETH');
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 1. DEPLOY MOCK ASSET TOKENS
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 1: Deploy Mock Asset Tokens ═══');
  
  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const tokens = [];
  
  for (let i = 0; i < CONFIG.assets.length; i++) {
    const asset = CONFIG.assets[i];
    console.log(`   Deploying ${asset.symbol}...`);
    
    const token = await MockERC20.deploy(asset.name, asset.symbol, asset.decimals);
    await token.waitForDeployment();
    const address = await token.getAddress();
    
    tokens.push({ ...asset, address });
    console.log(`   ✅ ${asset.symbol} deployed at: ${address}`);
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 2. DEPLOY SimpleMockDEX
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 2: Deploy SimpleMockDEX ═══');
  
  const SimpleMockDEX = await ethers.getContractFactory('SimpleMockDEX');
  const dex = await SimpleMockDEX.deploy(CONFIG.usdt);
  await dex.waitForDeployment();
  const dexAddress = await dex.getAddress();
  
  // Get the deployed contract instance with proper ABI
  const dexContract = await ethers.getContractAt('SimpleMockDEX', dexAddress);
  
  console.log(`   ✅ SimpleMockDEX deployed at: ${dexAddress}`);
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 3. CONFIGURE DEX WITH ASSET TOKENS
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 3: Configure DEX Assets ═══');
  
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    console.log(`   Configuring ${token.symbol} (index ${i})...`);
    
    // Convert to proper types
    const assetIndex = i;
    const tokenAddress = token.address;
    const decimals = token.decimals;
    const priceInUsdc = BigInt(token.price);
    
    const tx = await dexContract.configureAsset(assetIndex, tokenAddress, decimals, priceInUsdc);
    await tx.wait();
    
    console.log(`   ✅ ${token.symbol}: price=$${(Number(priceInUsdc) / 1e6).toLocaleString()}, decimals=${decimals}`);
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 4. CONFIGURE COMMUNITY POOL
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 4: Configure Community Pool ═══');
  
  const pool = new ethers.Contract(CONFIG.communityPool, POOL_ABI, deployer);
  
  // Set DEX Router
  console.log('   Setting DEX Router...');
  const setRouterTx = await pool.setDexRouter(dexAddress);
  await setRouterTx.wait();
  console.log(`   ✅ DEX Router set to: ${dexAddress}`);
  
  // Set Asset Tokens
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    console.log(`   Setting asset token ${i} (${token.symbol})...`);
    
    const tx = await pool.setAssetToken(i, token.address);
    await tx.wait();
    console.log(`   ✅ Asset[${i}] = ${token.address}`);
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 5. SEED DEX WITH USDT LIQUIDITY
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 5: Seed DEX with USDT ═══');
  
  const usdt = await ethers.getContractAt('IERC20', CONFIG.usdt);
  const deployerUsdtBalance = await usdt.balanceOf(deployer.address);
  console.log(`   Deployer USDT: ${ethers.formatUnits(deployerUsdtBalance, 6)} USDT`);
  
  const seedAmount = ethers.parseUnits('1000', 6); // 1000 USDT for liquidity
  if (deployerUsdtBalance >= seedAmount) {
    console.log('   Seeding DEX with 1000 USDT...');
    const seedTx = await usdt.transfer(dexAddress, seedAmount);
    await seedTx.wait();
    console.log('   ✅ DEX seeded with 1000 USDT');
  } else {
    console.log('   ⚠️  Insufficient USDT to seed DEX (need 1000 USDT)');
    console.log('   DEX will need USDT to handle sell orders');
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 6. SAVE DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 6: Save Deployment ═══');
  
  const deployment = {
    network: 'sepolia',
    chainId: 11155111,
    timestamp: new Date().toISOString(),
    simpleMockDEX: dexAddress,
    usdt: CONFIG.usdt,
    communityPool: CONFIG.communityPool,
    assets: {
      BTC: { address: tokens[0].address, decimals: 8, price: 100000 },
      ETH: { address: tokens[1].address, decimals: 18, price: 2500 },
      CRO: { address: tokens[2].address, decimals: 18, price: 0.10 },
      SUI: { address: tokens[3].address, decimals: 9, price: 3.50 },
    },
    targetAllocation: CONFIG.targetAllocation,
  };
  
  const deploymentPath = path.join(__dirname, '../../deployments/sepolia-dex.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`   ✅ Saved to: ${deploymentPath}`);
  
  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    DEPLOYMENT COMPLETE                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('SimpleMockDEX:', dexAddress);
  console.log('');
  console.log('Asset Tokens:');
  console.log('  [0] mBTC:', tokens[0].address);
  console.log('  [1] mETH:', tokens[1].address);
  console.log('  [2] mCRO:', tokens[2].address);
  console.log('  [3] mSUI:', tokens[3].address);
  console.log('');
  console.log('Target Allocation: BTC 30%, ETH 30%, CRO 20%, SUI 20%');
  console.log('');
  console.log('Next steps:');
  console.log('1. Run: npx hardhat run scripts/execute-sepolia-rebalance.cjs --network sepolia');
  console.log('   This will swap pool USDT → 4 assets according to target allocation');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
