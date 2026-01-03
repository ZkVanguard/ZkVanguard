/**
 * @fileoverview Deploy script for ZkVanguard contracts
 * @module scripts/deploy/deploy-contracts
 */

import { ethers } from 'hardhat';
import { saveContractAddresses, getCurrentNetwork } from '../../shared/utils/config';
import { logger } from '../../shared/utils/logger';

async function main() {
  const network = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();

  logger.info('Deployment started', {
    network: network.name,
    chainId: network.chainId,
    deployer: deployer.address,
  });

  const balance = await ethers.provider.getBalance(deployer.address);
  logger.info('Deployer balance', {
    balance: ethers.formatEther(balance),
    address: deployer.address,
  });

  // Deploy ZKVerifier
  logger.info('Deploying ZKVerifier...');
  const ZKVerifier = await ethers.getContractFactory('ZKVerifier');
  const zkVerifier = await ZKVerifier.deploy(deployer.address);
  await zkVerifier.waitForDeployment();
  const zkVerifierAddress = await zkVerifier.getAddress();
  logger.info('ZKVerifier deployed', { address: zkVerifierAddress });

  // Deploy PaymentRouter
  logger.info('Deploying PaymentRouter...');
  const PaymentRouter = await ethers.getContractFactory('PaymentRouter');
  const paymentRouter = await PaymentRouter.deploy(
    deployer.address, // admin
    deployer.address  // facilitator (replace with x402 facilitator in production)
  );
  await paymentRouter.waitForDeployment();
  const paymentRouterAddress = await paymentRouter.getAddress();
  logger.info('PaymentRouter deployed', { address: paymentRouterAddress });

  // Deploy RWAManager (upgradeable)
  logger.info('Deploying RWAManager (Upgradeable)...');
  const RWAManager = await ethers.getContractFactory('RWAManager');
  // TODO: Install @openzeppelin/hardhat-upgrades for proxy deployments
  // const rwaManager = await upgrades.deployProxy(RWAManager, [...], { initializer: 'initialize' });
  const rwaManager = await RWAManager.deploy();
  await rwaManager.waitForDeployment();
  const rwaManagerAddress = await rwaManager.getAddress();
  logger.info('RWAManager deployed', { address: rwaManagerAddress });

  // Set PaymentRouter in RWAManager
  logger.info('Configuring contracts...');
  const tx1 = await rwaManager.setPaymentRouter(paymentRouterAddress);
  await tx1.wait();
  logger.info('PaymentRouter set in RWAManager');

  // Grant AGENT_ROLE to deployer (for testing)
  const AGENT_ROLE = await rwaManager.AGENT_ROLE();
  const tx2 = await rwaManager.grantRole(AGENT_ROLE, deployer.address);
  await tx2.wait();
  logger.info('AGENT_ROLE granted to deployer');

  // Grant STRATEGY_EXECUTOR_ROLE to deployer
  const STRATEGY_EXECUTOR_ROLE = await rwaManager.STRATEGY_EXECUTOR_ROLE();
  const tx3 = await rwaManager.grantRole(STRATEGY_EXECUTOR_ROLE, deployer.address);
  await tx3.wait();
  logger.info('STRATEGY_EXECUTOR_ROLE granted to deployer');

  // Grant AGENT_ROLE to PaymentRouter
  const tx4 = await paymentRouter.grantRole(
    await paymentRouter.AGENT_ROLE(),
    deployer.address
  );
  await tx4.wait();
  logger.info('AGENT_ROLE granted to deployer in PaymentRouter');

  // Save addresses
  const addresses = {
    rwaManager: rwaManagerAddress,
    paymentRouter: paymentRouterAddress,
    zkVerifier: zkVerifierAddress,
    proofRegistry: zkVerifierAddress, // Same as zkVerifier for now
  };

  const networkConfig = getCurrentNetwork();
  saveContractAddresses(networkConfig.name, addresses);

  logger.info('Deployment completed successfully', { addresses });

  console.log('\n=== Deployment Summary ===');
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`\nContract Addresses:`);
  console.log(`  RWAManager: ${rwaManagerAddress}`);
  console.log(`  PaymentRouter: ${paymentRouterAddress}`);
  console.log(`  ZKVerifier: ${zkVerifierAddress}`);
  console.log('\nNext steps:');
  console.log('1. Verify contracts on explorer');
  console.log('2. Update .env with contract addresses');
  console.log('3. Initialize agents with agent configuration');
  console.log('4. Test with simulator dashboard');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Deployment failed', { error });
    console.error(error);
    process.exit(1);
  });
