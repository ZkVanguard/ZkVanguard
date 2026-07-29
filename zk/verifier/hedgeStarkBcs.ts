/**
 * BCS serializers for the on-chain hedge STARK verifier.
 *
 * Move entry function `zk_verifier::verify_hedge_stark_proof_entry`
 * (contracts/sui/sources/zk_verifier.move) can't accept `vector<FriQuery>` /
 * `vector<TraceOpening>` directly — Sui entry functions only accept
 * primitives + shallow vectors + object refs. So the caller BCS-encodes
 * those two nested pieces as `vector<u8>` blobs, and Move decodes them
 * via `zkv_stark::decode_fri_queries` / `decode_trace_openings`.
 *
 * This module builds those two blobs from the Python prover's JSON proof
 * (as emitted by `zkp/api/server.py`'s `/api/zk/generate` → the
 * `query_responses` and `trace_openings` fields).
 *
 * BCS layout MUST byte-match `sui::bcs::to_bytes` on the Move side. The
 * struct schemas below are the single source of truth; changing them
 * requires updating the matching Move decoders in
 * `contracts/sui/sources/zkv_stark.move` in the same commit.
 *
 * Schemas (matches `zkv_stark.move` peel_* functions):
 *   MerkleProofStep { sibling: vector<u8>, is_left: bool }
 *   FriQueryLayer   { value: u64, sibling_value: u64,
 *                     merkle_proof: vector<MerkleProofStep>,
 *                     sibling_proof: vector<MerkleProofStep> }
 *   FriQuery        { index: u64, layers: vector<FriQueryLayer> }
 *   TraceOpening    { index: u64, value: u64,
 *                     merkle_proof: vector<MerkleProofStep> }
 */

import { bcs } from '@mysten/sui/bcs';

// -------------------- BCS schemas (byte-exact to Move `sui::bcs`) --------------------

export const MerkleProofStep = bcs.struct('MerkleProofStep', {
  sibling: bcs.vector(bcs.u8()),
  is_left: bcs.bool(),
});

export const FriQueryLayer = bcs.struct('FriQueryLayer', {
  value: bcs.u64(),
  sibling_value: bcs.u64(),
  merkle_proof: bcs.vector(MerkleProofStep),
  sibling_proof: bcs.vector(MerkleProofStep),
});

export const FriQuery = bcs.struct('FriQuery', {
  index: bcs.u64(),
  layers: bcs.vector(FriQueryLayer),
});

export const TraceOpening = bcs.struct('TraceOpening', {
  index: bcs.u64(),
  value: bcs.u64(),
  merkle_proof: bcs.vector(MerkleProofStep),
});

export const FriQueryVec = bcs.vector(FriQuery);
export const TraceOpeningVec = bcs.vector(TraceOpening);

// -------------------- Shape types --------------------

export interface JsMerkleProofStep {
  sibling: Uint8Array;
  is_left: boolean;
}

export interface JsFriQueryLayer {
  value: bigint;
  sibling_value: bigint;
  merkle_proof: JsMerkleProofStep[];
  sibling_proof: JsMerkleProofStep[];
}

export interface JsFriQuery {
  index: bigint;
  layers: JsFriQueryLayer[];
}

export interface JsTraceOpening {
  index: bigint;
  value: bigint;
  merkle_proof: JsMerkleProofStep[];
}

// -------------------- Python-JSON → JS-shape adapters --------------------

/**
 * Python emits Merkle proof steps as `Array<[hex_string, boolean]>` and
 * Merkle sibling values as decimal integer strings. Normalize both.
 *
 * Callers can pass steps as either:
 *   - `[hex, is_left]` (Python JSON shape)
 *   - `{ sibling: hex|Uint8Array, is_left: boolean }` (structured shape)
 */
export function normalizeMerkleProof(
  proof: Array<[string, boolean] | { sibling: string | Uint8Array; is_left: boolean }>,
): JsMerkleProofStep[] {
  return proof.map((step) => {
    let sibling: Uint8Array;
    let isLeft: boolean;
    if (Array.isArray(step)) {
      sibling = hexToBytes(step[0]);
      isLeft = step[1];
    } else {
      sibling = typeof step.sibling === 'string' ? hexToBytes(step.sibling) : step.sibling;
      isLeft = step.is_left;
    }
    if (sibling.length !== 32) {
      throw new Error(
        `hedgeStarkBcs: Merkle sibling must be 32 bytes, got ${sibling.length}`,
      );
    }
    return { sibling, is_left: isLeft };
  });
}

/** Convert Python proof's `query_responses[]` into the JS shape. */
export function pythonQueriesToJs(queryResponses: unknown[]): JsFriQuery[] {
  return queryResponses.map((q, qi) => {
    const query = q as { index: number | string; layers: unknown[] };
    const index = toBigInt(query.index, `query_responses[${qi}].index`);
    const layers = query.layers.map((l, li) => {
      const layer = l as {
        value: string;
        sibling_value: string;
        merkle_proof: Array<[string, boolean]>;
        sibling_proof: Array<[string, boolean]>;
      };
      return {
        value: toBigInt(layer.value, `query_responses[${qi}].layers[${li}].value`),
        sibling_value: toBigInt(
          layer.sibling_value,
          `query_responses[${qi}].layers[${li}].sibling_value`,
        ),
        merkle_proof: normalizeMerkleProof(layer.merkle_proof),
        sibling_proof: normalizeMerkleProof(layer.sibling_proof),
      };
    });
    return { index, layers };
  });
}

