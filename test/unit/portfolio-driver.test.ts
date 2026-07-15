/**
 * Unit tests for PortfolioDriver — Gap 1 controller.
 *
 * Locks the behavior that reshapes existing holdings toward the target
 * allocation. Regression risk: profit-lock decisions get made all the
 * time, but if the driver stops emitting corrective actions the fix
 * silently regresses to the original drawdown-defense hole.
 *
 * Integration test at test/integration/pool-drawdown-defense.test.ts
 * covers the full replay; these unit tests pin narrower invariants.
 */
import { describe, it, expect } from '@jest/globals';
import { runPortfolioDriverTick } from '@/lib/services/sui/PortfolioDriver';

function makeSandbox(idleUsdc: number, spot: Record<string, number>) {
  const s = {
    idleUsdc,
    spot,
    hedges: [] as Array<{ asset: string; side: 'LONG' | 'SHORT'; notionalUsd: number }>,
    getNav() {
      return this.idleUsdc + Object.values(this.spot).reduce((sum, v) => sum + (Number(v) || 0), 0);
    },
  };
  return s;
}

describe('runPortfolioDriverTick — profit-lock unwind (Gap 1)', () => {
  it('emits SELL_SPOT_TO_USDC for every risk asset at ≥20% drawdown', async () => {
    const sandbox = makeSandbox(5, { wBTC: 20, wETH: 15, SUI: 5 }); // ~89% risk
    const peakNav = sandbox.getNav() * 1.35; // 25%+ drawdown
    const actions = await runPortfolioDriverTick({
      sandbox,
      signal: { direction: 'DOWN', confidence: 80, observedAt: Date.now() },
      nowMs: Date.now(),
      peakNavUsd: peakNav,
    });
    const sells = actions.filter(a => a.type === 'SELL_SPOT_TO_USDC');
    expect(sells.length).toBeGreaterThan(0);
    const soldUsd = sells.reduce((s, a) => s + a.amountUsd, 0);
    const spotBefore = 20 + 15 + 5;
    expect(soldUsd).toBeGreaterThanOrEqual(spotBefore * 0.9);
  });

  it('does not fire when drawdown < 5% (profit-lock start threshold)', async () => {
    const sandbox = makeSandbox(5, { wBTC: 20, wETH: 15, SUI: 5 });
    const peakNav = sandbox.getNav() * 1.02; // just 2% off peak
    const actions = await runPortfolioDriverTick({
      sandbox,
      signal: { direction: 'UP', confidence: 60, observedAt: Date.now() },
      nowMs: Date.now(),
      peakNavUsd: peakNav,
    });
    const sellsFromLock = actions.filter(
      a => a.type === 'SELL_SPOT_TO_USDC' && a.reason.includes('profit-lock'),
    );
    expect(sellsFromLock.length).toBe(0);
  });

  it('emits actions whose reason attributes cause (profit-lock vs signal)', async () => {
    const sandbox = makeSandbox(5, { wBTC: 20 });
    const peakNav = sandbox.getNav() * 1.30;
    const actions = await runPortfolioDriverTick({
      sandbox,
      signal: { direction: 'DOWN', confidence: 75, observedAt: Date.now() },
      nowMs: Date.now(),
      peakNavUsd: peakNav,
    });
    const sells = actions.filter(a => a.type === 'SELL_SPOT_TO_USDC');
    expect(sells.length).toBeGreaterThan(0);
    // Reason should mention profit-lock OR signal — never both mutually
    for (const a of sells) {
      expect(a.reason).toMatch(/profit-lock|signal|reduce/i);
    }
  });
});

