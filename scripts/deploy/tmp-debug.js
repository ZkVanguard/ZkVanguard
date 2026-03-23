const { ethers } = require('ethers'); const fs = require('fs');
(async () => {
  const url = 'https://testnet.hashio.io/api';
  const key = '0x313618e24bb4f0215fd15d7f28cd2870e145e630c7381885f5b5937220bcf489';
  const provider = new ethers.JsonRpcProvider(url, 296);
  const wallet = new ethers.Wallet(key, provider);
  const artifact = JSON.parse(fs.readFileSync('contracts/abi/CommunityPool.json', 'utf8'));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const tx = await factory.getDeployTransaction();
  console.log('tx data length', (tx.data || '').length);
  console.log('tx data prefix', (tx.data || '').slice(0, 40));
  console.log('tx fields', {
    gasLimit: tx.gasLimit,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    gasPrice: tx.gasPrice,
  });

  const tx2 = await factory.getDeployTransaction({ gasLimit: 15000000, maxFeePerGas: ethers.parseUnits('20000', 'gwei'), maxPriorityFeePerGas: 0 });
  console.log('tx2 fields', {
    gasLimit: tx2.gasLimit?.toString(),
    maxFeePerGas: tx2.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: tx2.maxPriorityFeePerGas?.toString(),
    gasPrice: tx2.gasPrice,
  });

  try {
    const est = await provider.estimateGas(tx2);
    console.log('estimateGas', est.toString());
  } catch (e) {
    console.error('estimateGas failed', e.message, e.info?.error);
  }
})();