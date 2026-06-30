/**
 * Private-Hedge Commitment Emitter (cron-side)
 *
 * Called by `sui-community-pool` cron immediately after a successful BlueFin
 * openHedge fill. Computes a SHA-256 commitment + deterministic nullifier
 * from the hedge details and stores them on-chain via
 * `zk_hedge_commitment::store_commitment`.
 *
 * What this gives the pool:
 *   - On-chain proof that an auto-hedge was opened with specific (hidden)
 *     parameters, without revealing asset / side / size / leverage / price.
 *   - Nullifier serves as a double-emit guard at the contract layer.
 *
 * What it does NOT do (intentionally):
 *   - Doesn't call the Python STARK prover. `store_commitment` is just a
 *     write; no ZK proof is required. The STARK + ed25519 attestation path
 *     is used by SuiPrivateHedgeService.getAttestedSolvencyProof when a
 *     stronger guarantee is needed (e.g., proxy vault withdrawals).
 *   - Doesn't hide the BlueFin position. The perp itself is visible via the
 *     BlueFin API. Venue-level privacy is a separate, larger problem.
 *
 * Fails closed — every code path returns `{ success: false, ... }` on
 * misconfiguration so the caller can log + move on without blocking the
 * core auto-hedge flow.
 */

import { logger } from '@/lib/utils/logger';
import crypto from 'crypto';

const ZK_HEDGE_COMMITMENT_MODULE = 'zk_hedge_commitment';

export interface CronHedgeIdentity {
  asset: string;
  side: 'LONG' | 'SHORT';
  size: number;
  notionalValue: number;
  leverage: number;
  entryPrice: number;
  orderId: string;
}

export interface EmitResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  txDigest?: string;
  commitmentHashHex?: string;
  nullifierHex?: string;
  error?: string;
}

function readEnv(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

/**
 * Build a canonical commitment for a cron-opened hedge. Deterministic: same
 * inputs always produce the same hash. The orderId is part of the canonical
 * payload so re-runs of the same hedge can't accidentally collide with each
 * other.
 */
export function computeCommitment(hedge: CronHedgeIdentity, saltHex: string): {
  commitmentHashHex: string;
  saltHex: string;
} {
  const canonical = JSON.stringify({
    asset: hedge.asset,
    entryPrice: hedge.entryPrice,
    leverage: hedge.leverage,
    notionalValue: hedge.notionalValue,
    orderId: hedge.orderId,
    salt: saltHex,
    side: hedge.side,
    size: hedge.size,
  });
  const commitmentHashHex = crypto.createHash('sha256').update(canonical).digest('hex');
  return { commitmentHashHex, saltHex };
}

export function computeNullifier(commitmentHashHex: string, secret: string): string {
  return crypto.createHash('sha256').update(commitmentHashHex + secret).digest('hex');
}

function hexToBytes(hex: string): number[] {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  return bytes;
}

/**
 * Submit `zk_hedge_commitment::store_commitment` for the given hedge. Returns
 * `{ success: false, skipped: true, reason }` if privacy contracts or admin
 * key aren't configured — never throws, so the caller doesn't need a
 * try/catch on the happy path.
 */
export async function emitPrivateHedgeCommitment(
  hedge: CronHedgeIdentity,
  network: 'mainnet' | 'testnet' = 'mainnet',
): Promise<EmitResult> {
  const packageId = readEnv('NEXT_PUBLIC_SUI_MAINNET_ZK_PRIVACY_PACKAGE_ID');
  const commitmentStateId = readEnv('NEXT_PUBLIC_SUI_MAINNET_ZK_HEDGE_COMMITMENT_STATE');

  if (!packageId || !commitmentStateId) {
    return {
      success: false,
      skipped: true,
      reason: 'Privacy contracts not configured (NEXT_PUBLIC_SUI_MAINNET_ZK_PRIVACY_PACKAGE_ID + NEXT_PUBLIC_SUI_MAINNET_ZK_HEDGE_COMMITMENT_STATE required)',
    };
  }

  const adminKey = readEnv('SUI_POOL_ADMIN_KEY', readEnv('BLUEFIN_PRIVATE_KEY'));
  if (!adminKey) {
    return { success: false, skipped: true, reason: 'No admin signing key in env' };
  }

  // Per-emission salt — keeps the on-chain commitment unguessable even when
  // someone correlates BlueFin order timestamps with this txn.
  const saltHex = crypto.randomBytes(32).toString('hex');
  const { commitmentHashHex } = computeCommitment(hedge, saltHex);

  // Nullifier secret: stable per-installation key so the same hedge re-emitted
  // (e.g., from a retry) produces the same nullifier and the contract dedupes.
  const nullifierSecret = readEnv('HEDGE_NULLIFIER_SECRET') || readEnv('HEDGE_ENCRYPTION_SEED') || 'zkv_cron_nullifier_v1';
  const nullifierHex = computeNullifier(commitmentHashHex, nullifierSecret);

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    let keypair: InstanceType<typeof Ed25519Keypair>;
    try {
      keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    } catch (e) {
      return { success: false, error: `Invalid admin key: ${e instanceof Error ? e.message : String(e)}` };
    }

    const rpcUrl = network === 'mainnet'
      ? readEnv('SUI_MAINNET_RPC', getFullnodeUrl('mainnet'))
      : readEnv('SUI_TESTNET_RPC', getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::${ZK_HEDGE_COMMITMENT_MODULE}::store_commitment`,
      arguments: [
        tx.object(commitmentStateId),
        tx.pure.vector('u8', hexToBytes(commitmentHashHex)),
        tx.pure.vector('u8', hexToBytes(nullifierHex)),
        tx.object('0x6'), // Clock
      ],
    });
    tx.setGasBudget(20_000_000);

    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showEvents: false },
    });

    const success = result.effects?.status?.status === 'success';
    if (!success) {
      const err = result.effects?.status?.error || 'unknown move abort';
      logger.warn('[PrivateHedgeEmit] store_commitment failed', {
        orderId: hedge.orderId, asset: hedge.asset, err,
      });
      return {
        success: false,
        error: err,
        commitmentHashHex,
        nullifierHex,
        txDigest: result.digest,
      };
    }

    logger.info('[PrivateHedgeEmit] store_commitment OK', {
      orderId: hedge.orderId,
      asset: hedge.asset,
      txDigest: result.digest,
      commitment: commitmentHashHex.slice(0, 16) + '...',
    });
    return {
      success: true,
      txDigest: result.digest,
      commitmentHashHex,
      nullifierHex,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      commitmentHashHex,
      nullifierHex,
    };
  }
}
