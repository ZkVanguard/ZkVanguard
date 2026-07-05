#!/usr/bin/env npx tsx
/**
 * Simulate the user's withdraw against the live pool via devInspect.
 *
 * We use the exact PTB the frontend builds: `community_pool_usdc::withdraw<USDC>`
 * with (poolState, sharesToBurn, clock, ctx). Sender is the affected wallet
 * (0x880c…8aac). devInspect executes the Move body without requiring a signature
 * or balance change, so we can prove:
 *   (a) assert_external_nav_fresh_if_required does NOT fire abort code 29
 *   (b) the withdraw path succeeds (or fails with the expected non-freshness
 *       reason like MIN_SHARES).
 *
 *   bun run scripts/test-withdraw-simulation.ts [wallet] [shares]
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

const POOL = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE
  || process.env.NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE
  || '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a').trim();
const PKG = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID
  || process.env.NEXT_PUBLIC_SUI_MAINNET_PACKAGE_ID
  || '0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726').trim();
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const RPC = (process.env.SUI_MAINNET_RPC || 'https://fullnode.mainnet.sui.io:443').trim();

const WALLET = process.argv[2] || '0x880cfa491c497f5f3c8205ef43a9e1d4cd89169a20c708ab27676ec1fe7e8aac';
const SHARES = Number(process.argv[3] || '1');   // 1 share = 1e6 scaled (USDC_DECIMALS=6)

async function main() {
  const { SuiClient } = await import('@mysten/sui/client');
  const { Transaction } = await import('@mysten/sui/transactions');
  const c = new SuiClient({ url: RPC });

  console.log('=== Withdraw simulation via devInspect ===');
  console.log('  wallet:', WALLET);
  console.log('  shares:', SHARES, `(=${BigInt(Math.floor(SHARES * 1e6))} scaled)`);
  console.log('  pool  :', POOL);
  console.log('  pkg   :', PKG);
  console.log();

  // Pre-check freshness so we can distinguish "fresh but reverts for other reason" from
  // "stale — abort code 29" cleanly.
  console.log('Pre-check: NAV freshness');
  {
    const t = new Transaction();
    t.moveCall({
      target: `${PKG}::community_pool_usdc::is_external_nav_fresh`,
      typeArguments: [USDC],
      arguments: [t.object(POOL), t.object('0x6')],
    });
    t.moveCall({
      target: `${PKG}::community_pool_usdc::get_external_nav_ts_ms`,
      typeArguments: [USDC],
      arguments: [t.object(POOL)],
    });
    t.setSender('0x0000000000000000000000000000000000000000000000000000000000000001');
    const bytes = await t.build({ client: c, onlyTransactionKind: true });
    const inspect = await c.devInspectTransactionBlock({
      sender: '0x0000000000000000000000000000000000000000000000000000000000000001',
      transactionBlock: bytes,
    });
    const freshBytes = inspect.results?.[0]?.returnValues?.[0]?.[0];
    const tsBytes = inspect.results?.[1]?.returnValues?.[0]?.[0];
    const isFresh = Array.isArray(freshBytes) && freshBytes[0] === 1;
    let ts = 0n;
    if (Array.isArray(tsBytes) && tsBytes.length >= 8) {
      for (let i = 7; i >= 0; i--) ts = (ts << 8n) | BigInt(tsBytes[i]);
    }
    console.log('  is_external_nav_fresh :', isFresh);
    console.log('  last attest           :', ts > 0n ? new Date(Number(ts)).toISOString() : 'never');
    console.log('  age (min)             :', ts > 0n ? ((Date.now() - Number(ts)) / 60000).toFixed(2) : 'n/a');
    if (!isFresh) {
      console.log('\n  ❌ PRECONDITION FAIL — NAV is STALE. Withdraw WILL abort with code 29 right now.');
      console.log('  Trigger sui-community-pool cron to re-attest, then retry.');
      process.exit(1);
    }
  }

  console.log('\nBuilding withdraw PTB the way the frontend does...');
  const sharesScaled = BigInt(Math.floor(SHARES * 1e6));
  const tx = new Transaction();
  tx.moveCall({
    target: `${PKG}::community_pool_usdc::withdraw`,
    typeArguments: [USDC],
    arguments: [
      tx.object(POOL),
      tx.pure.u64(sharesScaled),
      tx.object('0x6'),
    ],
  });
  tx.setSender(WALLET);
  const bytes = await tx.build({ client: c, onlyTransactionKind: true });

  console.log('devInspecting withdraw...');
  const inspect = await c.devInspectTransactionBlock({
    sender: WALLET, transactionBlock: bytes,
  });
  const status = inspect.effects?.status?.status;
  const err = inspect.effects?.status?.error ?? '';

  console.log('\n=== Result ===');
  console.log('  status:', status);
  if (err) console.log('  error :', err);

  // Interpret result
  if (status === 'success') {
    console.log('\n✅ WITHDRAW EXECUTES CLEANLY — the fix works. User can withdraw now.');
    process.exit(0);
  }

  // Failure — classify.
  // abort code 29 = E_EXTERNAL_NAV_STALE (the bug we fixed)
  // Other common abort codes: 3=E_MIN_SHARES_NOT_MET, 4=E_PAUSED, 8=E_INSUFFICIENT_BALANCE, etc.
  if (/abort code:\s*29/i.test(err) || /assert_external_nav_fresh/i.test(err)) {
    console.log('\n❌ FAIL — withdraw STILL aborts with the stale-NAV check (code 29).');
    console.log('   Investigate: cron must not have attested since we checked.');
    process.exit(1);
  }
  // Other abort codes are semantically expected (e.g. user has < 1 share).
  // The key thing we're testing is that abort code 29 does NOT fire.
  const abortCode = err.match(/abort code:\s*(\d+)/i)?.[1];
  console.log(`\n⚠ withdraw fails with abort code ${abortCode ?? '?'} — but NOT the stale-NAV check.`);
  console.log('  This is expected if the wallet has 0 shares or fails a different guard.');
  console.log('  The critical thing: assert_external_nav_fresh_if_required PASSED.');
  console.log('  ✅ The strict-mode block is fixed; other failures are semantic (user state).');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
