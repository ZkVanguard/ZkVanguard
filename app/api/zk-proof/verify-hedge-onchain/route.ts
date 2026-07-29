/**
 * POST /api/zk-proof/verify-hedge-onchain
 *
 * Turns a Python hedge STARK proof into a Sui PTB that calls
 * `zk_verifier::verify_hedge_stark_proof_entry`, which delegates through
 * `zkv_stark::verify_hedge_stark_proof` (grinding + FRI + composition)
 * to the on-chain verifier. The chain independently confirms the hedge
 * invariants — no trust in the operator's ed25519 key required.
 *
 * Modes:
 *   - buildOnly (default): return serialized tx bytes so a client wallet
 *     signs and submits (user pays gas). This is the "self-custodial
 *     private hedge" path.
 *   - execute (`?mode=execute`): server signs with SUI_POOL_ADMIN_KEY
 *     and executes. Operator pays gas — the "sponsored" path. Only
 *     available if a signing key is configured.
 *
 * Request body:
 *   {
 *     proof: <Python prover JSON>,             // required
 *     commitmentHashHex: string,               // required (64 hex, no 0x)
 *     mode?: 'buildOnly' | 'execute',          // default: 'buildOnly'
 *     maxFinalDegree?: number,                 // default: 80
 *   }
 *
 * Response (buildOnly):
 *   { mode: 'buildOnly', txBytesBase64: string, target: string, config: {...} }
 *
 * Response (execute):
 *   { mode: 'execute', digest: string, status: 'success'|'failure',
 *     effects: {...} }
 */

import { NextRequest, NextResponse } from 'next/server';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import {
  buildHedgeStarkVerifyTx,
  type HedgeStarkOnChainConfig,
} from '@/zk/verifier/hedgeStarkTx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Every env read gets .trim() per repo convention — Vercel values carry
// trailing \r\n.
function envTrim(name: string): string {
  return (process.env[name] ?? '').trim();
}

interface RequestBody {
  proof: unknown;
  commitmentHashHex: string;
  mode?: 'buildOnly' | 'execute';
  maxFinalDegree?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const { proof, commitmentHashHex } = body;
    const mode = body.mode ?? 'buildOnly';

    if (!proof || typeof proof !== 'object') {
      return NextResponse.json(
        { success: false, error: 'proof is required (Python prover JSON)' },
        { status: 400 },
      );
    }
    if (
      !commitmentHashHex ||
      typeof commitmentHashHex !== 'string' ||
      commitmentHashHex.replace(/^0x/, '').length !== 64
    ) {
      return NextResponse.json(
        { success: false, error: 'commitmentHashHex must be a 64-char hex string' },
        { status: 400 },
      );
    }

    // Address book — same env vars the existing SUI stack reads.
    const network = envTrim('SUI_NETWORK') || envTrim('NEXT_PUBLIC_SUI_NETWORK') || 'mainnet';
    const packageId =
      envTrim('NEXT_PUBLIC_SUI_MAINNET_ZK_STARK_PKG') ||
      envTrim('NEXT_PUBLIC_SUI_MAINNET_PACKAGE_ID');
    const zkVerifierStateId = envTrim('NEXT_PUBLIC_SUI_ZK_VERIFIER_STATE');

    if (!packageId || !zkVerifierStateId) {
      return NextResponse.json(
        {
          success: false,
          error:
            'STARK verifier not deployed on this network yet. Expected env vars: ' +
            'NEXT_PUBLIC_SUI_MAINNET_ZK_STARK_PKG (or NEXT_PUBLIC_SUI_MAINNET_PACKAGE_ID) ' +
            'and NEXT_PUBLIC_SUI_ZK_VERIFIER_STATE.',
          network,
        },
        { status: 503 },
      );
    }

    const config: HedgeStarkOnChainConfig = {
      packageId,
      zkVerifierStateId,
    };
    const target = `${packageId}::zk_verifier::verify_hedge_stark_proof_entry`;

    // Build the transaction. Throws on malformed proof; surfaced as 400.
    let tx;
    try {
      tx = buildHedgeStarkVerifyTx(
        proof as Parameters<typeof buildHedgeStarkVerifyTx>[0],
        commitmentHashHex,
        config,
        { maxFinalDegree: body.maxFinalDegree ? BigInt(body.maxFinalDegree) : 80n },
      );
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Failed to build hedge STARK verify tx: ' +
            (err instanceof Error ? err.message : String(err)),
        },
        { status: 400 },
      );
    }

    // buildOnly: serialize + return. The client wallet supplies the sender
    // and signs.
    if (mode === 'buildOnly') {
      const suiClient = new SuiClient({ url: getFullnodeUrl(network as 'mainnet' | 'testnet' | 'devnet') });
      const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
      return NextResponse.json({
        success: true,
        mode: 'buildOnly',
        txBytesBase64: Buffer.from(txBytes).toString('base64'),
        target,
        config: { network, packageId, zkVerifierStateId },
      });
    }

    // execute: sign with operator key + execute. Only allowed if a key
    // is configured — otherwise return 403 (no silent fallback to a
    // less-authenticated path).
    if (mode === 'execute') {
      const adminKeyHex = envTrim('SUI_POOL_ADMIN_KEY');
      if (!adminKeyHex) {
        return NextResponse.json(
          {
            success: false,
            error:
              'execute mode requires SUI_POOL_ADMIN_KEY on the server. ' +
              'Use mode=buildOnly for wallet-signed submission.',
          },
          { status: 403 },
        );
      }
      const clean = adminKeyHex.startsWith('0x') ? adminKeyHex.slice(2) : adminKeyHex;
      const secretKey = Uint8Array.from(Buffer.from(clean, 'hex'));
      const keypair = Ed25519Keypair.fromSecretKey(
        secretKey.length === 32 ? secretKey : secretKey.slice(0, 32),
      );
      tx.setSender(keypair.toSuiAddress());

      const suiClient = new SuiClient({ url: getFullnodeUrl(network as 'mainnet' | 'testnet' | 'devnet') });
      const result = await suiClient.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true },
      });
      const status = result.effects?.status?.status ?? 'unknown';
      logger.info('[verify-hedge-onchain] executed', {
        digest: result.digest,
        status,
        packageId,
      });
      return NextResponse.json({
        success: status === 'success',
        mode: 'execute',
        digest: result.digest,
        status,
        effects: result.effects,
      });
    }

    return NextResponse.json(
      { success: false, error: `Unknown mode: ${mode}` },
      { status: 400 },
    );
  } catch (error: unknown) {
    logger.error('[verify-hedge-onchain] Error:', error);
    return safeErrorResponse(error, 'ZK on-chain hedge verify');
  }
}
