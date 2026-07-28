/**
 * Defense-in-depth guard against ZK-STARK metadata tampering.
 *
 * Prover cutover 2026-07-28: expected values updated from the legacy
 * AuthenticZKStark (NIST P-521, 32 queries) to whitepaper-aligned
 * CUDATrueSTARK (Goldilocks, 80 queries, 20-bit grinding). Guard now
 * rejects DOWNGRADES only — stronger parameters pass.
 */
import { describe, it, expect } from '@jest/globals';
import {
  checkProofMetadata,
  EXPECTED_FIELD_PRIME_DECIMAL,
  MIN_SECURITY_LEVEL_BITS,
  MIN_FRI_QUERIES,
  EXPECTED_BLOWUP_FACTOR,
  MIN_GRINDING_BITS,
} from '@/zk/verifier/proof-metadata-guard';

const HEALTHY = {
  security_level: 512,
  field_prime: EXPECTED_FIELD_PRIME_DECIMAL,
  trace_length: 256,
  extended_trace_length: 256 * EXPECTED_BLOWUP_FACTOR,
  query_responses: Array(MIN_FRI_QUERIES).fill({}),
  grinding_bits: MIN_GRINDING_BITS,
};

describe('checkProofMetadata', () => {
  it('healthy proof passes with no violations', () => {
    const r = checkProofMetadata(HEALTHY);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('rejects downgraded security_level (512 → 64)', () => {
    const r = checkProofMetadata({ ...HEALTHY, security_level: 64 });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('security_level=64');
    expect(r.violations[0]).toContain(String(MIN_SECURITY_LEVEL_BITS));
  });

  it('accepts security_level at floor (128) but rejects below', () => {
    expect(checkProofMetadata({ ...HEALTHY, security_level: 128 }).ok).toBe(true);
    expect(checkProofMetadata({ ...HEALTHY, security_level: 127 }).ok).toBe(false);
  });

  it('rejects wrong field_prime (non-Goldilocks)', () => {
    const r = checkProofMetadata({ ...HEALTHY, field_prime: '12345' });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('field_prime');
    expect(r.violations[0]).toContain('Goldilocks');
  });

  it('accepts correct field_prime (byte-exact Goldilocks)', () => {
    expect(checkProofMetadata(HEALTHY).ok).toBe(true);
  });

  it('rejects legacy NIST P-521 prime (post-cutover)', () => {
    const nistP521 =
      '6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151';
    const r = checkProofMetadata({ ...HEALTHY, field_prime: nistP521 });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('field_prime');
  });

  it('rejects wrong blowup factor', () => {
    // extended = 512, trace = 256 → blowup 2 (not 4)
    const r = checkProofMetadata({
      ...HEALTHY, trace_length: 256, extended_trace_length: 512,
    });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('blowup factor');
  });

  it('rejects query count below whitepaper spec (80)', () => {
    const r = checkProofMetadata({
      ...HEALTHY, query_responses: Array(32).fill({}),
    });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('query_responses count 32');
    expect(r.violations[0]).toContain(String(MIN_FRI_QUERIES));
  });

  it('accepts more queries than the minimum (upgrade path)', () => {
    const r = checkProofMetadata({
      ...HEALTHY, query_responses: Array(MIN_FRI_QUERIES + 20).fill({}),
    });
    expect(r.ok).toBe(true);
  });

  it('rejects grinding_bits below whitepaper spec (20)', () => {
    const r = checkProofMetadata({ ...HEALTHY, grinding_bits: 0 });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('grinding_bits');
  });

  it('accepts grinding_bits at or above whitepaper spec', () => {
    expect(checkProofMetadata({ ...HEALTHY, grinding_bits: MIN_GRINDING_BITS }).ok).toBe(true);
    expect(checkProofMetadata({ ...HEALTHY, grinding_bits: MIN_GRINDING_BITS + 4 }).ok).toBe(true);
  });

  it('rejects zero/negative trace length', () => {
    expect(checkProofMetadata({ ...HEALTHY, trace_length: 0, extended_trace_length: 1024 }).ok).toBe(false);
    expect(checkProofMetadata({ ...HEALTHY, trace_length: -1, extended_trace_length: 1024 }).ok).toBe(false);
  });

  it('accepts legacy execution_trace_length field name (transitional)', () => {
    // While both provers coexist, the guard should recognize either naming.
    const legacy: Record<string, unknown> = { ...HEALTHY };
    delete legacy.trace_length;
    legacy.execution_trace_length = 256;
    expect(checkProofMetadata(legacy).ok).toBe(true);
  });

  it('reports MULTIPLE violations when several fields are tampered', () => {
    const r = checkProofMetadata({
      ...HEALTHY,
      security_level: 64,
      field_prime: '12345',
      query_responses: [],
      grinding_bits: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBeGreaterThanOrEqual(4);
  });

  it('accepts a proof missing optional metadata (tolerant of absent fields)', () => {
    const partial = { security_level: 512, field_prime: EXPECTED_FIELD_PRIME_DECIMAL };
    expect(checkProofMetadata(partial).ok).toBe(true);
  });
});
