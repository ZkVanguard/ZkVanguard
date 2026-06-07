#!/usr/bin/env npx tsx
/**
 * Read live SUI USDC pool state + compute the share-pricing math
 * the same way the on-chain contract does.
 *
 * AUDIT 2026-06-07 phase 10: this script is the deploy verification
 * source of truth. Previous version had three correctness bugs:
 *   1. WAD constant was 1e9 (shares treated as 9-decimal); contract
 *      defines WAD = 1_000_000 (6 decimals matching USDC).
 *   2. VIRTUAL_ASSETS / VIRTUAL_SHARES used 1 (= $0.000001 in
 *      converted units); contract uses 1_000_000 raw = $1 = 1 share.
 *   3. Didn't read the external_nav dynamic field, so post-upgrade
 *      verification would show pre-upgrade math regardless of state.
 *
 * Fixed in this rewrite. The computed share price MATCHES the
 * on-chain `calculate_assets_for_shares` exactly when fed (shares=WAD).
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

// Contract constants — keep in sync with community_pool_usdc.move:
const WAD = 1_000_000;                // 1e6, shares match USDC 6-decimal precision
const VIRTUAL_ASSETS = 1_000_000;     // raw = $1
const VIRTUAL_SHARES = 1_000_000;     // raw = 1 share
const EXTERNAL_NAV_KEY = 'external_nav_usdc';
const EXTERNAL_NAV_TS_KEY = 'external_nav_ts_ms';
const EXTERNAL_NAV_REQUIRED_KEY = 'external_nav_required';
const CAP_MINTING_LOCKED_KEY = 'cap_minting_locked';
const EXTERNAL_NAV_MAX_AGE_MS = 7_200_000; // 2 hours

async function main() {
  const poolStateId = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE
    || process.env.NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE || '').trim();
  if (!poolStateId) { console.error('Missing pool state id'); process.exit(1); }

  const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
  const client = new SuiClient({ url: (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim() });

  // === read core state ===
  const obj = await client.getObject({ id: poolStateId, options: { showContent: true } });
  const fields = (obj.data?.content as any)?.fields;
  if (!fields) { console.error('No fields'); process.exit(1); }

  const balanceRaw = Number(fields.balance);
  const totalSharesRaw = Number(fields.total_shares);
  const totalDepositedRaw = Number(fields.total_deposited);
  const totalWithdrawnRaw = Number(fields.total_withdrawn);
  const paused = fields.paused;
  const circuitBroken = fields.circuit_breaker_tripped;
  const memberCount = Number(fields.member_count);
  const hedgeState = fields.hedge_state?.fields;
  const totalHedgedRaw = Number(hedgeState?.total_hedged_value ?? 0);
  const activeHedges = (hedgeState?.active_hedges || []).length;

  // === read external NAV dynamic fields (post-upgrade) ===
  const dynamicFields = await client.getDynamicFields({ parentId: poolStateId });
  let externalNavRaw = 0;
  let externalNavTsMs = 0;
  let externalNavRequired = false;
  let capMintingLocked = false;
  let hasExternalNavDfs = false;

  for (const df of dynamicFields.data) {
    const name = df.name?.value;
    if (typeof name !== 'string' && !Array.isArray(name)) continue;
    const nameStr = typeof name === 'string' ? name
      : Array.isArray(name) ? Buffer.from(name as number[]).toString('utf8') : String(name);

    if (nameStr === EXTERNAL_NAV_KEY) {
      hasExternalNavDfs = true;
      const v = await client.getDynamicFieldObject({ parentId: poolStateId, name: df.name });
      externalNavRaw = Number((v.data?.content as any)?.fields?.value ?? 0);
    } else if (nameStr === EXTERNAL_NAV_TS_KEY) {
      const v = await client.getDynamicFieldObject({ parentId: poolStateId, name: df.name });
      externalNavTsMs = Number((v.data?.content as any)?.fields?.value ?? 0);
    } else if (nameStr === EXTERNAL_NAV_REQUIRED_KEY) {
      const v = await client.getDynamicFieldObject({ parentId: poolStateId, name: df.name });
      externalNavRequired = Boolean((v.data?.content as any)?.fields?.value);
    } else if (nameStr === CAP_MINTING_LOCKED_KEY) {
      const v = await client.getDynamicFieldObject({ parentId: poolStateId, name: df.name });
      capMintingLocked = Boolean((v.data?.content as any)?.fields?.value);
    }
  }

  // === human-readable conversions ===
  const balanceUsd = balanceRaw / 1e6;
  const hedgedUsd = totalHedgedRaw / 1e6;
  const externalNavUsd = externalNavRaw / 1e6;
  const totalDepositedUsd = totalDepositedRaw / 1e6;
  const totalWithdrawnUsd = totalWithdrawnRaw / 1e6;
  const totalShares = totalSharesRaw / WAD;

  // === share-math computed the EXACT same way the contract does ===
  // total_assets_including_external (when total_shares > 0):
  //   balance + external_nav
  // (when total_shares = 0): balance only
  const totalAssetsIncludingExternalRaw = totalSharesRaw > 0
    ? balanceRaw + externalNavRaw
    : balanceRaw;
  const totalAssetsRaw = totalAssetsIncludingExternalRaw + VIRTUAL_ASSETS;
  const totalSharesVirtualRaw = totalSharesRaw + VIRTUAL_SHARES;

  // calculate_assets_for_shares(WAD raw) for ONE share:
  const onShareValueRaw = totalSharesRaw > 0
    ? (WAD * totalAssetsRaw) / totalSharesVirtualRaw
    : WAD; // returns WAD when total_shares == 0
  const onShareValueUsd = onShareValueRaw / 1e6;

  // get_total_nav() = balance + external_nav + total_hedged_value
  const totalNavRaw = balanceRaw + externalNavRaw + totalHedgedRaw;
  const totalNavUsd = totalNavRaw / 1e6;

  // freshness check
  const now = Date.now();
  const externalNavAgeMs = externalNavTsMs > 0 ? now - externalNavTsMs : -1;
  const externalNavFresh = externalNavTsMs > 0 && externalNavAgeMs >= 0 && externalNavAgeMs <= EXTERNAL_NAV_MAX_AGE_MS;

  // === report ===
  console.log('═══ POOL ON-CHAIN STATE ═══');
  console.log(`  paused:                  ${paused}`);
  console.log(`  circuit_breaker_tripped: ${circuitBroken}`);
  console.log(`  balance (raw):           ${balanceRaw}  ($${balanceUsd.toFixed(4)})`);
  console.log(`  total_shares (raw):      ${totalSharesRaw}  (${totalShares.toFixed(6)} shares)`);
  console.log(`  total_deposited:         ${totalDepositedRaw}  ($${totalDepositedUsd.toFixed(2)})`);
  console.log(`  total_withdrawn:         ${totalWithdrawnRaw}  ($${totalWithdrawnUsd.toFixed(2)})`);
  console.log(`  member_count:            ${memberCount}`);

  console.log('\n═══ HEDGE STATE ═══');
  console.log(`  total_hedged (raw):      ${totalHedgedRaw}  ($${hedgedUsd.toFixed(4)})`);
  console.log(`  active_hedges count:     ${activeHedges}`);

  console.log('\n═══ EXTERNAL NAV ORACLE (post-upgrade — dynamic fields) ═══');
  if (!hasExternalNavDfs) {
    console.log(`  STATE: PRE-UPGRADE or NO ATTESTATION YET`);
    console.log(`  external_nav dynamic field does NOT exist yet`);
    console.log(`  → share-math returns balance-only (the underpayment behavior)`);
  } else {
    console.log(`  external_nav_raw:        ${externalNavRaw}  ($${externalNavUsd.toFixed(4)})`);
    console.log(`  external_nav_ts_ms:      ${externalNavTsMs}  (${externalNavTsMs > 0 ? new Date(externalNavTsMs).toISOString() : 'never'})`);
    console.log(`  age:                     ${externalNavAgeMs >= 0 ? `${(externalNavAgeMs / 1000).toFixed(0)}s` : 'n/a'}`);
    console.log(`  is_fresh (< 2h):         ${externalNavFresh}`);
    console.log(`  strict mode required:    ${externalNavRequired}`);
  }
  console.log(`  cap minting locked:      ${capMintingLocked}`);

  console.log('\n═══ NAV + SHARE PRICE (matches contract math) ═══');
  console.log(`  get_total_nav():         $${totalNavUsd.toFixed(4)}  (balance + external_nav + hedged)`);
  if (totalSharesRaw > 0) {
    console.log(`  per-share value:         $${onShareValueUsd.toFixed(6)}`);
    console.log(`  total member equity:     $${(onShareValueUsd * totalShares).toFixed(4)}`);
  } else {
    console.log(`  per-share value:         WAD (= $1.00, pool is empty)`);
  }

  // pre-/post-upgrade comparison
  console.log('\n═══ UNDERPAYMENT CHECK ═══');
  if (totalSharesRaw === 0) {
    console.log(`  Pool empty — N/A`);
  } else {
    // What the OLD contract would have paid out (balance-only math):
    const oldAssetsRaw = balanceRaw + VIRTUAL_ASSETS;
    const oldOnShareRaw = (WAD * oldAssetsRaw) / totalSharesVirtualRaw;
    const oldOnShareUsd = oldOnShareRaw / 1e6;
    // What the FIX (or correct on-chain reality) says:
    const trueOnShareUsd = onShareValueUsd;
    const delta = trueOnShareUsd - oldOnShareUsd;
    const deltaPct = oldOnShareUsd > 0 ? (delta / oldOnShareUsd) * 100 : 0;

    console.log(`  Old (buggy balance-only): $${oldOnShareUsd.toFixed(6)} per share`);
    console.log(`  New (with external_nav):  $${trueOnShareUsd.toFixed(6)} per share`);
    if (delta > 0.0001) {
      console.log(`  ✓ Fix is active: share price up by $${delta.toFixed(6)} (+${deltaPct.toFixed(2)}%)`);
      console.log(`     Members now receive ${(deltaPct).toFixed(1)}% MORE per share than the bug would have paid.`);
    } else if (Math.abs(delta) < 0.0001) {
      console.log(`  ⚠ Old and new match — external_nav is 0 (cron hasn't attested yet)`);
    } else {
      console.log(`  ⚠ Old > New — abnormal. external_nav may be negative offset or stale.`);
    }
  }

  // pre-deploy verification expectations
  console.log('\n═══ DEPLOY-DAY EXPECTED VALUES (for verification) ═══');
  console.log(`  Step 5 wants to see:`);
  console.log(`    external_nav_usdc ≈ 29,640,000 (= $29.64)  [from cron computing $30 - $0.42]`);
  console.log(`    get_total_nav()   ≈ $30.06`);
  console.log(`    per-share value   ≈ $0.99 (was $0.045 pre-fix)`);
  console.log(`    is_fresh = true, strict mode flag whatever you've set`);
  console.log(`  If any of these are wildly off, STOP. Do not enable strict mode. Do not unpause.`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