describe('runPortfolioDriverTick — symmetric sell trigger (Gap 5)', () => {
  it('reduces on ≥65% opposing signal even without profit-lock', async () => {
    const sandbox = makeSandbox(5, { wBTC: 20 });
    const peakNav = sandbox.getNav(); // no drawdown
    const actions = await runPortfolioDriverTick({
      sandbox,
      signal: { direction: 'DOWN', confidence: 75, observedAt: Date.now() },
      nowMs: Date.now(),
      peakNavUsd: peakNav,
      aiAllocation: { BTC: 40 },
    });
    const sells = actions.filter(a => a.type === 'SELL_SPOT_TO_USDC');
    expect(sells.length).toBeGreaterThan(0);
    // 75% opposing → reduce by 50 ppts → target 0% → sell most of wBTC
    const btcSold = sells.filter(a => a.asset === 'wBTC').reduce((s, a) => s + a.amountUsd, 0);
    expect(btcSold).toBeGreaterThan(15);
  });

  it('does not fire when confidence < 65% (below trigger threshold)', async () => {
    const sandbox = makeSandbox(5, { wBTC: 20 });
    const actions = await runPortfolioDriverTick({
      sandbox,
      signal: { direction: 'DOWN', confidence: 55, observedAt: Date.now() },
      nowMs: Date.now(),
      peakNavUsd: sandbox.getNav(),
      aiAllocation: { BTC: 40 },
    });
    const sellsSignal = actions.filter(
      a => a.type === 'SELL_SPOT_TO_USDC' && /opposing/i.test(a.reason),
    );
    expect(sellsSignal.length).toBe(0);
  });
});

describe('runPortfolioDriverTick — signal-flip drift-close (Gap 2)', () => {
  it('closes contradicted perp hedge on signal flip', async () => {
    const sandbox = makeSandbox(10, {});
    sandbox.hedges = [
      { asset: 'BTC', side: 'LONG', notionalUsd: 20 },
    ];
    const actions = await runPortfolioDriverTick({
      sandbox,
      signal: { direction: 'DOWN', confidence: 78, observedAt: Date.now() },
      nowMs: Date.now(),
      peakNavUsd: sandbox.getNav(),
      signalFlipped: true,
    });
    const closes = actions.filter(a => a.type === 'CLOSE_HEDGE' && a.asset === 'BTC');
    expect(closes.length).toBe(1);
  });

  it('unwinds contradicted spot on signal flip (Gap 2 spot-side)', async () => {
    const sandbox = makeSandbox(5, { wBTC: 15 });
    const actions = await runPortfolioDriverTick({
      sandbox,
      signal: { direction: 'DOWN', confidence: 70, observedAt: Date.now() },
      nowMs: Date.now(),
      peakNavUsd: sandbox.getNav(),
      signalFlipped: true,
    });
    const sells = actions.filter(a => a.type === 'SELL_SPOT_TO_USDC' && a.asset === 'wBTC');
    expect(sells.length).toBeGreaterThan(0);
    expect(sells[0].amountUsd).toBeGreaterThan(10);
  });
});

describe('runPortfolioDriverTick — action shape invariants', () => {
  it('never emits actions with negative amounts', async () => {
    const sandbox = makeSandbox(50, { wBTC: 10, wETH: 5 });
    const actions = await runPortfolioDriverTick({
      sandbox,
      signal: { direction: 'DOWN', confidence: 80, observedAt: Date.now() },
      nowMs: Date.now(),
      peakNavUsd: sandbox.getNav() * 1.5,
    });
    for (const a of actions) expect(a.amountUsd).toBeGreaterThanOrEqual(0);
  });

  it('every action has a non-empty reason string', async () => {
    const sandbox = makeSandbox(5, { wBTC: 20 });
    const actions = await runPortfolioDriverTick({
      sandbox,
      signal: { direction: 'DOWN', confidence: 80, observedAt: Date.now() },
      nowMs: Date.now(),
      peakNavUsd: sandbox.getNav() * 1.3,
    });
    for (const a of actions) {
      expect(a.reason).toBeTruthy();
      expect(a.reason.length).toBeGreaterThan(5);
    }
  });

  it('returns empty array when nothing needs correction', async () => {
    const sandbox = makeSandbox(100, {}); // 100% USDC, nothing risk
    const actions = await runPortfolioDriverTick({
      sandbox,
      signal: { direction: 'UP', confidence: 60, observedAt: Date.now() },
      nowMs: Date.now(),
      peakNavUsd: sandbox.getNav(),
    });
    expect(actions).toEqual([]);
  });
});
