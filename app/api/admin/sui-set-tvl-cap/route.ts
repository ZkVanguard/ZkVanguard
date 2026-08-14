/**
 * POST /api/admin/sui-set-tvl-cap
 *
 * Calls community_pool_usdc::admin_set_tvl_cap<USDC>(AdminCap, state, cap_usdc).
 *
 * The pool was deployed 2026-06-12 with a $10K TVL cap as deliberate
 * operational proof at bootstrap. This endpoint is how the operator lifts
 * that ceiling as confidence grows (external audit done, MSafe migration
 * complete, trader earn-rate verified).
 *
 *   • cap = 0     → unlimited (backwards compat, treats as no cap)
 *   • cap = raw USDC (6 decimals) — 100_000_000_000 = $100k
 *   • cap < current total_deposited → new deposits blocked, existing untouched
 *
 * Auth: Bearer <CRON_SECRET or ADMIN_SECRET>
 * Body: { capUsdc: number }  // human-readable USDC ($100000 = $100k cap)
 *
 * See also:
 *   • Move fn: contracts/sui/sources/community_pool_usdc.move:admin_set_tvl_cap
 *   • Sibling: /api/admin/sui-set-withdrawal-limits (same pattern for BPS caps)
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyAdminBearer } from '@/lib/security/auth-middleware';
import { SUI_USDC_POOL_CONFIG, SUI_USDC_COIN_TYPE } from '@/lib/types/sui-pool-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sanity ceiling: no accidental "raise to $1B" typo. Contract u64 can hold up to
// ~18.4e18 raw = $18.4T; we cap the API at $10M explicit for now, well above
// realistic pool sizes for this scale of ops. Raise this in code if you outgrow it.
const MAX_CAP_USDC = 10_000_000; // $10M

export async function POST(request: NextRequest) {
  if (!verifyAdminBearer(request, ['ADMIN_SECRET', 'CRON_SECRET'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { capUsdc?: number } = {};
  try { body = await request.json(); } catch { /* body required */ }

  const capUsdc = Number(body.capUsdc);
  if (!Number.isFinite(capUsdc) || capUsdc < 0) {
    return NextResponse.json(
      { error: 'capUsdc required (number ≥ 0 in human USDC; 0 = unlimited)' },
      { status: 400 },
    );
  }
  if (capUsdc > MAX_CAP_USDC) {
    return NextResponse.json(
      { error: `capUsdc exceeds API safety ceiling $${MAX_CAP_USDC.toLocaleString()} — raise MAX_CAP_USDC in code if intentional` },
      { status: 400 },
    );
  }

  const network = ((process.env.SUI_NETWORK || 'mainnet').trim()) as 'mainnet' | 'testnet';
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const adminCapId = (process.env.SUI_ADMIN_CAP_ID || '').trim();
  const poolConfig = SUI_USDC_POOL_CONFIG[network];

  if (!adminKey) return NextResponse.json({ error: 'SUI_POOL_ADMIN_KEY not set' }, { status: 503 });
  if (!adminCapId) return NextResponse.json({ error: 'SUI_ADMIN_CAP_ID not set' }, { status: 503 });
  if (!poolConfig.packageId || !poolConfig.poolStateId) {
    return NextResponse.json({ error: 'pool config missing' }, { status: 503 });
  }

  // Convert human USDC → raw (6 decimals). Move fn takes u64.
  const capRaw = BigInt(Math.floor(capUsdc * 1_000_000));

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { createFailoverSuiClient } = await import('@/lib/services/sui/sui-failover-transport');

    const client = createFailoverSuiClient(network);
    const kp = adminKey.startsWith('suiprivkey')
      ? Ed25519Keypair.fromSecretKey(adminKey)
      : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));

    const tx = new Transaction();
    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::admin_set_tvl_cap`,
      typeArguments: [SUI_USDC_COIN_TYPE[network]],
      arguments: [
        tx.object(adminCapId),
        tx.object(poolConfig.poolStateId!),
        tx.pure.u64(capRaw),
      ],
    });
    tx.setGasBudget(10_000_000);

    const result = await client.signAndExecuteTransaction({
      transaction: tx, signer: kp, options: { showEffects: true },
    });
    const ok = result.effects?.status?.status === 'success';
    if (ok) {
      logger.info('[Admin] TVL cap updated', { capUsdc, capRaw: capRaw.toString(), txDigest: result.digest });
    } else {
      logger.error('[Admin] set_tvl_cap failed', { error: result.effects?.status?.error, capUsdc });
    }
    return NextResponse.json({
      success: ok,
      txDigest: result.digest,
      newCapUsdc: capUsdc,
      newCapRaw: capRaw.toString(),
      note: capUsdc === 0 ? 'cap = 0 → unlimited (no TVL ceiling enforced)' : undefined,
      error: ok ? undefined : result.effects?.status?.error,
    }, { status: ok ? 200 : 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[Admin] set_tvl_cap threw', { error: msg, capUsdc });
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
