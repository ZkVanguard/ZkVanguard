/**
 * Contract lock for performDryRunHedge orchestrator.
 *
 * The pre-flight validator for every hedge open. If it silently accepts
 * a bad order (wrong pair, over-leverage, bad size), the real openHedge
 * afterwards is what discovers the problem — with capital already
 * committed. Testing every step's fail-fast behavior here means the
 * validator does its job.
 */
import { describe, it, expect } from '@jest/globals';
import { performDryRunHedge, type DryRunContext } from '@/lib/services/sui/bluefin/dry-run-hedge';

function makeCtx(overrides: Partial<DryRunContext> = {}): DryRunContext {
  return {
    accessToken: 'jwt-fake',
    walletAddress: '0xdeadbeef',
    network: 'mainnet',
    apiRequest: async () => ({ marginAvailableE9: '1000000000000' }) as never,
    getMarketData: async () => ({ price: 4000, fundingRate: 0.0001 }),
    signOrder: async () => 'fake-signature-64-chars-long-representing-a-real-ed25519-signature',
    ...overrides,
  };
}

const VALID_PARAMS = {
  symbol: 'ETH-PERP',
  side: 'LONG' as const,
  size: 0.02,
  leverage: 3,
};

describe('performDryRunHedge', () => {
  it('happy path — all steps pass', async () => {
    const r = await performDryRunHedge(makeCtx(), VALID_PARAMS);
    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
    const passed = r.steps.map((s) => s.step);
    expect(passed).toContain('auth');
    expect(passed).toContain('account');
    expect(passed).toContain('pair');
    expect(passed).toContain('leverage');
    expect(passed).toContain('order-size');
    expect(passed).toContain('market-data');
    expect(passed).toContain('order-construction');
    expect(passed).toContain('signature');
    expect(r.order).toBeDefined();
    expect((r.order as { signedFields: { symbol: string } }).signedFields.symbol).toBe('ETH-PERP');
  });

  it('fails fast on missing auth token', async () => {
    const r = await performDryRunHedge(makeCtx({ accessToken: null }), VALID_PARAMS);
    expect(r.success).toBe(false);
    expect(r.error).toBe('Authentication failed');
    expect(r.steps.find((s) => s.step === 'auth')?.passed).toBe(false);
    // Should NOT have proceeded past auth
    expect(r.steps.map((s) => s.step)).not.toContain('pair');
  });

  it('records account NOT onboarded when apiRequest throws', async () => {
    const r = await performDryRunHedge(
      makeCtx({ apiRequest: async () => { throw new Error('404 not found'); } }),
      VALID_PARAMS,
    );
    const acct = r.steps.find((s) => s.step === 'account');
    expect(acct?.passed).toBe(false);
    expect(acct?.detail).toContain('NOT onboarded');
    // Should CONTINUE past onboarding failure (it's a step, not an abort)
    expect(r.steps.map((s) => s.step)).toContain('pair');
  });

  it('fails fast on invalid pair', async () => {
    const r = await performDryRunHedge(makeCtx(), { ...VALID_PARAMS, symbol: 'FAKE-PERP' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Invalid pair');
    expect(r.steps.find((s) => s.step === 'pair')?.passed).toBe(false);
    // Should abort at pair check — no leverage/size/market-data
    expect(r.steps.map((s) => s.step)).not.toContain('leverage');
  });

  it('flags over-leverage but continues to run other steps', async () => {
    // ETH-PERP maxLeverage is 10x per BLUEFIN_PAIRS
    const r = await performDryRunHedge(makeCtx(), { ...VALID_PARAMS, leverage: 100 });
    const leverageStep = r.steps.find((s) => s.step === 'leverage');
    expect(leverageStep?.passed).toBe(false);
    // Other steps still ran (this is a "validate all issues" mode)
    expect(r.steps.map((s) => s.step)).toContain('market-data');
    // Overall success is false because a step failed
    expect(r.success).toBe(false);
  });

  it('flags below-minQty size but continues', async () => {
    // ETH-PERP minQty is 0.01, try 0.005
    const r = await performDryRunHedge(makeCtx(), { ...VALID_PARAMS, size: 0.005 });
    const sizeStep = r.steps.find((s) => s.step === 'order-size');
    expect(sizeStep?.passed).toBe(false);
    expect(r.success).toBe(false);
  });

  it('records market-data step failure but still tries construction + signature', async () => {
    const r = await performDryRunHedge(
      makeCtx({ getMarketData: async () => null }),
      VALID_PARAMS,
    );
    const md = r.steps.find((s) => s.step === 'market-data');
    expect(md?.passed).toBe(false);
    // Order construction still runs (uses whatever price it has — 0)
    expect(r.steps.map((s) => s.step)).toContain('order-construction');
    expect(r.success).toBe(false);
  });

  it('handles signature failure gracefully', async () => {
    const r = await performDryRunHedge(
      makeCtx({ signOrder: async () => { throw new Error('key unavailable'); } }),
      VALID_PARAMS,
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe('Signature failed');
    const sig = r.steps.find((s) => s.step === 'signature');
    expect(sig?.passed).toBe(false);
    expect(sig?.detail).toContain('key unavailable');
  });
});
