/**
 * Unit tests for StaleHedgeDetector — Gap 6.
 *
 * Locks the age × flip-count × contradicted-side rule. Regression risk:
 * a "simplify" refactor of the three-part gate could silently mark
 * fresh hedges as stale (bad — force-closes at loss) or let the ancient
 * misaligned hedge live on (the 32-day ETH SHORT from the original
 * drawdown incident).
 */
import { describe, it, expect } from '@jest/globals';
import { detectStaleHedges } from '@/lib/services/sui/StaleHedgeDetector';

const NOW = new Date('2026-07-15T12:00:00Z');

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe('detectStaleHedges — canonical cases', () => {
  it('flags the 20-day ETH SHORT case via rule (a) — contradicted side (under max-age)', async () => {
    // 20d < 30d default max-age, so rule (b) doesn't fire; rule (a) must.
    // Kept the original 32-day incident case (now covered by the max-age
    // test below) — this one locks the rule-(a) reason string.
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 190, asset: 'ETH', side: 'SHORT', openedAt: daysAgo(20), notionalUsd: 17.33 },
      ],
      signalFlipsPerAsset: { ETH: 13 },
      currentSignals: { ETH: { direction: 'UP', confidence: 67 } },
      now: NOW,
    });
    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe(190);
    expect(stale[0].ageDays).toBeCloseTo(20, 0);
    expect(stale[0].reason).toMatch(/20.*d/i);
    expect(stale[0].reason).toMatch(/UP.*conf=67/);
  });

  it('does NOT flag a 6-day hedge (below default 7-day age threshold)', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 1, asset: 'BTC', side: 'LONG', openedAt: daysAgo(6), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { BTC: 5 },
      currentSignals: { BTC: { direction: 'DOWN', confidence: 80 } },
      now: NOW,
    });
    expect(stale).toHaveLength(0);
  });

  it('does NOT flag if only 1 signal flip has happened (below default min 2) at 20d age', async () => {
    // 20d < 30d default max-age, so rule (b) doesn't fire; rule (a) needs flips ≥ 2
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 2, asset: 'BTC', side: 'LONG', openedAt: daysAgo(20), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { BTC: 1 },
      currentSignals: { BTC: { direction: 'DOWN', confidence: 80 } },
      now: NOW,
    });
    expect(stale).toHaveLength(0);
  });

  it('does NOT flag when current signal aligns with hedge side (under max-age)', async () => {
    // 20d < 30d default max-age, so rule (b) doesn't fire; rule (a) needs contradiction
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 3, asset: 'BTC', side: 'SHORT', openedAt: daysAgo(20), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { BTC: 10 },
      currentSignals: { BTC: { direction: 'DOWN', confidence: 80 } }, // SHORT + DOWN = aligned
      now: NOW,
    });
    expect(stale).toHaveLength(0);
  });

  it('does NOT flag when no signal for the asset exists (under max-age)', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 4, asset: 'SOL', side: 'LONG', openedAt: daysAgo(20), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { SOL: 10 },
      currentSignals: {}, // no SOL signal
      now: NOW,
    });
    expect(stale).toHaveLength(0);
  });

  it('flags an aligned 57-day-old ETH SHORT via max-age rule (rule b)', async () => {
    // The 2026-08-08 stuck orphan case: aligned today, but 57 days old is
    // coincidental. Max-age rule must fire regardless of signal state.
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 190, asset: 'ETH', side: 'SHORT', openedAt: daysAgo(57), notionalUsd: 18.27 },
      ],
      signalFlipsPerAsset: { ETH: 24 },
      currentSignals: { ETH: { direction: 'DOWN', confidence: 51 } }, // aligned with SHORT
      now: NOW,
    });
    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe(190);
    expect(stale[0].reason).toMatch(/max.*30d|coincidental/i);
  });

  it('flags a 69-day orphan hedge with no signal at all (SUI LONG #5 case)', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 5, asset: 'SUI', side: 'LONG', openedAt: daysAgo(69), notionalUsd: 0.53 },
      ],
      signalFlipsPerAsset: {}, // no flips tracked
      currentSignals: {},      // no signal at all
      now: NOW,
    });
    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe(5);
  });
});

describe('detectStaleHedges — env-override thresholds', () => {
  it('respects staleAgeDays override (14 days)', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 5, asset: 'BTC', side: 'LONG', openedAt: daysAgo(10), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { BTC: 5 },
      currentSignals: { BTC: { direction: 'DOWN', confidence: 80 } },
      now: NOW,
      staleAgeDays: 14,
    });
    expect(stale).toHaveLength(0);
  });

  it('respects staleMinFlips override (5 flips) at 20d age', async () => {
    // 20d < 30d default max-age, so rule (b) doesn't force-close; rule (a)
    // needs flips ≥ 5 override, hedge only has 3.
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 6, asset: 'BTC', side: 'LONG', openedAt: daysAgo(20), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { BTC: 3 },
      currentSignals: { BTC: { direction: 'DOWN', confidence: 80 } },
      now: NOW,
      staleMinFlips: 5,
    });
    expect(stale).toHaveLength(0);
  });

  it('respects staleMaxAgeDays override (60 days) — aligned 32-day survives', async () => {
    // With max-age lifted to 60d, an aligned 32d hedge is neither
    // rule-(a) stale (signal aligned) nor rule-(b) stale (under 60d).
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 7, asset: 'BTC', side: 'SHORT', openedAt: daysAgo(32), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { BTC: 10 },
      currentSignals: { BTC: { direction: 'DOWN', confidence: 80 } }, // aligned
      now: NOW,
      staleMaxAgeDays: 60,
    });
    expect(stale).toHaveLength(0);
  });
});

describe('detectStaleHedges — multiple hedges', () => {
  it('flags only the subset that meets all three criteria (all under max-age)', async () => {
    // All ages under 30d default max-age so rule (b) doesn't fire on any;
    // only rule (a) is tested here. Original 30d aged hedges promoted to
    // separate max-age test cases above.
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 100, asset: 'BTC', side: 'LONG', openedAt: daysAgo(20), notionalUsd: 20 }, // stale via rule (a)
        { id: 101, asset: 'ETH', side: 'SHORT', openedAt: daysAgo(3), notionalUsd: 15 },  // too fresh
        { id: 102, asset: 'SUI', side: 'LONG', openedAt: daysAgo(20), notionalUsd: 5 },   // aligned
      ],
      signalFlipsPerAsset: { BTC: 10, ETH: 10, SUI: 10 },
      currentSignals: {
        BTC: { direction: 'DOWN', confidence: 80 }, // contradicts LONG
        ETH: { direction: 'UP', confidence: 80 },
        SUI: { direction: 'UP', confidence: 80 },   // aligns with LONG
      },
      now: NOW,
    });
    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe(100);
  });

  it('returns empty array on empty input', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [],
      signalFlipsPerAsset: {},
      currentSignals: {},
      now: NOW,
    });
    expect(stale).toEqual([]);
  });
});
