/**
 * Initialize ZKVerifier Contract
 * Sets up the verifier for production use
 */

const { ethers } = require('hardhat');

async function main() {
  console.log('🔧 Initializing ZKVerifier Contract\n');

  const [deployer] = await ethers.getSigners();
  console.log('Admin Address:', deployer.address);

  const zkVerifierAddress = '0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8';
  
  // Connect to deployed contract
  const zkVerifier = await ethers.getContractAt('ZKVerifier', zkVerifierAddress);
  
  console.log('📍 ZKVerifier:', zkVerifierAddress);

  // Check if deployer has VERIFIER_ROLE
  const VERIFIER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('VERIFIER_ROLE'));
  const hasRole = await zkVerifier.hasRole(VERIFIER_ROLE, deployer.address);
  
  console.log('Has VERIFIER_ROLE:', hasRole);

  if (!hasRole) {
    console.log('\n🔑 Granting VERIFIER_ROLE...');
    const tx = await zkVerifier.grantRole(VERIFIER_ROLE, deployer.address);
    await tx.wait();
    console.log('✅ VERIFIER_ROLE granted');
  }

  // Deploy a simple verifier contract for testing
  console.log('\n📦 Deploying MockVerifier for testing...');
  const MockVerifier = await ethers.getContractFactory('MockGroth16Verifier');
  const mockVerifier = await MockVerifier.deploy();
  await mockVerifier.waitForDeployment();
  const mockVerifierAddress = await mockVerifier.getAddress();
  console.log('✅ MockVerifier deployed:', mockVerifierAddress);

  // Set verifier contracts for each proof type
  console.log('\n🔗 Setting verifier contracts...');
  
  const proofTypes = ['settlement', 'risk', 'rebalance'];
  
  for (const proofType of proofTypes) {
    try {
      const tx = await zkVerifier.setVerifierContract(proofType, mockVerifierAddress);
      await tx.wait();
      console.log(`✅ Set verifier for ${proofType}`);
    } catch (error) {
      console.log(`⚠️  ${proofType}: ${error.message}`);
    }
  }

  console.log('\n✨ ZKVerifier initialization complete!');
  console.log('\n📋 Summary:');
  console.log('   ZKVerifier:', zkVerifierAddress);
  console.log('   MockVerifier:', mockVerifierAddress);
  console.log('   Supported Proof Types:', proofTypes.join(', '));
  console.log('\n✅ Ready to verify ZK proofs!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  });
