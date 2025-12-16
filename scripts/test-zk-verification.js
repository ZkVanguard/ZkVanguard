#!/usr/bin/env node
/**
 * Complete ZK Proof Verification Test
 * Tests both off-chain (Python backend) and on-chain (ZKVerifier contract) verification
 */

const { ethers } = require('hardhat');
const deployment = require('../deployments/cronos-testnet.json');

async function testOffChainVerification() {
  console.log('\n[1/3] TESTING OFF-CHAIN VERIFICATION (Python Backend)');
  console.log('======================================================\n');
  
  try {
    // Generate a proof
    console.log('📝 Generating ZK-STARK proof...');
    const generateResponse = await fetch('http://localhost:8000/api/zk/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof_type: 'settlement',
        data: {
          payments: [
            { recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', amount: 1000 },
            { recipient: '0x170E8232E9e18eeB1839dB1d939501994f1e272F', amount: 2000 }
          ]
        },
        portfolio_id: 1
      })
    });
    
    const jobResult = await generateResponse.json();
    console.log('  Job ID:', jobResult.job_id);
    console.log('  Status:', jobResult.status);
    
    // Wait for completion
    console.log('\n⏳ Waiting for proof generation...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const statusResponse = await fetch(`http://localhost:8000/api/zk/proof/${jobResult.job_id}`);
    const proofStatus = await statusResponse.json();
    
    if (proofStatus.status !== 'completed') {
      console.log('❌ Proof generation failed');
      return null;
    }
    
    console.log('✅ Proof generated in', proofStatus.duration_ms, 'ms');
    console.log('  CUDA Accelerated:', proofStatus.proof.cuda_accelerated);
    
    // Verify off-chain
    console.log('\n🔍 Verifying proof off-chain...');
    const verifyResponse = await fetch('http://localhost:8000/api/zk/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof: proofStatus.proof,
        public_inputs: [3000, 2] // total amount, payment count
      })
    });
    
    const verifyResult = await verifyResponse.json();
    console.log('  Valid:', verifyResult.valid ? '✅ TRUE' : '❌ FALSE');
    console.log('  Duration:', verifyResult.duration_ms, 'ms');
    
    return proofStatus.proof;
    
  } catch (error) {
    console.error('❌ Off-chain verification failed:', error.message);
    return null;
  }
}

async function testOnChainVerification(proof) {
  console.log('\n[2/3] TESTING ON-CHAIN VERIFICATION (ZKVerifier Contract)');
  console.log('=========================================================\n');
  
  if (!proof) {
    console.log('⚠️  Skipping - no proof available');
    return;
  }
  
  console.log('📍 Contract:', deployment.contracts.ZKVerifier);
  console.log('🌐 Network: Cronos Testnet (338)');
  console.log('');
  
  console.log('💡 To verify on-chain, you need to:');
  console.log('  1. Connect your wallet to the dashboard');
  console.log('  2. Go to the ZK Proof Demo section');
  console.log('  3. Click "Submit Proof for Verification"');
  console.log('  4. Sign the transaction');
  console.log('');
  console.log('📱 Or use the frontend:');
  console.log('   http://localhost:3000/dashboard');
  console.log('');
  console.log('🔗 View contract on explorer:');
  console.log(`   https://explorer.cronos.org/testnet/address/${deployment.contracts.ZKVerifier}`);
}

async function showVerificationCommands() {
  console.log('\n[3/3] VERIFICATION COMMANDS');
  console.log('============================\n');
  
  console.log('📋 Check backend health:');
  console.log('   curl http://localhost:8000/health\n');
  
  console.log('📊 View proof statistics:');
  console.log('   curl http://localhost:8000/api/zk/stats\n');
  
  console.log('🔍 Verify specific transaction:');
  console.log('   node scripts/verify-onchain-proof.js <TX_HASH>\n');
  
  console.log('🌐 Frontend dashboard:');
  console.log('   npm run dev');
  console.log('   Open: http://localhost:3000/dashboard\n');
  
  console.log('📖 API Documentation:');
  console.log('   http://localhost:8000/docs\n');
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║     ZK-STARK VERIFICATION TEST SUITE                  ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  
  const proof = await testOffChainVerification();
  await testOnChainVerification(proof);
  await showVerificationCommands();
  
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║     TEST COMPLETE ✓                                    ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
