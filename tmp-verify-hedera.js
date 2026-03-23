const { ethers } = require('ethers');
(async () => {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.HEDERA_TESTNET_RPC_URL || 'https://testnet.hashio.io/api', 296);
    const wallet = new ethers.Wallet(process.env.HEDERA_PRIVATE_KEY || '0x7af57dd2889cb16393ff945b87a8ce670aea2950179c425a572059017636b18d', provider);
    console.log('Wallet address:', wallet.address);
    const bn = await provider.getBlockNumber();
    console.log('Block', bn);
    const bal = await provider.getBalance(wallet.address);
    console.log('Balance:', ethers.formatEther(bal));
    const code = await provider.getCode(wallet.address);
    console.log('Code:', code);
  } catch (e) {
    console.error('Error', e.message, e.stack);
  }
})();
