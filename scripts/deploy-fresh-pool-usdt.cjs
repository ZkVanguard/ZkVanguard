/**
 * Deploy proper USDT token (no Mock prefix) and fresh CommunityPool
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('=== DEPLOYING TETHER USD (USDT) ===\n');
  
  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'TCRO\n');
  
  // Deploy MockERC20 but with proper Tether naming (no "Mock")
  const MockERC20 = await ethers.getContractFactory('MockERC20');
  console.log('Deploying USDT (Tether USD, USDT, 6 decimals)...');
  
  const usdt = await MockERC20.deploy('Tether USD', 'USDT', 6);
  await usdt.waitForDeployment();
  
  const usdtAddress = await usdt.getAddress();
  console.log('USDT deployed at:', usdtAddress);
  
  // Verify on-chain
  const name = await usdt.name();
  const symbol = await usdt.symbol();
  const decimals = await usdt.decimals();
  console.log('\nVerification:');
  console.log('  Name:', name);
  console.log('  Symbol:', symbol);
  console.log('  Decimals:', decimals);
  
  // Mint initial supply
  const mintAmount = ethers.parseUnits('10000000', 6); // 10M USDT
  console.log('\nMinting 10,000,000 USDT to deployer...');
  await usdt.mint(deployer.address, mintAmount);
  console.log('Minted! Balance:', ethers.formatUnits(await usdt.balanceOf(deployer.address), 6), 'USDT');
  
  // Deploy fresh CommunityPool
  console.log('\n=== DEPLOYING FRESH COMMUNITY POOL ===\n');
  
  const CommunityPool = await ethers.getContractFactory('CommunityPool');
  console.log('Deploying CommunityPool with USDT as deposit token...');
  
  const pool = await CommunityPool.deploy(usdtAddress);
  await pool.waitForDeployment();
  
  const poolAddress = await pool.getAddress();
  console.log('CommunityPool deployed at:', poolAddress);
  
  // Verify pool config
  const depositToken = await pool.depositToken();
  console.log('Pool deposit token:', depositToken);
  console.log('Pool deposit token matches USDT:', depositToken.toLowerCase() === usdtAddress.toLowerCase());
  
  // Initialize pool with default settings
  console.log('\nInitializing pool...');
  
  // Set minimum deposit to 10 USDT
  const minDeposit = ethers.parseUnits('10', 6);
  await pool.setMinimumDeposit(minDeposit);
  console.log('Set minimum deposit: 10 USDT');
  
  // Deployer deposits initial amount to bootstrap the pool
  console.log('\nBootstrapping pool with initial deposit...');
  const initialDeposit = ethers.parseUnits('10000', 6); // 10K USDT
  
  // Approve and deposit
  await usdt.approve(poolAddress, initialDeposit);
  await pool.deposit(initialDeposit);
  console.log('Deposited 10,000 USDT to bootstrap pool');
  
  // Check pool state
  const tvl = await pool.totalValueLocked();
  const members = await pool.memberCount();
  console.log('\nPool state:');
  console.log('  TVL:', ethers.formatUnits(tvl, 6), 'USDT');
  console.log('  Members:', members.toString());
  
  // Update deployment file
  const deploymentPath = path.join(__dirname, '../deployments/cronos-testnet.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  
  // Update references
  deployment.tetherWDK = {
    description: 'Tether WDK USDT integration',
    usdt: usdtAddress,
    note: 'Tether USD on Cronos Testnet (6 decimals)'
  };
  deployment.USDT = usdtAddress;
  deployment.CommunityPool = poolAddress;
  deployment.lastDeployment = new Date().toISOString();
  
  // Remove old Mock references
  delete deployment.MockUSDC;
  delete deployment.MockUSDT;
  
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log('\nUpdated deployments/cronos-testnet.json');
  
  // Also update community-pool.json
  const poolDeploymentPath = path.join(__dirname, '../deployments/community-pool.json');
  if (fs.existsSync(poolDeploymentPath)) {
    const poolDeployment = JSON.parse(fs.readFileSync(poolDeploymentPath, 'utf8'));
    poolDeployment['cronos-testnet'] = {
      pool: poolAddress,
      depositToken: usdtAddress,
      depositTokenName: 'Tether USD',
      depositTokenSymbol: 'USDT',
      deployedAt: new Date().toISOString()
    };
    fs.writeFileSync(poolDeploymentPath, JSON.stringify(poolDeployment, null, 2));
    console.log('Updated deployments/community-pool.json');
  }
  
  console.log('\n=== DEPLOYMENT COMPLETE ===');
  console.log('USDT Token:', usdtAddress);
  console.log('CommunityPool:', poolAddress);
  console.log('\nThe pool is ready with 10,000 USDT TVL');
  
  return { usdt: usdtAddress, pool: poolAddress };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
