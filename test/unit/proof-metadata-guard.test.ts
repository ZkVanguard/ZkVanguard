/**
 * Defense-in-depth guard against ZK-STARK metadata tampering.
 *
 * Finding 2026-07-26: Python /api/zk/verify correctly rejects tampering
 * of cryptographic fields (merkle_root, challenge, response, etc) but
 * does NOT check metadata (security_level, field_prime, blowup factor,
 * query count). This guard is the TS-side safety net for the display /
 * reporting layer.
 */
import { describe, it, expect } from '@jest/globals';
import {
  checkProofMetadata,
  EXPECTED_FIELD_PRIME_DECIMAL,
  MIN_SECURITY_LEVEL_BITS,
  EXPECTED_FRI_QUERIES,
  EXPECTED_BLOWUP_FACTOR,
} from '@/zk/verifier/proof-metadata-guard';

const HEALTHY = {
  security_level: 521,
  field_prime: EXPECTED_FIELD_PRIME_DECIMAL,
  execution_trace_length: 33,
  extended_trace_length: 33 * EXPECTED_BLOWUP_FACTOR,
  query_responses: Array(EXPECTED_FRI_QUERIES).fill({}),
  proof_hash: '12345678901234567890',
};

describe('checkProofMetadata', () => {
  it('healthy proof passes with no violations', () => {
    const r = checkProofMetadata(HEALTHY);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('rejects downgraded security_level (521 → 64)', () => {
    const r = checkProofMetadata({ ...HEALTHY, security_level: 64 });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('security_level=64');
    expect(r.violations[0]).toContain(String(MIN_SECURITY_LEVEL_BITS));
  });

  it('rejects downgraded security_level (521 → 128 is allowed at floor, but < 128 is not)', () => {
    // Exactly at floor is OK
    expect(checkProofMetadata({ ...HEALTHY, security_level: 128 }).ok).toBe(true);
    // Below floor rejected
    expect(checkProofMetadata({ ...HEALTHY, security_level: 127 }).ok).toBe(false);
  });

  it('rejects wrong field_prime (non-NIST-P521)', () => {
    const r = checkProofMetadata({ ...HEALTHY, field_prime: '12345' });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('field_prime');
    expect(r.violations[0]).toContain('NIST P-521');
  });

  it('accepts correct field_prime (byte-exact NIST P-521)', () => {
    expect(checkProofMetadata(HEALTHY).ok).toBe(true);
  });

  it('rejects wrong blowup factor', () => {
    // extended = 66, trace = 33 → blowup 2 (not 4)
    const r = checkProofMetadata({
      ...HEALTHY, execution_trace_length: 33, extended_trace_length: 66,
    });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('blowup factor');
  });

  it('rejects wrong query count', () => {
    const r = checkProofMetadata({
      ...HEALTHY, query_responses: Array(16).fill({}),
    });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('query_responses count 16');
    expect(r.violations[0]).toContain(String(EXPECTED_FRI_QUERIES));
  });

  it('rejects zero or empty proof_hash', () => {
    expect(checkProofMetadata({ ...HEALTHY, proof_hash: '0' }).ok).toBe(false);
    expect(checkProofMetadata({ ...HEALTHY, proof_hash: '' }).ok).toBe(false);
  });

  it('rejects zero/negative trace length', () => {
    expect(checkProofMetadata({ ...HEALTHY, execution_trace_length: 0, extended_trace_length: 132 }).ok).toBe(false);
    expect(checkProofMetadata({ ...HEALTHY, execution_trace_length: -1, extended_trace_length: 132 }).ok).toBe(false);
  });

  it('reports MULTIPLE violations when several fields are tampered', () => {
    const r = checkProofMetadata({
      ...HEALTHY,
      security_level: 64,
      field_prime: '12345',
      query_responses: [],
    });
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBeGreaterThanOrEqual(3);
  });

  it('accepts a proof missing optional metadata (tolerant of absent fields)', () => {
    // Only required-shape fields need checking; missing fields don't fail
    const partial = { security_level: 521, field_prime: EXPECTED_FIELD_PRIME_DECIMAL };
    expect(checkProofMetadata(partial).ok).toBe(true);
  });
});
