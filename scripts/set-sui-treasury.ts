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
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Configuration - ALL values MUST be explicitly set via environment variables
const CONFIG = {
  network: 'testnet' as const,
  packageId: process.env.NEXT_PUBLIC_SUI_PACKAGE_ID,
  moduleName: 'community_pool',
  
  // AdminCap object ID (owned by deployer)
  adminCapId: process.env.SUI_ADMIN_CAP_ID,
  
  // Community Pool State (shared object)
  poolStateId: process.env.NEXT_PUBLIC_SUI_POOL_STATE_ID,
  
  // MSafe Multisig Treasury Address
  msafeTreasury: process.env.MSAFE_TREASURY_ADDRESS,
  
  // Clock object (system)
  clockId: '0x6',
};

/**
 * Validate all required configuration is present
 */
function validateConfig(): void {
  const required: Array<{ key: keyof typeof CONFIG; envVar: string }> = [
    { key: 'packageId', envVar: 'NEXT_PUBLIC_SUI_PACKAGE_ID' },
    { key: 'adminCapId', envVar: 'SUI_ADMIN_CAP_ID' },
    { key: 'poolStateId', envVar: 'NEXT_PUBLIC_SUI_POOL_STATE_ID' },
    { key: 'msafeTreasury', envVar: 'MSAFE_TREASURY_ADDRESS' },
  ];
  
  const missing = required.filter(r => !CONFIG[r.key]);
  
  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:');
    missing.forEach(r => console.error(`   - ${r.envVar}`));
    console.error('\nPlease set these in .env.local before running this script.');
    process.exit(1);
  }
}

function getKeypair(): Ed25519Keypair {
  const privateKey = process.env.SUI_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      'SUI_PRIVATE_KEY not set. Add it to .env.local for local development ' +
      'or set it in Vercel environment variables for production.'
    );
  }
  
  if (privateKey.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  if (privateKey.startsWith('0x')) {
    const hexStr = privateKey.slice(2);
    const bytes = new Uint8Array(hexStr.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    return Ed25519Keypair.fromSecretKey(bytes);
  }
  // Assume base64 encoded
  return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
}

async function main() {
  // Validate all required configuration before starting
  validateConfig();
  
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
