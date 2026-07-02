/**
 * Golden tests for the STARK risk-binding layer (zk/prover/riskCanonical.ts
 * + zk/verifier/ProofValidator.ts). These are pure-arithmetic checks — no
 * Python server needed. They pin the byte-exact serialization that the
 * Python `zkp/core/risk_canonical.py` must reproduce.
 *
 * If any of these tests fail, the on-chain risk attestation is broken:
 * the STARK proof would no longer bind the claimed `totalRisk` to the
 * inputs that produced it, so an operator could sign any score against
 * any state.
 */
import { describe, it, expect } from '@jest/globals';
import crypto from 'crypto';
import {
  RISK_CANONICAL_VERSION,
  SENTIMENT_CODE,
  serializeCanonical,
  computeInputsHash,
  computeOutputHash,
  computeCommitmentHash,
  computeBaseRiskScore,
  fuseRiskScores,
  prepareRiskBinding,
  type CanonicalRiskInputs,
} from '@/zk/prover/riskCanonical';
import { ProofValidator } from '@/zk/verifier/ProofValidator';

const validator = new ProofValidator();

function baseInputs(overrides: Partial<CanonicalRiskInputs> = {}): CanonicalRiskInputs {
  return {
    version: RISK_CANONICAL_VERSION,
    portfolioId: -2,
    chain: 'sui',
    timestampMs: 1783017000000, // fixed for determinism
    portfolioValueUsdc: 5408, // $54.08
    volatilityBps: 2500, // 25%
    exposures: [
      { asset: 'BTC', exposureBps: 3000, contributionBps: 1500 },
      { asset: 'ETH', exposureBps: 3000, contributionBps: 1500 },
      { asset: 'SUI', exposureBps: 2000, contributionBps: 1000 },
      { asset: 'CRO', exposureBps: 2000, contributionBps: 1000 },
    ],
    sentimentCode: SENTIMENT_CODE.neutral,
    baseRiskScore: 62, // 25/100*50 + (15+15+10+10)/100 = 12.5+50 = 62.5 → round 63... let's recompute
    aiRiskScore: null,
    totalRisk: 62,
    threshold: 100,
    ...overrides,
  };
}

describe('base-risk formula', () => {
  it('reproduces the exact TS formula for known inputs', () => {
    const exposures = [
      { contributionBps: 1500 },
      { contributionBps: 1500 },
      { contributionBps: 1000 },
      { contributionBps: 1000 },
    ];
    // vol=25% → 2500bps → 25/100*50 = 12.5; contribs sum = 50; total = 62.5 → round 63
    expect(computeBaseRiskScore(2500, exposures)).toBe(63);
  });
  it('clamps to [0, 100]', () => {
    expect(computeBaseRiskScore(0, [])).toBe(0);
    expect(
      computeBaseRiskScore(20000, [{ contributionBps: 100_000_000 }]),
    ).toBe(100);
  });
});

describe('fuseRiskScores', () => {
  it('returns base when AI is null', () => {
    expect(fuseRiskScores(50, null)).toBe(50);
  });
  it('averages when AI is present', () => {
    expect(fuseRiskScores(50, 70)).toBe(60);
    expect(fuseRiskScores(40, 41)).toBe(41); // rounds .5 up (banker's rounding via Math.round)
  });
  it('clamps result to [0, 100]', () => {
    expect(fuseRiskScores(100, 100)).toBe(100);
    expect(fuseRiskScores(-10, -20)).toBe(0);
  });
});

