#!/usr/bin/env npx tsx
/**
 * EMERGENCY: pause the SUI USDC community pool.
 *
 * Required after discovering the withdrawal-underpayment bug
 * (project_pool_withdrawal_underpayment_bug memo). Pausing freezes BOTH
 * deposits and withdrawals so:
 *   - Existing members can't get shortchanged by withdrawing against
 *     the depleted on-chain balance
 *   - New depositors can't get over-issued shares against the same
 *     depleted balance
 *
 * Requires: SUI_POOL_ADMIN_KEY + SUI_ADMIN_CAP_ID in .env.local OR the
 * Vercel env pulled to .env.vercel.tmp.
 *
 * Run:  bun run scripts/pause-sui-pool.ts            (DRY RUN — shows current state)
 *       bun run scripts/pause-sui-pool.ts --commit   (actually sends the tx)
 *
 * To unpause later: bun run scripts/pause-sui-pool.ts --unpause --commit
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

const COMMIT = process.argv.includes('--commit');
const UNPAUSE = process.argv.includes('--unpause');

async function main() {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const adminCapId = (process.env.SUI_ADMIN_CAP_ID || '').trim();
  const packageId = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID
    || process.env.NEXT_PUBLIC_SUI_PACKAGE_ID || '').trim();
  const poolStateId = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE
    || process.env.NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE || '').trim();

  console.log('config:');
  console.log('  adminKey:        ', adminKey ? '<set>' : '!! MISSING');
  console.log('  adminCapId:      ', adminCapId || '!! MISSING');
  console.log('  packageId:       ', packageId || '!! MISSING');
  console.log('  poolStateId:     ', poolStateId || '!! MISSING');
  console.log('  action:          ', UNPAUSE ? 'UNPAUSE' : 'PAUSE');
  console.log('  commit:          ', COMMIT);

  if (!adminKey || !adminCapId || !packageId || !poolStateId) {
    console.error('\nMissing required env. Aborting.');
    process.exit(1);
  }

  const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
  const { Transaction } = await import('@mysten/sui/transactions');
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');

  const client = new SuiClient({ url: (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim() });
  const kp = adminKey.startsWith('suiprivkey')
    ? Ed25519Keypair.fromSecretKey(adminKey)
    : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
  console.log('\nsigner address:', kp.toSuiAddress());

  // Pre-flight: confirm AdminCap is actually owned by signer
  const capObj = await client.getObject({ id: adminCapId, options: { showOwner: true } });
  const owner = (capObj.data?.owner as { AddressOwner?: string } | undefined)?.AddressOwner;
  console.log('AdminCap owner: ', owner || '(unreadable)');
  if (owner?.toLowerCase() !== kp.toSuiAddress().toLowerCase()) {
    console.error('\nAdminCap is NOT owned by the cron signer. Cannot pause from here.');
    console.error('Multi-sig route required.');
    process.exit(1);
  }

  // Pre-flight: current pause state
  const stateObj = await client.getObject({ id: poolStateId, options: { showContent: true } });
  const currentPaused = (stateObj.data?.content as any)?.fields?.paused;
  console.log('current paused:', currentPaused);

  if (!COMMIT) {
    console.log('\nDRY RUN. Re-run with --commit to send the tx.');
    return;
  }

  // SUI_USDC coin type from constants (same as the cron)
  const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::community_pool_usdc::set_paused`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(adminCapId),
      tx.object(poolStateId),
      tx.pure.bool(!UNPAUSE),
      tx.object('0x6'), // Clock
    ],
  });
  tx.setGasBudget(20_000_000);

  console.log('\nSending tx...');
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
  const ok = r.effects?.status?.status === 'success';
  console.log('result:', ok ? 'SUCCESS' : 'FAILED');
  console.log('digest:', r.digest);
  if (!ok) console.log('error:', r.effects?.status?.error);
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
