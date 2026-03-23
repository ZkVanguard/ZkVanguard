/*
  Generic Hedera deployment script (Hardhat-compatible)
  Usage:
    CONTRACT_NAME=MyContract npx hardhat run --network hedera-testnet scripts/deploy-hedera.cjs
  or
    npx hardhat run --network hedera-testnet scripts/deploy-hedera.cjs --contract MyContract

  This script purposefully does not include secrets. Set HEDERA_TESTNET_RPC_URL and
  HEDERA_PRIVATE_KEY in your environment or use an env file loaded by your shell.
*/
const hre = require('hardhat');

async function main() {
  const envName = process.env.CONTRACT_NAME || (() => {
    const idx = process.argv.indexOf('--contract');
    if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
    return undefined;
  })();

  const contractName = envName;
  if (!contractName) {
    throw new Error('Please set CONTRACT_NAME env var or pass --contract <Name>');
  }

  const accounts = await hre.ethers.getSigners();
  const deployer = accounts[0];
  console.log('Deploying', contractName, 'using address', deployer.address);

  const Factory = await hre.ethers.getContractFactory(contractName, deployer);
  const deployed = await Factory.deploy();
  await deployed.deployed?.();

  console.log('Deployed', contractName, '->', deployed.address || deployed.target || '<unknown>');
  // Optionally write to deployments/ directory
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
