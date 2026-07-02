/**
 * Canonical serialization + hashing of risk-analysis inputs, so a STARK
 * proof can cryptographically bind the claimed risk score to the *exact*
 * inputs that produced it.
 *
 * Before this module, the on-chain / off-chain risk attestations proved
 * only that "some STARK computation ran and yielded totalRisk = N" — the
 * witness was `{ secret_value: totalRisk, portfolio_value: 10_000_000 }`
 * where portfolio_value was HARDCODED and no other input was constrained.
 * A malicious operator could sign any score against any state.
 *
 * With canonical binding:
 *
 *   1. Every risk input (portfolioId, chain, timestamp, portfolio value,
 *      volatility, exposures, sentiment, base score, AI score, total
 *      score) is serialized deterministically — same bytes on TS and on
 *      Python.
 *   2. `inputsHash = SHA256(canonical_bytes)` fingerprints the input set.
 *   3. `outputHash = SHA256(u32-BE totalRisk)` fingerprints the score.
 *   4. `commitmentHash = SHA256(inputsHash || outputHash || totalRisk_be
 *      || portfolioId_be || timestampMs_be || threshold_be || version_be)`
 *      is the 32-byte value the prover ed25519-signs and the on-chain
 *      verifier checks — one canonical binding value for the whole tuple.
 *
 * The STARK statement's public_inputs pins `[inputsHash, outputHash,
 * totalRisk, threshold]`, which folds into `statement_hash`. The prover
 * additionally asserts (before generating the proof) that
 * `sha256(canonical_witness) == inputsHash` and that the base+AI+total
 * formulas match. A honest prover can only produce a proof for a
 * consistent tuple.
 *
 * Non-verifiable: the raw LLM output (`aiRiskScore`). It enters as an
 * opaque witness field — we cannot re-run the LLM inside a circuit — but
 * it *is* folded into `inputsHash`, so it can't be revised post-hoc
 * without invalidating the proof.
 */

import crypto from 'crypto';

/** Sentinel — MUST match RISK_CANONICAL_VERSION in zkp/api/server.py. */
export const RISK_CANONICAL_VERSION = 1 as const;

/** Sentiment codes — fixed integer mapping so cross-lang hashes agree. */
export const SENTIMENT_CODE = {
  bearish: 0,
  neutral: 1,
  bullish: 2,
} as const;

export type SentimentLabel = keyof typeof SENTIMENT_CODE;
export type SentimentCode = (typeof SENTIMENT_CODE)[SentimentLabel];

/**
 * The exact schema the STARK proof binds. Every field is an integer or a
 * fixed-precision-scaled integer to keep serialization language-neutral.
 *
 * Precision conventions (must match Python):
 *   - USDC-denominated values → integer cents ($1 = 100)
 *   - Ratios / percentages    → basis points (100% = 10000)
 *   - Scores                  → integers 0..100
 *   - Asset symbols           → uppercase ASCII
 *   - Sentiment               → integer code from SENTIMENT_CODE
 */
export interface CanonicalRiskInputs {
  version: typeof RISK_CANONICAL_VERSION;
  portfolioId: number;
  chain: string;
  /** ms epoch — floored to the nearest 1000 ms so proof and attestation share the same second. */
  timestampMs: number;
  /** Portfolio NAV in USDC cents (1 USDC = 100). */
  portfolioValueUsdc: number;
  /** Volatility fraction × 10000, rounded (0.25 → 2500). */
  volatilityBps: number;
  /** Sorted asc by asset symbol (ASCII) so lists in the same order across langs. */
  exposures: Array<{
    asset: string;
    /** Exposure "percentage points" × 100 (30 pp → 3000). Matches RiskAgent.exposure * 100. */
    exposureBps: number;
    /** Contribution to base risk × 100 (30 pp → 3000). Matches RiskAgent.contribution * 100. */
    contributionBps: number;
  }>;
  sentimentCode: SentimentCode;
  /** Deterministic score computed from volatility + exposures — 0..100. */
  baseRiskScore: number;
  /** LLM-adjusted score if AI ran, else null. 0..100. */
  aiRiskScore: number | null;
  /** Final published score = fuse(baseRiskScore, aiRiskScore). 0..100. */
  totalRisk: number;
  /** Compliance threshold this proof asserts totalRisk stays below. */
  threshold: number;
}

/**
 * Canonical JSON serialization. This is the byte string the SHA256
 * hashes and both Python + TypeScript must produce byte-for-byte
 * identical output — that's the whole point.
 *
 * Rules:
 *   1. Keys sorted lexicographically at every nesting level.
 *   2. No whitespace (compact separators).
 *   3. All floats are pre-rounded to integers at scaling time (bps/cents)
 *      so JSON never emits `1.0` vs `1`.
 *   4. Exposures list pre-sorted by `asset` ASCII order.
 *   5. Asset symbols uppercased; chain lowercased.
 *   6. `aiRiskScore: null` serializes as JSON `null` (matches Python None).
 */
export function serializeCanonical(inputs: CanonicalRiskInputs): string {
  const normalized: CanonicalRiskInputs = {
    version: RISK_CANONICAL_VERSION,
    portfolioId: Math.trunc(inputs.portfolioId),
    chain: inputs.chain.toLowerCase(),
    timestampMs: Math.floor(inputs.timestampMs / 1000) * 1000,
    portfolioValueUsdc: Math.round(inputs.portfolioValueUsdc),
    volatilityBps: Math.round(inputs.volatilityBps),
    exposures: [...inputs.exposures]
      .map((e) => ({
        asset: e.asset.toUpperCase(),
        exposureBps: Math.round(e.exposureBps),
        contributionBps: Math.round(e.contributionBps),
      }))
      .sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0)),
    sentimentCode: inputs.sentimentCode,
    baseRiskScore: Math.round(inputs.baseRiskScore),
    aiRiskScore: inputs.aiRiskScore === null ? null : Math.round(inputs.aiRiskScore),
    totalRisk: Math.round(inputs.totalRisk),
    threshold: Math.round(inputs.threshold),
  };
  return stringifySortedKeys(normalized);
}

