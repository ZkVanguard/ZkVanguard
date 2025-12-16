/**
 * Fund gasless contract for continued operation
 */

const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const CONTRACT = '0x52903d1FA10F90e9ec88DD7c3b1F0F73A0f811f9';
  
  console.log('\n💰 Funding Gasless Contract');
  console.log('============================\n');
  
  const balanceBefore = await hre.ethers.provider.getBalance(CONTRACT);
  console.log('Current balance:', hre.ethers.formatEther(balanceBefore), 'TCRO');
  
  const fundAmount = hre.ethers.parseEther('10'); // Add 10 TCRO
  console.log('\nSending:', hre.ethers.formatEther(fundAmount), 'TCRO...');
  
  const tx = await deployer.sendTransaction({
    to: CONTRACT,
    value: fundAmount,
  });
  
  await tx.wait();
  
  const balanceAfter = await hre.ethers.provider.getBalance(CONTRACT);
  console.log('New balance:', hre.ethers.formatEther(balanceAfter), 'TCRO');
  console.log('\n✅ Contract funded successfully!\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
