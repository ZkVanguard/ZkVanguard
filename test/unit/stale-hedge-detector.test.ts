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
  it('flags the 32-day ETH SHORT case (the original drawdown-incident hedge)', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 190, asset: 'ETH', side: 'SHORT', openedAt: daysAgo(32), notionalUsd: 17.33 },
      ],
      signalFlipsPerAsset: { ETH: 13 },
      currentSignals: { ETH: { direction: 'UP', confidence: 67 } },
      now: NOW,
    });
    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe(190);
    expect(stale[0].ageDays).toBeCloseTo(32, 0);
    expect(stale[0].reason).toMatch(/32.*d/i);
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

  it('does NOT flag if only 1 signal flip has happened (below default min 2)', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 2, asset: 'BTC', side: 'LONG', openedAt: daysAgo(30), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { BTC: 1 },
      currentSignals: { BTC: { direction: 'DOWN', confidence: 80 } },
      now: NOW,
    });
    expect(stale).toHaveLength(0);
  });

  it('does NOT flag when current signal aligns with hedge side', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 3, asset: 'BTC', side: 'SHORT', openedAt: daysAgo(30), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { BTC: 10 },
      currentSignals: { BTC: { direction: 'DOWN', confidence: 80 } }, // SHORT + DOWN = aligned
      now: NOW,
    });
    expect(stale).toHaveLength(0);
  });

  it('does NOT flag when no signal for the asset exists', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 4, asset: 'SOL', side: 'LONG', openedAt: daysAgo(30), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { SOL: 10 },
      currentSignals: {}, // no SOL signal
      now: NOW,
    });
    expect(stale).toHaveLength(0);
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

  it('respects staleMinFlips override (5 flips)', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 6, asset: 'BTC', side: 'LONG', openedAt: daysAgo(30), notionalUsd: 20 },
      ],
      signalFlipsPerAsset: { BTC: 3 },
      currentSignals: { BTC: { direction: 'DOWN', confidence: 80 } },
      now: NOW,
      staleMinFlips: 5,
    });
    expect(stale).toHaveLength(0);
  });
});

describe('detectStaleHedges — multiple hedges', () => {
  it('flags only the subset that meets all three criteria', async () => {
    const stale = await detectStaleHedges({
      activeHedges: [
        { id: 100, asset: 'BTC', side: 'LONG', openedAt: daysAgo(30), notionalUsd: 20 }, // stale
        { id: 101, asset: 'ETH', side: 'SHORT', openedAt: daysAgo(3), notionalUsd: 15 },  // too fresh
        { id: 102, asset: 'SUI', side: 'LONG', openedAt: daysAgo(30), notionalUsd: 5 },   // aligned
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
