/**
 * Canonical serialization + hashing of private-hedge inputs — TypeScript side.
 *
 * MUST produce byte-identical output to `zkp/core/hedge_canonical.py` so
 * the browser prover client (soon) and Python STARK server agree on the
 * commitment hash, and Move on-chain verifier consumes it as-is.
 *
 * Purpose: a depositor commits to a hedge (asset, side, size, leverage,
 * entry price, salt) with a single 32-byte hash on-chain. The proof
 * proves off-chain that the hidden inputs satisfy vault invariants; the
 * `public_inputs` pin the CAPS the proof was made against so any
 * observer can see the safety envelope even without the trade details.
 *
 * Precision conventions (must match Python):
 *   - USDC-denominated values → integer cents ($1 = 100). Wire encoded
 *     as u128-BE (BigInt in TS) so trillion-dollar caps are safe.
 *   - Leverage                → integer x (1..leverageCap). u32.
 *   - Prices                  → integer USDC cents. u64.
 *   - Sizes                   → integer per-asset step units. u64.
 *   - Asset / side            → uppercase ASCII, enum-coded on wire.
 *   - Salt                    → 32 raw bytes (64 hex chars, lowercase).
 *   - Timestamps              → ms epoch, floored to nearest 1000 ms.
 */

import crypto from 'crypto';

/** Sentinel — MUST match HEDGE_CANONICAL_VERSION in zkp/core/hedge_canonical.py. */
export const HEDGE_CANONICAL_VERSION = 1 as const;

/**
 * Enum codes go into the fixed-layout commitment_hash preimage. NEVER
 * renumber — existing on-chain commitments would drift.
 */
export const ASSET_CODE = {
  BTC: 1,
  ETH: 2,
  SUI: 3,
} as const;

export const SIDE_CODE = {
  LONG: 0,
  SHORT: 1,
} as const;

export type HedgeAsset = keyof typeof ASSET_CODE;
export type HedgeSide = keyof typeof SIDE_CODE;

export const ALLOWED_ASSETS: ReadonlySet<HedgeAsset> = new Set(
  Object.keys(ASSET_CODE) as HedgeAsset[],
);
export const ALLOWED_SIDES: ReadonlySet<HedgeSide> = new Set(
  Object.keys(SIDE_CODE) as HedgeSide[],
);

/** Thrown when a hedge witness fails a binding invariant (client-side pre-flight). */
export class HedgeBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HedgeBindingError';
  }
}

/**
 * The exact schema the STARK proof binds. Fields are integers or
 * bigint-string integers to keep serialization language-neutral.
 *
 * `sizeUnits`, `notionalValueUsdcCents`, `notionalCapUsdcCents` are
 * `bigint` so cent-precision doesn't overflow 2^53. Other fields fit
 * in Number.
 */
export interface CanonicalHedgeInputs {
  version: typeof HEDGE_CANONICAL_VERSION;
  chain: string;
  portfolioId: number;
  /** ms epoch — floored to nearest 1000 ms so proof and attestation share the same second. */
  timestampMs: number;
  asset: HedgeAsset;
  side: HedgeSide;
  /** Position size in per-asset step units (SUI: 1 = 1 SUI, BTC: 1000 = 0.001 BTC, ETH: 10000 = 0.01 ETH). */
  sizeUnits: bigint;
  leverageX: number;
  /** Entry price in USDC cents (u64). */
  entryPriceUsdcCents: bigint;
  /** size × entry × 1× (base notional). u128 on wire. */
  notionalValueUsdcCents: bigint;
  /** Max allowed leverage for this hedge — pinned in commitment. */
  leverageCap: number;
  /** Max allowed notional for this hedge — pinned in commitment. */
  notionalCapUsdcCents: bigint;
  /** 32-byte hex, lowercase, no 0x prefix. */
  salt: string;
}

function normalize(inputs: CanonicalHedgeInputs): CanonicalHedgeInputs {
  return {
    version: HEDGE_CANONICAL_VERSION,
    chain: inputs.chain.toLowerCase(),
    portfolioId: Math.trunc(inputs.portfolioId),
    timestampMs: Math.floor(inputs.timestampMs / 1000) * 1000,
    asset: inputs.asset.toString().toUpperCase() as HedgeAsset,
    side: inputs.side.toString().toUpperCase() as HedgeSide,
    sizeUnits: BigInt(inputs.sizeUnits),
    leverageX: Math.trunc(inputs.leverageX),
    entryPriceUsdcCents: BigInt(inputs.entryPriceUsdcCents),
    notionalValueUsdcCents: BigInt(inputs.notionalValueUsdcCents),
    leverageCap: Math.trunc(inputs.leverageCap),
    notionalCapUsdcCents: BigInt(inputs.notionalCapUsdcCents),
    salt: inputs.salt.toLowerCase(),
  };
}

