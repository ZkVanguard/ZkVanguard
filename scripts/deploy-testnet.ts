import { ethers, upgrades } from 'hardhat';

async function main() {
  console.log('🚀 Deploying Chronos Vanguard contracts to Cronos Testnet...\n');

  const [deployer] = await ethers.getSigners();
  console.log('📝 Deploying with account:', deployer.address);
  console.log('💰 Account balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'tCRO\n');

  // 1. Deploy ZKVerifier
  console.log('📦 Deploying ZKVerifier...');
  const ZKVerifier = await ethers.getContractFactory('ZKVerifier');
  const zkVerifier = await ZKVerifier.deploy(deployer.address);
  await zkVerifier.waitForDeployment();
  const zkVerifierAddress = await zkVerifier.getAddress();
  console.log('✅ ZKVerifier deployed to:', zkVerifierAddress);

  // 2. Deploy RWAManager (Upgradeable)
  console.log('\n📦 Deploying RWAManager (UUPS Proxy)...');
  const RWAManager = await ethers.getContractFactory('RWAManager');
  const rwaManager = await upgrades.deployProxy(
    RWAManager,
    [deployer.address, zkVerifierAddress, deployer.address], // Using deployer as fee collector
    { 
      initializer: 'initialize',
      kind: 'uups'
    }
  );
  await rwaManager.waitForDeployment();
  const rwaManagerAddress = await rwaManager.getAddress();
  console.log('✅ RWAManager Proxy deployed to:', rwaManagerAddress);

  // 3. Deploy PaymentRouter
  console.log('\n📦 Deploying PaymentRouter...');
  const PaymentRouter = await ethers.getContractFactory('PaymentRouter');
  const paymentRouter = await PaymentRouter.deploy(
    rwaManagerAddress,
    zkVerifierAddress
  );
  await paymentRouter.waitForDeployment();
  const paymentRouterAddress = await paymentRouter.getAddress();
  console.log('✅ PaymentRouter deployed to:', paymentRouterAddress);

  // 4. Grant roles
  console.log('\n🔐 Setting up roles...');
  
  // Grant AGENT_ROLE to PaymentRouter
  const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('AGENT_ROLE'));
  await rwaManager.grantRole(AGENT_ROLE, paymentRouterAddress);
  console.log('✅ Granted AGENT_ROLE to PaymentRouter');

  // Grant VERIFIER_ROLE to RWAManager
  const VERIFIER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('VERIFIER_ROLE'));
  await zkVerifier.grantRole(VERIFIER_ROLE, rwaManagerAddress);
  console.log('✅ Granted VERIFIER_ROLE to RWAManager');

  await zkVerifier.grantRole(VERIFIER_ROLE, paymentRouterAddress);
  console.log('✅ Granted VERIFIER_ROLE to PaymentRouter');

  // 5. Summary
  console.log('\n' + '='.repeat(60));
  console.log('🎉 DEPLOYMENT COMPLETE!');
  console.log('='.repeat(60));
  console.log('\n📋 Contract Addresses:');
  console.log('├─ ZKVerifier:      ', zkVerifierAddress);
  console.log('├─ RWAManager:      ', rwaManagerAddress);
  console.log('└─ PaymentRouter:   ', paymentRouterAddress);
  
  console.log('\n🔗 Block Explorer Links:');
  console.log('├─ ZKVerifier:      ', `https://explorer.cronos.org/testnet/address/${zkVerifierAddress}`);
  console.log('├─ RWAManager:      ', `https://explorer.cronos.org/testnet/address/${rwaManagerAddress}`);
  console.log('└─ PaymentRouter:   ', `https://explorer.cronos.org/testnet/address/${paymentRouterAddress}`);

  console.log('\n💾 Save these addresses to your .env.local:');
  console.log(`NEXT_PUBLIC_ZKVERIFIER_ADDRESS=${zkVerifierAddress}`);
  console.log(`NEXT_PUBLIC_RWAMANAGER_ADDRESS=${rwaManagerAddress}`);
  console.log(`NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS=${paymentRouterAddress}`);

  // Save deployment info
  const fs = require('fs');
  const deploymentInfo = {
    network: 'cronos-testnet',
    chainId: 338,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      ZKVerifier: zkVerifierAddress,
      RWAManager: rwaManagerAddress,
      PaymentRouter: paymentRouterAddress,
    },
  };

  fs.writeFileSync(
    './deployments/cronos-testnet.json',
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log('\n✅ Deployment info saved to deployments/cronos-testnet.json');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
