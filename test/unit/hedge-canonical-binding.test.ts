import { describe, it, expect } from '@jest/globals';
import {
  ALLOWED_ASSETS,
  ALLOWED_SIDES,
  CanonicalHedgeInputs,
  HEDGE_CANONICAL_VERSION,
  HedgeBindingError,
  assertHedgeBindingLocal,
  computeCommitmentHash,
  computeInputsHash,
  prepareHedgeBinding,
  serializeCanonical,
} from '@/zk/prover/hedgeCanonical';

/**
 * Deterministic hedge that MUST hash to the golden constants below.
 * Same values baked into zkp/tests/test_hedge_canonical.py::base_inputs.
 */
function baseInputs(overrides: Partial<CanonicalHedgeInputs> = {}): CanonicalHedgeInputs {
  return {
    version: HEDGE_CANONICAL_VERSION,
    chain: 'sui',
    portfolioId: 42,
    timestampMs: 1_752_000_000_000,
    asset: 'BTC',
    side: 'LONG',
    sizeUnits: 1_000n,
    leverageX: 3,
    entryPriceUsdcCents: 7_300_000_00n,
    notionalValueUsdcCents: 21_900_00n,
    leverageCap: 4,
    notionalCapUsdcCents: 1_000_000_00n,
    salt: 'a'.repeat(64),
    ...overrides,
  };
}

function statementFor(
  inputs: CanonicalHedgeInputs,
  overrides: { leverageCap?: number; notionalCap?: bigint } = {},
) {
  const binding = prepareHedgeBinding(inputs);
  return {
    claim: `zkv-hedge-v${HEDGE_CANONICAL_VERSION}`,
    public_inputs: [
      binding.commitmentHash,
      binding.inputsHash,
      overrides.notionalCap ?? inputs.notionalCapUsdcCents,
      overrides.leverageCap ?? inputs.leverageCap,
    ] as Array<string | number | bigint>,
  };
}

// -----------------------------------------------------------------------
// Golden cross-language hashes — MUST match zkp/tests/test_hedge_canonical.py
// -----------------------------------------------------------------------
const EXPECTED_INPUTS_HASH =
  '4c84f1101ecd46fd7709ea54bdd359927cd9c42c22322ef995426d4530e44eb4';
const EXPECTED_COMMITMENT_HASH =
  'e67c08703e4338b9b416af922fadbf3c482e801fe9d8a5f24996d8bc8be73ca2';

describe('cross-lang golden hash', () => {
  it('inputsHash matches Python constant', () => {
    expect(computeInputsHash(baseInputs())).toBe(EXPECTED_INPUTS_HASH);
  });

  it('commitmentHash matches Python constant', () => {
    const i = baseInputs();
    expect(computeCommitmentHash(i, computeInputsHash(i))).toBe(EXPECTED_COMMITMENT_HASH);
  });

  it('prepareHedgeBinding returns matching triple', () => {
    const b = prepareHedgeBinding(baseInputs());
    expect(b.inputsHash).toBe(EXPECTED_INPUTS_HASH);
    expect(b.commitmentHash).toBe(EXPECTED_COMMITMENT_HASH);
  });
});

describe('serializeCanonical', () => {
  it('is compact JSON with sorted keys', () => {
    const s = serializeCanonical(baseInputs());
    expect(s.startsWith('{') && s.endsWith('}')).toBe(true);
    expect(s.includes(' ')).toBe(false);
    expect(s.indexOf('"asset"')).toBeLessThan(s.indexOf('"chain"'));
    expect(s.indexOf('"chain"')).toBeLessThan(s.indexOf('"entryPriceUsdcCents"'));
  });

  it('uppercases asset and side even if lowercase in input', () => {
    const s = serializeCanonical({ ...baseInputs(), asset: 'btc' as any, side: 'long' as any });
    expect(s).toContain('"asset":"BTC"');
    expect(s).toContain('"side":"LONG"');
  });

  it('floors timestamp to nearest 1000 ms', () => {
    const s = serializeCanonical({ ...baseInputs(), timestampMs: 1_752_000_000_123 });
    expect(s).toContain('"timestampMs":1752000000000');
  });
});

describe('assertHedgeBindingLocal — accepts healthy', () => {
  it('accepts a well-formed statement built from the same inputs', () => {
    const i = baseInputs();
    const stmt = statementFor(i);
    expect(() => assertHedgeBindingLocal(stmt, { canonical: i })).not.toThrow();
  });
});

