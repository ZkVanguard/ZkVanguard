/**
 * Deploy ZKPaymaster - TRUE Gasless Contract
 * 
 * This deploys a meta-transaction forwarder that:
 * 1. Accepts signed messages from users (FREE for users)
 * 2. Relayer submits tx and pays gas
 * 3. Contract refunds relayer
 * 4. User pays $0.00
 * 
 * Usage:
 *   npx hardhat run scripts/deploy-zk-paymaster.ts --network cronos-testnet
 */

import { ethers } from 'hardhat';

async function main() {
  console.log('🚀 Deploying ZKPaymaster...\n');

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  
  console.log('📋 Deployment Details:');
  console.log('   Deployer:', deployer.address);
  console.log('   Balance:', ethers.formatEther(balance), 'CRO');
  console.log('   Network:', (await ethers.provider.getNetwork()).chainId.toString());
  console.log('');

  // Deploy ZKPaymaster
  console.log('📦 Deploying ZKPaymaster contract...');
  const ZKPaymaster = await ethers.getContractFactory('ZKPaymaster');
  const paymaster = await ZKPaymaster.deploy();
  await paymaster.waitForDeployment();
  
  const paymasterAddress = await paymaster.getAddress();
  console.log('✅ ZKPaymaster deployed to:', paymasterAddress);

  // Fund the contract with testnet CRO (for gas sponsorship)
  const fundAmount = ethers.parseEther('5'); // 5 CRO - free from faucet
  console.log(`\n💰 Funding contract with ${ethers.formatEther(fundAmount)} CRO...`);
  
  const fundTx = await deployer.sendTransaction({
    to: paymasterAddress,
    value: fundAmount,
  });
  await fundTx.wait();
  console.log('✅ Contract funded!');

  // Get contract stats
  const contractBalance = await ethers.provider.getBalance(paymasterAddress);
  console.log('   Contract balance:', ethers.formatEther(contractBalance), 'CRO');

  // Estimate transactions possible
  const avgGasCost = ethers.parseEther('0.001'); // ~0.001 CRO per tx
  const txPossible = Number(contractBalance / avgGasCost);
  console.log(`   Can sponsor ~${txPossible} transactions\n`);

  // Summary
  console.log('═'.repeat(60));
  console.log('🎉 DEPLOYMENT COMPLETE - TRUE GASLESS ENABLED');
  console.log('═'.repeat(60));
  console.log('');
  console.log('Contract Address:', paymasterAddress);
  console.log('');
  console.log('Cost Breakdown:');
  console.log('  • User signs message:     $0.00 (just signature)');
  console.log('  • Relayer submits tx:     $0.00 (gets refunded)');
  console.log('  • Contract pays gas:      FREE (testnet CRO from faucet)');
  console.log('  ─────────────────────────────');
  console.log('  • TOTAL USER COST:        $0.00 ✅');
  console.log('');
  console.log('Next Steps:');
  console.log('  1. Add contract address to .env:');
  console.log(`     ZK_PAYMASTER_ADDRESS=${paymasterAddress}`);
  console.log('');
  console.log('  2. Fund with more CRO if needed:');
  console.log('     https://cronos.org/faucet (Cronos Testnet)');
  console.log('');
  console.log('  3. Test gasless transaction:');
  console.log('     npm run test:paymaster');
  console.log('═'.repeat(60));

  return paymasterAddress;
}

main()
  .then((_address) => {
    console.log('\n✅ Deployment successful!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Deployment failed:', error);
    process.exit(1);
  });