/** JSON.stringify with sorted keys at every level, no whitespace. */
function stringifySortedKeys(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`non-finite number: ${v}`);
    return Number.isInteger(v) ? v.toString() : v.toString();
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stringifySortedKeys).join(',')}]`;
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifySortedKeys(obj[k])}`).join(',')}}`;
  }
  throw new Error(`unserializable value: ${typeof v}`);
}

/**
 * SHA-256 of the canonical serialization. 32 bytes. Same value produced
 * by Python's `hashlib.sha256(serialize_canonical(inputs).encode()).hexdigest()`.
 */
export function computeInputsHash(inputs: CanonicalRiskInputs): string {
  const bytes = Buffer.from(serializeCanonical(inputs), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * SHA-256 over the 4-byte big-endian totalRisk. This is a fingerprint of
 * the *output* only, useful for on-chain lookups keyed by score.
 */
export function computeOutputHash(totalRisk: number): string {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(Math.round(totalRisk) & 0xffffffff, 0);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * The 32-byte value the prover's ed25519 key signs. Feed this as
 * `commitment_hash_hex` to `/api/zk/attest` and as the `msg` arg to
 * `zk_verifier::verify_proof` on-chain.
 *
 * Field order is byte-exact — any change here MUST land in Python and
 * Move at the same time.
 *
 *   commitmentHash =
 *     SHA256(
 *       version_u32BE     ||
 *       portfolioId_u32BE ||
 *       timestampMs_u64BE ||
 *       totalRisk_u32BE   ||
 *       threshold_u32BE   ||
 *       inputsHash_32B    ||
 *       outputHash_32B
 *     )
 */
export function computeCommitmentHash(
  inputs: CanonicalRiskInputs,
  inputsHash: string,
  outputHash: string,
): string {
  const parts = [
    u32BE(RISK_CANONICAL_VERSION),
    u32BE(inputs.portfolioId),
    u64BE(Math.floor(inputs.timestampMs / 1000) * 1000),
    u32BE(Math.round(inputs.totalRisk)),
    u32BE(Math.round(inputs.threshold)),
    Buffer.from(inputsHash, 'hex'),
    Buffer.from(outputHash, 'hex'),
  ];
  return crypto.createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}

function u32BE(n: number): Buffer {
  const buf = Buffer.alloc(4);
  // `n >>> 0` converts any int (incl. negatives like the -2 SUI-pool
  // sentinel) to its unsigned 32-bit representation. Do NOT re-apply a
  // bitwise `&` here — JS bitwise ops re-signed-fold the value.
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

function u64BE(n: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(n));
  return buf;
}

/**
 * Deterministic base-risk formula. Must byte-match Python
 * `compute_base_risk_score` in zkp/core/risk_canonical.py.
 *
 * Units:
 *   - volatilityBps  = fraction × 10000 (0.25 → 2500)
 *   - contributionBps = percentage-points × 100 (30 pp → 3000)
 *
 * Formula (mirrors agents/specialized/RiskAgent.ts:202-205 with unit
 * conversion applied):
 *
 *   volFrac      = volatilityBps / 10000              // 0.25
 *   contribSum   = Σ (contributionBps / 100)          // percentage points
 *   raw          = volFrac × 50 + contribSum          // 0..∞
 *   baseRisk     = clamp(round(raw), 0, 100)
 */
export function computeBaseRiskScore(
  volatilityBps: number,
  exposures: Array<{ contributionBps: number }>,
): number {
  const volFrac = volatilityBps / 10_000;
  const contribSum = exposures.reduce((s, e) => s + e.contributionBps / 100, 0);
  const raw = volFrac * 50 + contribSum;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Fuse base + AI score. Mirrors RiskAgent.analyzeRisk lines 258 (AI
 * present) and the fallback (AI absent).
 *
 *   fuse(base, null) = base
 *   fuse(base, ai)   = round((base + ai) / 2)
 */
export function fuseRiskScores(baseRiskScore: number, aiRiskScore: number | null): number {
  if (aiRiskScore === null) return Math.round(baseRiskScore);
  return Math.max(0, Math.min(100, Math.round((baseRiskScore + aiRiskScore) / 2)));
}

/**
 * Everything a caller needs to submit a bound STARK request. Returned by
 * `prepareRiskBinding` so `ProofGenerator` and `ProofValidator` don't
 * have to re-derive the hashes independently.
 */
export interface RiskBinding {
  canonical: CanonicalRiskInputs;
  canonicalBytes: string;
  inputsHash: string;
  outputHash: string;
  commitmentHash: string;
}

/** One-shot: canonicalize → hash → return everything. */
export function prepareRiskBinding(inputs: CanonicalRiskInputs): RiskBinding {
  const canonicalBytes = serializeCanonical(inputs);
  const inputsHash = crypto.createHash('sha256').update(canonicalBytes, 'utf8').digest('hex');
  const outputHash = computeOutputHash(inputs.totalRisk);
  const commitmentHash = computeCommitmentHash(inputs, inputsHash, outputHash);
  return {
    canonical: inputs,
    canonicalBytes,
    inputsHash,
    outputHash,
    commitmentHash,
  };
}
