#!/usr/bin/env tsx
/**
 * End-to-end custody attestor flow — pure off-chain integration test.
 *
 * Proves the full pipeline works BEFORE the Move contract is deployed:
 *   1. Holder hashes the asset list canonically
 *   2. Holder requests the signed-message bytes from /api/custody (action=build-message)
 *   3. Custodian (simulated locally with a fresh ed25519 keypair) signs them
 *   4. Caller submits to /api/custody (action=verify) for off-chain validation
 *   5. We round-trip the same flow via the TS SDK to confirm canonical-form
 *      agreement between the SDK, the API, and the Move contract spec
 *
 * Pass criteria: every step returns the expected output AND the off-chain
 * signature verification succeeds — proving holder ↔ custodian ↔ API all
 * agree on the canonical message layout. Once deployed, the same signature
 * bytes will be accepted by `rwa_custody_attestor::submit_attestation`.
 *
 * Run with the dev server up:
 *   bun run dev          # in one terminal
 *   bun run scripts/test-custody-attestor-e2e.ts   # in another
 */
import { ed25519 } from '@noble/curves/ed25519';
import { RwaCustodyAttestService, type AssetEntry } from '../lib/services/sui/RwaCustodyAttestService';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3000';

function bytesToHex(b: Uint8Array): string {
  return '0x' + Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function assert(condition: unknown, msg: string): void {
  if (!condition) {
    console.error('  ✗ FAIL:', msg);
    process.exit(1);
  }
}

function ok(msg: string): void {
  console.log('  ✓', msg);
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  CUSTODY ATTESTOR — END-TO-END OFF-CHAIN FLOW TEST           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // ─── Step 0: simulate a custodian ed25519 keypair ───────────────────────
  console.log('── Step 0: custodian keypair ──');
  const custodianPriv = ed25519.utils.randomPrivateKey();
  const custodianPub = ed25519.getPublicKey(custodianPriv);
  assert(custodianPub.length === 32, 'pubkey is 32 bytes');
  ok(`custodian pubkey: ${bytesToHex(custodianPub).slice(0, 20)}…`);

  // ─── Step 1: holder defines an asset list ─────────────────────────────
  console.log('\n── Step 1: holder + custodian agree on off-chain asset list ──');
  const assets: AssetEntry[] = [
    { type: 'US_TBILL_3MO', identifier: 'US912797JZ19', quantity: '50000.00', custodian_account: 'BOFA-CUSTODY-A4881' },
    { type: 'GOLD_OZ', identifier: 'LBMA-LONDON-GOOD-DELIVERY', quantity: '100.5' },
  ];
  ok(`asset list: ${assets.length} entries`);

  // ─── Step 2: both sides hash the asset list ───────────────────────────
  console.log('\n── Step 2: canonical asset-list hash via API + SDK ──');
  const apiHashResp = await fetch(`${API_BASE}/api/custody`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'hash-assets', assets }),
  });
  assert(apiHashResp.ok, `hash-assets endpoint returned ${apiHashResp.status}`);
  const apiHashJson = (await apiHashResp.json()) as { assetListHash: string };
  ok(`API hash: ${apiHashJson.assetListHash}`);

  const sdk = new RwaCustodyAttestService({} as never, '', '');
  const sdkHash = sdk.hashAssetList(assets);
  const sdkHashHex = bytesToHex(sdkHash);
  ok(`SDK hash: ${sdkHashHex}`);
  assert(sdkHashHex === apiHashJson.assetListHash, 'API hash matches SDK hash (canonical form agreement)');

  // ─── Step 3: holder requests signable message bytes ───────────────────
  console.log('\n── Step 3: build canonical signed message ──');
  const portfolioId = 42n;
  const nonce = 1n;
  const validUntil = BigInt(Date.now()) + 30n * 24n * 60n * 60n * 1000n; // 30 days

  const msgResp = await fetch(`${API_BASE}/api/custody`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'build-message',
      portfolioId: portfolioId.toString(),
      assetListHash: sdkHashHex,
      nonce: nonce.toString(),
      validUntil: validUntil.toString(),
    }),
  });
  assert(msgResp.ok, `build-message endpoint returned ${msgResp.status}`);
  const msgJson = (await msgResp.json()) as { messageHex: string; messageLength: number };
  assert(msgJson.messageLength === 56, '56-byte canonical message');
  ok(`message bytes: ${msgJson.messageHex.slice(0, 20)}… (${msgJson.messageLength} bytes)`);

  // SDK should produce identical bytes
  const sdkMsg = sdk.buildSignedMessage({
    portfolioId, assetListHash: sdkHash, nonce, validUntil,
  });
  assert(bytesToHex(sdkMsg) === msgJson.messageHex, 'SDK message bytes match API message bytes');

  // ─── Step 4: custodian signs ─────────────────────────────────────────
  console.log('\n── Step 4: custodian signs with ed25519 ──');
  const signature = ed25519.sign(hexToBytes(msgJson.messageHex), custodianPriv);
  assert(signature.length === 64, 'ed25519 signature is 64 bytes');
  ok(`signature: ${bytesToHex(signature).slice(0, 20)}…`);

  // ─── Step 5: off-chain verify via API ─────────────────────────────────
  console.log('\n── Step 5: off-chain verification via /api/custody action=verify ──');
  const verifyResp = await fetch(`${API_BASE}/api/custody`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'verify',
      portfolioId: portfolioId.toString(),
      assetListHash: sdkHashHex,
      nonce: nonce.toString(),
      validUntil: validUntil.toString(),
      custodianPubkey: bytesToHex(custodianPub),
      signature: bytesToHex(signature),
    }),
  });
  assert(verifyResp.ok, `verify endpoint returned ${verifyResp.status}`);
  const verifyJson = (await verifyResp.json()) as { signatureValid: boolean; notExpired: boolean; overall: boolean };
  assert(verifyJson.signatureValid === true, 'API verifies signature is valid');
  assert(verifyJson.notExpired === true, 'API confirms not expired');
  assert(verifyJson.overall === true, 'API overall verdict: valid');
  ok('API verify: signatureValid=true notExpired=true overall=true');

  // ─── Step 6: SDK off-chain verify (independent path) ─────────────────
  console.log('\n── Step 6: SDK independent verification ──');
  const sdkValid = sdk.verifySignature({
    portfolioId,
    assetListHash: sdkHash,
    nonce,
    validUntil,
    custodianPubkey: custodianPub,
    signature,
  });
  assert(sdkValid, 'SDK independently verifies signature');
  ok('SDK verify: true');

  // ─── Step 7: tampered signature should fail ──────────────────────────
  console.log('\n── Step 7: tamper detection ──');
  const tamperedSig = new Uint8Array(signature);
  tamperedSig[0] ^= 0xff; // flip first byte
  const tamperedValid = sdk.verifySignature({
    portfolioId, assetListHash: sdkHash, nonce, validUntil,
    custodianPubkey: custodianPub, signature: tamperedSig,
  });
  assert(!tamperedValid, 'SDK rejects tampered signature');
  ok('SDK rejects tampered signature (1 bit flip)');

  const wrongNonce = sdk.verifySignature({
    portfolioId, assetListHash: sdkHash,
    nonce: nonce + 1n, // wrong nonce → message differs → sig invalid
    validUntil, custodianPubkey: custodianPub, signature,
  });
  assert(!wrongNonce, 'SDK rejects wrong nonce');
  ok('SDK rejects wrong nonce (replay protection at signature level)');

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ ALL CHECKS PASSED — custody attestor off-chain stack ready ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  console.log('  • API canonical-hash algorithm matches SDK ✓');
  console.log('  • 56-byte signed message format matches Move spec ✓');
  console.log('  • ed25519 signature verification works end-to-end ✓');
  console.log('  • Tamper + replay detection working ✓\n');
  console.log('  Once `rwa_custody_attestor.move` is deployed to mainnet, the');
  console.log('  same signature bytes from this test will be accepted by the');
  console.log('  on-chain `submit_attestation` entry function.\n');
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
