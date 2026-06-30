/**
 * Custody Attestor API — single multi-action route.
 *
 * Consolidates four previously-separate custody endpoints into one
 * action-dispatched route, reducing Vercel function count by 3
 * (Hobby-plan deployments cap at 12 functions; we were exceeding).
 *
 * GET  /api/custody?action=list-attestations&wallet=0x...&onlyValid=true
 * POST /api/custody  body: { action: 'build-message', portfolioId, assetListHash, nonce, validUntil }
 * POST /api/custody  body: { action: 'verify', portfolioId, assetListHash, nonce, validUntil, custodianPubkey, signature }
 * POST /api/custody  body: { action: 'hash-assets', assets: [...] }
 *
 * Strictly READ-ONLY (no mutations, no admin writes). Mirrors the spec in
 * docs/CUSTODY_ATTESTATION_SPEC.md.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 12;

const SUI_ADDRESS = /^0x[a-fA-F0-9]{64}$/;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('hex length must be even');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return '0x' + Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// GET: list-attestations
// ============================================================================
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = readLimiter.check(request);
  if (limited) return limited;

  try {
    const action = request.nextUrl.searchParams.get('action') || 'list-attestations';
    if (action !== 'list-attestations') {
      return NextResponse.json({ error: `Unknown GET action: ${action}` }, { status: 400 });
    }

    const wallet = request.nextUrl.searchParams.get('wallet')?.trim() || '';
    if (!wallet || !SUI_ADDRESS.test(wallet)) {
      return NextResponse.json(
        { error: 'Valid SUI wallet address required (0x + 64 hex)' },
        { status: 400 },
      );
    }
    const onlyValid = request.nextUrl.searchParams.get('onlyValid') === 'true';

    const packageId = (process.env.NEXT_PUBLIC_SUI_MAINNET_CUSTODY_ATTESTOR_PACKAGE || '').trim();
    const registryId = (process.env.NEXT_PUBLIC_SUI_MAINNET_CUSTODY_ATTESTOR_REGISTRY || '').trim();

    if (!packageId || !registryId) {
      return NextResponse.json({
        wallet,
        attestations: [],
        deployed: false,
        message: 'Custody attestation primitive not deployed yet. See docs/CUSTODY_ATTESTATION_SPEC.md for the deployment runbook.',
      });
    }

    const { SuiClient } = await import('@mysten/sui/client');
    const rpcUrl = (process.env.SUI_MAINNET_RPC || 'https://fullnode.mainnet.sui.io:443').trim();
    const client = new SuiClient({ url: rpcUrl });
    const { RwaCustodyAttestService } = await import('@/lib/services/sui/RwaCustodyAttestService');
    const svc = new RwaCustodyAttestService(client, packageId, registryId);
    const attestations = await svc.getAttestationsForWallet(wallet, { onlyValid });
    return NextResponse.json({
      wallet,
      attestations: attestations.map((a) => ({
        objectId: a.objectId,
        portfolioId: a.portfolioId.toString(),
        custodianPubkey: a.custodianPubkey,
        assetListHash: a.assetListHash,
        nonce: a.nonce.toString(),
        attestedAt: a.attestedAt.toString(),
        validUntil: a.validUntil.toString(),
        isValid: a.isValid,
      })),
      deployed: true,
    });
  } catch (e: unknown) {
    return safeErrorResponse(e, 'Custody GET');
  }
}

// ============================================================================
// POST: build-message | verify | hash-assets
// ============================================================================
interface AssetEntry {
  type?: string; identifier?: string; quantity?: string; custodian_account?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = readLimiter.check(request);
  if (limited) return limited;

  try {
    const body = (await request.json()) as Record<string, unknown> & { action?: string };
    const action = body.action ?? 'verify';

    if (action === 'hash-assets') {
      return await handleHashAssets(body as { assets?: AssetEntry[] });
    }
    if (action === 'build-message') {
      return await handleBuildMessage(body as {
        portfolioId?: string | number;
        assetListHash?: string;
        nonce?: string | number;
        validUntil?: string | number;
      });
    }
    if (action === 'verify') {
      return await handleVerify(body as {
        portfolioId?: string | number;
        assetListHash?: string;
        nonce?: string | number;
        validUntil?: string | number;
        custodianPubkey?: string;
        signature?: string;
      });
    }
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: unknown) {
    return safeErrorResponse(e, 'Custody POST');
  }
}

async function handleHashAssets(body: { assets?: AssetEntry[] }): Promise<NextResponse> {
  if (!Array.isArray(body.assets) || body.assets.length === 0) {
    return NextResponse.json({ error: 'assets[] required' }, { status: 400 });
  }
  for (const a of body.assets) {
    if (!a.type || !a.identifier || a.quantity === undefined) {
      return NextResponse.json(
        { error: 'each asset must have { type, identifier, quantity }' },
        { status: 400 },
      );
    }
  }
  const { RwaCustodyAttestService } = await import('@/lib/services/sui/RwaCustodyAttestService');
  const svc = new RwaCustodyAttestService({} as never, '', '');
  const validated = body.assets.map((a) => ({
    type: String(a.type),
    identifier: String(a.identifier),
    quantity: String(a.quantity),
    custodian_account: a.custodian_account !== undefined ? String(a.custodian_account) : undefined,
  }));
  const hash = svc.hashAssetList(validated);
  return NextResponse.json({
    assetListHash: bytesToHex(hash),
    hashLength: hash.length,
    assetCount: validated.length,
    canonicalization: 'JSON over sorted-by-(type, identifier) entries with keys in {custodian_account, identifier, quantity, type} alphabetical order; SHA-256 of UTF-8 bytes.',
  });
}

async function handleBuildMessage(body: {
  portfolioId?: string | number;
  assetListHash?: string;
  nonce?: string | number;
  validUntil?: string | number;
}): Promise<NextResponse> {
  if (
    body.portfolioId === undefined ||
    !body.assetListHash ||
    body.nonce === undefined ||
    body.validUntil === undefined
  ) {
    return NextResponse.json(
      { error: 'Required: portfolioId, assetListHash (32-byte hex), nonce, validUntil (ms)' },
      { status: 400 },
    );
  }
  const assetListHash = hexToBytes(body.assetListHash);
  if (assetListHash.length !== 32) {
    return NextResponse.json({ error: 'assetListHash must be 32 bytes' }, { status: 400 });
  }
  const { RwaCustodyAttestService } = await import('@/lib/services/sui/RwaCustodyAttestService');
  const svc = new RwaCustodyAttestService({} as never, '', '');
  const msg = svc.buildSignedMessage({
    portfolioId: BigInt(body.portfolioId),
    assetListHash,
    nonce: BigInt(body.nonce),
    validUntil: BigInt(body.validUntil),
  });
  return NextResponse.json({
    messageHex: bytesToHex(msg),
    messageLength: msg.length,
    layout: 'portfolio_id (u64 BE, 8) || asset_list_hash (32) || nonce (u64 BE, 8) || valid_until (u64 BE, 8)',
    instructions: 'Custodian signs this 56-byte message with their ed25519 private key; signature returned to the portfolio holder who submits it on-chain via submit_attestation.',
  });
}

async function handleVerify(body: {
  portfolioId?: string | number;
  assetListHash?: string;
  nonce?: string | number;
  validUntil?: string | number;
  custodianPubkey?: string;
  signature?: string;
}): Promise<NextResponse> {
  if (
    body.portfolioId === undefined ||
    !body.assetListHash ||
    body.nonce === undefined ||
    body.validUntil === undefined ||
    !body.custodianPubkey ||
    !body.signature
  ) {
    return NextResponse.json(
      { error: 'Required: portfolioId, assetListHash, nonce, validUntil, custodianPubkey, signature' },
      { status: 400 },
    );
  }

  const assetListHash = hexToBytes(body.assetListHash);
  const custodianPubkey = hexToBytes(body.custodianPubkey);
  const signature = hexToBytes(body.signature);

  if (assetListHash.length !== 32) {
    return NextResponse.json({ error: 'assetListHash must be 32 bytes (64 hex chars)' }, { status: 400 });
  }
  if (custodianPubkey.length !== 32) {
    return NextResponse.json({ error: 'custodianPubkey must be 32 bytes (64 hex chars)' }, { status: 400 });
  }
  if (signature.length !== 64) {
    return NextResponse.json({ error: 'signature must be 64 bytes (128 hex chars)' }, { status: 400 });
  }

  const { RwaCustodyAttestService } = await import('@/lib/services/sui/RwaCustodyAttestService');
  const svc = new RwaCustodyAttestService({} as never, '', '');
  const isValid = svc.verifySignature({
    portfolioId: BigInt(body.portfolioId),
    assetListHash,
    nonce: BigInt(body.nonce),
    validUntil: BigInt(body.validUntil),
    custodianPubkey,
    signature,
  });

  const now = BigInt(Date.now());
  const notExpired = BigInt(body.validUntil) > now;

  return NextResponse.json({
    signatureValid: isValid,
    notExpired,
    overall: isValid && notExpired,
    verifiedAt: new Date().toISOString(),
  });
}
