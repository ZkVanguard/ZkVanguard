/**
 * SUI Gas Sponsor API — Admin pays gas for user transactions
 *
 * POST /api/sui/sponsor-gas
 * Body: { txBytes: string (base64) , sender: string }
 * Returns: { sponsorSignature: string, txBytes: string (base64) }
 *
 * The admin wallet pays gas so users don't need SUI for transaction fees.
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
    const { txBytes, sender } = await request.json();

    if (!txBytes || !sender) {
      return NextResponse.json({ error: 'txBytes and sender are required' }, { status: 400 });
    }

    // Validate sender is a valid SUI address (0x + 64 hex)
    if (!/^0x[a-fA-F0-9]{64}$/.test(sender)) {
      return NextResponse.json({ error: 'Invalid sender address' }, { status: 400 });
    }

    const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
    if (!adminKey) {
      logger.error('[SponsorGas] No admin key configured');
      return NextResponse.json({ error: 'Gas sponsoring unavailable' }, { status: 503 });
    }

    const network = process.env.SUI_NETWORK || process.env.NEXT_PUBLIC_SUI_NETWORK || 'mainnet';

    // Dynamic imports to avoid module-level conflicts
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    // Derive admin keypair
    let keypair: InstanceType<typeof Ed25519Keypair>;
    try {
      keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(
            Buffer.from(adminKey.replace(/^0x/, ''), 'hex')
          );
    } catch (keyErr: unknown) {
      logger.error('[SponsorGas] Invalid admin key format', { error: keyErr instanceof Error ? keyErr.message : String(keyErr), keyPrefix: adminKey.substring(0, 8) });
      return NextResponse.json({ error: 'Gas sponsoring unavailable — key parse error' }, { status: 503 });
    }

    const sponsorAddress = keypair.getPublicKey().toSuiAddress();

    // Check admin has enough SUI for gas
    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const client = new SuiClient({ url: rpcUrl });

    const adminBalance = await client.getBalance({ owner: sponsorAddress, coinType: '0x2::sui::SUI' });
    const adminSui = BigInt(adminBalance.totalBalance);
    if (adminSui < BigInt(50_000_000)) { // need at least 0.05 SUI
      logger.error('[SponsorGas] Admin wallet low on gas', { balance: adminSui.toString() });
      return NextResponse.json({ error: 'Gas sponsor wallet is empty. Please try again later.' }, { status: 503 });
    }

    // Deserialize the user's transaction
    const txBytesRaw = Buffer.from(txBytes, 'base64');
    const tx = Transaction.from(txBytesRaw);

    // Set the gas owner to admin (sponsor)
    tx.setSender(sender);
    tx.setGasOwner(sponsorAddress);

    // Build the transaction (resolves gas coins, etc.)
    const builtBytes = await tx.build({ client });

    // Admin signs as gas sponsor
    const sponsorSig = await keypair.signTransaction(builtBytes);

    logger.info('[SponsorGas] Sponsored transaction', {
      sender: sender.slice(0, 10),
      sponsor: sponsorAddress.slice(0, 10),
      gasUsed: 'pending',
    });

    return NextResponse.json({
      success: true,
      txBytes: Buffer.from(builtBytes).toString('base64'),
      sponsorSignature: sponsorSig.signature,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[SponsorGas] Failed', { error: message });
    return NextResponse.json({ error: 'Gas sponsoring failed: ' + message }, { status: 500 });
  }
}
