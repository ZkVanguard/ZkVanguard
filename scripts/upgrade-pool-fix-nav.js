/**
 * Upgrade CommunityPool V3 Proxy and Reset Asset Balances
 * 
 * This script:
 * 1. Upgrades the CommunityPool proxy to the new implementation with resetAssetBalance
 * 2. Calls resetAssetBalance(255) to clear all corrupted asset balances
 */

const { ethers, upgrades, network } = require('hardhat');

const PROXY_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';

async function main() {
  console.log('🔄 Upgrading CommunityPool...');
  console.log('   Proxy:', PROXY_ADDRESS);
  console.log('   Network:', network.name);
  
  // Get deployer from hardhat config
  const signers = await ethers.getSigners();
  if (!signers || signers.length === 0) {
    throw new Error('No signers available. Check PRIVATE_KEY in hardhat.config.cjs');
  }
  const deployer = signers[0];
  console.log('   Deployer:', deployer.address);
  
  // Check balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('   Balance:', ethers.formatEther(balance), 'CRO');
  
  if (balance === 0n) {
    throw new Error('Deployer has no CRO for gas');
  }
  
  // Check current NAV before fix
  const abi = ['function calculateTotalNAV() view returns (uint256)', 'function assetBalances(uint256) view returns (uint256)'];
  const poolBefore = new ethers.Contract(PROXY_ADDRESS, abi, deployer);
  
  const navBefore = await poolBefore.calculateTotalNAV();
  const btcBalBefore = await poolBefore.assetBalances(0);
  console.log('\n📊 Before Upgrade:');
  console.log('   NAV:', ethers.formatUnits(navBefore, 6), 'USD');
  console.log('   BTC Balance:', btcBalBefore.toString());
  
  // Get the CommunityPool factory
  const CommunityPool = await ethers.getContractFactory('CommunityPool');
  
  // Validate upgrade compatibility (optional but recommended)
  console.log('\n🔍 Validating upgrade...');
  try {
    await upgrades.validateUpgrade(PROXY_ADDRESS, CommunityPool, {
      kind: 'uups',
    });
    console.log('   ✅ Upgrade validation passed');
  } catch (e) {
    console.log('   ⚠️ Validation warning:', e.message.slice(0, 100));
  }
  
  // Perform the upgrade
  console.log('\n🚀 Performing upgrade...');
  const upgraded = await upgrades.upgradeProxy(PROXY_ADDRESS, CommunityPool, {
    kind: 'uups',
  });
  await upgraded.waitForDeployment();
  
  const implAddress = await upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  console.log('   ✅ Upgraded! New implementation:', implAddress);
  
  // Now call resetAssetBalance(255) to clear all
  console.log('\n🧹 Resetting asset balances...');
  const pool = upgraded;
  
  const tx = await pool.resetAssetBalance(255);
  console.log('   TX Hash:', tx.hash);
  await tx.wait();
  console.log('   ✅ Asset balances reset');
  
  // Verify the fix
  const navAfter = await pool.calculateTotalNAV();
  const btcBalAfter = await pool.assetBalances(0);
  console.log('\n📊 After Fix:');
  console.log('   NAV:', ethers.formatUnits(navAfter, 6), 'USD');
  console.log('   BTC Balance:', btcBalAfter.toString());
  
  console.log('\n✅ CommunityPool upgrade and asset balance reset complete!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });
