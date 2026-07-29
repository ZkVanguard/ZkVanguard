/**
 * Sui transaction builder for the on-chain hedge STARK verifier.
 *
 * Composes `zk/verifier/hedgeStarkBcs.ts` (proof → BCS blobs) with a
 * `@mysten/sui/transactions::Transaction` `moveCall` targeting
 * `zk_verifier::verify_hedge_stark_proof_entry`. Pure builder — does
 * NOT execute; the caller decides whether to serialize for wallet
 * signing (user-pays-gas) or sign+execute with an operator key
 * (sponsored).
 *
 * Split from the route so the tx-shape can be unit-tested without a
 * running Next.js server.
 */

import { Transaction } from '@mysten/sui/transactions';
import {
  buildHedgeStarkEntryArgs,
  type HedgeStarkEntryArgs,
} from './hedgeStarkBcs';

/** Address book for the deployed verifier package. */
export interface HedgeStarkOnChainConfig {
  /** Deployed Move package ID that contains `zk_verifier`. */
  packageId: string;
  /** Shared `ZKVerifierState` object ID (per-network). */
  zkVerifierStateId: string;
  /** Optional gas budget override (default 100M MIST = ~$0.02 SUI @ current). */
  gasBudget?: number;
}

/**
 * Build a Sui `Transaction` that calls
 * `zk_verifier::verify_hedge_stark_proof_entry` with args derived from
 * a Python prover JSON. Does not set a sender; the caller sets it via
 * `tx.setSender(...)` before signing.
 *
 * The returned transaction is ready to be:
 *   - `tx.build({ client, onlyTransactionKind: false })` for wallet signing
 *   - passed to `suiClient.signAndExecuteTransaction({ signer, transaction: tx })`
 */
export function buildHedgeStarkVerifyTx(
  pythonProof: Parameters<typeof buildHedgeStarkEntryArgs>[0],
  commitmentHashHex: string,
  config: HedgeStarkOnChainConfig,
  opts: { maxFinalDegree?: bigint } = {},
): Transaction {
  const args = buildHedgeStarkEntryArgs(
    pythonProof,
    commitmentHashHex,
    opts.maxFinalDegree ?? 80n,
  );
  return buildHedgeStarkVerifyTxFromArgs(args, config);
}

/**
 * Same as `buildHedgeStarkVerifyTx` but takes pre-built entry args.
 * Useful when a caller has already normalized the proof (e.g., to log
 * something before submission, or to reuse args across multiple retries).
 */
export function buildHedgeStarkVerifyTxFromArgs(
  args: HedgeStarkEntryArgs,
  config: HedgeStarkOnChainConfig,
): Transaction {
  if (!config.packageId || !config.zkVerifierStateId) {
    throw new Error(
      'hedgeStarkTx: packageId and zkVerifierStateId are required to build the tx',
    );
  }

  const tx = new Transaction();

  tx.moveCall({
    target: `${config.packageId}::zk_verifier::verify_hedge_stark_proof_entry`,
    arguments: [
      tx.object(config.zkVerifierStateId),
      tx.pure.vector('u8', Array.from(args.trace_merkle_root)),
      tx.pure.vector(
        'vector<u8>',
        args.fri_roots.map((r) => Array.from(r)),
      ),
      tx.pure.vector('u64', args.final_poly_coeffs),
      tx.pure.vector('u8', Array.from(args.fri_queries_bcs)),
      tx.pure.vector('u8', Array.from(args.trace_openings_bcs)),
      tx.pure.u64(args.extended_size),
      tx.pure.u64(args.trace_length),
      tx.pure.u64(args.leverage_cap),
      tx.pure.u64(args.grinding_nonce),
      tx.pure.u64(args.grinding_bits),
      tx.pure.u64(args.max_final_degree),
      tx.pure.vector('u8', Array.from(args.commitment_hash)),
      // Move entry takes &Clock — SUI's shared Clock object is at 0x6.
      tx.object('0x6'),
    ],
  });

  tx.setGasBudget(config.gasBudget ?? 100_000_000);
  return tx;
}
