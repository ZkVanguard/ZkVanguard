/**
 * SUI Sponsor Execute API — Step 2: Admin co-signs + executes a sponsored transaction
 *
 * POST /api/sui/sponsor-execute
 * Body: { txBytes: string (base64 BCS from wallet), userSignature: string, sender: string }
 * Returns: { success: boolean, digest: string, error?: string }
 *
 * After the wallet builds + signs the transaction, this endpoint:
 * 1. Admin signs the SAME bytes the wallet signed (guaranteeing signature match)
 * 2. Executes with both signatures
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { mutationLimiter } from '@/lib/security/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rateLimitRes = mutationLimiter.check(request);
  if (rateLimitRes) return rateLimitRes;

  try {
    const { txBytes, userSignature, sender } = await request.json();

    if (!txBytes || !userSignature || !sender) {
      return NextResponse.json({ error: 'txBytes, userSignature, and sender are required' }, { status: 400 });
    }

    // Validate sender address
    if (!/^0x[a-fA-F0-9]{64}$/.test(sender)) {
      return NextResponse.json({ error: 'Invalid sender address' }, { status: 400 });
    }

    const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
    if (!adminKey) {
      logger.error('[SponsorExecute] No admin key configured');
      return NextResponse.json({ error: 'Gas sponsoring unavailable' }, { status: 503 });
    }

    const network = (process.env.SUI_NETWORK || process.env.NEXT_PUBLIC_SUI_NETWORK || 'mainnet').trim();

    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    let keypair: InstanceType<typeof Ed25519Keypair>;
    try {
      keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(
            Buffer.from(adminKey.replace(/^0x/, ''), 'hex')
          );
    } catch (keyErr: unknown) {
      logger.error('[SponsorExecute] Invalid admin key format', { error: keyErr instanceof Error ? keyErr.message : String(keyErr) });
      return NextResponse.json({ error: 'Gas sponsoring unavailable — key parse error' }, { status: 503 });
    }

    const sponsorAddress = keypair.getPublicKey().toSuiAddress();
    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const client = new SuiClient({ url: rpcUrl });

    // txBytes is base64 of BCS bytes (what the wallet built and the user signed)
    const builtBytes = Uint8Array.from(Buffer.from(txBytes, 'base64'));

    // Admin signs the SAME bytes the user signed — guarantees signature match
    const sponsorSig = await keypair.signTransaction(builtBytes);

    logger.info('[SponsorExecute] Co-signing and executing', {
      sender: sender.slice(0, 10),
      sponsor: sponsorAddress.slice(0, 10),
      txBytesLen: builtBytes.length,
    });

    // Execute with both signatures (user + sponsor)
    const result = await client.executeTransactionBlock({
      transactionBlock: txBytes, // base64 string
      signature: [userSignature, sponsorSig.signature],
      options: { showEffects: true },
    });

    const success = result.effects?.status?.status === 'success';
    const effectsError = result.effects?.status?.error;

    if (!success) {
      logger.error('[SponsorExecute] Transaction effects failure', {
        digest: result.digest,
        error: effectsError,
        sender,
      });
    } else {
      logger.info('[SponsorExecute] Transaction succeeded', {
        digest: result.digest,
        sender: sender.slice(0, 10),
      });
    }

    return NextResponse.json({
      success,
      digest: result.digest,
      ...(effectsError ? { error: effectsError } : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[SponsorExecute] Failed', { error: message });
    return NextResponse.json({ error: 'Sponsored execution failed: ' + message, success: false }, { status: 500 });
  }
}
