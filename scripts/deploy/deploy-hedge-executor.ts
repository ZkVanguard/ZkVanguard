/**
 * @fileoverview Deploy HedgeExecutor (UUPS Proxy) to Cronos zkEVM testnet
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-hedge-executor.ts --network cronos-testnet
 * 
 * Prerequisites:
 *   - MockMoonlander + MockUSDC deployed (will be deployed if not present)
 *   - ZKHedgeCommitment deployed (will be deployed if not present)
 *   - PRIVATE_KEY set in .env.local
 */

import { ethers, upgrades } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const DEPLOYMENT_FILE = path.join(__dirname, '../../deployments/cronos-testnet.json');

function loadDeployment(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf-8'));
  } catch {
    return { network: 'cronos-testnet', chainId: 338, contracts: {} };
  }
}

function saveDeployment(data: Record<string, any>) {
  data.lastDeployment = new Date().toISOString();
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2));
  console.log(`Deployment saved to ${DEPLOYMENT_FILE}`);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();

  console.log('\n=== HedgeExecutor Deployment ===');
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} CRO\n`);

  const deployment = loadDeployment();

  // ============ Step 1: Deploy MockUSDC if needed ============
  let usdcAddress = deployment.usdcToken;
  if (!usdcAddress) {
    console.log('Deploying MockUSDC...');
    const MockUSDC = await ethers.getContractFactory('MockUSDC');
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
    deployment.usdcToken = usdcAddress;
    console.log(`  MockUSDC deployed: ${usdcAddress}`);
  } else {
    console.log(`  MockUSDC already deployed: ${usdcAddress}`);
  }

  // ============ Step 2: Deploy MockMoonlander if needed ============
  let moonlanderAddress = deployment.MockMoonlander;
  if (!moonlanderAddress) {
    console.log('Deploying MockMoonlander...');
    const MockMoonlander = await ethers.getContractFactory('MockMoonlander');
    const moonlander = await MockMoonlander.deploy(usdcAddress);
    await moonlander.waitForDeployment();
    moonlanderAddress = await moonlander.getAddress();
    deployment.MockMoonlander = moonlanderAddress;
    console.log(`  MockMoonlander deployed: ${moonlanderAddress}`);
  } else {
    console.log(`  MockMoonlander already deployed: ${moonlanderAddress}`);
  }

  // ============ Step 3: Deploy ZKHedgeCommitment if needed ============
  let zkCommitmentAddress = deployment.ZKHedgeCommitment;
  if (!zkCommitmentAddress) {
    console.log('Deploying ZKHedgeCommitment...');
    const ZKHedgeCommitment = await ethers.getContractFactory('ZKHedgeCommitment');
    const zkCommitment = await ZKHedgeCommitment.deploy();
    await zkCommitment.waitForDeployment();
    zkCommitmentAddress = await zkCommitment.getAddress();
    deployment.ZKHedgeCommitment = zkCommitmentAddress;

    // Initialize
    const initTx = await zkCommitment.initialize(deployer.address);
    await initTx.wait();
    console.log(`  ZKHedgeCommitment deployed + initialized: ${zkCommitmentAddress}`);
  } else {
    console.log(`  ZKHedgeCommitment already deployed: ${zkCommitmentAddress}`);
  }

  // ============ Step 4: Deploy HedgeExecutor (UUPS Proxy) ============
  console.log('\nDeploying HedgeExecutor (UUPS Proxy)...');
  
  let hedgeExecutorAddress: string;

  try {
    // Try with OpenZeppelin Upgrades plugin
    const HedgeExecutor = await ethers.getContractFactory('HedgeExecutor');
    const hedgeExecutor = await upgrades.deployProxy(
      HedgeExecutor,
      [usdcAddress, moonlanderAddress, zkCommitmentAddress, deployer.address],
      {
        initializer: 'initialize',
        kind: 'uups',
      }
    );
    await hedgeExecutor.waitForDeployment();
    hedgeExecutorAddress = await hedgeExecutor.getAddress();
  } catch (e) {
    // Fallback: deploy without proxy (direct deploy + manual initialize)
    console.log('  Upgrades plugin not available, deploying directly...');
    const HedgeExecutor = await ethers.getContractFactory('HedgeExecutor');
    const hedgeExecutor = await HedgeExecutor.deploy();
    await hedgeExecutor.waitForDeployment();
    hedgeExecutorAddress = await hedgeExecutor.getAddress();

    // Initialize manually
    const initTx = await hedgeExecutor.initialize(
      usdcAddress,
      moonlanderAddress, 
      zkCommitmentAddress,
      deployer.address
    );
    await initTx.wait();
    console.log('  Initialized without proxy');
  }

  deployment.HedgeExecutor = hedgeExecutorAddress;
  console.log(`  HedgeExecutor deployed: ${hedgeExecutorAddress}`);

  // ============ Step 5: Configure Roles & Permissions ============
  console.log('\nConfiguring roles...');
  
  const hedgeExecutor = await ethers.getContractAt('HedgeExecutor', hedgeExecutorAddress);
  
  // Grant AGENT_ROLE to deployer for testing
  const AGENT_ROLE = await hedgeExecutor.AGENT_ROLE();
  try {
    const tx = await hedgeExecutor.grantRole(AGENT_ROLE, deployer.address);
    await tx.wait();
    console.log('  AGENT_ROLE granted to deployer');
  } catch (e: any) {
    console.log(`  AGENT_ROLE may already be set: ${e.message?.slice(0, 80)}`);
  }

  // ============ Step 6: Approve USDC for HedgeExecutor ============
  console.log('\nApproving USDC...');
  const usdc = await ethers.getContractAt('MockUSDC', usdcAddress);

  // Mint some test USDC to deployer
  try {
    const mintTx = await usdc.mint(deployer.address, ethers.parseUnits('1000000', 6));
    await mintTx.wait();
    console.log('  Minted 1,000,000 USDC to deployer');
  } catch (e: any) {
    console.log(`  Mint skipped: ${e.message?.slice(0, 80)}`);
  }

  // Approve HedgeExecutor to spend USDC
  try {
    const approveTx = await usdc.approve(
      hedgeExecutorAddress,
      ethers.parseUnits('1000000', 6)
    );
    await approveTx.wait();
    console.log('  USDC approved for HedgeExecutor');
  } catch (e: any) {
    console.log(`  Approve skipped: ${e.message?.slice(0, 80)}`);
  }

  // ============ Save Deployment ============
  saveDeployment(deployment);

  // ============ Summary ============
  console.log('\n=== Deployment Summary ===');
  console.log(`  MockUSDC:          ${usdcAddress}`);
  console.log(`  MockMoonlander:    ${moonlanderAddress}`);
  console.log(`  ZKHedgeCommitment: ${zkCommitmentAddress}`);
  console.log(`  HedgeExecutor:     ${hedgeExecutorAddress}`);
  console.log(`  Deployer:          ${deployer.address}`);
  console.log('\nNext steps:');
  console.log('  1. Verify on explorer: https://explorer.cronos.org/testnet3');
  console.log('  2. Test with: npx hardhat run scripts/test-hedge-executor.ts --network cronos-testnet');
  console.log('  3. Update agents/specialized/HedgingAgent.ts with on-chain addresses');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
