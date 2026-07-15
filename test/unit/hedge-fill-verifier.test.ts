/**
 * Unit tests for HedgeFillVerifier — Gap 3.
 *
 * The bulletproof integration test exercises the phantom-detection code
 * path; these unit tests pin narrower invariants around polling behaviour,
 * tolerance handling, and phantom-rate computation.
 *
 * Regression risk: if verifyFill's tolerance math regresses, real fills
 * can be marked phantom (false positive) — worse than a missed detection
 * because it'd auto-halt the trader on every open.
 */
import { describe, it, expect } from '@jest/globals';
import { verifyFill, computePhantomRate } from '@/lib/services/sui/HedgeFillVerifier';

// No-op sleep so tests don't wait for real timers.
const noSleep = async () => undefined;

describe('verifyFill — happy paths', () => {
  it('returns fill_observed when position appears on first poll', async () => {
    const result = await verifyFill({
      hedgeId: 1,
      symbol: 'ETH-PERP',
      expectedSizeDelta: 0.01,
      pollAtMs: [0, 5000],
      getPositions: async () => [{ symbol: 'ETH-PERP', size: 0.01 }],
      sleepFn: noSleep,
    });
    expect(result.phantom).toBe(false);
    expect(result.reason).toBe('fill_observed');
    expect(result.pollsAttempted).toBe(1);
  });

  it('returns fill_observed when position appears on second poll', async () => {
    let callCount = 0;
    const result = await verifyFill({
      hedgeId: 2,
      symbol: 'BTC-PERP',
      expectedSizeDelta: 0.001,
      pollAtMs: [0, 0],
      getPositions: async () => {
        callCount++;
        return callCount === 1 ? [] : [{ symbol: 'BTC-PERP', size: 0.001 }];
      },
      sleepFn: noSleep,
    });
    expect(result.phantom).toBe(false);
    expect(result.pollsAttempted).toBe(2);
  });

  it('accepts fills within tolerance (99% of expected)', async () => {
    const result = await verifyFill({
      hedgeId: 3,
      symbol: 'SUI-PERP',
      expectedSizeDelta: 100,
      pollAtMs: [0],
      getPositions: async () => [{ symbol: 'SUI-PERP', size: 99 }],
      toleranceBps: 100, // 1% tolerance → min acceptable 99
      sleepFn: noSleep,
    });
    expect(result.phantom).toBe(false);
    expect(result.observedSize).toBe(99);
  });
});

describe('verifyFill — phantom detection', () => {
  it('marks phantom when getPositions returns empty across all polls', async () => {
    const result = await verifyFill({
      hedgeId: 4,
      symbol: 'ETH-PERP',
      expectedSizeDelta: 0.01,
      pollAtMs: [0, 0, 0],
      getPositions: async () => [],
      sleepFn: noSleep,
    });
    expect(result.phantom).toBe(true);
    expect(result.reason).toBe('no_fill_observed');
    expect(result.observedSize).toBeNull();
    expect(result.pollsAttempted).toBe(3);
  });

  it('marks phantom when position is present but below tolerance', async () => {
    const result = await verifyFill({
      hedgeId: 5,
      symbol: 'ETH-PERP',
      expectedSizeDelta: 0.01,
      pollAtMs: [0],
      getPositions: async () => [{ symbol: 'ETH-PERP', size: 0.005 }], // 50%
      toleranceBps: 100,
      sleepFn: noSleep,
    });
    expect(result.phantom).toBe(true);
    expect(result.reason).toBe('partial_fill_below_tolerance');
    expect(result.observedSize).toBe(0.005);
  });

  it('marks phantom on symbol mismatch (only ETH-PERP filled when BTC-PERP requested)', async () => {
    const result = await verifyFill({
      hedgeId: 6,
      symbol: 'BTC-PERP',
      expectedSizeDelta: 0.001,
      pollAtMs: [0, 0],
      getPositions: async () => [{ symbol: 'ETH-PERP', size: 0.01 }],
      sleepFn: noSleep,
    });
    expect(result.phantom).toBe(true);
  });

  it('handles getPositions throwing gracefully — keeps polling', async () => {
    let callCount = 0;
    const result = await verifyFill({
      hedgeId: 7,
      symbol: 'ETH-PERP',
      expectedSizeDelta: 0.01,
      pollAtMs: [0, 0],
      getPositions: async () => {
        callCount++;
        if (callCount === 1) throw new Error('transient network error');
        return [{ symbol: 'ETH-PERP', size: 0.01 }];
      },
      sleepFn: noSleep,
    });
    expect(result.phantom).toBe(false);
    expect(result.pollsAttempted).toBe(2);
  });
});

describe('verifyFill — signed size delta', () => {
  it('accepts absolute size (SHORT position returns negative size at some venues)', async () => {
    const result = await verifyFill({
      hedgeId: 8,
      symbol: 'ETH-PERP',
      expectedSizeDelta: -0.01, // SHORT
      pollAtMs: [0],
      getPositions: async () => [{ symbol: 'ETH-PERP', size: -0.01 }],
      sleepFn: noSleep,
    });
    expect(result.phantom).toBe(false);
  });
});

describe('computePhantomRate', () => {
  it('returns zero rate on empty input', () => {
    const r = computePhantomRate([]);
    expect(r.rate).toBe(0);
    expect(r.phantoms).toBe(0);
    expect(r.total).toBe(0);
  });

  it('computes rate correctly on mixed rows', () => {
    const r = computePhantomRate([
      { status: 'closed' },
      { status: 'phantom' },
      { status: 'closed' },
      { status: 'phantom' },
      { status: 'active' },
    ]);
    expect(r.total).toBe(5);
    expect(r.phantoms).toBe(2);
    expect(r.rate).toBe(0.4);
  });

  it('handles rows with unusual status values gracefully', () => {
    const r = computePhantomRate([
      { status: 'closed' },
      { status: 'phantom' },
      { status: 'pending' as string },
      { status: 'reconciled' as string },
    ]);
    expect(r.total).toBe(4);
    expect(r.phantoms).toBe(1);
    expect(r.rate).toBe(0.25);
  });
});
