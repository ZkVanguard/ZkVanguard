/**
 * Defense-in-depth guard for ZK-STARK proof metadata.
 *
 * The Python `/api/zk/verify` endpoint enforces the cryptographic bindings
 * (statement_hash, Merkle proofs on value + sibling per FRI layer, folding
 * consistency `f_next(x²) = (v+s)/2 + α·(v−s)/(2x)`, Fiat-Shamir rebind on
 * challenges, grinding PoW over the full commitment transcript, and the
 * final-polynomial degree bound). What it does NOT check is the descriptive
 * *metadata* — an attacker could submit a valid weak proof while advertising
 * strong parameters, misleading any UI or auditor that reads the metadata
 * as authoritative.
 *
 * This guard is the TS-side downgrade defense: reject any proof whose
 * declared parameters are weaker than the whitepaper spec, even if the
 * core crypto verifies.
 *
 * Prover cutover 2026-07-28: expected values were updated from the legacy
 * AuthenticZKStark (NIST P-521, 32 queries, no grinding) to the whitepaper-
 * aligned CUDATrueSTARK (Goldilocks, 80 queries, 20-bit grinding).
 */

/** Goldilocks prime: 2^64 − 2^32 + 1. Same field used by Polygon zkEVM / Plonky2. */
export const EXPECTED_FIELD_PRIME_DECIMAL = '18446744069414584321';

/** Minimum accepted security level in bits — reject anything downgraded. */
export const MIN_SECURITY_LEVEL_BITS = 128;

/** Minimum accepted FRI query count. Whitepaper spec is 80 (ρ^80 = 2^-160 soundness). */
export const MIN_FRI_QUERIES = 80;

/** Expected Reed-Solomon blowup factor (extended / trace length). */
export const EXPECTED_BLOWUP_FACTOR = 4;

/** Minimum accepted grinding bits (2^-20 soundness contribution). */
export const MIN_GRINDING_BITS = 20;

/** @deprecated alias for backwards-compat with older imports. Use MIN_FRI_QUERIES. */
export const EXPECTED_FRI_QUERIES = MIN_FRI_QUERIES;

export interface MetadataGuardResult {
  ok: boolean;
  violations: string[];
}

/**
 * Check that a STARK proof's metadata fields match expected whitepaper values.
 * Returns `ok: true` if every field is consistent, or `ok: false` with the
 * specific violations. Never throws.
 *
 * Wrap this around the Python verifier call: even if that returns valid=true,
 * if the metadata is off, treat as suspect.
 */
export function checkProofMetadata(proof: Record<string, unknown>): MetadataGuardResult {
  const violations: string[] = [];

  // security_level — must be at least 128 (whitepaper claims ~180-bit effective).
  const sec = Number(proof.security_level);
  if (Number.isFinite(sec)) {
    if (sec < MIN_SECURITY_LEVEL_BITS) {
      violations.push(`security_level=${sec} below minimum ${MIN_SECURITY_LEVEL_BITS}`);
    }
  }

  // field_prime — must equal Goldilocks (compare as string to avoid Number precision loss).
  if (proof.field_prime != null) {
    const fp = String(proof.field_prime);
    if (fp !== EXPECTED_FIELD_PRIME_DECIMAL) {
      violations.push(`field_prime does not match Goldilocks (got ${fp.slice(0, 30)}...)`);
    }
  }

  // Trace length: CUDATrueSTARK emits `trace_length`; legacy AuthenticZKStark
  // emitted `execution_trace_length`. Accept either while both formats coexist.
  const traceRaw = proof.trace_length ?? proof.execution_trace_length;
  const trace = Number(traceRaw);
  const extended = Number(proof.extended_trace_length);
  if (Number.isFinite(trace) && Number.isFinite(extended)) {
    if (trace <= 0) violations.push(`trace_length=${trace} must be positive`);
    if (extended <= 0) violations.push(`extended_trace_length=${extended} must be positive`);
    if (trace > 0 && extended > 0) {
      const blowup = extended / trace;
      if (blowup !== EXPECTED_BLOWUP_FACTOR) {
        violations.push(
          `blowup factor ${blowup} ≠ expected ${EXPECTED_BLOWUP_FACTOR} ` +
          `(trace=${trace}, extended=${extended})`,
        );
      }
    }
  }

  // query_responses — must be at least MIN_FRI_QUERIES. Fewer = weaker.
  // More is fine (the config could be tightened without breaking the guard).
  const queries = Array.isArray(proof.query_responses)
    ? (proof.query_responses as unknown[]).length
    : undefined;
  if (queries !== undefined && queries < MIN_FRI_QUERIES) {
    violations.push(
      `query_responses count ${queries} < minimum ${MIN_FRI_QUERIES} ` +
      `(whitepaper spec: 80-query FRI for 2^-160 soundness)`,
    );
  }

  // grinding_bits — must be at least MIN_GRINDING_BITS. Whitepaper claims
  // 2^-180 effective soundness = FRI 2^-160 × grinding 2^-20. A downgraded
  // grinding_bits falsifies the whitepaper claim even if the PoW check
  // itself passes for the declared bits.
  if (proof.grinding_bits != null) {
    const gb = Number(proof.grinding_bits);
    if (!Number.isFinite(gb) || gb < MIN_GRINDING_BITS) {
      violations.push(
        `grinding_bits=${gb} < minimum ${MIN_GRINDING_BITS} ` +
        `(whitepaper spec: 20 bits of PoW)`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
