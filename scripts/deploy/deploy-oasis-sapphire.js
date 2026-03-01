/**
 * Deploy contracts to Oasis EVM ParaTimes (Emerald or Sapphire)
 * 
 * Oasis ParaTimes:
 *   - Emerald: Public EVM ParaTime (standard Solidity contracts)
 *   - Sapphire: Confidential EVM ParaTime (end-to-end encryption, 100% confidential to 100% public)
 *   - Consensus: Base layer (staking/governance only, no smart contracts)
 *   - Cipher: Confidential WASM ParaTime (requires Oasis SDK, not EVM)
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-oasis-sapphire.js --network oasis-sapphire-testnet
 *   npx hardhat run scripts/deploy/deploy-oasis-sapphire.js --network oasis-sapphire-mainnet
 *   npx hardhat run scripts/deploy/deploy-oasis-sapphire.js --network oasis-emerald-testnet
 *   npx hardhat run scripts/deploy/deploy-oasis-sapphire.js --network oasis-emerald-mainnet
 * 
 * Prerequisites:
 *   1. Set PRIVATE_KEY in .env.local
 *   2. Get testnet ROSE from https://faucet.testnet.oasis.io/
 *   3. For Sapphire confidential contracts, install @oasisprotocol/sapphire-hardhat
 */

