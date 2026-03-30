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

// Configuration
const PACKAGE_ID = '0xcb37e4ea0109e5c91096c0733821e4b603a5ef8faa995cfcf6c47aa2e325b70c';
const POOL_STATE_ID = '0xb9b9c58c8c023723f631455c95c21ad3d3b00ba0fef91e42a90c9f648fa68f56';
const FEE_MANAGER_CAP_ID = '0x705d008ef94b9efdb6ed5a5c1e02e93a4e638fffe6714c1924537ac653c97af6';

// Deployer private key (same as treasury script)
const SUI_PRIVKEY = '***REDACTED_LEAKED_KEY_2***';

// Target fees
const MANAGEMENT_FEE_BPS = 50;   // 0.5% annual on NAV
const PERFORMANCE_FEE_BPS = 2000; // 20% on profit only

async function main() {
  console.log('\n═══════════════════════════════════════════');
  console.log('SET SUI COMMUNITY POOL FEES');
  console.log('═══════════════════════════════════════════\n');

  // Load keypair
  const { secretKey } = decodeSuiPrivateKey(SUI_PRIVKEY);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
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
