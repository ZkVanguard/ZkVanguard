/**
 * Cron Job: SUI Hedge State Reconciliation (Move ↔ BlueFin)
 *
 * Detects and repairs drift between the Move contract's `hedge_state` and
 * the actual live positions on BlueFin Pro.
 *
 * Drift sources:
 *   1. BlueFin auto-liquidates a position (15%+ adverse move on leveraged perp)
 *      → on-chain `total_hedged_value` over-reports NAV until corrected.
 *   2. Manual position close on BlueFin UI bypassing the contract.
 *   3. Network failure between BlueFin close + on-chain close_hedge call.
 *
 * Why this matters for $1B+ scale:
 *   The on-chain `total_hedged_value` is used by the Move withdrawal cap
 *   (`max_single_withdrawal_bps * nav`). If it over-reports by $50M, depositors
 *   could withdraw $50M more than the pool actually has → bank-run risk.
 *
 * Repair strategy:
 *   - Read on-chain `active_hedges` from the pool state object.
 *   - Read live BlueFin positions (BTC-PERP, ETH-PERP, SUI-PERP).
 *   - Map each on-chain hedge to a live position (by symbol presence).
 *   - If 1+ on-chain hedges have NO matching live position → drift detected.
 *   - When AdminCap is held by cron signer: call `admin_reset_hedge_state`
 *     to clear the on-chain vector + zero `total_hedged_value`. Next AI cron
 *     re-opens hedges as needed based on signal.
 *   - When AdminCap is multisig-gated: skip and emit a structured warning
 *     so a human operator gets paged.
 *
 * Schedule: Every 1 hour via QStash (defense-in-depth — the auto-hedge cron
 * already cleans DB rows; this cron handles the on-chain side).
 *
 * Security: QStash signature or CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { errMsg } from '@/lib/utils/error-handler';
import { SUI_USDC_POOL_CONFIG, SUI_USDC_COIN_TYPE } from '@/lib/types/sui-pool-types';
import { BluefinService, type BluefinPosition } from '@/lib/services/sui/BluefinService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface ReconcileResult {
  success: boolean;
  ranAt: string;
  network: 'mainnet' | 'testnet';
  attempted: boolean;
  onChainHedges?: number;
  liveBluefinPositions?: number;
  driftDetected?: boolean;
  driftDetails?: {
    onChainHedgesUsdc: number;
    liveMarginUsdc: number;
    deltaUsdc: number;
  };
  resetExecuted?: boolean;
  txDigest?: string;
  reason?: string;
  error?: string;
}

/**
 * Symbol families a Move hedge can map to. The Move contract stores hedges
 * by `pair_index` not `symbol`, but at the protocol level there are exactly
 * 3 active perp markets. As long as ANY live position exists per market that
 * the on-chain side believes is open, we treat the side as "in sync".
 */
const SUPPORTED_SYMBOLS = ['BTC-PERP', 'ETH-PERP', 'SUI-PERP'] as const;