describe('serializeCanonical', () => {
  it('produces sorted-keys, no-whitespace, no-trailing-precision JSON', () => {
    const inputs = baseInputs({ baseRiskScore: 63, totalRisk: 63 });
    const s = serializeCanonical(inputs);
    expect(s.startsWith('{"')).toBe(true);
    expect(s.endsWith('}')).toBe(true);
    expect(s).not.toContain(' '); // no whitespace
    expect(s).not.toContain('\n');
    // keys must appear in ASCII order at top level
    const topKeys = Array.from(s.matchAll(/"([a-zA-Z]+)":/g)).map((m) => m[1]);
    const topLevelSample = topKeys.slice(0, 4); // first few — sanity check ordering
    expect(topLevelSample).toEqual([...topLevelSample].sort());
  });
  it('normalizes chain to lowercase and assets to uppercase', () => {
    const s = serializeCanonical(
      baseInputs({
        chain: 'SUI',
        exposures: [{ asset: 'btc', exposureBps: 100, contributionBps: 50 }],
        baseRiskScore: 1,
        totalRisk: 1,
      }),
    );
    expect(s).toContain('"chain":"sui"');
    expect(s).toContain('"asset":"BTC"');
  });
  it('sorts exposures by asset symbol regardless of input order', () => {
    const a = serializeCanonical(
      baseInputs({
        exposures: [
          { asset: 'SUI', exposureBps: 1, contributionBps: 1 },
          { asset: 'BTC', exposureBps: 1, contributionBps: 1 },
        ],
        baseRiskScore: 1,
        totalRisk: 1,
      }),
    );
    const b = serializeCanonical(
      baseInputs({
        exposures: [
          { asset: 'BTC', exposureBps: 1, contributionBps: 1 },
          { asset: 'SUI', exposureBps: 1, contributionBps: 1 },
        ],
        baseRiskScore: 1,
        totalRisk: 1,
      }),
    );
    expect(a).toBe(b);
  });
  it('floors timestampMs to nearest second', () => {
    const a = serializeCanonical(baseInputs({ timestampMs: 1000, baseRiskScore: 1, totalRisk: 1 }));
    const b = serializeCanonical(baseInputs({ timestampMs: 1999, baseRiskScore: 1, totalRisk: 1 }));
    expect(a).toBe(b);
    const c = serializeCanonical(baseInputs({ timestampMs: 2000, baseRiskScore: 1, totalRisk: 1 }));
    expect(a).not.toBe(c);
  });
});

