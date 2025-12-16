const { ethers } = require('hardhat');
const fs = require('fs');

async function main() {
  console.log('🚀 Deploying ZKCommitmentVerifier contract...');
  
  const ZKCommitmentVerifier = await ethers.getContractFactory('ZKCommitmentVerifier');
  const verifier = await ZKCommitmentVerifier.deploy();
  
  await verifier.waitForDeployment();
  const address = await verifier.getAddress();
  
  console.log('✅ ZKCommitmentVerifier deployed to:', address);
  console.log('\n📝 Contract accepts:');
  console.log('   - proofHash: bytes32 (commitment hash)');
  console.log('   - merkleRoot: bytes32 (ZK-STARK merkle root)');
  console.log('   - securityLevel: uint256 (521 for NIST P-521)');
  
  console.log('\n🔐 Security Model:');
  console.log('   - Proof verified OFF-CHAIN with 521-bit precision');
  console.log('   - Commitment stored ON-CHAIN (256-bit compatible)');
  console.log('   - Full cryptographic security preserved!');
  
  // Save deployment info
  const deployments = JSON.parse(
    fs.readFileSync('deployments/cronos-testnet.json', 'utf8')
  );
  
  deployments.zkCommitmentVerifier = address;
  deployments.deployedAt = new Date().toISOString();
  
  fs.writeFileSync(
    'deployments/cronos-testnet.json',
    JSON.stringify(deployments, null, 2)
  );
  
  console.log('\n✅ Deployment info saved to deployments/cronos-testnet.json');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