export async function GET(request: NextRequest): Promise<NextResponse<ReconcileResult>> {
  const ranAt = new Date().toISOString();
  const network: 'mainnet' | 'testnet' =
    (process.env.SUI_NETWORK as 'mainnet' | 'testnet') === 'testnet' ? 'testnet' : 'mainnet';

  const auth = await verifyCronRequest(request, 'SuiHedgeReconcile');
  if (auth !== true) {
    return NextResponse.json(
      { success: false, ranAt, network, attempted: false, reason: 'Unauthorized' },
      { status: 401 },
    );
  }

  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const adminCapId = (process.env.SUI_ADMIN_CAP_ID || '').trim();
  const poolConfig = SUI_USDC_POOL_CONFIG[network];

  if (!adminKey || !poolConfig.packageId || !poolConfig.poolStateId) {
    return NextResponse.json({
      success: true,
      ranAt,
      network,
      attempted: false,
      reason: 'admin key or pool not configured',
    });
  }

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    // 1. Read on-chain hedge state
    const poolObj = await suiClient.getObject({
      id: poolConfig.poolStateId!,
      options: { showContent: true },
    });
    type ContentLike = { fields?: { hedge_state?: { fields?: { active_hedges?: unknown[]; total_hedged_value?: string | number } } } };
    const content = (poolObj.data?.content as unknown as ContentLike) || {};
    const hedgeStateFields = content.fields?.hedge_state?.fields || {};
    const onChainHedges: unknown[] = Array.isArray(hedgeStateFields.active_hedges)
      ? hedgeStateFields.active_hedges
      : [];
    const onChainHedgedRaw = Number(hedgeStateFields.total_hedged_value || 0);
    const onChainHedgedUsdc = onChainHedgedRaw / 1e6;

    // 2. Read live BlueFin positions
    let livePositions: BluefinPosition[] = [];
    let liveMarginUsdc = 0;
    try {
      const bf = BluefinService.getInstance();
      await bf.initialize(adminKey, network === 'mainnet' ? 'mainnet' : 'testnet');
      livePositions = await bf.getPositions();
      for (const p of livePositions) {
        liveMarginUsdc += Number(p.margin || 0);
      }
    } catch (bfErr) {
      logger.warn('[SuiHedgeReconcile] Could not read BlueFin — abort reconciliation (do NOT reset on stale signal)', {
        error: errMsg(bfErr),
      });
      return NextResponse.json({
        success: true,
        ranAt,
        network,
        attempted: true,
        onChainHedges: onChainHedges.length,
        reason: 'bluefin unreadable — aborted to avoid false-positive reset',
      });
    }

    // 3. Decide if drift is real
    //
    // We use an absolute USDC delta tolerance because integer rounding +
    // funding rate accruals can produce small benign drift. A drift > $1
    // OR mismatch in count > 0 is a signal that something closed externally.
    const onChainCount = onChainHedges.length;
    const liveCount = livePositions.length;
    const deltaUsdc = onChainHedgedUsdc - liveMarginUsdc;
    const COUNT_DRIFT = onChainCount > liveCount; // on-chain thinks more hedges are open
    const VALUE_DRIFT = deltaUsdc > 1.0;         // on-chain over-reports by $1+
    const driftDetected = COUNT_DRIFT || VALUE_DRIFT;

    if (!driftDetected) {
      return NextResponse.json({
        success: true,
        ranAt,
        network,
        attempted: true,
        onChainHedges: onChainCount,
        liveBluefinPositions: liveCount,
        driftDetected: false,
        driftDetails: { onChainHedgesUsdc: onChainHedgedUsdc, liveMarginUsdc, deltaUsdc },
        reason: 'in sync — no action needed',
      });
    }

    logger.warn('[SuiHedgeReconcile] DRIFT DETECTED — on-chain hedge state out of sync with BlueFin', {
      onChainCount,
      liveCount,
      onChainHedgedUsdc: onChainHedgedUsdc.toFixed(4),
      liveMarginUsdc: liveMarginUsdc.toFixed(4),
      deltaUsdc: deltaUsdc.toFixed(4),
      supportedSymbols: SUPPORTED_SYMBOLS,
    });

    // 4. Attempt reset (only if AdminCap is held by cron signer)
    if (!adminCapId) {
      return NextResponse.json({
        success: true,
        ranAt,
        network,
        attempted: true,
        onChainHedges: onChainCount,
        liveBluefinPositions: liveCount,
        driftDetected: true,
        driftDetails: { onChainHedgesUsdc: onChainHedgedUsdc, liveMarginUsdc, deltaUsdc },
        resetExecuted: false,
        reason: 'SUI_ADMIN_CAP_ID not configured — alert only',
      });
    }

    let keypair: InstanceType<typeof Ed25519Keypair>;
    try {
      keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    } catch {
      return NextResponse.json({
        success: false, ranAt, network, attempted: true, error: 'invalid admin key format',
      });
    }

    const capObj = await suiClient.getObject({ id: adminCapId, options: { showOwner: true } });
    const capOwner = capObj.data?.owner;
    const cronSigner = keypair.toSuiAddress();
    if (!capOwner || typeof capOwner !== 'object' || !('AddressOwner' in capOwner)) {
      return NextResponse.json({
        success: true,
        ranAt,
        network,
        attempted: true,
        onChainHedges: onChainCount,
        liveBluefinPositions: liveCount,
        driftDetected: true,
        resetExecuted: false,
        reason: 'AdminCap owner unreadable — alert only',
      });
    }
    const ownerAddr = (capOwner as { AddressOwner: string }).AddressOwner;
    if (ownerAddr.toLowerCase() !== cronSigner.toLowerCase()) {
      logger.warn('[SuiHedgeReconcile] AdminCap is multisig-gated — drift requires manual reset', {
        capOwner: ownerAddr,
        cronSigner,
      });
      return NextResponse.json({
        success: true,
        ranAt,
        network,
        attempted: true,
        onChainHedges: onChainCount,
        liveBluefinPositions: liveCount,
        driftDetected: true,
        driftDetails: { onChainHedgesUsdc: onChainHedgedUsdc, liveMarginUsdc, deltaUsdc },
        resetExecuted: false,
        reason: `AdminCap owned by ${ownerAddr} — multisig must call admin_reset_hedge_state`,
      });
    }

    const usdcType = SUI_USDC_COIN_TYPE[network];
    const tx = new Transaction();
    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::admin_reset_hedge_state`,
      typeArguments: [usdcType],
      arguments: [
        tx.object(adminCapId),
        tx.object(poolConfig.poolStateId!),
        tx.object('0x6'),
      ],
    });
    tx.setGasBudget(20_000_000);

    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });
    const ok = result.effects?.status?.status === 'success';

    if (ok) {
      logger.info('[SuiHedgeReconcile] ✅ admin_reset_hedge_state succeeded — drift repaired', {
        txDigest: result.digest,
        clearedHedgesCount: onChainCount,
        clearedHedgedUsdc: onChainHedgedUsdc.toFixed(4),
      });
    } else {
      logger.error('[SuiHedgeReconcile] admin_reset_hedge_state FAILED', {
        error: result.effects?.status?.error,
      });
    }

    return NextResponse.json({
      success: ok,
      ranAt,
      network,
      attempted: true,
      onChainHedges: onChainCount,
      liveBluefinPositions: liveCount,
      driftDetected: true,
      driftDetails: { onChainHedgesUsdc: onChainHedgedUsdc, liveMarginUsdc, deltaUsdc },
      resetExecuted: ok,
      txDigest: result.digest,
      error: ok ? undefined : result.effects?.status?.error,
    });
  } catch (e) {
    logger.error('[SuiHedgeReconcile] exception', { error: errMsg(e) });
    return safeErrorResponse(e, 'sui-hedge-reconcile') as NextResponse<ReconcileResult>;
  }
}

export const POST = GET;
