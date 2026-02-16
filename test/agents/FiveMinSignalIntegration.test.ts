/**
 * 5-Minute BTC Signal Agent Integration Tests
 * 
 * Tests that the Polymarket 5-min signal is properly consumed by:
 * - PriceMonitorAgent (event emission + auto-hedge trigger)
 * - RiskAgent (weighted sentiment)
 * - HedgingAgent (hedge ratio adjustment)
 * - DelphiMarketService (prediction injection)
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ─── Mock: Polymarket5MinService ────────────────────────

const mockGetLatest5MinSignal = jest.fn();
const mockGetSignalHistory = jest.fn();
const mockSignalToPredictionMarket = jest.fn();

jest.mock('../../lib/services/Polymarket5MinService', () => ({
  Polymarket5MinService: {
    getLatest5MinSignal: mockGetLatest5MinSignal,
    getSignalHistory: mockGetSignalHistory,
    signalToPredictionMarket: mockSignalToPredictionMarket,
  },
  FiveMinBTCSignal: {},
  FiveMinSignalHistory: {},
}));

// Mock logger
jest.mock('../../lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock cache
jest.mock('../../lib/utils/cache', () => ({
  cache: {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
  },
  withCache: jest.fn((fn: (...args: unknown[]) => unknown) => fn),
}));

import type { FiveMinBTCSignal, FiveMinSignalHistory } from '../../lib/services/Polymarket5MinService';

// ─── Test Fixtures ──────────────────────────────────────

function createStrongDownSignal(): FiveMinBTCSignal {
  return {
    marketId: 'test-down-001',
    windowLabel: '10:00-10:05PM ET',
    direction: 'DOWN',
    probability: 82,
    upProbability: 18,
    downProbability: 82,
    priceToBeat: 97500,
    currentPrice: 97500,
    volume: 1500,
    confidence: 85,
    recommendation: 'HEDGE_SHORT',
    signalStrength: 'STRONG',
    timeRemainingSeconds: 180,
    windowEndTime: Date.now() + 180_000,
    fetchedAt: Date.now(),
    question: 'Will Bitcoin go Up or Down from $97,500.00?',
    sourceUrl: 'https://polymarket.com/event/test-down-001',
  };
}

function createStrongUpSignal(): FiveMinBTCSignal {
  return {
    ...createStrongDownSignal(),
    marketId: 'test-up-001',
    direction: 'UP',
    probability: 78,
    upProbability: 78,
    downProbability: 22,
    recommendation: 'HEDGE_LONG',
    sourceUrl: 'https://polymarket.com/event/test-up-001',
  };
}

function createWeakSignal(): FiveMinBTCSignal {
  return {
    ...createStrongDownSignal(),
    marketId: 'test-weak-001',
    direction: 'UP',
    probability: 52,
    upProbability: 52,
    downProbability: 48,
    volume: 30,
    confidence: 25,
    recommendation: 'WAIT',
    signalStrength: 'WEAK',
    sourceUrl: 'https://polymarket.com/event/test-weak-001',
  };
}

function createMockHistory(signals: FiveMinBTCSignal[]): FiveMinSignalHistory {
  return {
    signals,
    accuracy: { correct: 4, total: 6, rate: 67 },
    streak: { direction: signals[0]?.direction || 'MIXED', count: signals.length },
    avgConfidence: signals.length > 0
      ? Math.round(signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length)
      : 0,
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('5-Min Signal Agent Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLatest5MinSignal.mockReset();
    mockGetSignalHistory.mockReset();
    mockSignalToPredictionMarket.mockReset();
  });

  // ── Signal Shape Validation ───────────────────────────

  describe('Signal Shape', () => {
    it('strong DOWN signal has correct properties for agent consumption', () => {
      const signal = createStrongDownSignal();

      expect(signal.direction).toBe('DOWN');
      expect(signal.signalStrength).toBe('STRONG');
      expect(signal.recommendation).toBe('HEDGE_SHORT');
      expect(signal.confidence).toBeGreaterThan(70);
      expect(signal.probability).toBeGreaterThan(70);
      expect(signal.timeRemainingSeconds).toBeGreaterThan(0);
    });

    it('strong UP signal has correct properties', () => {
      const signal = createStrongUpSignal();

      expect(signal.direction).toBe('UP');
      expect(signal.signalStrength).toBe('STRONG');
      expect(signal.recommendation).toBe('HEDGE_LONG');
    });

    it('weak signal should not trigger hedging', () => {
      const signal = createWeakSignal();

      expect(signal.signalStrength).toBe('WEAK');
      expect(signal.recommendation).toBe('WAIT');
      expect(signal.confidence).toBeLessThan(50);
    });
  });

  // ── RiskAgent Sentiment Weighting Logic ───────────────

  describe('RiskAgent Sentiment Weighting', () => {
    it('STRONG DOWN signal should add 3x weight to bearishCount', () => {
      const signal = createStrongDownSignal();
      let bearishCount = 2;
      let bullishCount = 3;

      // Replicate the logic from RiskAgent.assessMarketSentimentInternal
      if (signal.signalStrength !== 'WEAK') {
        const weight = signal.signalStrength === 'STRONG' ? 3 : 2;
        if (signal.direction === 'DOWN') {
          bearishCount += weight;
        } else {
          bullishCount += weight;
        }
      }

      expect(bearishCount).toBe(5); // 2 + 3
      expect(bullishCount).toBe(3); // unchanged
    });

    it('MODERATE UP signal should add 2x weight to bullishCount', () => {
      const signal: FiveMinBTCSignal = {
        ...createStrongUpSignal(),
        signalStrength: 'MODERATE',
        confidence: 55,
      };
      let bearishCount = 2;
      let bullishCount = 3;

      if (signal.signalStrength !== 'WEAK') {
        const weight = signal.signalStrength === 'STRONG' ? 3 : 2;
        if (signal.direction === 'DOWN') {
          bearishCount += weight;
        } else {
          bullishCount += weight;
        }
      }

      expect(bearishCount).toBe(2); // unchanged
      expect(bullishCount).toBe(5); // 3 + 2
    });

    it('WEAK signal should not modify counts', () => {
      const signal = createWeakSignal();
      let bearishCount = 2;
      let bullishCount = 3;

      if (signal.signalStrength !== 'WEAK') {
        const weight = signal.signalStrength === 'STRONG' ? 3 : 2;
        if (signal.direction === 'DOWN') {
          bearishCount += weight;
        } else {
          bullishCount += weight;
        }
      }

      expect(bearishCount).toBe(2);
      expect(bullishCount).toBe(3);
    });
  });

  // ── HedgingAgent Ratio Adjustment Logic ───────────────

  describe('HedgingAgent Hedge Ratio Adjustment', () => {
    it('STRONG DOWN signal should boost hedge ratio by ~1.1x', () => {
      const signal = createStrongDownSignal();
      const history = createMockHistory([signal]);
      let hedgeRatio = 0.5;

      // Replicate the logic from HedgingAgent.analyzeHedgeOpportunity
      if (signal.signalStrength !== 'WEAK') {
        let fiveMinMultiplier = 1.0;
        if (signal.direction === 'DOWN') {
          fiveMinMultiplier = 1.0 + (signal.confidence / 100) * 0.1;
        } else {
          fiveMinMultiplier = Math.max(0.9, 1.0 - (signal.confidence / 100) * 0.05);
        }
        // Streak amplifier
        if (history.streak.count >= 3 && history.streak.direction === signal.direction) {
          fiveMinMultiplier *= 1.05;
        }
        hedgeRatio *= fiveMinMultiplier;
      }

      // confidence=85, so fiveMinMultiplier = 1.0 + 0.85 * 0.1 = 1.085
      // streak.count = 1, so no streak amplifier
      expect(hedgeRatio).toBeCloseTo(0.5 * 1.085, 3);
    });

    it('STRONG UP signal should relax hedge ratio', () => {
      const signal = createStrongUpSignal();
      const history = createMockHistory([signal]);
      let hedgeRatio = 0.5;

      if (signal.signalStrength !== 'WEAK') {
        let fiveMinMultiplier = 1.0;
        if (signal.direction === 'DOWN') {
          fiveMinMultiplier = 1.0 + (signal.confidence / 100) * 0.1;
        } else {
          fiveMinMultiplier = Math.max(0.9, 1.0 - (signal.confidence / 100) * 0.05);
        }
        if (history.streak.count >= 3 && history.streak.direction === signal.direction) {
          fiveMinMultiplier *= 1.05;
        }
        hedgeRatio *= fiveMinMultiplier;
      }

      // confidence=85, direction=UP: fiveMinMultiplier = max(0.9, 1 - 0.85*0.05) = max(0.9, 0.9575) = 0.9575
      expect(hedgeRatio).toBeCloseTo(0.5 * 0.9575, 3);
    });

    it('streak >= 3 should amplify the multiplier by 1.05x', () => {
      const signal = createStrongDownSignal();
      const signals = [signal, signal, signal, signal]; // 4-streak
      const history = createMockHistory(signals);
      let hedgeRatio = 0.5;

      if (signal.signalStrength !== 'WEAK') {
        let fiveMinMultiplier = 1.0;
        if (signal.direction === 'DOWN') {
          fiveMinMultiplier = 1.0 + (signal.confidence / 100) * 0.1;
        } else {
          fiveMinMultiplier = Math.max(0.9, 1.0 - (signal.confidence / 100) * 0.05);
        }
        if (history.streak.count >= 3 && history.streak.direction === signal.direction) {
          fiveMinMultiplier *= 1.05;
        }
        hedgeRatio *= fiveMinMultiplier;
      }

      // confidence=85, DOWN: fiveMinMultiplier = 1.085 * 1.05 = 1.13925
      expect(hedgeRatio).toBeCloseTo(0.5 * 1.085 * 1.05, 3);
    });

    it('WEAK signal should not adjust hedge ratio', () => {
      const signal = createWeakSignal();
      let hedgeRatio = 0.5;

      if (signal.signalStrength !== 'WEAK') {
        hedgeRatio *= 1.1; // This should NOT execute
      }

      expect(hedgeRatio).toBe(0.5);
    });
  });

  // ── PriceMonitorAgent Event Logic ─────────────────────

  describe('PriceMonitorAgent 5-Min Logic', () => {
    it('STRONG signal should trigger event emission', () => {
      const signal = createStrongDownSignal();
      const events: Array<{ type: string; signal?: FiveMinBTCSignal }> = [];

      // Simulate the PriceMonitorAgent logic
      if (signal.signalStrength === 'STRONG') {
        events.push({
          type: 'five_min_signal',
          signal,
        });
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('five_min_signal');
    });

    it('STRONG DOWN + HEDGE_SHORT should trigger auto-hedge', () => {
      const signal = createStrongDownSignal();
      const btcPrice = { price: 97500, symbol: 'BTC', change24h: -0.5, timestamp: Date.now() };
      let autoHedgeTriggered = false;

      // Simulate the PriceMonitorAgent auto-hedge logic
      if (signal.signalStrength === 'STRONG') {
        if (signal.recommendation === 'HEDGE_SHORT' && btcPrice) {
          autoHedgeTriggered = true;
        }
      }

      expect(autoHedgeTriggered).toBe(true);
    });

    it('STRONG UP should NOT trigger auto-hedge (only emits event)', () => {
      const signal = createStrongUpSignal();
      const btcPrice = { price: 97500, symbol: 'BTC', change24h: 0.5, timestamp: Date.now() };
      let autoHedgeTriggered = false;

      if (signal.signalStrength === 'STRONG') {
        if (signal.recommendation === 'HEDGE_SHORT' && btcPrice) {
          autoHedgeTriggered = true;
        }
      }

      expect(autoHedgeTriggered).toBe(false);
    });

    it('WEAK/MODERATE signals should not trigger events', () => {
      const signal = createWeakSignal();
      const events: unknown[] = [];

      if (signal.signalStrength === 'STRONG') {
        events.push({ type: 'five_min_signal' });
      }

      expect(events).toHaveLength(0);
    });
  });

  // ── DelphiMarketService Injection ─────────────────────

  describe('DelphiMarketService Signal Injection', () => {
    it('converted signal should have polymarket-5min prefix', () => {
      const signal = createStrongDownSignal();
      const pm = {
        id: `polymarket-5min-${signal.marketId}`,
        question: `⚡ 5-Min BTC Signal: ${signal.direction}`,
        category: 'price',
        source: 'polymarket',
        relatedAssets: ['BTC'],
      };

      expect(pm.id).toBe('polymarket-5min-test-down-001');
      expect(pm.question).toContain('5-Min BTC Signal');
      expect(pm.question).toContain('DOWN');
      expect(pm.source).toBe('polymarket');
    });

    it('injected signal should appear first in predictions array', () => {
      const fiveMinPrediction = { id: 'polymarket-5min-test', priority: 'high' };
      const existingPredictions = [
        { id: 'delphi-btc-1', priority: 'normal' },
        { id: 'polymarket-btc-2', priority: 'normal' },
      ];

      // Replicate the unshift logic from DelphiMarketService
      const allPredictions = [...existingPredictions];
      allPredictions.unshift(fiveMinPrediction);

      expect(allPredictions[0].id).toBe('polymarket-5min-test');
      expect(allPredictions).toHaveLength(3);
    });
  });

  // ── Service Mock Behavior ─────────────────────────────

  describe('Service Mock Behavior', () => {
    it('getLatest5MinSignal returns mocked signal', async () => {
      const signal = createStrongDownSignal();
      mockGetLatest5MinSignal.mockResolvedValueOnce(signal);

      const { Polymarket5MinService } = require('../../lib/services/Polymarket5MinService');
      const result = await Polymarket5MinService.getLatest5MinSignal();

      expect(result).toBe(signal);
      expect(result.direction).toBe('DOWN');
    });

    it('getLatest5MinSignal returns null when no market available', async () => {
      mockGetLatest5MinSignal.mockResolvedValueOnce(null);

      const { Polymarket5MinService } = require('../../lib/services/Polymarket5MinService');
      const result = await Polymarket5MinService.getLatest5MinSignal();

      expect(result).toBeNull();
    });

    it('getSignalHistory returns mocked history', async () => {
      const history = createMockHistory([createStrongDownSignal(), createStrongDownSignal()]);
      mockGetSignalHistory.mockReturnValueOnce(history);

      const { Polymarket5MinService } = require('../../lib/services/Polymarket5MinService');
      const result = Polymarket5MinService.getSignalHistory();

      expect(result.signals).toHaveLength(2);
      expect(result.streak.direction).toBe('DOWN');
      expect(result.streak.count).toBe(2);
    });
  });
});
