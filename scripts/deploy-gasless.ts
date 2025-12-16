/**
 * Deploy Universal Gasless Relayer
 * Makes ALL platform transactions FREE for users
 */

import { ethers } from 'hardhat';
import fs from 'fs';

async function main() {
  console.log('🚀 Deploying Gasless Infrastructure...\n');

  const [deployer] = await ethers.getSigners();
  console.log('Deploying from:', deployer.address);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'TCRO\n');

  // Load existing contract addresses
  const deploymentsPath = './deployments/cronos-testnet.json';
  let deployments: any = {};
  
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
  }

  // 1. Deploy UniversalRelayer
  console.log('📦 Deploying UniversalRelayer...');
  const UniversalRelayer = await ethers.getContractFactory('UniversalRelayer');
  const relayer = await UniversalRelayer.deploy(deployer.address); // Admin address
  await relayer.waitForDeployment();
  const relayerAddress = await relayer.getAddress();
  console.log('✅ UniversalRelayer deployed:', relayerAddress);

  // 2. Deploy GaslessZKVerifier
  console.log('\n📦 Deploying GaslessZKVerifier...');
  const GaslessZKVerifier = await ethers.getContractFactory('GaslessZKVerifier');
  const gaslessZK = await GaslessZKVerifier.deploy(relayerAddress);
  await gaslessZK.waitForDeployment();
  const gaslessZKAddress = await gaslessZK.getAddress();
  console.log('✅ GaslessZKVerifier deployed:', gaslessZKAddress);

  // 3. Grant RELAYER_ROLE to deployer (temporary for testing)
  console.log('\n🔑 Setting up roles...');
  const RELAYER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('RELAYER_ROLE'));
  const tx1 = await relayer.grantRole(RELAYER_ROLE, deployer.address);
  await tx1.wait();
  console.log('✅ Granted RELAYER_ROLE to:', deployer.address);

  // 4. Sponsor existing contracts
  if (deployments.RWAManager) {
    console.log('\n💰 Sponsoring existing contracts...');
    
    const tx2 = await relayer.sponsorContract(
      deployments.RWAManager,
      ethers.parseEther('10') // 10 TCRO budget
    );
    await tx2.wait();
    console.log('✅ Sponsored RWAManager:', deployments.RWAManager);
  }

  if (deployments.ZKVerifier) {
    const tx3 = await relayer.sponsorContract(
      deployments.ZKVerifier,
      ethers.parseEther('10')
    );
    await tx3.wait();
    console.log('✅ Sponsored ZKVerifier:', deployments.ZKVerifier);
  }

  if (deployments.PaymentRouter) {
    const tx4 = await relayer.sponsorContract(
      deployments.PaymentRouter,
      ethers.parseEther('10')
    );
    await tx4.wait();
    console.log('✅ Sponsored PaymentRouter:', deployments.PaymentRouter);
  }

  // 5. Update deployments file
  deployments.UniversalRelayer = relayerAddress;
  deployments.GaslessZKVerifier = gaslessZKAddress;
  
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log('\n💾 Updated deployments file');

  // 6. Create .env updates
  console.log('\n📝 Environment Variables:\n');
  console.log(`NEXT_PUBLIC_RELAYER_CONTRACT=${relayerAddress}`);
  console.log(`NEXT_PUBLIC_RELAYER_URL=http://localhost:8001`);
  console.log(`GASLESS_ZK_VERIFIER=${gaslessZKAddress}`);
  console.log('\nAdd these to your .env.local file');

  // 7. Summary
  console.log('\n' + '='.repeat(60));
  console.log('✨ GASLESS INFRASTRUCTURE DEPLOYED');
  console.log('='.repeat(60));
  console.log('\n📍 Contract Addresses:');
  console.log('   UniversalRelayer:', relayerAddress);
  console.log('   GaslessZKVerifier:', gaslessZKAddress);
  
  console.log('\n🔗 Block Explorer:');
  console.log('   https://explorer.cronos.org/testnet/address/' + relayerAddress);
  console.log('   https://explorer.cronos.org/testnet/address/' + gaslessZKAddress);

  console.log('\n📋 Next Steps:');
  console.log('   1. Update .env.local with the environment variables above');
  console.log('   2. Create a relayer wallet and fund it with TCRO');
  console.log('   3. Grant RELAYER_ROLE to the relayer wallet address');
  console.log('   4. Start relayer service: node services/gasless-relayer.js');
  console.log('   5. Users can now make ALL transactions for FREE! 🎉');

  console.log('\n💡 How it works:');
  console.log('   • Users sign messages (EIP-712) - NO GAS');
  console.log('   • Relayer submits to blockchain - PAYS GAS');
  console.log('   • Platform sponsors gas costs for users');
  console.log('   • Users enjoy 100% gasless experience! 🚀');

  console.log('\n💸 Gas Savings:');
  console.log('   • Traditional: ~0.056 TCRO per transaction');
  console.log('   • With Batching: ~0.02 TCRO per transaction (60-70% savings)');
  console.log('   • For Users: 0 TCRO (100% FREE) ✨');

  console.log('\n' + '='.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
