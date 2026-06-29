/**
 * POST /api/custody/build-message
 *
 * Helper for custodians: given (portfolioId, assetListHash, nonce, validUntil),
 * returns the canonical 56-byte message they need to sign with their ed25519
 * private key. The signed result then gets submitted by the portfolio holder
 * via the Move contract directly (or via /api/custody/submit if we wire it
 * later for fully-managed flows).
 *
 * Public, read-only computation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(b: Uint8Array): string {
  return '0x' + Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
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
    };

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
  } catch (e: unknown) {
    return safeErrorResponse(e, 'Custody build message');
  }
}