/** Convert Python proof's `trace_openings[]` into the JS shape. */
export function pythonTraceOpeningsToJs(traceOpenings: unknown[]): JsTraceOpening[] {
  return traceOpenings.map((o, oi) => {
    const opening = o as {
      index: number | string;
      value: string;
      merkle_proof: Array<[string, boolean]>;
    };
    return {
      index: toBigInt(opening.index, `trace_openings[${oi}].index`),
      value: toBigInt(opening.value, `trace_openings[${oi}].value`),
      merkle_proof: normalizeMerkleProof(opening.merkle_proof),
    };
  });
}

// -------------------- Serialize entry points --------------------

/**
 * BCS-serialize the FRI query responses into the `vector<u8>` blob
 * `zk_verifier::verify_hedge_stark_proof_entry` expects at
 * `fri_queries_bcs`.
 *
 * Accepts EITHER pre-normalized JS shape OR the raw Python JSON
 * `query_responses[]`.
 */
export function serializeFriQueries(
  queries: JsFriQuery[] | unknown[],
): Uint8Array {
  const normalized: JsFriQuery[] = isJsFriQueries(queries)
    ? queries
    : pythonQueriesToJs(queries);
  return FriQueryVec.serialize(normalized).toBytes();
}

/**
 * BCS-serialize the trace openings into the `vector<u8>` blob
 * `zk_verifier::verify_hedge_stark_proof_entry` expects at
 * `trace_openings_bcs`.
 */
export function serializeTraceOpenings(
  openings: JsTraceOpening[] | unknown[],
): Uint8Array {
  const normalized: JsTraceOpening[] = isJsTraceOpenings(openings)
    ? openings
    : pythonTraceOpeningsToJs(openings);
  return TraceOpeningVec.serialize(normalized).toBytes();
}

/**
 * One-shot: take the full Python proof JSON and return the two blobs +
 * flat scalar arguments the Sui PTB needs to call
 * `verify_hedge_stark_proof_entry`. Field names mirror the Move
 * parameter names so a caller can `move.moveCall({ arguments: [...] })`
 * directly.
 */
export interface HedgeStarkEntryArgs {
  trace_merkle_root: Uint8Array;
  fri_roots: Uint8Array[];
  final_poly_coeffs: bigint[];
  fri_queries_bcs: Uint8Array;
  trace_openings_bcs: Uint8Array;
  extended_size: bigint;
  trace_length: bigint;
  leverage_cap: bigint;
  grinding_nonce: bigint;
  grinding_bits: bigint;
  max_final_degree: bigint;
  commitment_hash: Uint8Array;
}

export function buildHedgeStarkEntryArgs(
  pythonProof: {
    proof?: Record<string, unknown>;
  } & Record<string, unknown>,
  commitmentHashHex: string,
  maxFinalDegree: bigint = 80n,
): HedgeStarkEntryArgs {
  const p = (pythonProof.proof ?? pythonProof) as Record<string, unknown>;
  return {
    trace_merkle_root: hexToBytes(String(p.trace_merkle_root ?? '')),
    fri_roots: (p.fri_roots as string[]).map(hexToBytes),
    final_poly_coeffs: (p.fri_final_polynomial as string[]).map((s) => BigInt(s)),
    fri_queries_bcs: serializeFriQueries(p.query_responses as unknown[]),
    trace_openings_bcs: serializeTraceOpenings(p.trace_openings as unknown[]),
    extended_size: toBigInt(p.extended_trace_length, 'extended_trace_length'),
    trace_length: toBigInt(p.trace_length, 'trace_length'),
    leverage_cap: extractLeverageCap(pythonProof),
    grinding_nonce: toBigInt(p.grinding_nonce, 'grinding_nonce'),
    grinding_bits: toBigInt(p.grinding_bits, 'grinding_bits'),
    max_final_degree: maxFinalDegree,
    commitment_hash: hexToBytes(commitmentHashHex),
  };
}

// -------------------- Helpers --------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error(`hedgeStarkBcs: odd-length hex string (len=${clean.length})`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toBigInt(v: unknown, field: string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') return BigInt(v);
  throw new Error(`hedgeStarkBcs: cannot coerce ${field}=${String(v)} to bigint`);
}

function extractLeverageCap(pythonProof: Record<string, unknown>): bigint {
  // Statement is either at top level or under `.statement` per proof shape.
  const stmt = (pythonProof.statement ??
    (pythonProof.proof as Record<string, unknown> | undefined)?.statement) as
    | { public_inputs?: Array<string | number> }
    | undefined;
  if (!stmt || !Array.isArray(stmt.public_inputs) || stmt.public_inputs.length < 4) {
    throw new Error(
      'hedgeStarkBcs: cannot extract leverage_cap — expected statement.public_inputs[3]',
    );
  }
  return toBigInt(stmt.public_inputs[3], 'statement.public_inputs[3]');
}

function isJsFriQueries(v: unknown): v is JsFriQuery[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof (v[0] as JsFriQuery)?.index === 'bigint'
  );
}

function isJsTraceOpenings(v: unknown): v is JsTraceOpening[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof (v[0] as JsTraceOpening)?.index === 'bigint' &&
    typeof (v[0] as JsTraceOpening)?.value === 'bigint'
  );
}
