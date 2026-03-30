/**
 * Configure SUI USDC Pool - Set Treasury and Fees
 * 
 * This script configures the USDC pool that the UI actually uses:
 * - Sets treasury to MSafe multisig
 * - Sets performance fee to 20%
 * 
 * Usage: npx tsx scripts/configure-sui-usdc-pool.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// USDC Pool Configuration (the one the UI uses)
const CONFIG = {
  network: 'testnet' as const,
  packageId: process.env.NEXT_PUBLIC_SUI_USDC_POOL_PACKAGE_ID || '0xcac1e7de082a92ec3db4a4f0766f1a73e9f8c22e50a3dafed6d81dc043bd0ac9',
  poolStateId: process.env.NEXT_PUBLIC_SUI_USDC_POOL_STATE_TESTNET || '0x9f77819f91d75833f86259025068da493bb1c7215ed84f39d5ad0f5bc1b40971',
  adminCapId: process.env.NEXT_PUBLIC_SUI_USDC_ADMIN_CAP || '0x21ecdca39b66a545d8029201f4c70dbeee8ea826245705ace58717e8e901c321',
  
  // Target settings
  msafeTreasury: process.env.SUI_MSAFE_ADDRESS || '0x83b9f1bc3a2d32685e67fc52dce547e4e817afeeed90a996e8c6931e0ba35f2b',
  managementFeeBps: 50,    // 0.5% annual
  performanceFeeBps: 2000, // 20% on profit
};

function getKeypair(): Ed25519Keypair {
  // Try SUI_POOL_ADMIN_KEY first (deployer of USDC pool)
  const poolAdminKey = process.env.SUI_POOL_ADMIN_KEY;
  if (poolAdminKey && poolAdminKey.startsWith('0x')) {
    const hexStr = poolAdminKey.slice(2);
    const bytes = new Uint8Array(hexStr.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    return Ed25519Keypair.fromSecretKey(bytes);
  }
  
  const privateKey = process.env.SUI_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('Neither SUI_POOL_ADMIN_KEY nor SUI_PRIVATE_KEY set in .env.local');
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
  return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('   CONFIGURE SUI USDC POOL (UI POOL)');
  console.log('═'.repeat(60) + '\n');

  const client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
  const keypair = getKeypair();
  const adminAddress = keypair.toSuiAddress();

  console.log('📍 Admin Account:', adminAddress);
  console.log('📦 Package ID:', CONFIG.packageId);
  console.log('🏦 Pool State:', CONFIG.poolStateId);
  console.log('🔑 Admin Cap:', CONFIG.adminCapId);
  console.log();

  // Verify AdminCap ownership
  const capObj = await client.getObject({
    id: CONFIG.adminCapId,
    options: { showOwner: true }
  });

  if (!capObj.data) {
    throw new Error('AdminCap not found');
  }

  const owner = capObj.data.owner;
  if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
    if (owner.AddressOwner !== adminAddress) {
      throw new Error(`AdminCap not owned by this account. Owner: ${owner.AddressOwner}`);
    }
    console.log('✅ AdminCap ownership verified\n');
  } else {
    throw new Error('AdminCap has unexpected owner type');
  }

  // Check current state
  const stateObj = await client.getObject({
    id: CONFIG.poolStateId,
    options: { showContent: true }
  });

  if (stateObj.data?.content?.dataType === 'moveObject') {
    const fields = stateObj.data.content.fields as Record<string, unknown>;
    console.log('Current State:');
    console.log('  Treasury:', fields.treasury_address || 'not set');
    console.log('  Management Fee:', fields.management_fee_bps, 'bps');
    console.log('  Performance Fee:', fields.performance_fee_bps, 'bps');
    console.log();
  }

  // Build transaction with multiple operations
  const tx = new Transaction();

  // 1. Set Treasury
  console.log('🔧 Step 1: Setting treasury to MSafe...');
  tx.moveCall({
    target: `${CONFIG.packageId}::community_pool_usdc::set_treasury`,
    arguments: [
      tx.object(CONFIG.adminCapId),
      tx.object(CONFIG.poolStateId),
      tx.pure.address(CONFIG.msafeTreasury),
    ],
  });

  // 2. Set Fees
  console.log('🔧 Step 2: Setting fees (20% performance)...');
  tx.moveCall({
    target: `${CONFIG.packageId}::community_pool_usdc::set_fees`,
    arguments: [
      tx.object(CONFIG.adminCapId),
      tx.object(CONFIG.poolStateId),
      tx.pure.u64(CONFIG.managementFeeBps),
      tx.pure.u64(CONFIG.performanceFeeBps),
    ],
  });

  console.log('\n🚀 Executing transaction...');

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: {
      showEffects: true,
    },
  });

  if (result.effects?.status?.status === 'success') {
    console.log('✅ Transaction submitted!');
    console.log('   TX Digest:', result.digest);
    console.log('   Explorer: https://suiscan.xyz/testnet/tx/' + result.digest);
    console.log('');

    // Verify new state
    const updatedState = await client.getObject({
      id: CONFIG.poolStateId,
      options: { showContent: true }
    });

    if (updatedState.data?.content?.dataType === 'moveObject') {
      const fields = updatedState.data.content.fields as Record<string, unknown>;
      console.log('✅ ✅ ✅  USDC POOL CONFIGURED! ✅ ✅ ✅');
      console.log('  Treasury:', fields.treasury_address);
      console.log('  Management Fee:', fields.management_fee_bps, 'bps (' + (Number(fields.management_fee_bps) / 100) + '%)');
      console.log('  Performance Fee:', fields.performance_fee_bps, 'bps (' + (Number(fields.performance_fee_bps) / 100) + '%)');
      console.log('');
      console.log('🎉 The UI pool is now configured with MSafe treasury and 20% performance fee!');
    }
  } else {
    console.error('❌ Transaction failed:', result.effects?.status);
    process.exit(1);
  }
}

main().catch(console.error);
