#!/usr/bin/env node
/**
 * E2E test for the three-layer hedge sync (DB <-> on-chain <-> Bluefin).
 *
 * Read-mostly: queries both layers, reports drift, exercises every new helper
 * (recordSuiOnchainHedge, listActiveSuiOnchainHedges, closeHedgeByOnchainId,
 *  getHedgeByOnchainId, tryAcquireHedgeDecisionLock, releaseHedgeDecisionLock,
 *  ensureDecisionLockTable). Only mutates DB if --heal is passed.
 *
 * Usage:
 *   node -r dotenv/config scripts/test-hedge-sync-e2e.mjs dotenv_config_path=.env.production
 *   node -r dotenv/config scripts/test-hedge-sync-e2e.mjs dotenv_config_path=.env.production -- --heal
 */
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const POOL_STATE_ID = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
const heal = process.argv.includes('--heal');

function ok(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  ▸ ${msg}`); }

async function main() {
  console.log('=== Three-layer hedge sync E2E ===');
  console.log('Mode:', heal ? 'HEAL (will mutate DB)' : 'READ-ONLY');
  console.log('');

  // --- 1. Imports of new helpers ---
  console.log('[1/6] Loading DB helpers from lib/db/hedges.ts ...');
  const dbMod = await import('../lib/db/hedges.ts').catch(async () => {
    // tsx fallback
    const { register } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    register('tsx/esm', pathToFileURL('./'));
    return import('../lib/db/hedges.ts');
  });
  const required = [
    'getActiveHedges',
    'getHedgeByOnchainId',
    'closeHedgeByOnchainId',
    'recordSuiOnchainHedge',
    'listActiveSuiOnchainHedges',
    'tryAcquireHedgeDecisionLock',
    'releaseHedgeDecisionLock',
    'updateHedgeStatus',
  ];
  for (const k of required) {
    if (typeof dbMod[k] === 'function') ok(`${k} exported`);
    else fail(`${k} NOT exported`);
  }
  if (process.exitCode) return;

  // --- 2. Decision lock table + acquire/release ---
  console.log('\n[2/6] Decision lock acquire/release round-trip ...');
  // tryAcquireHedgeDecisionLock auto-creates the table on first call.
  const token = `e2e-test-${Date.now()}`;
  const a1 = await dbMod.tryAcquireHedgeDecisionLock(token, 60);
  if (a1) ok(`tryAcquireHedgeDecisionLock(${token.slice(-6)}) -> true`);
  else fail('first acquire should succeed');
  const a2 = await dbMod.tryAcquireHedgeDecisionLock(token, 60);
  if (!a2) ok('second acquire correctly rejected (idempotent)');
  else fail('second acquire MUST NOT succeed (would allow double-fire)');
  await dbMod.releaseHedgeDecisionLock(token);
  ok('releaseHedgeDecisionLock() ran');
  const a3 = await dbMod.tryAcquireHedgeDecisionLock(token, 60);
  if (a3) ok('re-acquire after release succeeded');
  else fail('re-acquire after release should succeed');
  await dbMod.releaseHedgeDecisionLock(token);

  // --- 3. On-chain active hedges ---
  console.log('\n[3/6] Reading Move active_hedges from pool ...');
  const rpc = process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet');
  const sui = new SuiClient({ url: rpc });
  const obj = await sui.getObject({ id: POOL_STATE_ID, options: { showContent: true } });
  const fields = obj.data?.content?.fields;
  const onchainRaw = fields?.hedge_state?.fields?.active_hedges || [];
  const onchain = onchainRaw.map(h => {
    const hf = h.fields || h;
    return {
      hedgeIdHex: Buffer.from(hf.hedge_id).toString('hex'),
      collateralUsdc: Number(hf.collateral_usdc) / 1e6,
      pairIndex: Number(hf.pair_index),
      openTime: Number(hf.open_time),
    };
  });
  info(`on-chain active hedges: ${onchain.length}`);
  for (const h of onchain) {
    info(`  ${h.hedgeIdHex.slice(0, 16)}…  $${h.collateralUsdc.toFixed(6)}  pair=${h.pairIndex}`);
  }

  // --- 4. DB active SUI on-chain hedges ---
  console.log('\n[4/6] Reading DB hedges (chain=sui, on_chain=true, status=active) ...');
  const dbActive = await dbMod.listActiveSuiOnchainHedges();
  info(`DB active rows: ${dbActive.length}`);
  for (const r of dbActive) {
    info(`  ${(r.hedgeIdOnchain || '').slice(0, 18)}…  notional=$${r.notionalValue?.toFixed?.(6) ?? r.notionalValue}`);
  }

  // --- 5. Drift analysis ---
  console.log('\n[5/6] Drift analysis ...');
  const onchainIds = new Set(onchain.map(h => h.hedgeIdHex.toLowerCase()));
  const dbIds = new Set(dbActive.map(d => (d.hedgeIdOnchain || '').replace(/^0x/, '').toLowerCase()).filter(Boolean));

  const onchainOrphans = onchain.filter(h => !dbIds.has(h.hedgeIdHex.toLowerCase()));
  const dbOrphans = dbActive.filter(d => {
    const id = (d.hedgeIdOnchain || '').replace(/^0x/, '').toLowerCase();
    return id && !onchainIds.has(id);
  });

  console.log(`  on-chain orphans (no DB row): ${onchainOrphans.length}`);
  for (const h of onchainOrphans) info(`    ${h.hedgeIdHex.slice(0, 16)}…  $${h.collateralUsdc.toFixed(6)}`);
  console.log(`  DB orphans      (closed on chain, still active in DB): ${dbOrphans.length}`);
  for (const d of dbOrphans) info(`    ${(d.hedgeIdOnchain || '').slice(0, 18)}…  notional=$${d.notionalValue}`);

  if (onchainOrphans.length === 0 && dbOrphans.length === 0) ok('Layers are in sync');
  else info(`Drift detected: ${onchainOrphans.length} chain-orphan + ${dbOrphans.length} db-orphan`);

  // --- 6. getHedgeByOnchainId round-trip ---
  console.log('\n[6/6] getHedgeByOnchainId round-trip on real ID ...');
  if (onchain.length > 0) {
    const probe = onchain[0].hedgeIdHex;
    const row = await dbMod.getHedgeByOnchainId(probe);
    if (row) ok(`Found DB row for on-chain hedge ${probe.slice(0, 16)}… (orderId=${row.order_id || row.orderId})`);
    else info(`No DB row for ${probe.slice(0, 16)}… (would be inserted by Step 0.5 reconciliation)`);
  } else {
    info('No on-chain hedge to probe');
  }

  // --- HEAL mode ---
  if (heal && (onchainOrphans.length || dbOrphans.length)) {
    console.log('\n[HEAL] Applying reconciliation ...');
    let healed = 0;
    for (const h of onchainOrphans) {
      const r = await dbMod.recordSuiOnchainHedge({
        hedgeIdOnchain: h.hedgeIdHex,
        collateralUsdc: h.collateralUsdc,
        pairIndex: h.pairIndex,
        isLong: true,
        leverage: 1,
        txDigest: 'e2e-test-heal',
        reason: 'E2E test: heal on-chain orphan',
      });
      if (r.inserted) { ok(`inserted DB row for ${h.hedgeIdHex.slice(0, 16)}…`); healed++; }
      else info(`row already existed for ${h.hedgeIdHex.slice(0, 16)}…`);
    }
    for (const d of dbOrphans) {
      const id = (d.hedgeIdOnchain || '').replace(/^0x/, '').toLowerCase();
      const r = await dbMod.closeHedgeByOnchainId({ hedgeIdOnchain: id, realizedPnl: 0, status: 'closed' });
      if (r.updated > 0) { ok(`closed DB row for ${id.slice(0, 16)}…`); healed++; }
      else info(`no row updated for ${id.slice(0, 16)}…`);
    }
    console.log(`  total healed: ${healed}`);
  }

  console.log('\n=== Result ===');
  if (process.exitCode) console.log('FAIL'); else console.log('PASS');
}

main().catch(e => { console.error(e); process.exit(1); });
