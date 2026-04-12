/**
 * SUI Gas Sponsor API — Step 1: Prepare a sponsored transaction
 *
 * POST /api/sui/sponsor-gas
 * Body: { txBytes: string (base64 JSON of unbuilt tx), sender: string }
 * Returns: { txBytes: string (base64 JSON of modified unbuilt tx with gas fields) }
 *
 * Sets gasOwner, gasBudget, and gasPayment on the transaction.
 * The wallet will build + sign, then /api/sui/sponsor-execute handles admin co-signing + execution.
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

    const network = (process.env.SUI_NETWORK || process.env.NEXT_PUBLIC_SUI_NETWORK || 'mainnet').trim();

    // Dynamic imports to avoid module-level conflicts
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    // Derive admin keypair (to get sponsor address)
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
      logger.error('[SponsorGas] Admin wallet low on gas', { balance: adminSui.toString(), sponsor: sponsorAddress, network });
      return NextResponse.json({ error: 'Gas sponsor wallet is empty. Please try again later.' }, { status: 503 });
    }

    // Deserialize the user's unbuilt transaction (JSON string, base64-encoded)
    const txSerialized = Buffer.from(txBytes, 'base64').toString('utf-8');
    const tx = Transaction.from(txSerialized);

    // Set gas sponsoring fields (wallet will build the final BCS bytes)
    tx.setSender(sender);
    tx.setGasOwner(sponsorAddress);
    tx.setGasBudget(50_000_000); // 0.05 SUI — generous for typical deposit/withdraw

    // Select gas coins from the sponsor's wallet
    const sponsorCoins = await client.getCoins({ owner: sponsorAddress, coinType: '0x2::sui::SUI' });
    if (!sponsorCoins.data.length) {
      return NextResponse.json({ error: 'Gas sponsor wallet has no SUI coins' }, { status: 503 });
    }
    tx.setGasPayment(sponsorCoins.data.map(c => ({
      objectId: c.coinObjectId,
      version: c.version,
      digest: c.digest,
    })));

    // Return the modified but UNBUILT tx — wallet will build + sign
    const modifiedTx = tx.serialize();

    logger.info('[SponsorGas] Prepared sponsored tx', {
      sender: sender.slice(0, 10),
      sponsor: sponsorAddress.slice(0, 10),
    });

    return NextResponse.json({
      success: true,
      txBytes: Buffer.from(modifiedTx).toString('base64'),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[SponsorGas] Failed', { error: message });
    return NextResponse.json({ error: 'Gas sponsoring failed: ' + message }, { status: 500 });
  }
}
