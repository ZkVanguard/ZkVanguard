/**
 * Deploy self-sponsoring gasless commitment verifier
 * TRUE ON-CHAIN GASLESS - No backend service needed!
 */

const hre = require('hardhat');

async function main() {
  console.log('\n🚀 Deploying Self-Sponsoring Gasless ZK Verifier');
  console.log('==================================================\n');

  const [deployer] = await hre.ethers.getSigners();
  console.log('📝 Deploying with:', deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log('💰 Balance:', hre.ethers.formatEther(balance), 'TCRO\n');

  // Deploy GaslessZKCommitmentVerifier
  console.log('📦 Deploying GaslessZKCommitmentVerifier...');
  const GaslessVerifier = await hre.ethers.getContractFactory('GaslessZKCommitmentVerifier');
  const verifier = await GaslessVerifier.deploy();
  await verifier.waitForDeployment();
  
  const address = await verifier.getAddress();
  console.log('✅ GaslessZKCommitmentVerifier deployed to:', address);
  
  // Fund the contract to sponsor gas
  console.log('\n💸 Funding contract with 10 TCRO to sponsor gas...');
  const fundTx = await deployer.sendTransaction({
    to: address,
    value: hre.ethers.parseEther('10')
  });
  await fundTx.wait();
  
  const contractBalance = await hre.ethers.provider.getBalance(address);
  console.log('✅ Contract funded:', hre.ethers.formatEther(contractBalance), 'TCRO');
  
  console.log('\n🎯 Features:');
  console.log('   ✨ TRUE ON-CHAIN GASLESS');
  console.log('   💰 Users pay ZERO gas - contract refunds automatically');
  console.log('   📦 Supports batch operations (70%+ gas savings)');
  console.log('   🔥 No backend service needed');
  console.log('   🎉 Pure on-chain solution like Base chain!');
  
  console.log('\n📋 Next Steps:');
  console.log('   1. Update frontend to use:', address);
  console.log('   2. Call storeCommitmentGasless() - user gets refunded!');
  console.log('   3. Monitor contract balance and refill as needed');
  
  console.log('\n✅ Deployment complete!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
