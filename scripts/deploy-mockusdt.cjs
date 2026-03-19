/**
 * Deploy MockUSDT token with correct name/symbol
 * Then update CommunityPool to use it as deposit token
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('=== DEPLOYING MOCK USDT ===\n');
  
  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'TCRO\n');
  
  // Deploy MockERC20 as "Mock USDT"
  const MockERC20 = await ethers.getContractFactory('MockERC20');
  console.log('Deploying MockUSDT (Mock USDT, USDT, 6 decimals)...');
  
  const mockUSDT = await MockERC20.deploy('Mock USDT', 'USDT', 6);
  await mockUSDT.waitForDeployment();
  
  const usdtAddress = await mockUSDT.getAddress();
  console.log('MockUSDT deployed at:', usdtAddress);
  
  // Verify on-chain
  const name = await mockUSDT.name();
  const symbol = await mockUSDT.symbol();
  const decimals = await mockUSDT.decimals();
  console.log('\nVerification:');
  console.log('  Name:', name);
  console.log('  Symbol:', symbol);
  console.log('  Decimals:', decimals);
  
  // Mint initial supply to deployer (1M USDT for testing)
  const mintAmount = ethers.parseUnits('1000000', 6); // 1M USDT
  console.log('\nMinting 1,000,000 USDT to deployer...');
  await mockUSDT.mint(deployer.address, mintAmount);
  console.log('Minted! Balance:', ethers.formatUnits(await mockUSDT.balanceOf(deployer.address), 6), 'USDT');
  
  // Update deployment file
  const deploymentPath = path.join(__dirname, '../deployments/cronos-testnet.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  
  // Update the USDT reference
  deployment.tetherWDK.usdt = usdtAddress;
  deployment.tetherWDK.note = 'MockUSDT on Cronos Testnet (6 decimals) - Proper USDT token';
  deployment.MockUSDT = usdtAddress;
  deployment.lastDeployment = new Date().toISOString();
  
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log('\nUpdated deployments/cronos-testnet.json');
  
  // Now update the CommunityPool to use this new USDT
  const poolAddress = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
  console.log('\n=== UPDATING COMMUNITY POOL ===');
  console.log('Pool address:', poolAddress);
  
  // Get pool contract
  const poolAbi = [
    'function depositToken() view returns (address)',
    'function setDepositToken(address _token) external',
    'function owner() view returns (address)',
    'function hasRole(bytes32 role, address account) view returns (bool)',
    'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  ];
  
  const pool = new ethers.Contract(poolAddress, poolAbi, deployer);
  
  // Check current deposit token
  const currentToken = await pool.depositToken();
  console.log('Current deposit token:', currentToken);
  
  // Check if we have admin role
  const adminRole = await pool.DEFAULT_ADMIN_ROLE();
  const isAdmin = await pool.hasRole(adminRole, deployer.address);
  console.log('Deployer is admin:', isAdmin);
  
  if (isAdmin) {
    console.log('\nSetting new deposit token to MockUSDT...');
    const tx = await pool.setDepositToken(usdtAddress);
    await tx.wait();
    console.log('Deposit token updated!');
    
    // Verify
    const newToken = await pool.depositToken();
    console.log('New deposit token:', newToken);
  } else {
    console.log('\n⚠️ Not admin - cannot update deposit token');
    console.log('Please manually call setDepositToken(' + usdtAddress + ')');
  }
  
  console.log('\n=== DONE ===');
  console.log('MockUSDT:', usdtAddress);
  
  return usdtAddress;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
