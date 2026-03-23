const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
  const url = process.env.HEDERA_TESTNET_RPC_URL || 'https://testnet.hashio.io/api';
  const key = process.env.HEDERA_PRIVATE_KEY;
  if (!key) throw new Error('HEDERA_PRIVATE_KEY is required');

  const provider = new ethers.JsonRpcProvider(url, 296);
  const wallet = new ethers.Wallet(key, provider);

  const artifact = JSON.parse(fs.readFileSync('contracts/abi/CommunityPool.json', 'utf8'));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  const gasLimit = 15000000;
  const maxFeePerGas = ethers.parseUnits('20000', 'gwei');
  const maxPriorityFeePerGas = 0;

  console.log('Estimating Gas...');
  const txData = await factory.getDeployTransaction({ gasLimit, maxFeePerGas, maxPriorityFeePerGas });
  const estimate = await provider.estimateGas(txData);
  console.log('Estimated gas for implementation deploy:', estimate.toString());

  console.log('Deploying implementation...');
  const contract = await factory.deploy({ gasLimit, maxFeePerGas, maxPriorityFeePerGas });
  const deploymentTx = contract.deploymentTransaction?.();
  console.log('Deployment tx hash:', deploymentTx?.hash || '<unknown>');
  const receipt = await deploymentTx?.wait();
  await contract.waitForDeployment();
  console.log('Deployed contract at', contract.target || contract.address);
  console.log('Deployment mined gasUsed:', receipt?.gasUsed?.toString() || '<unknown>');

  console.log('Initializing contract...');
  const initTx = await contract.initialize(
    '0x0000000000000000000000000000000000000000',
    [
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
    ],
    wallet.address,
    wallet.address,
    { gasLimit, maxFeePerGas, maxPriorityFeePerGas }
  );
  console.log('Init tx', initTx.hash);
  const initReceipt = await initTx.wait();
  console.log('Init done, gasUsed:', initReceipt.gasUsed.toString());

  console.log('SUCCESS: CommunityPool deployed and initialized');
  console.log('Address:', contract.address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});