const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const network = hre.network.name;
  const chainId = hre.network.config.chainId;
  const paraTime = network.includes('emerald') ? 'Emerald' : 'Sapphire';
  
  console.log('='.repeat(60));
  console.log(`Deploying to Oasis ${paraTime}`);
  console.log(`Network: ${network} (Chain ID: ${chainId})`);
  console.log('='.repeat(60));

  const [deployer] = await hre.ethers.getSigners();
  console.log(`\nDeployer: ${deployer.address}`);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ROSE`);
  
  if (balance === 0n) {
    console.error('\n❌ Deployer has no ROSE. Get testnet ROSE from: https://faucet.testnet.oasis.io/');
    process.exit(1);
  }

  const deployedContracts = {};
  const deploymentFile = path.join(__dirname, '..', '..', 'deployments', `${network}.json`);

  // 1. Deploy ZKVerifier
  console.log('\n📦 Deploying ZKVerifier...');
  try {
    const ZKVerifier = await hre.ethers.getContractFactory('ZKSTARKVerifier');
    const zkVerifier = await ZKVerifier.deploy();
    await zkVerifier.waitForDeployment();
    const zkVerifierAddress = await zkVerifier.getAddress();
    console.log(`  ✅ ZKVerifier deployed at: ${zkVerifierAddress}`);
    deployedContracts.zkVerifier = {
      address: zkVerifierAddress,
      txHash: zkVerifier.deploymentTransaction()?.hash || '',
      blockNumber: zkVerifier.deploymentTransaction()?.blockNumber || 0,
    };
  } catch (error) {
    console.error(`  ❌ ZKVerifier deployment failed: ${error.message}`);
  }

  // 2. Deploy RWAManager
  console.log('\n📦 Deploying RWAManager...');
  try {
    const RWAManager = await hre.ethers.getContractFactory('RWAManager');
    const rwaManager = await RWAManager.deploy();
    await rwaManager.waitForDeployment();
    const rwaManagerAddress = await rwaManager.getAddress();
    console.log(`  ✅ RWAManager deployed at: ${rwaManagerAddress}`);
    deployedContracts.rwaManager = {
      address: rwaManagerAddress,
      txHash: rwaManager.deploymentTransaction()?.hash || '',
      blockNumber: rwaManager.deploymentTransaction()?.blockNumber || 0,
    };
  } catch (error) {
    console.error(`  ❌ RWAManager deployment failed: ${error.message}`);
  }

  // 3. Deploy PaymentRouter (requires admin and facilitator addresses)
  console.log('\n📦 Deploying PaymentRouter...');
  try {
    const PaymentRouter = await hre.ethers.getContractFactory('PaymentRouter');
    const paymentRouter = await PaymentRouter.deploy(deployer.address, deployer.address);
    await paymentRouter.waitForDeployment();
    const paymentRouterAddress = await paymentRouter.getAddress();
    console.log(`  ✅ PaymentRouter deployed at: ${paymentRouterAddress}`);
    deployedContracts.paymentRouter = {
      address: paymentRouterAddress,
      txHash: paymentRouter.deploymentTransaction()?.hash || '',
      blockNumber: paymentRouter.deploymentTransaction()?.blockNumber || 0,
    };
  } catch (error) {
    console.error(`  ❌ PaymentRouter deployment failed: ${error.message}`);
  }

  // 4. Deploy GaslessZKCommitmentVerifier
  console.log('\n📦 Deploying GaslessZKCommitmentVerifier...');
  try {
    const GaslessVerifier = await hre.ethers.getContractFactory('GaslessZKCommitmentVerifier');
    const gaslessVerifier = await GaslessVerifier.deploy();
    await gaslessVerifier.waitForDeployment();
    const gaslessVerifierAddress = await gaslessVerifier.getAddress();
    console.log(`  ✅ GaslessZKCommitmentVerifier deployed at: ${gaslessVerifierAddress}`);
    deployedContracts.gaslessZKCommitmentVerifier = {
      address: gaslessVerifierAddress,
      txHash: gaslessVerifier.deploymentTransaction()?.hash || '',
      blockNumber: gaslessVerifier.deploymentTransaction()?.blockNumber || 0,
    };
  } catch (error) {
    console.error(`  ❌ GaslessZKCommitmentVerifier deployment failed: ${error.message}`);
  }

  // 5. Deploy HedgeExecutor
  console.log('\n📦 Deploying HedgeExecutor...');
  try {
    const HedgeExecutor = await hre.ethers.getContractFactory('HedgeExecutorV2');
    const hedgeExecutor = await HedgeExecutor.deploy();
    await hedgeExecutor.waitForDeployment();
    const hedgeExecutorAddress = await hedgeExecutor.getAddress();
    console.log(`  ✅ HedgeExecutor deployed at: ${hedgeExecutorAddress}`);
    deployedContracts.hedgeExecutor = {
      address: hedgeExecutorAddress,
      txHash: hedgeExecutor.deploymentTransaction()?.hash || '',
      blockNumber: hedgeExecutor.deploymentTransaction()?.blockNumber || 0,
    };
  } catch (error) {
    console.error(`  ❌ HedgeExecutor deployment failed: ${error.message}`);
  }

  // Save deployment info
  const isTestnet = network.includes('testnet');
  const netEnv = isTestnet ? 'testnet' : 'mainnet';
  const paraTimeLower = paraTime.toLowerCase(); // 'emerald' or 'sapphire'

  const deploymentInfo = {
    network,
    chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    rpcUrl: isTestnet
      ? `https://testnet.${paraTimeLower}.oasis.io`
      : `https://${paraTimeLower}.oasis.io`,
    explorerUrl: `https://explorer.oasis.io/${netEnv}/${paraTimeLower}`,
    contracts: deployedContracts,
    notes: `Oasis ${paraTime} ${isTestnet ? 'Testnet' : 'Mainnet'} deployment`,
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n💾 Deployment saved to: ${deploymentFile}`);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log(`DEPLOYMENT SUMMARY - Oasis ${paraTime}`);
  console.log('='.repeat(60));
  for (const [name, info] of Object.entries(deployedContracts)) {
    console.log(`  ${name}: ${info.address}`);
  }
  console.log('\n📋 Next steps:');
  console.log('  1. Update .env.local with the deployed contract addresses');
  console.log('  2. Verify contracts on the Oasis Explorer');
  console.log('  3. Run verification: npx hardhat verify --network ' + network + ' <contract_address>');
  console.log('  4. Consider deploying confidential contracts using @oasisprotocol/sapphire-hardhat');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
