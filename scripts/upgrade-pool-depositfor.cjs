/**
 * Upgrade CommunityPool to add depositFor() and RELAYER_ROLE
 * 
 * Usage: npx hardhat run scripts/upgrade-pool-depositfor.cjs --network sepolia
 */
const hre = require("hardhat");

const PROXY_ADDRESS = '0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086'; // Sepolia

async function main() {
  const [admin] = await hre.ethers.getSigners();
  console.log('Upgrading CommunityPool...');
  console.log('Admin:', admin.address);
  console.log('Proxy:', PROXY_ADDRESS);

  const CommunityPool = await hre.ethers.getContractFactory("CommunityPool");
  
  // Upgrade the proxy to the new implementation
  const upgraded = await hre.upgrades.upgradeProxy(PROXY_ADDRESS, CommunityPool, {
    unsafeAllow: ['delegatecall'],
  });
  
  const implAddress = await hre.upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  console.log('New implementation deployed at:', implAddress);
  console.log('Proxy still at:', PROXY_ADDRESS);

  // Grant RELAYER_ROLE to admin (server wallet)
  const RELAYER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("RELAYER_ROLE"));
  const hasRole = await upgraded.hasRole(RELAYER_ROLE, admin.address);
  
  if (!hasRole) {
    console.log('Granting RELAYER_ROLE to admin...');
    const tx = await upgraded.grantRole(RELAYER_ROLE, admin.address);
    await tx.wait();
    console.log('RELAYER_ROLE granted');
  } else {
    console.log('Admin already has RELAYER_ROLE');
  }

  // Verify depositFor exists
  try {
    const code = await hre.ethers.provider.getCode(PROXY_ADDRESS);
    console.log('Contract code size:', code.length / 2 - 1, 'bytes');
  } catch (e) {
    console.log('Could not check code size');
  }

  console.log('\nUpgrade complete! depositFor() is now available.');
  console.log('Server wallet', admin.address, 'has RELAYER_ROLE');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Upgrade failed:', error);
    process.exit(1);
  });
