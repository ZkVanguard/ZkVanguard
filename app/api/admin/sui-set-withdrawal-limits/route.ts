/**
 * POST /api/admin/sui-set-withdrawal-limits
 *
 * Calls community_pool_usdc::admin_set_withdrawal_limits<USDC>(AdminCap, state,
 * max_single_withdrawal_bps, daily_withdrawal_cap_bps). Values are basis points
 * (0..10000). Use to lift the 25% single-tx cap and 50% daily cap that were the
 * defaults, allowing users to fully unwind large positions in one tx.
 *
 * Auth: Bearer <CRON_SECRET>
 * Body: { maxSingleBps?: number; dailyBps?: number }  // defaults 10000 / 10000
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyAdminBearer } from '@/lib/security/auth-middleware';
import { SUI_USDC_POOL_CONFIG, SUI_USDC_COIN_TYPE } from '@/lib/types/sui-pool-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!verifyAdminBearer(request, ['ADMIN_SECRET', 'CRON_SECRET'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { maxSingleBps?: number; dailyBps?: number } = {};
  try { body = await request.json(); } catch { /* body optional */ }

  const maxSingleBps = Math.min(10000, Math.max(1, Math.floor(Number(body.maxSingleBps ?? 10000))));
  const dailyBps = Math.min(10000, Math.max(1, Math.floor(Number(body.dailyBps ?? 10000))));

  const network = ((process.env.SUI_NETWORK || 'mainnet').trim()) as 'mainnet' | 'testnet';
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const adminCapId = (process.env.SUI_ADMIN_CAP_ID || '').trim();
  const poolConfig = SUI_USDC_POOL_CONFIG[network];

  if (!adminKey) return NextResponse.json({ error: 'SUI_POOL_ADMIN_KEY not set' }, { status: 503 });
  if (!adminCapId) return NextResponse.json({ error: 'SUI_ADMIN_CAP_ID not set' }, { status: 503 });
  if (!poolConfig.packageId || !poolConfig.poolStateId) {
    return NextResponse.json({ error: 'pool config missing' }, { status: 503 });
  }

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim()
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet')).trim();
    const client = new SuiClient({ url: rpcUrl });
    const kp = adminKey.startsWith('suiprivkey')
      ? Ed25519Keypair.fromSecretKey(adminKey)
      : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));

    const tx = new Transaction();
    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::set_withdrawal_limits`,
      typeArguments: [SUI_USDC_COIN_TYPE[network]],
      arguments: [
        tx.object(adminCapId),
        tx.object(poolConfig.poolStateId!),
        tx.pure.u64(maxSingleBps),
        tx.pure.u64(dailyBps),
      ],
    });
    tx.setGasBudget(10_000_000);

    const result = await client.signAndExecuteTransaction({
      transaction: tx, signer: kp, options: { showEffects: true },
    });
    const ok = result.effects?.status?.status === 'success';
    if (ok) {
      logger.info('[Admin] Withdrawal limits updated', { maxSingleBps, dailyBps, txDigest: result.digest });
    } else {
      logger.error('[Admin] set_withdrawal_limits failed', { error: result.effects?.status?.error });
    }
    return NextResponse.json({
      success: ok,
      txDigest: result.digest,
      maxSingleBps, dailyBps,
      error: ok ? undefined : result.effects?.status?.error,
    }, { status: ok ? 200 : 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[Admin] set_withdrawal_limits threw', { error: msg });
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