describe('assertHedgeBindingLocal — rejects invariant violations', () => {
  it('rejects unsupported asset', () => {
    const i = baseInputs({ asset: 'DOGE' as any });
    const stmt = {
      claim: `zkv-hedge-v${HEDGE_CANONICAL_VERSION}`,
      public_inputs: ['0'.repeat(64), '0'.repeat(64), i.notionalCapUsdcCents, i.leverageCap],
    };
    expect(() => assertHedgeBindingLocal(stmt as any, { canonical: i })).toThrow(
      /asset .* not in allow-list/,
    );
  });

  it('rejects unsupported side', () => {
    const i = baseInputs({ side: 'MAYBE' as any });
    const stmt = {
      claim: `zkv-hedge-v${HEDGE_CANONICAL_VERSION}`,
      public_inputs: ['0'.repeat(64), '0'.repeat(64), i.notionalCapUsdcCents, i.leverageCap],
    };
    expect(() => assertHedgeBindingLocal(stmt as any, { canonical: i })).toThrow(
      /side .* not in allow-list/,
    );
  });

  it('rejects leverage above cap', () => {
    const i = baseInputs({ leverageX: 5, leverageCap: 4 });
    expect(() => assertHedgeBindingLocal(statementFor(i), { canonical: i })).toThrow(
      /leverageX \(5\) outside \[1, 4\]/,
    );
  });

  it('rejects leverage zero', () => {
    const i = baseInputs({ leverageX: 0 });
    expect(() => assertHedgeBindingLocal(statementFor(i), { canonical: i })).toThrow(
      /leverageX \(0\) outside/,
    );
  });

  it('rejects notional above cap', () => {
    const i = baseInputs({
      notionalValueUsdcCents: 2_000_000_00n,
      notionalCapUsdcCents: 1_000_000_00n,
    });
    expect(() => assertHedgeBindingLocal(statementFor(i), { canonical: i })).toThrow(
      /notional .* exceeds cap/,
    );
  });

  it('rejects zero notional', () => {
    const i = baseInputs({ notionalValueUsdcCents: 0n });
    expect(() => assertHedgeBindingLocal(statementFor(i), { canonical: i })).toThrow(
      /notionalValueUsdcCents must be positive/,
    );
  });

  it('rejects short salt', () => {
    const i = baseInputs({ salt: 'ab'.repeat(8) });
    expect(() => assertHedgeBindingLocal(statementFor(i), { canonical: i })).toThrow(
      HedgeBindingError,
    );
  });
});

describe('assertHedgeBindingLocal — rejects hash tamper', () => {
  it('rejects wrong inputs_hash', () => {
    const i = baseInputs();
    const stmt = statementFor(i);
    stmt.public_inputs[1] = '0'.repeat(64);
    expect(() => assertHedgeBindingLocal(stmt, { canonical: i })).toThrow(
      /inputs_hash mismatch/,
    );
  });

  it('rejects wrong commitment_hash', () => {
    const i = baseInputs();
    const stmt = statementFor(i);
    stmt.public_inputs[0] = '0'.repeat(64);
    expect(() => assertHedgeBindingLocal(stmt, { canonical: i })).toThrow(
      /commitment_hash mismatch/,
    );
  });

  it('rejects leverage_cap downgrade', () => {
    const i = baseInputs({ leverageX: 3, leverageCap: 4 });
    const stmt = statementFor(i, { leverageCap: 2 });
    expect(() => assertHedgeBindingLocal(stmt, { canonical: i })).toThrow(
      /leverageCap .* != statement.leverage_cap/,
    );
  });

  it('rejects notional_cap downgrade', () => {
    const i = baseInputs();
    const stmt = statementFor(i, { notionalCap: 1n });
    expect(() => assertHedgeBindingLocal(stmt, { canonical: i })).toThrow(
      /notionalCapUsdcCents .* != statement.notional_cap_cents/,
    );
  });
});

describe('assertHedgeBindingLocal — rejects malformed shape', () => {
  it('rejects wrong claim tag', () => {
    const i = baseInputs();
    const stmt = statementFor(i);
    stmt.claim = 'zkv-risk-v1';
    expect(() => assertHedgeBindingLocal(stmt, { canonical: i })).toThrow(/claim mismatch/);
  });

  it('rejects short public_inputs', () => {
    const i = baseInputs();
    const stmt = statementFor(i);
    stmt.public_inputs = stmt.public_inputs.slice(0, 2);
    expect(() => assertHedgeBindingLocal(stmt, { canonical: i })).toThrow(
      /public_inputs must be/,
    );
  });
});

describe('allow-lists', () => {
  it('ALLOWED_ASSETS has BTC / ETH / SUI', () => {
    expect(ALLOWED_ASSETS.has('BTC')).toBe(true);
    expect(ALLOWED_ASSETS.has('ETH')).toBe(true);
    expect(ALLOWED_ASSETS.has('SUI')).toBe(true);
    expect(ALLOWED_ASSETS.size).toBe(3);
  });

  it('ALLOWED_SIDES has LONG / SHORT', () => {
    expect(ALLOWED_SIDES.has('LONG')).toBe(true);
    expect(ALLOWED_SIDES.has('SHORT')).toBe(true);
    expect(ALLOWED_SIDES.size).toBe(2);
  });
});
