/**
 * ZK Proxy Vault Deployment Script
 * 
 * Deploys the bulletproof escrow system:
 * 1. ZKSTARKVerifier - On-chain proof verification
 * 2. ZKProxyVault - Escrow vault with ZK ownership
 * 
 * Usage:
 *   npx hardhat run scripts/deploy-zk-vault.ts --network cronos-testnet
 */

import { ethers, upgrades } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

interface DeploymentInfo {
  network: string;
  chainId: number;
  zkVerifier: string;
  zkProxyVault: string;
  zkProxyVaultImpl: string;
  deployer: string;
  timestamp: number;
  timeLockThreshold: string;
  timeLockDuration: number;
  txHashes: {
    verifier: string;
    vault: string;
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log('\n' + '='.repeat(60));
  console.log('   CHRONOS VANGUARD - ZK Proxy Vault Deployment');
  console.log('='.repeat(60));
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log('='.repeat(60) + '\n');

  // Configuration
  const timeLockThreshold = ethers.parseEther('100'); // 100 ETH = time-lock
  const timeLockDuration = 24 * 60 * 60; // 24 hours

  // Step 1: Deploy ZK Verifier
  console.log('[1/3] Deploying ZKSTARKVerifier...');
  const ZKVerifier = await ethers.getContractFactory('ZKSTARKVerifier');
  const zkVerifier = await ZKVerifier.deploy();
  await zkVerifier.waitForDeployment();
  const verifierAddress = await zkVerifier.getAddress();
  console.log(`  ✅ ZKSTARKVerifier deployed at: ${verifierAddress}`);

  // Step 2: Deploy ZK Proxy Vault (Upgradeable)
  console.log('\n[2/3] Deploying ZKProxyVault (UUPS Upgradeable)...');
  const ZKProxyVault = await ethers.getContractFactory('ZKProxyVault');
  const zkProxyVault = await upgrades.deployProxy(
    ZKProxyVault,
    [verifierAddress, timeLockThreshold, timeLockDuration],
    { 
      initializer: 'initialize',
      kind: 'uups',
    }
  );
  await zkProxyVault.waitForDeployment();
  const vaultAddress = await zkProxyVault.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(vaultAddress);
  console.log(`  ✅ ZKProxyVault proxy deployed at: ${vaultAddress}`);
  console.log(`  ✅ Implementation deployed at: ${implAddress}`);

  // Step 3: Verify deployment
  console.log('\n[3/3] Verifying deployment...');
  
  const storedVerifier = await zkProxyVault.zkVerifier();
  const storedThreshold = await zkProxyVault.timeLockThreshold();
  const storedDuration = await zkProxyVault.timeLockDuration();
  
  console.log(`  ZK Verifier: ${storedVerifier} ${storedVerifier === verifierAddress ? '✅' : '❌'}`);
  console.log(`  Time-lock Threshold: ${ethers.formatEther(storedThreshold)} ETH ✅`);
  console.log(`  Time-lock Duration: ${Number(storedDuration) / 3600} hours ✅`);

  // Save deployment info
  const deploymentInfo: DeploymentInfo = {
    network: network.name,
    chainId: Number(network.chainId),
    zkVerifier: verifierAddress,
    zkProxyVault: vaultAddress,
    zkProxyVaultImpl: implAddress,
    deployer: deployer.address,
    timestamp: Date.now(),
    timeLockThreshold: ethers.formatEther(timeLockThreshold),
    timeLockDuration,
    txHashes: {
      verifier: zkVerifier.deploymentTransaction()?.hash || '',
      vault: zkProxyVault.deploymentTransaction()?.hash || '',
    },
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `zk-vault-${network.name}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  // Also save as latest
  fs.writeFileSync(
    path.join(deploymentsDir, `zk-vault-${network.name}.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log('\n' + '='.repeat(60));
  console.log('   DEPLOYMENT COMPLETE!');
  console.log('='.repeat(60));
  console.log(`\n📄 Deployment saved to: deployments/${filename}`);
  console.log('\n🔐 Contract Addresses:');
  console.log(`   ZKSTARKVerifier: ${verifierAddress}`);
  console.log(`   ZKProxyVault:    ${vaultAddress}`);
  console.log('\n⚠️  IMPORTANT: Update lib/crypto/ZKProxyVaultClient.ts with these addresses!');
  console.log('='.repeat(60) + '\n');

  return deploymentInfo;
}

main()
  .then((info) => {
    console.log('Deployment info:', info);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
