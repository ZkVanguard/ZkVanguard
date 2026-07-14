/**
 * Tests for PredictionAggregatorService.scanAndPickBest — the multi-asset
 * gate-filter + best-selection logic the autonomous trader depends on.
 *
 * The scoring math is separately tested in opportunity-scoring.test.ts.
 * These tests exercise:
 *   - Gate filtering (minConfidence, minConsensus, minSources)
 *   - Best selection (highest score after gate)
 *   - Edge cases (all fail, single asset, tied scores)
 *
 * Mocks getPerAssetPredictions to feed synthetic per-asset data.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock the I/O layer BEFORE importing the service
const mockGetPerAssetPredictions = jest.fn();
jest.mock('@/lib/services/market-data/PredictionAggregatorService', () => {
  const actual = jest.requireActual<
    typeof import('@/lib/services/market-data/PredictionAggregatorService')
  >('@/lib/services/market-data/PredictionAggregatorService');
  return {
    ...actual,
    PredictionAggregatorService: class {
      static scoreOpportunity = actual.PredictionAggregatorService.scoreOpportunity;
      static getPerAssetPredictions = mockGetPerAssetPredictions;
      static scanAndPickBest = actual.PredictionAggregatorService.scanAndPickBest;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PredictionAggregatorService } = require('@/lib/services/market-data/PredictionAggregatorService');

function makePrediction(over: Partial<{
  recommendation: 'HEDGE_LONG' | 'HEDGE_SHORT' | 'STRONG_HEDGE_LONG' | 'STRONG_HEDGE_SHORT' | 'LIGHT_HEDGE_LONG' | 'LIGHT_HEDGE_SHORT' | 'WAIT';
  confidence: number;
  consensus: number;
  sourceCount: number;
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
}> = {}) {
  const sourceCount = over.sourceCount ?? 2;
  return {
    recommendation: over.recommendation ?? 'HEDGE_LONG',
    confidence: over.confidence ?? 75,
    consensus: over.consensus ?? 75,
    direction: over.direction ?? 'UP',
    probability: 0.75,
    sizeMultiplier: 1,
    reasoning: 'test',
    sources: Array.from({ length: sourceCount }, (_, i) => ({
      name: `src${i}`, direction: 'UP', confidence: 75, weight: 1, category: 'test' as const,
    })),
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('scanAndPickBest — gate filtering', () => {
  it('filters out assets below minConfidence', async () => {
    mockGetPerAssetPredictions.mockResolvedValue({
      BTC: makePrediction({ confidence: 55, consensus: 80, sourceCount: 5 }),
      ETH: makePrediction({ confidence: 75, consensus: 80, sourceCount: 5 }),
    });
    const r = await PredictionAggregatorService.scanAndPickBest(['BTC', 'ETH'], {
      minConfidence: 70,
    });
    expect(r.best?.asset).toBe('ETH');
  });

  it('filters out assets below minConsensus', async () => {
    mockGetPerAssetPredictions.mockResolvedValue({
      BTC: makePrediction({ confidence: 80, consensus: 50, sourceCount: 5 }),
      ETH: makePrediction({ confidence: 80, consensus: 80, sourceCount: 5 }),
    });
    const r = await PredictionAggregatorService.scanAndPickBest(['BTC', 'ETH'], {
      minConsensus: 60,
    });
    expect(r.best?.asset).toBe('ETH');
  });

  it('filters out assets below minSources', async () => {
    mockGetPerAssetPredictions.mockResolvedValue({
      BTC: makePrediction({ confidence: 80, consensus: 80, sourceCount: 1 }),
      ETH: makePrediction({ confidence: 80, consensus: 80, sourceCount: 3 }),
    });
    const r = await PredictionAggregatorService.scanAndPickBest(['BTC', 'ETH'], {
      minSources: 2,
    });
    expect(r.best?.asset).toBe('ETH');
  });

  it('returns null best when ALL assets fail gates', async () => {
    mockGetPerAssetPredictions.mockResolvedValue({
      BTC: makePrediction({ confidence: 40, consensus: 80 }),
      ETH: makePrediction({ confidence: 45, consensus: 80 }),
    });
    const r = await PredictionAggregatorService.scanAndPickBest(['BTC', 'ETH'], {
      minConfidence: 70,
    });
    expect(r.best).toBeNull();
  });

  it('still returns the full `all` map even when nothing passes', async () => {
    const preds = {
      BTC: makePrediction({ confidence: 40 }),
      ETH: makePrediction({ confidence: 45 }),
    };
    mockGetPerAssetPredictions.mockResolvedValue(preds);
    const r = await PredictionAggregatorService.scanAndPickBest(['BTC', 'ETH'], {
      minConfidence: 70,
    });
    expect(Object.keys(r.all)).toEqual(['BTC', 'ETH']);
  });
});

describe('scanAndPickBest — best selection', () => {
  it('picks highest score among gate-passing candidates', async () => {
    // Both pass 60/60/2 gates. Score = sqrt(conf×cons) × breadth + STRONG bonus.
    // BTC: sqrt(70×70) × 1.0 = 70 (breadth 1.0 at 2 sources)
    // ETH: sqrt(70×80) × 1.0 = ~74.8 → wins
    mockGetPerAssetPredictions.mockResolvedValue({
      BTC: makePrediction({ confidence: 70, consensus: 70, sourceCount: 2 }),
      ETH: makePrediction({ confidence: 70, consensus: 80, sourceCount: 2 }),
    });
    const r = await PredictionAggregatorService.scanAndPickBest(['BTC', 'ETH']);
    expect(r.best?.asset).toBe('ETH');
  });

  it('STRONG bonus lifts a STRONG_HEDGE above a plain HEDGE with equal raw score', async () => {
    // Both sqrt(70×70)=70 raw. STRONG adds +10.
    mockGetPerAssetPredictions.mockResolvedValue({
      BTC: makePrediction({ recommendation: 'HEDGE_LONG', confidence: 70, consensus: 70 }),
      ETH: makePrediction({ recommendation: 'STRONG_HEDGE_LONG', confidence: 70, consensus: 70 }),
    });
    const r = await PredictionAggregatorService.scanAndPickBest(['BTC', 'ETH']);
    expect(r.best?.asset).toBe('ETH');
  });

  it('WAIT gets score 0 and is never picked even at 100/100', async () => {
    mockGetPerAssetPredictions.mockResolvedValue({
      BTC: makePrediction({ recommendation: 'WAIT', confidence: 100, consensus: 100 }),
      ETH: makePrediction({ recommendation: 'HEDGE_LONG', confidence: 65, consensus: 65 }),
    });
    const r = await PredictionAggregatorService.scanAndPickBest(['BTC', 'ETH']);
    expect(r.best?.asset).toBe('ETH');
  });
});

describe('scanAndPickBest — defaults + edge cases', () => {
  it('uses default gates (60/60/2) when none provided', async () => {
    mockGetPerAssetPredictions.mockResolvedValue({
      BTC: makePrediction({ confidence: 59, consensus: 90 }),  // fails default conf 60
      ETH: makePrediction({ confidence: 65, consensus: 65 }),  // passes
    });
    const r = await PredictionAggregatorService.scanAndPickBest();
    expect(r.best?.asset).toBe('ETH');
  });

  it('handles empty asset list', async () => {
    mockGetPerAssetPredictions.mockResolvedValue({});
    const r = await PredictionAggregatorService.scanAndPickBest([]);
    expect(r.best).toBeNull();
    expect(r.all).toEqual({});
  });

  it('handles single-asset scan', async () => {
    mockGetPerAssetPredictions.mockResolvedValue({
      SOL: makePrediction({ confidence: 80, consensus: 80, sourceCount: 3 }),
    });
    const r = await PredictionAggregatorService.scanAndPickBest(['SOL']);
    expect(r.best?.asset).toBe('SOL');
  });
});
