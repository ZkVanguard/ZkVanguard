/**
 * GET /api/custody/list-attestations?wallet=0x...&onlyValid=true
 *
 * List all CustodyAttestation objects owned by a wallet. Read-only, public.
 * Empty array when the custody-attestor package isn't deployed yet.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 12;

const SUI_ADDRESS = /^0x[a-fA-F0-9]{64}$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = readLimiter.check(request);
  if (limited) return limited;

  try {
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
      // Primitive not deployed yet — return empty list with explanatory flag.
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
    return safeErrorResponse(e, 'Custody list attestations');
  }
}
