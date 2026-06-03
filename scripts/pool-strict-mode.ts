#!/usr/bin/env npx tsx
/**
 * Flip the SUI USDC pool's external-NAV freshness requirement.
 *
 *   bun run scripts/pool-strict-mode.ts                  (DRY RUN)
 *   bun run scripts/pool-strict-mode.ts --commit         (turn ON strict)
 *   bun run scripts/pool-strict-mode.ts --off --commit   (turn OFF, emergency)
 *
 * When strict mode is ON, deposit + withdraw revert if the cron hasn't
 * attested external NAV within EXTERNAL_NAV_MAX_AGE_MS (2h on-chain).
 * Run this only AFTER the cron's attestation has been observed firing
 * cleanly for at least 2 cycles.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

const COMMIT = process.argv.includes('--commit');
const TURN_OFF = process.argv.includes('--off');

async function main() {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const adminCapId = (process.env.SUI_ADMIN_CAP_ID || '').trim();
  const packageId = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID
    || process.env.NEXT_PUBLIC_SUI_PACKAGE_ID || '').trim();
  const poolStateId = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE
    || process.env.NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE || '').trim();

  console.log('action:        ', TURN_OFF ? 'OFF (allow stale oracle)' : 'ON (require fresh oracle)');
  console.log('commit:        ', COMMIT);
  console.log('packageId:     ', packageId || 'MISSING');
  console.log('poolStateId:   ', poolStateId || 'MISSING');
  console.log('adminCapId:    ', adminCapId || 'MISSING');

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
  console.log('signer address:', kp.toSuiAddress());

  if (!COMMIT) {
    console.log('\nDRY RUN. Re-run with --commit to send the tx.');
    return;
  }

  const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::community_pool_usdc::admin_set_external_nav_required`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(adminCapId),
      tx.object(poolStateId),
      tx.pure.bool(!TURN_OFF),
    ],
  });
  tx.setGasBudget(10_000_000);

  console.log('\nSending tx...');
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
  const ok = r.effects?.status?.status === 'success';
  console.log('result:', ok ? 'SUCCESS' : 'FAILED');
  console.log('digest:', r.digest);
  if (!ok) console.log('error:', r.effects?.status?.error);
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
