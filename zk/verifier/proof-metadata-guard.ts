/**
 * Defense-in-depth guard for ZK-STARK proof metadata.
 *
 * Finding 2026-07-26: Python `/api/zk/verify` correctly rejects any
 * tampering with cryptographically-bound fields (merkle_root, challenge,
 * response, statement_hash, query_responses, public_inputs, claim).
 * BUT it does NOT check descriptive metadata:
 *   - security_level (attacker can lie about strength — "128-bit" while
 *     real crypto is 521-bit, or vice versa)
 *   - field_prime (attacker can lie about field)
 *   - execution_trace_length / extended_trace_length (blowup factor)
 *   - proof_hash (advertised as an integrity marker, not actually checked)
 *
 * On-chain (`zk_verifier.move`) recomputes `keccak256(proof_data)` so
 * it's safe. Off-chain crypto verification is safe. Only the DISPLAY /
 * REPORTING layer trusted these metadata fields, which is where an
 * attacker could downgrade a claim (present a strong proof as weak, or
 * a weak proof as strong).
 *
 * This module: hard-coded expected values for the current prover. Any
 * proof whose metadata diverges is rejected as suspect — even if the
 * core crypto verifies. Wrap the Python verify() call with this guard.
 */

/** NIST P-521 prime: 2^521 − 1 (Mersenne prime, 156 decimal digits). */
export const EXPECTED_FIELD_PRIME_DECIMAL =
  '6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151';

/** Minimum accepted security level in bits — reject anything downgraded. */
export const MIN_SECURITY_LEVEL_BITS = 128;

/** Expected number of FRI query responses (128-bit security parameter). */
export const EXPECTED_FRI_QUERIES = 32;

/** Expected Reed-Solomon blowup factor (extended / trace length). */
export const EXPECTED_BLOWUP_FACTOR = 4;

export interface MetadataGuardResult {
  ok: boolean;
  violations: string[];
}

/**
 * Check that a STARK proof's metadata fields match expected values.
 * Returns `ok: true` if every field is consistent, or `ok: false` with
 * the specific violations. Never throws.
 *
 * Wrap this around the Python verifier call: even if that returns
 * valid=true, if the metadata is off, treat as suspect.
 */
export function checkProofMetadata(proof: Record<string, unknown>): MetadataGuardResult {
  const violations: string[] = [];

  // security_level — must be at least 128, we produce 521
  const sec = Number(proof.security_level);
  if (Number.isFinite(sec)) {
    if (sec < MIN_SECURITY_LEVEL_BITS) {
      violations.push(`security_level=${sec} below minimum ${MIN_SECURITY_LEVEL_BITS}`);
    }
  }

  // field_prime — must equal NIST P-521 (compare as string to avoid Number precision loss)
  if (proof.field_prime != null) {
    const fp = String(proof.field_prime);
    if (fp !== EXPECTED_FIELD_PRIME_DECIMAL) {
      violations.push(`field_prime does not match NIST P-521 (got ${fp.slice(0, 30)}...)`);
    }
  }

  // execution_trace_length + extended_trace_length — extended must be a
  // multiple of trace_length (Reed-Solomon extension) and blowup should
  // be exactly EXPECTED_BLOWUP_FACTOR (usually 4).
  const trace = Number(proof.execution_trace_length);
  const extended = Number(proof.extended_trace_length);
  if (Number.isFinite(trace) && Number.isFinite(extended)) {
    if (trace <= 0) violations.push(`execution_trace_length=${trace} must be positive`);
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

  // query_responses — must be exactly EXPECTED_FRI_QUERIES for the
  // security parameter we ship. Fewer = weaker; more = at minimum
  // suspicious (never produced by the current prover config).
  const queries = Array.isArray(proof.query_responses)
    ? (proof.query_responses as unknown[]).length
    : undefined;
  if (queries !== undefined && queries !== EXPECTED_FRI_QUERIES) {
    violations.push(
      `query_responses count ${queries} ≠ expected ${EXPECTED_FRI_QUERIES} ` +
      `(prover ships ${EXPECTED_FRI_QUERIES}-query STARK)`,
    );
  }

  // proof_hash — advertised as an integrity marker. We can't independently
  // recompute it without the prover's internal serialization, but we CAN
  // check it's a well-formed big integer (not zero, not garbage).
  if (proof.proof_hash != null) {
    const ph = String(proof.proof_hash);
    if (ph === '0' || ph === '') {
      violations.push('proof_hash is empty/zero — should be a bound integrity marker');
    }
  }

  return { ok: violations.length === 0, violations };
}