describe('computeInputsHash', () => {
  /**
   * Golden fixture — MUST match the Python side.
   * If this hex ever changes, byte-identical serialization has broken
   * and the STARK binding is silently invalid on-chain until re-signed.
   * The identical constant lives in zkp/tests/test_risk_canonical.py
   * `TestCrossLangGolden.EXPECTED_HASH`.
   */
  const GOLDEN_INPUTS_HASH =
    '0619fb3793c77deddf71250e684ad0074c8f9b08ec0fd218e780cc77d7235f2c';

  it('is deterministic — same inputs give same hex', () => {
    const inputs = baseInputs({ baseRiskScore: 63, totalRisk: 63 });
    expect(computeInputsHash(inputs)).toBe(computeInputsHash(inputs));
  });
  it('is 64 lowercase hex chars', () => {
    expect(computeInputsHash(baseInputs({ baseRiskScore: 63, totalRisk: 63 }))).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
  it('matches the cross-language golden hash', () => {
    const inputs = baseInputs({ baseRiskScore: 63, totalRisk: 63 });
    expect(computeInputsHash(inputs)).toBe(GOLDEN_INPUTS_HASH);
  });
  it('changes when ANY input changes', () => {
    const h0 = computeInputsHash(baseInputs({ baseRiskScore: 63, totalRisk: 63 }));
    // portfolioId
    expect(computeInputsHash(baseInputs({ baseRiskScore: 63, totalRisk: 63, portfolioId: 42 }))).not.toBe(h0);
    // volatility
    expect(computeInputsHash(baseInputs({ baseRiskScore: 63, totalRisk: 63, volatilityBps: 2501 }))).not.toBe(h0);
    // one exposure basis point
    expect(
      computeInputsHash(
        baseInputs({
          baseRiskScore: 63,
          totalRisk: 63,
          exposures: [
            { asset: 'BTC', exposureBps: 3001, contributionBps: 1500 },
            { asset: 'ETH', exposureBps: 3000, contributionBps: 1500 },
            { asset: 'SUI', exposureBps: 2000, contributionBps: 1000 },
            { asset: 'CRO', exposureBps: 2000, contributionBps: 1000 },
          ],
        }),
      ),
    ).not.toBe(h0);
    // sentiment
    expect(
      computeInputsHash(
        baseInputs({ baseRiskScore: 63, totalRisk: 63, sentimentCode: SENTIMENT_CODE.bullish }),
      ),
    ).not.toBe(h0);
    // aiRiskScore: null → 50
    expect(
      computeInputsHash(baseInputs({ baseRiskScore: 63, totalRisk: 63, aiRiskScore: 50 })),
    ).not.toBe(h0);
    // totalRisk itself
    expect(computeInputsHash(baseInputs({ baseRiskScore: 63, totalRisk: 64 }))).not.toBe(h0);
  });
});

describe('computeOutputHash', () => {
  it('is SHA256(u32-BE totalRisk)', () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(63, 0);
    const expected = crypto.createHash('sha256').update(buf).digest('hex');
    expect(computeOutputHash(63)).toBe(expected);
  });
});

describe('computeCommitmentHash', () => {
  it('changes if totalRisk or threshold changes even with identical inputsHash', () => {
    const inputs = baseInputs({ baseRiskScore: 63, totalRisk: 63 });
    const inputsHash = computeInputsHash(inputs);
    const outputHash = computeOutputHash(63);
    const c0 = computeCommitmentHash(inputs, inputsHash, outputHash);
    // Change totalRisk in inputs (keep inputsHash the same to isolate)
    const inputs2 = { ...inputs, totalRisk: 64 };
    const c1 = computeCommitmentHash(inputs2, inputsHash, outputHash);
    expect(c1).not.toBe(c0);
  });
});

describe('ProofValidator.verifyRiskBinding', () => {
  it('accepts a well-formed statement built from the same inputs', () => {
    const inputs = baseInputs({ baseRiskScore: 63, totalRisk: 63 });
    const binding = prepareRiskBinding(inputs);
    const statement = {
      claim: 'zkv-risk-v1',
      public_inputs: [binding.inputsHash, binding.outputHash, String(63), String(100)],
      public_data: {
        portfolioId: -2,
        chain: 'sui',
        timestampMs: inputs.timestampMs,
        canonicalVersion: 1,
        commitmentHash: binding.commitmentHash,
      },
    };
    const result = validator.verifyRiskBinding(statement, inputs);
    expect(result.bound).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a statement with a mutated totalRisk', () => {
    const inputs = baseInputs({ baseRiskScore: 63, totalRisk: 63 });
    const binding = prepareRiskBinding(inputs);
    const badStatement = {
      claim: 'zkv-risk-v1',
      public_inputs: [binding.inputsHash, binding.outputHash, String(30), String(100)],
      public_data: { canonicalVersion: 1, commitmentHash: binding.commitmentHash },
    };
    const result = validator.verifyRiskBinding(badStatement, inputs);
    expect(result.bound).toBe(false);
    expect(result.errors.some((e) => e.includes('totalRisk mismatch'))).toBe(true);
  });

  it('rejects a statement whose inputsHash was recomputed for a different exposure set', () => {
    const inputs = baseInputs({ baseRiskScore: 63, totalRisk: 63 });
    const otherInputs = baseInputs({
      baseRiskScore: 63,
      totalRisk: 63,
      exposures: [
        { asset: 'BTC', exposureBps: 5000, contributionBps: 2500 },
        { asset: 'ETH', exposureBps: 5000, contributionBps: 2500 },
      ],
    });
    const evilBinding = prepareRiskBinding(otherInputs);
    const badStatement = {
      claim: 'zkv-risk-v1',
      public_inputs: [evilBinding.inputsHash, evilBinding.outputHash, String(63), String(100)],
      public_data: { canonicalVersion: 1, commitmentHash: evilBinding.commitmentHash },
    };
    // Verifier reruns with the CLAIMED (honest) inputs — mismatch surfaces
    const result = validator.verifyRiskBinding(badStatement, inputs);
    expect(result.bound).toBe(false);
    expect(result.errors.some((e) => e.includes('inputsHash mismatch'))).toBe(true);
  });

  it('rejects a statement with the wrong claim tag / version', () => {
    const inputs = baseInputs({ baseRiskScore: 63, totalRisk: 63 });
    const binding = prepareRiskBinding(inputs);
    const badStatement = {
      claim: 'zkv-risk-v1',
      public_inputs: [binding.inputsHash, binding.outputHash, String(63), String(100)],
      public_data: { canonicalVersion: 999, commitmentHash: binding.commitmentHash },
    };
    const result = validator.verifyRiskBinding(badStatement, inputs);
    expect(result.bound).toBe(false);
    expect(result.errors.some((e) => /canonicalVersion/i.test(e))).toBe(true);
  });
});
