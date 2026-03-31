/**
 * Set SUI Community Pool Fees
 * 
 * Updates fee rates on-chain:
 * - Management Fee: Annual fee on NAV (max 5%)
 * - Performance Fee: Fee on profit only (max 30%)
 * 
 * Requires FeeManagerCap ownership.
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Configuration from environment - NO HARDCODED FALLBACKS
const PACKAGE_ID = process.env.NEXT_PUBLIC_SUI_PACKAGE_ID;
const POOL_STATE_ID = process.env.NEXT_PUBLIC_SUI_POOL_STATE_ID;
const FEE_MANAGER_CAP_ID = process.env.SUI_FEE_MANAGER_CAP_ID;

// Target fees (can be overridden via CLI args)
const MANAGEMENT_FEE_BPS = parseInt(process.env.MANAGEMENT_FEE_BPS || '50');   // 0.5% annual on NAV
const PERFORMANCE_FEE_BPS = parseInt(process.env.PERFORMANCE_FEE_BPS || '2000'); // 20% on profit only

/**
 * Validate required configuration
 */
function validateConfig(): void {
  const missing: string[] = [];
  if (!PACKAGE_ID) missing.push('NEXT_PUBLIC_SUI_PACKAGE_ID');
  if (!POOL_STATE_ID) missing.push('NEXT_PUBLIC_SUI_POOL_STATE_ID');
  if (!FEE_MANAGER_CAP_ID) missing.push('SUI_FEE_MANAGER_CAP_ID');
  
  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:');
    missing.forEach(v => console.error(`   - ${v}`));
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
    return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey.slice(2), 'hex'));
  }
  throw new Error('Invalid SUI_PRIVATE_KEY format. Must start with "suiprivkey" or "0x"');
}

async function main() {
  // Validate required configuration before starting
  validateConfig();
  
  console.log('\n═══════════════════════════════════════════');
  console.log('SET SUI COMMUNITY POOL FEES');
  console.log('═══════════════════════════════════════════\n');

  // Load keypair from environment
  const keypair = getKeypair();
  const feeManager = keypair.getPublicKey().toSuiAddress();

  console.log('📍 Fee Manager Account:', feeManager);
  console.log('🔑 FeeManagerCap:', FEE_MANAGER_CAP_ID);
  console.log('');
  console.log('📊 Target Fees:');
  console.log('   Management Fee:', MANAGEMENT_FEE_BPS, 'bps (' + (MANAGEMENT_FEE_BPS / 100) + '%)');
  console.log('   Performance Fee:', PERFORMANCE_FEE_BPS, 'bps (' + (PERFORMANCE_FEE_BPS / 100) + '%)');
  console.log('');

  // Connect to SUI testnet
  const client = new SuiClient({ url: getFullnodeUrl('testnet') });

  // Verify FeeManagerCap ownership
  const capObj = await client.getObject({
    id: FEE_MANAGER_CAP_ID,
    options: { showOwner: true }
  });

  if (!capObj.data) {
    throw new Error('FeeManagerCap not found');
  }

  const owner = capObj.data.owner;
  if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
    if (owner.AddressOwner !== feeManager) {
      throw new Error(`FeeManagerCap not owned by this account. Owner: ${owner.AddressOwner}`);
    }
    console.log('✅ FeeManagerCap ownership verified\n');
  } else {
    throw new Error('FeeManagerCap has unexpected owner type');
  }

  // Get current fees
  const stateObj = await client.getObject({
    id: POOL_STATE_ID,
    options: { showContent: true }
  });

  if (stateObj.data?.content?.dataType === 'moveObject') {
    const fields = stateObj.data.content.fields as Record<string, unknown>;
    console.log('Current Fees:');
    console.log('   Management Fee:', fields.management_fee_bps, 'bps (' + (Number(fields.management_fee_bps) / 100) + '%)');
    console.log('   Performance Fee:', fields.performance_fee_bps, 'bps (' + (Number(fields.performance_fee_bps) / 100) + '%)');
    console.log('');
  }

  // Build transaction
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::community_pool::set_fees`,
    arguments: [
      tx.object(FEE_MANAGER_CAP_ID),
      tx.object(POOL_STATE_ID),
      tx.pure.u64(MANAGEMENT_FEE_BPS),
      tx.pure.u64(PERFORMANCE_FEE_BPS),
    ],
  });

  console.log('🚀 Executing set_fees transaction...');

  // Execute
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

    // Verify new fees
    const updatedState = await client.getObject({
      id: POOL_STATE_ID,
      options: { showContent: true }
    });

    if (updatedState.data?.content?.dataType === 'moveObject') {
      const fields = updatedState.data.content.fields as Record<string, unknown>;
      console.log('✅ ✅ ✅  FEES UPDATED SUCCESSFULLY! ✅ ✅ ✅');
      console.log('   Management Fee: ' + fields.management_fee_bps + ' bps (' + (Number(fields.management_fee_bps) / 100) + '%)');
      console.log('   Performance Fee: ' + fields.performance_fee_bps + ' bps (' + (Number(fields.performance_fee_bps) / 100) + '%)');
      console.log('');
      console.log('   20% of all profits will now go to the MSafe treasury.');
    }
  } else {
    console.error('❌ Transaction failed:', result.effects?.status);
    process.exit(1);
  }
}

main().catch(console.error);
