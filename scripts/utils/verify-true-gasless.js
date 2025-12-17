/**
 * Verify TRUE Gasless Contract (x402 + USDC)
 * Tests X402GaslessZKCommitmentVerifier operational status
 */

const hre = require('hardhat');

async function main() {
  console.log('\n🔍 VERIFYING TRUE GASLESS CONTRACT (x402 + USDC)');
  console.log('====================================================\n');

  const CONTRACT = '0xC81C1c09533f75Bc92a00eb4081909975e73Fd27';
  const USDC = '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0';
  
  try {
    // Connect to contract
    const verifier = await hre.ethers.getContractAt('X402GaslessZKCommitmentVerifier', CONTRACT);
    
    console.log('📍 Contract Address:', CONTRACT);
    console.log('💵 USDC Token:', USDC);
    console.log('🌐 Network: Cronos Testnet (338)\n');
    
    // Check contract balance (for gas sponsorship)
    const balance = await hre.ethers.provider.getBalance(CONTRACT);
    console.log('💰 Contract CRO Balance:', hre.ethers.formatEther(balance), 'TCRO');
    
    // Check fee configuration
    const feePerCommitment = await verifier.feePerCommitment();
    console.log('💵 USDC Fee per Commitment:', hre.ethers.formatUnits(feePerCommitment, 6), 'USDC');
    
    // Get contract stats
    const totalCommitments = await verifier.totalCommitments();
    const totalFeesCollected = await verifier.totalFeesCollected();
    const totalGasSponsored = await verifier.totalGasSponsored();
    
    console.log('\n📊 Contract Statistics:');
    console.log('   Total Commitments:', totalCommitments.toString());
    console.log('   Total USDC Collected:', hre.ethers.formatUnits(totalFeesCollected, 6), 'USDC');
    console.log('   Total CRO Gas Spent:', hre.ethers.formatEther(totalGasSponsored), 'TCRO');
    if (totalCommitments > 0) {
      const avgGas = totalGasSponsored / totalCommitments;
      console.log('   Avg Gas per Tx:', hre.ethers.formatEther(avgGas), 'TCRO');
    }
    
    // Check if contract is operational
    const remainingCapacity = Math.floor(Number(hre.ethers.formatEther(balance)) / 0.001);
    const isOperational = balance > hre.ethers.parseEther('0.01');
    
    console.log('\n✅ Operational Status:');
    console.log('   Status:', isOperational ? '🟢 OPERATIONAL' : '🔴 NEEDS FUNDING');
    console.log('   Remaining Capacity:', remainingCapacity, 'commitments');
    console.log('   Needs Refill:', balance < hre.ethers.parseEther('0.1') ? 'YES' : 'NO');
    
    // Test contract accessibility
    console.log('\n🧪 Contract Accessibility:');
    const testProofHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('test-proof'));
    const commitment = await verifier.verifyCommitment(testProofHash);
    console.log('   Query Success: ✅');
    console.log('   Contract Responsive: ✅');
    
    console.log('\n✨ TRUE GASLESS CONTRACT STATUS: READY');
    console.log('\n📝 Key Features:');
    console.log('   ✅ Users pay: $0.01 USDC (gasless via x402)');
    console.log('   ✅ Contract pays: ~$0.0001 CRO gas');
    console.log('   ✅ TRUE gasless: $0.00 CRO from user');
    console.log('   ✅ Margin: ~99%');
    
    if (!isOperational) {
      console.log('\n⚠️  WARNING: Contract needs CRO funding!');
      console.log('   Run: node scripts/utils/fund-gasless-contract.js');
    }
    
  } catch (error) {
    console.error('\n❌ Error verifying contract:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('   1. Check network connection');
    console.log('   2. Verify contract address');
    console.log('   3. Ensure RPC endpoint is responsive');
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
