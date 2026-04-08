/**
 * WDK Refactor Verification Test
 * Tests all extracted modules: provider-cache, zk-binding, storage, chain maps
 */
import { getCachedProvider, getProviderAsync, clearProviderCache } from '../lib/wdk/provider-cache';
import { sha256Hex, generateZKPasskeyBinding, verifyZKPasskeyBinding } from '../lib/wdk/zk-binding';
import { loadWallet, saveWallet, clearWallet, STORAGE_KEY } from '../lib/wdk/storage';
import { WDK_CHAINS } from '../lib/config/wdk';

let pass = 0, fail = 0;
function ok(l: string, d?: string) { pass++; console.log(`  ✅ ${l}${d ? ': ' + d : ''}`); }
function err(l: string, d: string) { fail++; console.log(`  ❌ ${l}: ${d}`); }

async function main() {
  console.log('═══ WDK REFACTOR TEST SUITE ═══\n');

  // 1. Provider Cache
  console.log('--- Provider Cache ---');
  try {
    const p1 = getCachedProvider('sepolia');
    if (p1) ok('getCachedProvider(sepolia)', 'returned provider'); else err('getCachedProvider(sepolia)', 'null');
  } catch (e: any) { err('getCachedProvider(sepolia)', e.message); }

  try {
    const p2 = getCachedProvider('sepolia');
    const p3 = getCachedProvider('sepolia');
    if (p2 === p3) ok('Cache hit', 'same instance'); else err('Cache hit', 'different instances');
  } catch (e: any) { err('Cache hit', e.message); }

  try {
    const pNull = getCachedProvider('nonexistent-chain');
    if (pNull === null) ok('Invalid chain returns null'); else err('Invalid chain', 'expected null');
  } catch (e: any) { err('Invalid chain', e.message); }

  try {
    const p4 = getCachedProvider('cronos-mainnet');
    if (p4) ok('getCachedProvider(cronos-mainnet)'); else err('getCachedProvider(cronos-mainnet)', 'null');
  } catch (e: any) { err('getCachedProvider(cronos-mainnet)', e.message); }

  try {
    const p5 = await getProviderAsync('sepolia');
    if (p5) ok('getProviderAsync(sepolia)'); else err('getProviderAsync(sepolia)', 'null');
  } catch (e: any) { err('getProviderAsync(sepolia)', e.message); }

  try {
    clearProviderCache();
    ok('clearProviderCache()', 'no errors');
  } catch (e: any) { err('clearProviderCache()', e.message); }

  try {
    const pAfterClear = getCachedProvider('sepolia');
    if (pAfterClear) ok('Provider re-created after clear'); else err('Provider re-created', 'null');
  } catch (e: any) { err('Provider re-created', e.message); }

  // 2. Chain Config
  console.log('\n--- Chain Config ---');
  const keys = Object.keys(WDK_CHAINS);
  ok('WDK_CHAINS loaded', `${keys.length} chains: ${keys.join(', ')}`);

  for (const key of ['sepolia', 'cronos-mainnet', 'plasma', 'stable']) {
    const cfg = WDK_CHAINS[key];
    if (cfg) ok(`Chain ${key}`, `chainId=${cfg.chainId}`); else err(`Chain ${key}`, 'missing');
  }

  // Verify derived chain maps would work
  const idToKey = Object.fromEntries(Object.entries(WDK_CHAINS).map(([k, c]) => [c.chainId, k]));
  const keyToId = Object.fromEntries(Object.entries(WDK_CHAINS).map(([k, c]) => [k, c.chainId]));
  if (idToKey[11155111] === 'sepolia') ok('CHAIN_ID_TO_KEY[11155111]', 'sepolia');
  else err('CHAIN_ID_TO_KEY', 'wrong mapping');
  if (idToKey[9745] === 'plasma') ok('CHAIN_ID_TO_KEY[9745]', 'plasma');
  else err('CHAIN_ID_TO_KEY[9745]', 'missing plasma');
  if (keyToId['stable'] === 988) ok('CHAIN_KEY_TO_ID[stable]', '988');
  else err('CHAIN_KEY_TO_ID[stable]', 'missing');

  // 3. ZK Binding
  console.log('\n--- ZK Binding ---');
  try {
    const hash = await sha256Hex('test');
    if (hash?.length === 64) ok('sha256Hex', hash.slice(0, 16) + '...');
    else err('sha256Hex', 'bad hash: ' + hash);
  } catch (e: any) { err('sha256Hex', e.message); }

  try {
    const { proofHash, bindingHash } = await generateZKPasskeyBinding('0x1234abcd', 'pk-1');
    if (proofHash?.length === 64 && bindingHash?.length === 64) {
      ok('generateZKPasskeyBinding', `proof=${proofHash.slice(0, 12)}... binding=${bindingHash.slice(0, 12)}...`);

      const valid = await verifyZKPasskeyBinding('0x1234abcd', 'pk-1', bindingHash);
      if (valid) ok('verifyZKPasskeyBinding (valid)');
      else err('verifyZKPasskeyBinding', 'expected true');

      const invalid = await verifyZKPasskeyBinding('0xdifferent', 'pk-1', bindingHash);
      if (!invalid) ok('verifyZKPasskeyBinding (tampered)', 'correctly rejected');
      else err('verifyZKPasskeyBinding(tampered)', 'expected false');
    } else {
      err('generateZKPasskeyBinding', 'bad hashes');
    }
  } catch (e: any) { err('ZK Binding', e.message); }

  // 4. Storage (server-side — no window)
  console.log('\n--- Storage (server-side safety) ---');
  try {
    if (STORAGE_KEY === 'wdk_wallet_v2') ok('STORAGE_KEY', STORAGE_KEY);
    else err('STORAGE_KEY', STORAGE_KEY);

    const w = loadWallet();
    if (w === null) ok('loadWallet() server-side', 'returns null');
    else err('loadWallet()', 'expected null');

    saveWallet({ encryptedData: 'x', iv: 'y', keyJwk: 'z', addresses: {}, lastChain: 'sepolia' });
    ok('saveWallet() server-side', 'no-op without window');

    clearWallet();
    ok('clearWallet() server-side', 'no-op without window');
  } catch (e: any) { err('Storage', e.message); }

  // 5. Provider for every chain
  console.log('\n--- Provider Coverage (all chains) ---');
  for (const key of keys) {
    try {
      const p = getCachedProvider(key);
      if (p) ok(`Provider: ${key}`); else err(`Provider: ${key}`, 'null');
    } catch (e: any) { err(`Provider: ${key}`, e.message); }
  }

  clearProviderCache();

  // Summary
  console.log('\n═══ SUMMARY ═══');
  console.log(`  ✅ Passed: ${pass}`);
  console.log(`  ❌ Failed: ${fail}`);
  console.log(fail === 0 ? '\n🟢 ALL WDK TESTS PASSED' : `\n🔴 ${fail} FAILURE(S)`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
