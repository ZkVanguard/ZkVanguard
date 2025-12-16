#!/usr/bin/env node
/**
 * Verify ZK Proof On-Chain
 * Query the ZKVerifier contract to check proof verification status
 */

const { ethers } = require('hardhat');
const deployment = require('../deployments/cronos-testnet.json');

// ZKVerifier ABI (minimal for reading proofs)
const ZK_VERIFIER_ABI = [
  'function proofs(bytes32) view returns (bytes32 proofHash, uint256 timestamp, address submitter, bool verified, string proofType)',
  'function proofRegistry(uint256) view returns (bytes32)',
  'event ProofVerified(bytes32 indexed proofHash, string indexed proofType, address indexed submitter, bool result)'
];

async function main() {
  const txHash = process.argv[2] || '0xf502c2c8001751d0a828ea431aa32c0c2773370ebb2b47ec23dae456414fa5d8';
  
  console.log('\n========================================');
  console.log('   ZK PROOF ON-CHAIN VERIFICATION');
  console.log('========================================\n');
  
  // Connect to Cronos Testnet
  const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org');
  const zkVerifier = new ethers.Contract(
    deployment.contracts.ZKVerifier,
    ZK_VERIFIER_ABI,
    provider
  );
  
  console.log('📋 Transaction:', txHash);
  console.log('📍 ZKVerifier:', deployment.contracts.ZKVerifier);
  console.log('');
  
  try {
    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      console.log('❌ Transaction not found');
      return;
    }
    
    console.log('✅ Transaction Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');
    console.log('⛽ Gas Used:', receipt.gasUsed.toString());
    console.log('📦 Block:', receipt.blockNumber);
    console.log('');
    
    // Parse logs to find ProofVerified event
    const iface = new ethers.Interface(ZK_VERIFIER_ABI);
    const proofEvents = receipt.logs
      .filter(log => log.address.toLowerCase() === deployment.contracts.ZKVerifier.toLowerCase())
      .map(log => {
        try {
          return iface.parseLog({ topics: log.topics, data: log.data });
        } catch {
          return null;
        }
      })
      .filter(event => event && event.name === 'ProofVerified');
    
    if (proofEvents.length === 0) {
      console.log('⚠️  No ProofVerified events found');
      console.log('   This might not be a proof verification transaction');
      return;
    }
    
    console.log('🔐 PROOF VERIFICATION DETAILS:');
    console.log('========================================\n');
    
    for (const event of proofEvents) {
      const { proofHash, proofType, submitter, result } = event.args;
      
      console.log('Proof Hash:', proofHash);
      console.log('Proof Type:', proofType);
      console.log('Submitter:', submitter);
      console.log('Verified:', result ? '✅ TRUE' : '❌ FALSE');
      console.log('');
      
      // Query full proof data from contract
      try {
        const proofData = await zkVerifier.proofs(proofHash);
        console.log('📊 On-Chain Proof Data:');
        console.log('  Timestamp:', new Date(Number(proofData.timestamp) * 1000).toISOString());
        console.log('  Stored Hash:', proofData.proofHash);
        console.log('  Status:', proofData.verified ? '✅ VERIFIED' : '❌ NOT VERIFIED');
        console.log('');
      } catch (error) {
        console.log('⚠️  Could not read full proof data:', error.message);
      }
    }
    
    // Get total proofs in registry
    let registryCount = 0;
    try {
      // Try to count registry entries (this is approximate)
      for (let i = 0; i < 100; i++) {
        try {
          await zkVerifier.proofRegistry(i);
          registryCount++;
        } catch {
          break;
        }
      }
      console.log('📚 Total Proofs in Registry:', registryCount);
    } catch (error) {
      // Registry might not be readable
    }
    
    console.log('\n========================================');
    console.log('🎯 VERIFICATION COMPLETE');
    console.log('========================================\n');
    
    console.log('🔗 View on Explorer:');
    console.log(`   https://explorer.cronos.org/testnet/tx/${txHash}`);
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
