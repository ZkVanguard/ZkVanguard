/**
 * Set SUI Community Pool Treasury to MSafe Multisig
 * 
 * This script calls the set_treasury admin function to point
 * all collected fees to the MSafe multisig address.
 * 
 * Usage:
 *   npx ts-node scripts/set-sui-treasury.ts
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// Configuration
const CONFIG = {
  network: 'testnet' as const,
  packageId: '0xcb37e4ea0109e5c91096c0733821e4b603a5ef8faa995cfcf6c47aa2e325b70c',
  moduleName: 'community_pool',
  
  // AdminCap object ID (owned by deployer)
  adminCapId: '0xef6d5702f58c020ff4b04e081ddb13c6e493715156ddb1d8123d502655d0e6e6',
  
  // Community Pool State (shared object)
  poolStateId: '0xb9b9c58c8c023723f631455c95c21ad3d3b00ba0fef91e42a90c9f648fa68f56',
  
  // NEW: MSafe Multisig Treasury Address
  msafeTreasury: '0x83b9f1bc3a2d32685e67fc52dce547e4e817afeeed90a996e8c6931e0ba35f2b',
  
  // Clock object (system)
  clockId: '0x6',
};

// Deployer private key (bech32 encoded)
const SUI_PRIVKEY = 'suiprivkey1qpu6rlng3uzygjusfat4vrj6nvkc7uhx6zztnrg4l27z45k4qm8h2eq0qan';

function getKeypair(): Ed25519Keypair {
  const privateKey = process.env.SUI_PRIVATE_KEY;
  if (privateKey) {
    if (privateKey.startsWith('suiprivkey')) {
      const { secretKey } = decodeSuiPrivateKey(privateKey);
      return Ed25519Keypair.fromSecretKey(secretKey);
    }
    if (privateKey.startsWith('0x')) {
      const hexStr = privateKey.slice(2);
      const bytes = new Uint8Array(hexStr.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      return Ed25519Keypair.fromSecretKey(bytes);
    }
    return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
  }
  
  // Use hardcoded bech32 key
  const { secretKey } = decodeSuiPrivateKey(SUI_PRIVKEY);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('   SET SUI COMMUNITY POOL TREASURY TO MSAFE');
  console.log('═'.repeat(60) + '\n');

  const client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
  const keypair = getKeypair();
  const adminAddress = keypair.toSuiAddress();

  console.log('📍 Admin Account:', adminAddress);
  console.log('📦 Package ID:', CONFIG.packageId);
  console.log('🏦 Pool State:', CONFIG.poolStateId);
  console.log('🔑 Admin Cap:', CONFIG.adminCapId);
  console.log('💰 New Treasury (MSafe):', CONFIG.msafeTreasury);
  console.log();

  // Get current balance
  const balance = await client.getBalance({ owner: adminAddress });
  console.log(`💰 Admin SUI Balance: ${Number(balance.totalBalance) / 1e9} SUI`);

  if (BigInt(balance.totalBalance) < 10_000_000n) {
    console.log('❌ Insufficient SUI for gas. Need at least 0.01 SUI.');
    return;
  }

  // Verify AdminCap ownership
  console.log('\n📋 Verifying AdminCap ownership...');
  try {
    const adminCap = await client.getObject({
      id: CONFIG.adminCapId,
      options: { showOwner: true },
    });
    
    if (!adminCap.data) {
      console.log('❌ AdminCap not found!');
      return;
    }

    const owner = adminCap.data.owner;
    if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
      if (owner.AddressOwner !== adminAddress) {
        console.log(`❌ AdminCap owned by ${owner.AddressOwner}, not ${adminAddress}`);
        return;
      }
      console.log('✅ AdminCap ownership verified');
    } else {
      console.log('❌ AdminCap is not owned by an address');
      return;
    }
  } catch (e: any) {
    console.log(`❌ Failed to verify AdminCap: ${e.message}`);
    return;
  }

  // Get current treasury before change
  console.log('\n📊 Current pool state...');
  try {
    const poolState = await client.getObject({
      id: CONFIG.poolStateId,
      options: { showContent: true },
    });
    
    if (poolState.data?.content && 'fields' in poolState.data.content) {
      const fields = poolState.data.content.fields as any;
      console.log(`   Current Treasury: ${fields.treasury}`);
      
      if (fields.treasury === CONFIG.msafeTreasury) {
        console.log('\n✅ Treasury is ALREADY set to MSafe address!');
        console.log('   No action needed.');
        return;
      }
    }
  } catch (e: any) {
    console.log(`   Warning: Could not read current state: ${e.message}`);
  }

  // Execute set_treasury transaction
  console.log('\n🚀 Executing set_treasury transaction...');
  
  try {
    const tx = new Transaction();
    
    tx.moveCall({
      target: `${CONFIG.packageId}::${CONFIG.moduleName}::set_treasury`,
      arguments: [
        tx.object(CONFIG.adminCapId),     // AdminCap (owned)
        tx.object(CONFIG.poolStateId),    // CommunityPoolState (shared)
        tx.pure.address(CONFIG.msafeTreasury), // new_treasury address
        tx.object(CONFIG.clockId),        // Clock (shared system)
      ],
    });
    
    tx.setGasBudget(10_000_000); // 0.01 SUI

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });

    console.log('\n✅ Transaction submitted!');
    console.log(`   TX Digest: ${result.digest}`);
    console.log(`   Explorer: https://suiscan.xyz/testnet/tx/${result.digest}`);

    // Wait for confirmation
    console.log('\n⏳ Waiting for confirmation...');
    const txResult = await client.waitForTransaction({
      digest: result.digest,
      options: { showEffects: true },
    });

    if (txResult.effects?.status?.status === 'success') {
      console.log('\n✅ ✅ ✅  TREASURY UPDATED SUCCESSFULLY! ✅ ✅ ✅');
      console.log(`\n   Treasury is now: ${CONFIG.msafeTreasury}`);
      console.log('   All future fees will be collected to the MSafe multisig.');
    } else {
      console.log('\n❌ Transaction failed:', txResult.effects?.status?.error);
    }
  } catch (e: any) {
    console.log(`\n❌ Transaction failed: ${e.message}`);
    if (e.message?.includes('InsufficientGas')) {
      console.log('   Tip: Admin account needs more SUI for gas');
    }
    if (e.message?.includes('Unauthorized')) {
      console.log('   Tip: AdminCap ownership issue');
    }
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(console.error);
