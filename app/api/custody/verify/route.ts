/**
 * POST /api/custody/verify
 *
 * Off-chain signature verification helper. Accepts an attestation payload
 * (portfolioId + assetListHash + nonce + validUntil + custodianPubkey +
 * signature) and returns whether the signature is valid. Lets a counterparty
 * verify an attestation independently without trusting the on-chain object.
 *
 * Body (JSON):
 *   {
 *     portfolioId: string|number,
 *     assetListHash: hex string (66 chars incl 0x),
 *     nonce: string|number,
 *     validUntil: string|number (ms),
 *     custodianPubkey: hex (66 chars),
 *     signature: hex (130 chars)
 *   }
 *
 * Public, read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('hex length must be even');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = readLimiter.check(request);
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      portfolioId?: string | number;
      assetListHash?: string;
      nonce?: string | number;
      validUntil?: string | number;
      custodianPubkey?: string;
      signature?: string;
    };

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
    // We only need the static methods (buildSignedMessage + verifySignature)
    // — pass empty client/package/registry, they're unused for verification.
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
  } catch (e: unknown) {
    return safeErrorResponse(e, 'Custody verify');
  }
}
