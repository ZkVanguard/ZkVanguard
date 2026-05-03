/**
 * Revert SUI mainnet USDC pool treasury back to the operator hot wallet.
 *
 * Why: the on-chain `treasury` field is overloaded — it is both the fee
 * receiver AND the hedge-collateral handoff address. `open_hedge` transfers
 * pool USDC directly to `state.treasury`, and the cron then deposits that
 * USDC on BlueFin to open the perp leg. If treasury points at a multisig,
 * the cron cannot access the funds to deposit, breaking autonomous hedging.
 *
 * Splitting fee_treasury and operator into two fields requires a Move
 * redeploy. Until then, treasury must be the operator wallet.
 *
 * Long-term hardening (off-chain): a scheduled task runs collect_fees
 * (multisig-gated via FeeManagerCap) → fees land in operator wallet → a
 * second multisig-signed tx sweeps fees from operator to cold safe.
 *
 * Run:
 *   npx tsx --env-file=.env.production scripts/revert-treasury-to-operator.ts
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SUI_USDC_COIN_TYPE } from '../lib/types/sui-pool-types';

const NETWORK = 'mainnet' as const;

function need(name: string): string {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
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
  const usdcType = SUI_USDC_COIN_TYPE[NETWORK];

  const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });
  const keypair = getKeypair();
  const operator = keypair.toSuiAddress();

  console.log('═'.repeat(64));
  console.log('  SUI MAINNET — revert pool treasury → operator hot wallet');
  console.log('═'.repeat(64));
  console.log('  Operator (target) :', operator);
  console.log('  Pool State        :', poolStateId);
  console.log();

  const state = await client.getObject({ id: poolStateId, options: { showContent: true } });
  if (state.data?.content?.dataType !== 'moveObject') {
    throw new Error('Pool state object missing or not a Move object');
  }
  const fields = state.data.content.fields as Record<string, unknown>;
  const currentTreasury = String(fields.treasury || '').toLowerCase();
  console.log('  Current treasury  :', currentTreasury);

  if (currentTreasury === operator.toLowerCase()) {
    console.log('\n✅ Treasury already points at operator. Nothing to do.');
    return;
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::community_pool_usdc::set_treasury`,
    typeArguments: [usdcType],
    arguments: [
      tx.object(adminCapId),
      tx.object(poolStateId),
      tx.pure.address(operator),
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

  await new Promise((r) => setTimeout(r, 1500));
  const after = await client.getObject({ id: poolStateId, options: { showContent: true } });
  if (after.data?.content?.dataType === 'moveObject') {
    const f = after.data.content.fields as Record<string, unknown>;
    console.log('  ✓ New treasury :', f.treasury);
  }
  console.log('\n✅ Autonomous hedging restored.');
}

main().catch((err) => {
  console.error('\n❌ FAILED:', err?.message || err);
  process.exit(1);
});
