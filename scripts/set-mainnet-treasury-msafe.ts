/**
 * Set the SUI mainnet USDC pool treasury to the MSafe multisig.
 *
 * Reads:
 *   SUI_MSAFE_ADDRESS                              — target multisig safe
 *   NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID   — pool package
 *   NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE        — pool shared state
 *   SUI_ADMIN_CAP_ID                               — owned AdminCap
 *   SUI_POOL_ADMIN_KEY (or SUI_PRIVATE_KEY)        — current admin signer
 *
 * Idempotent: if treasury is already set to the MSafe address, exits 0
 * without sending a transaction.
 *
 * Run:
 *   npx tsx --env-file=.env.production scripts/set-mainnet-treasury-msafe.ts
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SUI_USDC_COIN_TYPE } from '../lib/types/sui-pool-types';

const NETWORK = 'mainnet' as const;

function need(name: string): string {
  const v = (process.env[name] || '').trim();
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function getKeypair(): Ed25519Keypair {
  const key = (process.env.SUI_POOL_ADMIN_KEY || process.env.SUI_PRIVATE_KEY || '').trim();
  if (!key) throw new Error('SUI_POOL_ADMIN_KEY or SUI_PRIVATE_KEY must be set');
  if (key.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(key);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  if (key.startsWith('0x')) {
    const bytes = new Uint8Array(key.slice(2).match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    return Ed25519Keypair.fromSecretKey(bytes);
  }
  return Ed25519Keypair.fromSecretKey(Buffer.from(key, 'base64'));
}

async function main() {
  const packageId = need('NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID');
  const poolStateId = need('NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE');
  const adminCapId = need('SUI_ADMIN_CAP_ID');
  const msafeAddress = need('SUI_MSAFE_ADDRESS');
  const usdcType = SUI_USDC_COIN_TYPE[NETWORK];

  const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });
  const keypair = getKeypair();
  const signer = keypair.toSuiAddress();

  console.log('═'.repeat(64));
  console.log('  SUI MAINNET — set USDC pool treasury → MSafe multisig');
  console.log('═'.repeat(64));
  console.log('  Package    :', packageId);
  console.log('  Pool State :', poolStateId);
  console.log('  AdminCap   :', adminCapId);
  console.log('  Signer     :', signer);
  console.log('  Target     :', msafeAddress);
  console.log('  USDC type  :', usdcType);
  console.log();

  // Verify AdminCap ownership before signing.
  const cap = await client.getObject({ id: adminCapId, options: { showOwner: true } });
  if (!cap.data) throw new Error(`AdminCap ${adminCapId} not found on chain`);
  const owner = cap.data.owner;
  if (!owner || typeof owner !== 'object' || !('AddressOwner' in owner)) {
    throw new Error(`AdminCap has unexpected owner type: ${JSON.stringify(owner)}`);
  }
  if (owner.AddressOwner !== signer) {
    throw new Error(
      `AdminCap is owned by ${owner.AddressOwner}, but signer is ${signer}. ` +
      `Use the original deployer key, or transfer the AdminCap first.`,
    );
  }
  console.log('  ✓ AdminCap ownership verified');

  // Read current treasury so we don't waste gas on a no-op.
  const state = await client.getObject({ id: poolStateId, options: { showContent: true } });
  if (state.data?.content?.dataType !== 'moveObject') {
    throw new Error('Pool state object missing or not a Move object');
  }
  const fields = state.data.content.fields as Record<string, unknown>;
  const currentTreasury = String(fields.treasury || '').toLowerCase();
  console.log('  Current    :', currentTreasury || '(unset)');

  if (currentTreasury === msafeAddress.toLowerCase()) {
    console.log('\n✅ Treasury already points to the MSafe address. Nothing to do.');
    return;
  }

  // Build and submit the set_treasury tx.
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::community_pool_usdc::set_treasury`,
    typeArguments: [usdcType],
    arguments: [
      tx.object(adminCapId),
      tx.object(poolStateId),
      tx.pure.address(msafeAddress),
    ],
  });

  console.log('\n→ Submitting set_treasury …');
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  if (result.effects?.status?.status !== 'success') {
    console.error('❌ Transaction failed:', JSON.stringify(result.effects?.status, null, 2));
    process.exit(1);
  }

  console.log('  ✓ TX digest :', result.digest);
  console.log('  ✓ Explorer  : https://suiscan.xyz/mainnet/tx/' + result.digest);

  // Re-read to confirm.
  await new Promise((r) => setTimeout(r, 1500));
  const after = await client.getObject({ id: poolStateId, options: { showContent: true } });
  if (after.data?.content?.dataType === 'moveObject') {
    const f = after.data.content.fields as Record<string, unknown>;
    console.log('  ✓ New treasury :', f.treasury);
  }
  console.log('\n✅ MSafe multisig is now the on-chain treasury for the SUI mainnet USDC pool.');
}

main().catch((err) => {
  console.error('\n❌ FAILED:', err?.message || err);
  process.exit(1);
});