/**
 * Canonical JSON. Sorted keys at every level, no whitespace. `bigint`
 * fields serialize as bare integer literals (no quotes) so Python's
 * `json.loads`-parsed output byte-matches ours.
 */
export function serializeCanonical(inputs: CanonicalHedgeInputs): string {
  return stringifySortedKeys(normalize(inputs));
}

function stringifySortedKeys(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new HedgeBindingError(`non-finite number: ${v}`);
    return v.toString();
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stringifySortedKeys).join(',')}]`;
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifySortedKeys(obj[k])}`).join(',')}}`;
  }
  throw new HedgeBindingError(`unserializable value: ${typeof v}`);
}

/** SHA-256 of the canonical JSON serialization. Byte-matches Python. */
export function computeInputsHash(inputs: CanonicalHedgeInputs): string {
  const bytes = Buffer.from(serializeCanonical(inputs), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function u32BE(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

function u64BE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt.asUintN(64, n));
  return buf;
}

function u128BE(n: bigint): Buffer {
  if (n < 0n || n >= 1n << 128n) throw new HedgeBindingError(`u128 out of range: ${n}`);
  const buf = Buffer.alloc(16);
  const hi = n >> 64n;
  const lo = n & 0xffffffffffffffffn;
  buf.writeBigUInt64BE(BigInt.asUintN(64, hi), 0);
  buf.writeBigUInt64BE(BigInt.asUintN(64, lo), 8);
  return buf;
}

function u8(n: number): Buffer {
  return Buffer.from([n & 0xff]);
}

/**
 * 32-byte SHA256 the depositor's key signs and Move verifies on-chain.
 * Fixed binary layout — NEVER change without a version bump.
 *
 *   SHA256(
 *     version_u32BE                  (4)
 *     portfolioId_u32BE              (4)
 *     timestampMs_u64BE              (8)
 *     asset_code_u8                  (1)
 *     side_code_u8                   (1)
 *     leverageX_u32BE                (4)
 *     leverageCap_u32BE              (4)
 *     entryPriceUsdcCents_u64BE      (8)
 *     sizeUnits_u64BE                (8)
 *     notionalValueUsdcCents_u128BE  (16)
 *     notionalCapUsdcCents_u128BE    (16)
 *     salt_32B                       (32)
 *     inputsHash_32B                 (32)
 *   )
 *   = 146 bytes.
 */
export function computeCommitmentHash(
  inputs: CanonicalHedgeInputs,
  inputsHash: string,
): string {
  const n = normalize(inputs);

  const assetCode = (ASSET_CODE as Record<string, number>)[n.asset];
  if (assetCode == null) throw new HedgeBindingError(`unsupported asset: ${n.asset}`);
  const sideCode = (SIDE_CODE as Record<string, number>)[n.side];
  if (sideCode == null) throw new HedgeBindingError(`unsupported side: ${n.side}`);

  const saltBytes = Buffer.from(n.salt, 'hex');
  if (saltBytes.length !== 32) {
    throw new HedgeBindingError(
      `salt must be 32 bytes (64 hex chars), got ${saltBytes.length} bytes`,
    );
  }
  const inputsHashBytes = Buffer.from(inputsHash, 'hex');
  if (inputsHashBytes.length !== 32) {
    throw new HedgeBindingError(
      `inputs_hash must be 32 bytes (64 hex chars), got ${inputsHashBytes.length} bytes`,
    );
  }

  const preimage = Buffer.concat([
    u32BE(HEDGE_CANONICAL_VERSION),
    u32BE(n.portfolioId),
    u64BE(BigInt(n.timestampMs)),
    u8(assetCode),
    u8(sideCode),
    u32BE(n.leverageX),
    u32BE(n.leverageCap),
    u64BE(n.entryPriceUsdcCents),
    u64BE(n.sizeUnits),
    u128BE(n.notionalValueUsdcCents),
    u128BE(n.notionalCapUsdcCents),
    saltBytes,
    inputsHashBytes,
  ]);
  return crypto.createHash('sha256').update(preimage).digest('hex');
}

/**
 * Client-side pre-flight of the same invariants the Python server
 * enforces via `assert_hedge_binding`. Callers should run this before
 * submitting to `/api/zk/attest` — surfaces the error locally instead
 * of via a 400 response.
 */
export function assertHedgeBindingLocal(
  statement: { claim: string; public_inputs: Array<string | number | bigint> },
  witness: { canonical: CanonicalHedgeInputs },
): CanonicalHedgeInputs {
  const expectedClaim = `zkv-hedge-v${HEDGE_CANONICAL_VERSION}`;
  if (statement.claim !== expectedClaim) {
    throw new HedgeBindingError(
      `hedge-binding: claim mismatch — expected '${expectedClaim}', got '${statement.claim}'`,
    );
  }

  const pub = statement.public_inputs;
  if (!Array.isArray(pub) || pub.length < 4) {
    throw new HedgeBindingError(
      'hedge-binding: public_inputs must be [commitment_hash, inputs_hash, notional_cap_cents, leverage_cap]',
    );
  }

  const stmtCommitment = String(pub[0]).toLowerCase();
  const stmtInputsHash = String(pub[1]).toLowerCase();
  const stmtNotionalCap = BigInt(pub[2]);
  const stmtLeverageCap = Number(pub[3]);

  const canonical = witness.canonical;
  if (!canonical || typeof canonical !== 'object') {
    throw new HedgeBindingError('hedge-binding: witness.canonical is required');
  }

  const asset = String(canonical.asset).toUpperCase() as HedgeAsset;
  if (!ALLOWED_ASSETS.has(asset)) {
    throw new HedgeBindingError(
      `hedge-binding: asset '${asset}' not in allow-list ${[...ALLOWED_ASSETS].sort().join(',')}`,
    );
  }
  const side = String(canonical.side).toUpperCase() as HedgeSide;
  if (!ALLOWED_SIDES.has(side)) {
    throw new HedgeBindingError(
      `hedge-binding: side '${side}' not in allow-list ${[...ALLOWED_SIDES].sort().join(',')}`,
    );
  }

  const n = normalize(canonical);

  if (n.leverageCap !== stmtLeverageCap) {
    throw new HedgeBindingError(
      `hedge-binding: witness.leverageCap (${n.leverageCap}) != statement.leverage_cap (${stmtLeverageCap})`,
    );
  }
  if (n.notionalCapUsdcCents !== stmtNotionalCap) {
    throw new HedgeBindingError(
      `hedge-binding: witness.notionalCapUsdcCents (${n.notionalCapUsdcCents}) != statement.notional_cap_cents (${stmtNotionalCap})`,
    );
  }

  if (!(n.leverageX >= 1 && n.leverageX <= n.leverageCap)) {
    throw new HedgeBindingError(
      `hedge-binding: leverageX (${n.leverageX}) outside [1, ${n.leverageCap}]`,
    );
  }
  if (n.notionalValueUsdcCents <= 0n) {
    throw new HedgeBindingError(
      `hedge-binding: notionalValueUsdcCents must be positive, got ${n.notionalValueUsdcCents}`,
    );
  }
  if (n.notionalValueUsdcCents > n.notionalCapUsdcCents) {
    throw new HedgeBindingError(
      `hedge-binding: notional (${n.notionalValueUsdcCents}) exceeds cap (${n.notionalCapUsdcCents})`,
    );
  }
  if (n.sizeUnits <= 0n) {
    throw new HedgeBindingError(
      `hedge-binding: sizeUnits must be positive, got ${n.sizeUnits}`,
    );
  }
  if (n.entryPriceUsdcCents <= 0n) {
    throw new HedgeBindingError(
      `hedge-binding: entryPriceUsdcCents must be positive, got ${n.entryPriceUsdcCents}`,
    );
  }

  if (n.salt.length !== 64 || !/^[0-9a-f]{64}$/.test(n.salt)) {
    throw new HedgeBindingError(
      `hedge-binding: salt must be 64 lowercase hex chars, got '${n.salt}'`,
    );
  }

  const recomputedInputsHash = computeInputsHash(canonical);
  if (recomputedInputsHash !== stmtInputsHash) {
    throw new HedgeBindingError(
      `hedge-binding: inputs_hash mismatch — recomputed=${recomputedInputsHash} claimed=${stmtInputsHash}`,
    );
  }

  const recomputedCommitment = computeCommitmentHash(canonical, recomputedInputsHash);
  if (recomputedCommitment !== stmtCommitment) {
    throw new HedgeBindingError(
      `hedge-binding: commitment_hash mismatch — recomputed=${recomputedCommitment} claimed=${stmtCommitment}`,
    );
  }

  return n;
}

/**
 * Everything a caller needs to submit a bound STARK request. One-shot
 * canonicalize → hash → return.
 */
export interface HedgeBinding {
  canonical: CanonicalHedgeInputs;
  canonicalBytes: string;
  inputsHash: string;
  commitmentHash: string;
}

export function prepareHedgeBinding(inputs: CanonicalHedgeInputs): HedgeBinding {
  const canonicalBytes = serializeCanonical(inputs);
  const inputsHash = crypto.createHash('sha256').update(canonicalBytes, 'utf8').digest('hex');
  const commitmentHash = computeCommitmentHash(inputs, inputsHash);
  return { canonical: inputs, canonicalBytes, inputsHash, commitmentHash };
}
