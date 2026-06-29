/**
 * POST /api/custody/hash-assets
 *
 * Helper: canonicalize an asset list and return the SHA-256 hash used as
 * `asset_list_hash` in the on-chain attestation. The portfolio holder and
 * custodian both compute this independently to ensure they're signing over
 * the same asset list without exchanging it over public channels.
 *
 * Body:
 *   {
 *     assets: [
 *       { type: string, identifier: string, quantity: string, custodian_account?: string },
 *       ...
 *     ]
 *   }
 *
 * Public, read-only computation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AssetEntry {
  type?: string;
  identifier?: string;
  quantity?: string;
  custodian_account?: string;
}

function bytesToHex(b: Uint8Array): string {
  return '0x' + Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = readLimiter.check(request);
  if (limited) return limited;

  try {
    const body = (await request.json()) as { assets?: AssetEntry[] };
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
  } catch (e: unknown) {
    return safeErrorResponse(e, 'Custody hash assets');
  }
}
