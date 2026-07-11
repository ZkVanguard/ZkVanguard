/**
 * Verifies the minQty-aware candidate walk in polymarket-edge-trader.
 *
 * Bug: trader picked scan.best (usually BTC — highest signal quality)
 * and if BTC failed the "minQty stake ≤ 70% of free" check, gave up.
 * On a $50 pool the trader was silently no-op'ing every 5min despite
 * live directional signals on ETH, SUI, and SOL that would trade
 * comfortably at 3x leverage.
 *
 * Fix: walk candidates in score order, pick the first one that fits.
 *
 * This test file exercises the pure ranking + affordability check
 * logic; the full trader route is integration-tested elsewhere.
 */
import { ASSET_MIN_QTY, type SupportedAsset } from '@/lib/config/trader-assets';

// Same constants as the trader route
const OPEN_BUFFER = 1.5;
const MAX_STAKE_PCT_OF_FREE_FOR_MIN_QTY = 0.7;
const LEVERAGE = 3;

interface Candidate {
  asset: SupportedAsset;
  score: number;
}

/** Pure ranking + affordability walk mirroring the trader route logic. */
function pickAffordableCandidate(
  candidates: Candidate[],
  freeCollateral: number,
  priceMap: Record<SupportedAsset, number>,
): { picked: SupportedAsset | null; rejected: string[] } {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const rejected: string[] = [];
  for (const c of sorted) {
    const refPrice = priceMap[c.asset] || 0;
    if (refPrice <= 0) {
      rejected.push(`${c.asset}:no-price`);
      continue;
    }
    const minStake = (ASSET_MIN_QTY[c.asset] * refPrice * OPEN_BUFFER) / LEVERAGE;
    const requiredPct = minStake / freeCollateral;
    if (requiredPct > MAX_STAKE_PCT_OF_FREE_FOR_MIN_QTY) {
      rejected.push(`${c.asset}:${(requiredPct * 100).toFixed(0)}%`);
      continue;
    }
    return { picked: c.asset, rejected };
  }
  return { picked: null, rejected };
}

describe('polymarket-edge-trader minQty candidate walk', () => {
  // Realistic mainnet prices around 2026-07-11
  const prices: Record<SupportedAsset, number> = {
    BTC: 64000,
    ETH: 1790,
    SUI: 0.74,
    SOL: 145,
  };

  it('reproduces the bug: BTC is top-ranked but unaffordable on a $20 free pool', () => {
    // Old code: pick BTC → fail minQty → BAIL
    // Required BTC stake = 0.001 * 64000 * 1.5 / 3 = $32 → 160% of $20 → SKIP
    const btcStakeUsd = (ASSET_MIN_QTY.BTC * prices.BTC * OPEN_BUFFER) / LEVERAGE;
    expect(btcStakeUsd).toBeCloseTo(32, 0);
    expect(btcStakeUsd / 20).toBeGreaterThan(MAX_STAKE_PCT_OF_FREE_FOR_MIN_QTY);
  });

  it('falls back from unaffordable BTC to affordable ETH', () => {
    // BTC top score, ETH second
    const cands: Candidate[] = [
      { asset: 'BTC', score: 100 },
      { asset: 'ETH', score: 80 },
      { asset: 'SUI', score: 60 },
    ];
    const { picked, rejected } = pickAffordableCandidate(cands, 20, prices);
    // ETH stake = 0.01 * 1790 * 1.5 / 3 = $8.95 → 44.8% of $20 → OK
    expect(picked).toBe('ETH');
    expect(rejected).toEqual(['BTC:160%']);
  });

  it('falls all the way to SUI when only SUI is affordable', () => {
    const cands: Candidate[] = [
      { asset: 'BTC', score: 100 },
      { asset: 'ETH', score: 90 },
      { asset: 'SUI', score: 40 },
    ];
    // Even smaller free collateral: $5
    const { picked, rejected } = pickAffordableCandidate(cands, 5, prices);
    // BTC needs $32 → 640%; ETH needs $8.95 → 179%; SUI needs $0.37 → 7% → OK
    expect(picked).toBe('SUI');
    expect(rejected.length).toBe(2);
    expect(rejected[0]).toContain('BTC');
    expect(rejected[1]).toContain('ETH');
  });

  it('returns null when NO candidate is affordable', () => {
    const cands: Candidate[] = [
      { asset: 'BTC', score: 100 },
      { asset: 'ETH', score: 90 },
    ];
    // Only $0.50 free → not even SUI would fit (needs $0.37), but SUI
    // isn't in the candidate list here
    const { picked, rejected } = pickAffordableCandidate(cands, 0.5, prices);
    expect(picked).toBeNull();
    expect(rejected.length).toBe(2);
  });

  it('respects score ordering strictly (ETH 90 beats SUI 100 when unranked?)', () => {
    // Higher score should be tried first — even if a lower-scored one is
    // more affordable. The walk stops at the first AFFORDABLE candidate,
    // it doesn't optimize for cheapness.
    const cands: Candidate[] = [
      { asset: 'SUI', score: 100 },
      { asset: 'ETH', score: 90 },
    ];
    const { picked } = pickAffordableCandidate(cands, 20, prices);
    // SUI first because higher score
    expect(picked).toBe('SUI');
  });

  it('skips assets with missing mark price', () => {
    const cands: Candidate[] = [
      { asset: 'BTC', score: 100 },
      { asset: 'ETH', score: 90 },
    ];
    const partialPrices: Record<SupportedAsset, number> = {
      ...prices,
      BTC: 0, // simulate BlueFin returning no price
    };
    const { picked, rejected } = pickAffordableCandidate(cands, 20, partialPrices);
    expect(picked).toBe('ETH');
    expect(rejected).toContain('BTC:no-price');
  });

  it('picks top-scored asset when pool is large enough for anything', () => {
    const cands: Candidate[] = [
      { asset: 'BTC', score: 100 },
      { asset: 'ETH', score: 90 },
      { asset: 'SUI', score: 60 },
    ];
    // Big pool, everything fits
    const { picked, rejected } = pickAffordableCandidate(cands, 500, prices);
    expect(picked).toBe('BTC');
    expect(rejected).toEqual([]);
  });
});
