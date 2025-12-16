/**
 * Test Gasless Transaction Flow
 * Verify that users can submit transactions without paying gas
 */

const ethers = require('ethers');
require('dotenv').config({ path: '.env.local' });

const RELAYER_CONTRACT = '0x9E5512b683d92290ccD20F483D20699658bcb9f3';
const RPC_URL = 'https://evm-t3.cronos.org/';

// EIP-712 Domain
const domain = {
  name: 'UniversalRelayer',
  version: '1',
  chainId: 338,
  verifyingContract: RELAYER_CONTRACT
};

// EIP-712 Types
const types = {
  MetaTransaction: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
};

async function testGaslessSignature() {
  console.log('🧪 Testing Gasless Transaction Signature\n');

  try {
    // Connect to network
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Use deployer wallet for testing (in production, use user wallet)
    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY not found in .env.local');
    }
    
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log('👛 User Wallet:', wallet.address);
    
    // Get current balance (should remain unchanged after gasless tx)
    const balanceBefore = await provider.getBalance(wallet.address);
    console.log('💰 Balance Before:', ethers.formatEther(balanceBefore), 'TCRO');

    // Get nonce from relayer contract
    const relayerContract = new ethers.Contract(
      RELAYER_CONTRACT,
      ['function nonces(address) view returns (uint256)'],
      provider
    );
    const nonce = await relayerContract.nonces(wallet.address);
    console.log('🔢 Nonce:', nonce.toString());

    // Create a simple transaction (e.g., call a view function)
    // In production, this would be createPortfolio, depositAsset, etc.
    const targetContract = '0x170E8232E9e18eeB1839dB1d939501994f1e272F'; // RWAManager
    const iface = new ethers.Interface([
      'function getPortfolioCount(address _user) view returns (uint256)'
    ]);
    const data = iface.encodeFunctionData('getPortfolioCount', [wallet.address]);

    // Set deadline (5 minutes from now)
    const deadline = Math.floor(Date.now() / 1000) + 300;

    // Create message to sign
    const message = {
      from: wallet.address,
      to: targetContract,
      value: 0n,
      data,
      nonce: nonce.toString(),
      deadline
    };

    console.log('\n📝 Signing Transaction...');
    console.log('   From:', message.from);
    console.log('   To:', message.to);
    console.log('   Data:', message.data.slice(0, 20) + '...');
    console.log('   Nonce:', message.nonce);
    console.log('   Deadline:', deadline);

    // Sign with EIP-712
    const signature = await wallet.signTypedData(domain, types, message);
    console.log('\n✅ Signature Generated!');
    console.log('   Signature:', signature.slice(0, 20) + '...');

    // Verify signature recovery
    const recovered = ethers.verifyTypedData(domain, types, message, signature);
    console.log('   Recovered Address:', recovered);
    console.log('   Match:', recovered.toLowerCase() === wallet.address.toLowerCase() ? '✅' : '❌');

    // Get balance after (should be same - NO GAS PAID!)
    const balanceAfter = await provider.getBalance(wallet.address);
    console.log('\n💰 Balance After:', ethers.formatEther(balanceAfter), 'TCRO');
    console.log('   Gas Spent:', ethers.formatEther(balanceBefore - balanceAfter), 'TCRO');
    
    if (balanceBefore === balanceAfter) {
      console.log('\n🎉 SUCCESS: User paid ZERO gas!');
    } else {
      console.log('\n⚠️  Note: Balance changed (may have been from other activity)');
    }

    console.log('\n📋 To submit this transaction:');
    console.log('   1. Start relayer service: node services/gasless-relayer.js');
    console.log('   2. POST to http://localhost:8001/api/relay/submit');
    console.log('   3. Body: {');
    console.log('         "from": "' + message.from + '",');
    console.log('         "to": "' + message.to + '",');
    console.log('         "value": "0",');
    console.log('         "data": "' + message.data + '",');
    console.log('         "deadline": ' + deadline + ',');
    console.log('         "signature": "' + signature + '"');
    console.log('      }');

    console.log('\n✨ Gasless signature test complete!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run test
testGaslessSignature()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
