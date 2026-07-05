/**
 * Admin: Reset SUI Pool Hedge State
 * 
 * POST /api/admin/sui-reset-hedges
 * 
 * Calls admin_reset_hedge_state on the SUI pool contract to clear
 * orphaned hedge records. Requires AdminCap.
 * 
 * Protected by ADMIN_SECRET env var.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { logger } from '@/lib/utils/logger';
import { SUI_USDC_POOL_CONFIG } from '@/lib/services/sui/SuiCommunityPoolService';
import { verifyAdminBearer } from '@/lib/security/auth-middleware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  
  // Auth check (timing-safe)
  if (!verifyAdminBearer(request, ['ADMIN_SECRET', 'CRON_SECRET'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const network = ((process.env.SUI_NETWORK || 'mainnet').trim()) as 'mainnet' | 'testnet';
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const adminCapId = (process.env.SUI_ADMIN_CAP_ID || '').trim();

  if (!adminKey) {
    return NextResponse.json({ error: 'SUI_POOL_ADMIN_KEY not configured' }, { status: 503 });
  }
  if (!adminCapId) {
    return NextResponse.json({ error: 'SUI_ADMIN_CAP_ID not configured' }, { status: 503 });
  }

  logger.info('[Admin] Starting SUI hedge state reset', { network });

  try {
    // Create keypair
    let keypair: Ed25519Keypair;
    if (adminKey.startsWith('suiprivkey')) {
      keypair = Ed25519Keypair.fromSecretKey(adminKey);
    } else {
      keypair = Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace('0x', ''), 'hex'));
    }
    const adminAddress = keypair.getPublicKey().toSuiAddress();

    // Connect to SUI
    const poolConfig = SUI_USDC_POOL_CONFIG[network];
    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const client = new SuiClient({ url: rpcUrl });

    // Read current state
    const objBefore = await client.getObject({ 
      id: poolConfig.poolStateId!, 
      options: { showContent: true } 
    });
    const fieldsBefore = (objBefore.data?.content as any)?.fields;
    const hedgeStateBefore = fieldsBefore?.hedge_state?.fields || {};
    const activeHedgesBefore = hedgeStateBefore.active_hedges || [];
    const totalHedgedBefore = Number(hedgeStateBefore.total_hedged_value || '0') / 1e6;

    logger.info('[Admin] Current hedge state', {
      activeHedges: activeHedgesBefore.length,
      totalHedgedValue: totalHedgedBefore,
    });

    if (activeHedgesBefore.length === 0 && totalHedgedBefore === 0) {
      return NextResponse.json({
        success: true,
        message: 'Hedge state already clean',
        duration: Date.now() - startTime,
      });
    }

    // Build transaction
    const usdcType = poolConfig.usdcCoinType;

    // Read prior external_nav_usdc so we can bundle a re-attestation in the same PTB.
    // admin_reset_hedge_state wipes the external_nav dynamic fields; with strict mode
    // ON, deposits/withdraws then revert until re-attested. Bundling closes that window.
    // If the read fails, ABORT — pushing 0 would silently underpay withdrawers.
    let priorExternalNavRaw: bigint;
    {
      const inspectTx = new Transaction();
      inspectTx.moveCall({
        target: `${poolConfig.packageId}::${poolConfig.moduleName}::get_external_nav_usdc`,
        typeArguments: [usdcType],
        arguments: [inspectTx.object(poolConfig.poolStateId!)],
      });
      inspectTx.setSender('0x0000000000000000000000000000000000000000000000000000000000000001');
      const inspectBytes = await inspectTx.build({ client, onlyTransactionKind: true });
      const inspect = await client.devInspectTransactionBlock({
        sender: '0x0000000000000000000000000000000000000000000000000000000000000001',
        transactionBlock: inspectBytes,
      });
      if (inspect.effects?.status?.status !== 'success') {
        return NextResponse.json({
          success: false,
          error: `Prior external_nav unreadable (devInspect: ${inspect.effects?.status?.error ?? 'unknown'}) — reset aborted to avoid pushing wrong NAV`,
          duration: Date.now() - startTime,
        }, { status: 500 });
      }
      const raw = inspect.results?.[0]?.returnValues?.[0]?.[0];
      if (!Array.isArray(raw) || raw.length < 8) {
        return NextResponse.json({
          success: false,
          error: 'Prior external_nav returned unexpected shape — reset aborted',
          duration: Date.now() - startTime,
        }, { status: 500 });
      }
      let v = 0n;
      for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(raw[i]);
      priorExternalNavRaw = v;
    }

    const tx = new Transaction();

    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::admin_reset_hedge_state`,
      typeArguments: [usdcType],
      arguments: [
        tx.object(adminCapId),              // AdminCap
        tx.object(poolConfig.poolStateId!), // UsdcPoolState
        tx.object('0x6'),                   // Clock
      ],
    });
    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::admin_attest_external_nav`,
      typeArguments: [usdcType],
      arguments: [
        tx.object(adminCapId),
        tx.object(poolConfig.poolStateId!),
        tx.pure.u64(priorExternalNavRaw),
        tx.object('0x6'),
      ],
    });

    tx.setGasBudget(60_000_000);

    // Execute
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true },
    });

    const success = result.effects?.status?.status === 'success';
    
    if (success) {
      logger.info('[Admin] Hedge state reset successful', { txDigest: result.digest });

      // Read new state
      const objAfter = await client.getObject({ 
        id: poolConfig.poolStateId!, 
        options: { showContent: true } 
      });
      const fieldsAfter = (objAfter.data?.content as any)?.fields;
      const hedgeStateAfter = fieldsAfter?.hedge_state?.fields || {};
      const activeHedgesAfter = hedgeStateAfter.active_hedges || [];
      const totalHedgedAfter = Number(hedgeStateAfter.total_hedged_value || '0') / 1e6;

      return NextResponse.json({
        success: true,
        txDigest: result.digest,
        before: {
          activeHedges: activeHedgesBefore.length,
          totalHedgedValue: totalHedgedBefore,
        },
        after: {
          activeHedges: activeHedgesAfter.length,
          totalHedgedValue: totalHedgedAfter,
        },
        duration: Date.now() - startTime,
      });
    } else {
      const error = result.effects?.status?.error || 'Unknown error';
      logger.error('[Admin] Hedge state reset failed', { error, txDigest: result.digest });
      
      // Check if function doesn't exist
      if (error.includes('Function not found') || error.includes('UnresolvedFunction')) {
        return NextResponse.json({
          success: false,
          error: 'Function admin_reset_hedge_state not found in contract. Contract upgrade required.',
          txDigest: result.digest,
          duration: Date.now() - startTime,
        }, { status: 500 });
      }

      return NextResponse.json({
        success: false,
        error,
        txDigest: result.digest,
        duration: Date.now() - startTime,
      }, { status: 500 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[Admin] Hedge state reset error', { error: msg });
    
    return NextResponse.json({
      success: false,
      error: msg,
      duration: Date.now() - startTime,
    }, { status: 500 });
  }
}
