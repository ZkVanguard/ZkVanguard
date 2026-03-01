const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log('Address:', deployer.address);
  console.log('Balance:', hre.ethers.formatEther(balance), 'ROSE');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
