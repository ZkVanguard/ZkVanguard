/**
 * Transfer the SUI mainnet `AdminCap` to the MSafe multisig.
 *
 * AdminCap currently controls:
 *   - set_treasury        (where fees go)            ← critical $$ vector
 *   - set_fees rate ceil  (via FeeManagerCap actually)
 *   - set_withdrawal_limits (circuit breaker)
 *   - pause / unpause
 *   - admin_reset_daily_hedge (used by cron auto-reset)
 *   - emergency functions
 *
 * TRADEOFF: the cron's AI-driven daily-cap reset will stop working once
 * AdminCap leaves the cron's hot key. The cron is already coded to detect
 * this and treat the daily cap as a hard-stop until a human resets it
 * via the multisig (see aiDrivenResetDailyHedge in the cron route).
 *
 * Reads:
 *   SUI_ADMIN_CAP_ID   — owned AdminCap object id
 *   SUI_MSAFE_ADDRESS  — multisig safe address
 *   SUI_POOL_ADMIN_KEY — current owner key
 *
 * Idempotent. Run when ready:
 *   npx tsx --env-file=.env.production scripts/transfer-admin-cap-to-msafe.ts
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

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
  const capId = need('SUI_ADMIN_CAP_ID');
  const msafe = need('SUI_MSAFE_ADDRESS');

  const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });
  const keypair = getKeypair();
  const signer = keypair.toSuiAddress();

  console.log('═'.repeat(64));
  console.log('  SUI MAINNET — transfer AdminCap → MSafe multisig');
  console.log('═'.repeat(64));
  console.log('  Signer  :', signer);
  console.log('  Cap     :', capId);
  console.log('  Target  :', msafe);
  console.log();
  console.log('  ⚠  After this transfer, AI-driven daily-cap reset stops.');
  console.log('     Daily cap becomes a hard-stop until manually reset via multisig.');
  console.log();

  const cap = await client.getObject({
    id: capId,
    options: { showOwner: true, showType: true },
  });
  if (!cap.data) throw new Error(`Object ${capId} not found on chain`);
  if (!String(cap.data.type || '').includes('AdminCap')) {
    throw new Error(`Object ${capId} is not an AdminCap (type=${cap.data.type})`);
  }
  const owner = cap.data.owner;
  if (!owner || typeof owner !== 'object' || !('AddressOwner' in owner)) {
    throw new Error(`AdminCap has unexpected owner type: ${JSON.stringify(owner)}`);
  }
  console.log('  Owner   :', owner.AddressOwner);

  if (owner.AddressOwner.toLowerCase() === msafe.toLowerCase()) {
    console.log('\n✅ AdminCap already owned by the MSafe. Nothing to do.');
    return;
  }
  if (owner.AddressOwner.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(
      `AdminCap is owned by ${owner.AddressOwner}, but signer is ${signer}. Cannot transfer.`,
    );
  }

  const tx = new Transaction();
  tx.transferObjects([tx.object(capId)], tx.pure.address(msafe));

  console.log('→ Submitting transferObject …');
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
  const after = await client.getObject({ id: capId, options: { showOwner: true } });
  const newOwner = after.data?.owner;
  if (newOwner && typeof newOwner === 'object' && 'AddressOwner' in newOwner) {
    console.log('  ✓ New owner :', newOwner.AddressOwner);
  }
  console.log('\n✅ AdminCap is now controlled by the MSafe multisig.');
  console.log('   set_treasury / pause / withdrawal-limit changes require 2-of-2 signers.');
}

main().catch((err) => {
  console.error('\n❌ FAILED:', err?.message || err);
  process.exit(1);
});
