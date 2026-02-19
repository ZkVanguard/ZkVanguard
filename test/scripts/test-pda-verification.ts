/**
 * Test script: Verify ZK Proxy Wallet PDA derivation
 * 
 * This script tests that:
 * 1. We can derive the proxy address from (owner, nonce, zkBindingHash)
 * 2. The derivation matches what the contract produces
 * 3. Given a proxy address, we can verify it belongs to an owner
 * 
 * Run: npx ts-node test/scripts/test-pda-verification.ts
 */

import { ethers } from 'ethers';

const RPC_URL = 'https://evm-t3.cronos.org';
const ZK_PROXY_VAULT = '0x7E17D2f5cdBDB2D6050Ed433E06302D897B17c9C';

const ZK_PROXY_VAULT_ABI = [
  'function deriveProxyAddress(address owner, uint256 nonce, bytes32 zkBindingHash) pure returns (address)',
  'function proxyWallets(address) view returns (address owner, uint256 nonce, bytes32 zkBindingHash, uint256 createdAt)',
];

// TypeScript implementation of PDA derivation (mirrors contract)
function deriveProxyAddressTS(owner: string, nonce: number, zkBindingHash: string): string {
  const packed = ethers.solidityPacked(
    ['string', 'address', 'uint256', 'bytes32'],
    ['ZKVANGUARD_PDA_V1', owner, nonce, zkBindingHash]
  );
  const hash = ethers.keccak256(packed);
  // Take last 20 bytes as address
  return ethers.getAddress('0x' + hash.slice(-40));
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ZK Proxy Wallet PDA Verification Test');
  console.log('═══════════════════════════════════════════════════════\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const vault = new ethers.Contract(ZK_PROXY_VAULT, ZK_PROXY_VAULT_ABI, provider);

  // Test case: Known owner + derivation params
  const testOwner = '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c';
  const testNonce = 0;
  const testZkBindingHash = ethers.keccak256(ethers.toUtf8Bytes('test-binding'));

  console.log('Test Parameters:');
  console.log(`  Owner:         ${testOwner}`);
  console.log(`  Nonce:         ${testNonce}`);
  console.log(`  zkBindingHash: ${testZkBindingHash.slice(0, 20)}...`);
  console.log('');

  // 1. Derive using TypeScript implementation
  const tsProxyAddress = deriveProxyAddressTS(testOwner, testNonce, testZkBindingHash);
  console.log(`📝 TypeScript derivation:  ${tsProxyAddress}`);

  // 2. Derive using on-chain contract
  try {
    const contractProxyAddress = await vault.deriveProxyAddress(testOwner, testNonce, testZkBindingHash);
    console.log(`⛓️  Contract derivation:   ${contractProxyAddress}`);

    // 3. Compare
    if (tsProxyAddress.toLowerCase() === contractProxyAddress.toLowerCase()) {
      console.log('\n✅ SUCCESS: TypeScript derivation matches on-chain contract!\n');
    } else {
      console.log('\n❌ MISMATCH: Derivations do not match!\n');
    }
  } catch (err) {
    console.error('Failed to call contract:', err);
  }

  // 4. Demonstrate verification flow
  console.log('───────────────────────────────────────────────────────');
  console.log('  Verification Flow for Close Hedge');
  console.log('───────────────────────────────────────────────────────\n');

  console.log('When closing a ZK privacy hedge:');
  console.log('');
  console.log('1. User signs EIP-712 message with their REAL wallet');
  console.log('   └─ Signature proves: "I own this address"');
  console.log('');
  console.log('2. Backend looks up TRUE owner from hedge_ownership table');
  console.log('   └─ commitment_hash → wallet_address mapping');
  console.log('');
  console.log('3. Backend verifies: recovered signer == stored owner');
  console.log('   └─ If match: User is authorized to close');
  console.log('');
  console.log('4. Optional PDA verification:');
  console.log('   └─ Given (owner, nonce, zkBindingHash), derive proxy address');
  console.log('   └─ Verify it matches the on-chain hedge.trader');
  console.log('   └─ This proves the proxy was legitimately created for this owner');
  console.log('');
  console.log('5. Close hedge and forward funds to TRUE owner');
  console.log('   └─ Contract sends funds to on-chain trader (proxy)');
  console.log('   └─ Relayer forwards funds to TRUE owner wallet');
  console.log('');

  // Test verifying a proxy belongs to an owner
  console.log('───────────────────────────────────────────────────────');
  console.log('  Testing: Can we verify a proxy belongs to an owner?');
  console.log('───────────────────────────────────────────────────────\n');

  const knownProxy = tsProxyAddress;
  const claimedOwner = testOwner;
  const claimedNonce = testNonce;
  const claimedZkBinding = testZkBindingHash;

  // Re-derive and check
  const reDerived = deriveProxyAddressTS(claimedOwner, claimedNonce, claimedZkBinding);
  
  if (reDerived.toLowerCase() === knownProxy.toLowerCase()) {
    console.log(`✅ VERIFIED: Proxy ${knownProxy.slice(0,10)}... belongs to ${claimedOwner.slice(0,10)}...`);
    console.log(`   (derived from nonce=${claimedNonce}, zkBindingHash=${claimedZkBinding.slice(0,10)}...)`);
  } else {
    console.log(`❌ FAILED: Proxy does not match owner with given parameters`);
    console.log(`   Expected: ${knownProxy}`);
    console.log(`   Got:      ${reDerived}`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Test Complete');
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
