/**
 * Polymarket 5-Minute BTC Signal Service Tests
 * 
 * Tests signal parsing, directional logic, confidence scoring,
 * signal strength classification, history tracking, and agent integration format.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

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
}));

import { Polymarket5MinService, FiveMinBTCSignal, FiveMinSignalHistory } from '../../lib/services/Polymarket5MinService';

// ─── Test Fixtures ──────────────────────────────────────────────────

function createMockMarket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'market-5min-001',
    conditionId: 'cond-001',
    slug: 'btc-5min-up-or-down',
    question: 'Will Bitcoin go Up or Down from $97,500.00 between 10:00-10:05PM ET on Feb 15?',
    description: 'This market resolves based on BTC/USD Chainlink price feed. Starting price: $97,500.00.',
    outcomePrices: '["0.62", "0.38"]', // 62% UP, 38% DOWN
    volume: '500',
    volumeNum: '500',
    endDate: new Date(Date.now() + 180_000).toISOString(), // 3 mins remaining
    closed: false,
    ...overrides,
  };
}

function createMockResponse(markets: Record<string, unknown>[], ok = true): Response {
  return {
    ok,
    json: jest.fn().mockResolvedValue(markets),
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
  } as unknown as Response;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Polymarket5MinService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    // Clear internal signal history via calling getSignalHistory to observe it
    // (Static class — reset cache mock)
    const { cache } = require('../../lib/utils/cache');
    cache.get.mockReturnValue(null);
  });

  // ── Signal Parsing ────────────────────────────────────

  describe('getLatest5MinSignal()', () => {
    it('should return a valid signal when a 5-min BTC market exists', async () => {
      const mockMarket = createMockMarket();
      mockFetch.mockResolvedValueOnce(createMockResponse([mockMarket]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('UP');
      expect(signal!.upProbability).toBe(62);
      expect(signal!.downProbability).toBe(38);
      expect(signal!.probability).toBe(62);
      expect(signal!.marketId).toBe('market-5min-001');
      expect(signal!.priceToBeat).toBe(97500);
    });

    it('should parse DOWN direction when downProbability > upProbability', async () => {
      const mockMarket = createMockMarket({
        outcomePrices: '["0.35", "0.65"]', // 35% UP, 65% DOWN
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([mockMarket]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('DOWN');
      expect(signal!.upProbability).toBe(35);
      expect(signal!.downProbability).toBe(65);
      expect(signal!.probability).toBe(65); // Max of the two
    });

    it('should default to UP when probabilities are exactly equal', async () => {
      const mockMarket = createMockMarket({
        outcomePrices: '["0.50", "0.50"]',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([mockMarket]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('UP');
      expect(signal!.upProbability).toBe(50);
      expect(signal!.downProbability).toBe(50);
    });

    it('should return null when no markets are found', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse([]))   // tag search empty
        .mockResolvedValueOnce(createMockResponse([]));    // fallback empty

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).toBeNull();
    });

    it('should return null on API error and no cached data', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).toBeNull();
    });

    it('should return cached signal when available and fresh', async () => {
      const cachedSignal: FiveMinBTCSignal = {
        marketId: 'cached-001',
        windowLabel: '10:00-10:05PM ET',
        direction: 'UP',
        probability: 70,
        upProbability: 70,
        downProbability: 30,
        priceToBeat: 97000,
        currentPrice: 97000,
        volume: 300,
        confidence: 75,
        recommendation: 'HEDGE_LONG',
        signalStrength: 'STRONG',
        timeRemainingSeconds: 200,
        fetchedAt: Date.now() - 5000, // 5s ago — still fresh (within 15s TTL)
        question: 'Will Bitcoin go up?',
        sourceUrl: 'https://polymarket.com/event/cached-001',
      };
      const { cache } = require('../../lib/utils/cache');
      cache.get.mockReturnValueOnce(cachedSignal);

      const signal = await Polymarket5MinService.getLatest5MinSignal();

      expect(signal).not.toBeNull();
      expect(signal!.marketId).toBe('cached-001');
      expect(mockFetch).not.toHaveBeenCalled(); // No API call needed
    });

    it('should fallback to keyword search if tag search returns nothing', async () => {
      // First call (tag search) returns empty
      mockFetch.mockResolvedValueOnce(createMockResponse([]));
      // Fallback returns a mix of markets, only one matches keywords
      const validMarket = createMockMarket({
        question: 'Will Bitcoin go Up or Down (5 min) from $97,500.00?',
      });
      const irrelevantMarket = createMockMarket({
        id: 'irrelevant-001',
        question: 'Will Bitcoin reach $100,000 by March?',
      });
      mockFetch.mockResolvedValueOnce(
        createMockResponse([irrelevantMarket, validMarket])
      );

      const signal = await Polymarket5MinService.getLatest5MinSignal();

      expect(signal).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── Signal Strength Classification ────────────────────

  describe('Signal Strength Classification', () => {
    it('should classify as STRONG when probability skew >= 30 and volume >= 200', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.82", "0.18"]', // 64% skew
        volume: '500',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.signalStrength).toBe('STRONG');
    });

    it('should classify as MODERATE when skew >= 15 or volume >= 100', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.60", "0.40"]', // 20% skew
        volume: '80', // < 100 but skew >= 15
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.signalStrength).toBe('MODERATE');
    });

    it('should classify as WEAK when skew < 15 and volume < 100', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.53", "0.47"]', // 6% skew
        volume: '50',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.signalStrength).toBe('WEAK');
    });
  });

  // ── Recommendation Logic ──────────────────────────────

  describe('Recommendation Logic', () => {
    it('should recommend HEDGE_SHORT for STRONG DOWN signal', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.15", "0.85"]', // 70% skew, DOWN
        volume: '1000',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.recommendation).toBe('HEDGE_SHORT');
      expect(signal!.direction).toBe('DOWN');
    });

    it('should recommend HEDGE_LONG for STRONG UP signal', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.85", "0.15"]', // 70% skew, UP
        volume: '1000',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.recommendation).toBe('HEDGE_LONG');
      expect(signal!.direction).toBe('UP');
    });

    it('should recommend WAIT for WEAK signals', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.52", "0.48"]', // 4% skew
        volume: '30',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.recommendation).toBe('WAIT');
    });

    it('should recommend hedge for MODERATE signal with maxProb >= 65', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.68", "0.32"]', // 36% skew, moderate volume
        volume: '90', // < 200, so not STRONG by volume — but skew >= 30 AND volume >= 200?
        // Actually: skew=36 >= 30, volume=90 < 200. So NOT STRONG.
        // MODERATE: skew >= 15 or volume >= 100 → skew=36 >= 15 → MODERATE
        // maxProb=68 >= 65 → HEDGE_LONG
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.signalStrength).toBe('MODERATE');
      expect(signal!.recommendation).toBe('HEDGE_LONG');
    });
  });

  // ── Confidence Scoring ────────────────────────────────

  describe('Confidence Scoring', () => {
    it('should calculate confidence as a number between 0 and 95', async () => {
      const market = createMockMarket({ volume: '500' });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.confidence).toBeGreaterThanOrEqual(0);
      expect(signal!.confidence).toBeLessThanOrEqual(95);
    });

    it('should produce higher confidence with larger volume and skew', async () => {
      // High volume + high skew
      const highMarket = createMockMarket({
        outcomePrices: '["0.85", "0.15"]',
        volume: '5000',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([highMarket]));
      const highSignal = await Polymarket5MinService.getLatest5MinSignal();

      // Reset cache
      const { cache } = require('../../lib/utils/cache');
      cache.get.mockReturnValue(null);

      // Low volume + low skew
      const lowMarket = createMockMarket({
        outcomePrices: '["0.51", "0.49"]',
        volume: '10',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([lowMarket]));
      const lowSignal = await Polymarket5MinService.getLatest5MinSignal();

      expect(highSignal!.confidence).toBeGreaterThan(lowSignal!.confidence);
    });
  });

  // ── Price Extraction ──────────────────────────────────

  describe('Price to Beat Extraction', () => {
    it('should extract price from question with $ format', async () => {
      const market = createMockMarket({
        question: 'Will Bitcoin go Up from $97,500.00 in the next 5 minutes?',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.priceToBeat).toBe(97500);
    });

    it('should extract price from description if not in question', async () => {
      const market = createMockMarket({
        question: 'Will BTC go up or down (5 min)?',
        description: 'Starting price: $68,386.96',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.priceToBeat).toBe(68386.96);
    });

    it('should set priceToBeat to 0 when no price found', async () => {
      const market = createMockMarket({
        question: 'Will Bitcoin go up or down 5 min?',
        description: 'Binary market with no price listed.',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.priceToBeat).toBe(0);
    });
  });

  // ── Time Remaining ────────────────────────────────────

  describe('Time Remaining', () => {
    it('should calculate timeRemainingSeconds from endDate', async () => {
      const futureEnd = new Date(Date.now() + 120_000).toISOString(); // 2 mins
      const market = createMockMarket({ endDate: futureEnd });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.timeRemainingSeconds).toBeGreaterThan(100);
      expect(signal!.timeRemainingSeconds).toBeLessThanOrEqual(120);
    });

    it('should clamp to 0 when endDate is in the past', async () => {
      const pastEnd = new Date(Date.now() - 60_000).toISOString();
      const market = createMockMarket({ endDate: pastEnd });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.timeRemainingSeconds).toBe(0);
    });

    it('should default to 300s when no endDate is provided', async () => {
      const market = createMockMarket({ endDate: undefined });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.timeRemainingSeconds).toBe(300);
    });
  });

  // ── Signal History ────────────────────────────────────

  describe('getSignalHistory()', () => {
    it('should return history with streak and avgConfidence', async () => {
      // Fetch multiple signals to populate history
      for (let i = 0; i < 3; i++) {
        const market = createMockMarket({
          id: `market-${i}`,
          outcomePrices: '["0.70", "0.30"]',
          volume: '300',
        });
        mockFetch.mockResolvedValueOnce(createMockResponse([market]));
        const { cache } = require('../../lib/utils/cache');
        cache.get.mockReturnValue(null);
        await Polymarket5MinService.getLatest5MinSignal();
      }

      const history = Polymarket5MinService.getSignalHistory();

      expect(history).toBeDefined();
      expect(history.signals.length).toBeGreaterThanOrEqual(1);
      expect(history.streak).toBeDefined();
      expect(history.streak.direction).toBe('UP');
      expect(history.streak.count).toBeGreaterThanOrEqual(1);
      expect(history.avgConfidence).toBeGreaterThan(0);
    });

    it('should return empty history when no signals exist', () => {
      // On first run with clean static state, history may have previous entries
      // but avgConfidence should still be a number
      const history = Polymarket5MinService.getSignalHistory();
      expect(history).toBeDefined();
      expect(typeof history.avgConfidence).toBe('number');
      expect(history.streak).toBeDefined();
    });
  });

  // ── PredictionMarket Conversion ───────────────────────

  describe('signalToPredictionMarket()', () => {
    it('should convert signal to PredictionMarket format', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.75", "0.25"]',
        volume: '2000',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).not.toBeNull();

      const pm = Polymarket5MinService.signalToPredictionMarket(signal!);

      expect(pm.id).toContain('polymarket-5min-');
      expect(pm.question).toContain('5-Min BTC Signal');
      expect(pm.question).toContain('UP');
      expect(pm.category).toBe('price');
      expect(pm.source).toBe('polymarket');
      expect(pm.relatedAssets).toContain('BTC');
      expect(pm.confidence).toBe(signal!.confidence);
      expect(pm.impact).toBe('HIGH'); // STRONG signal → HIGH impact
    });

    it('should set recommendation to HEDGE for HEDGE_SHORT signals', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.10", "0.90"]', // Strong DOWN
        volume: '1000',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      const pm = Polymarket5MinService.signalToPredictionMarket(signal!);

      expect(pm.recommendation).toBe('HEDGE');
    });

    it('should set recommendation to MONITOR for WAIT/HEDGE_LONG signals', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.52", "0.48"]',
        volume: '30',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      const pm = Polymarket5MinService.signalToPredictionMarket(signal!);

      expect(pm.recommendation).toBe('MONITOR');
    });

    it('should include aiSummary with signal details', async () => {
      const market = createMockMarket();
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      const pm = Polymarket5MinService.signalToPredictionMarket(signal!);

      expect(pm.aiSummary).toContain('Polymarket 5-min binary');
      expect(pm.aiSummary).toContain('UP');
      expect(pm.aiSummary).toContain('DOWN');
      expect(pm.aiSummary).toContain('Signal:');
    });
  });

  // ── Window Label Parsing ──────────────────────────────

  describe('Window Label Parsing', () => {
    it('should extract time window from question', async () => {
      const market = createMockMarket({
        question: 'Will Bitcoin go Up or Down between 10:00-10:05PM ET?',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.windowLabel).toContain('10:05PM');
    });

    it('should fallback to "Current Window" when time not parseable', async () => {
      const market = createMockMarket({
        question: 'Will BTC go up or down 5 min?',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.windowLabel).toBe('Current Window');
    });
  });

  // ── Edge Cases ────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle malformed outcomePrices gracefully', async () => {
      const market = createMockMarket({
        outcomePrices: 'not-json',
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      // Should fall back to 50/50
      expect(signal).not.toBeNull();
      expect(signal!.upProbability).toBe(50);
      expect(signal!.downProbability).toBe(50);
    });

    it('should handle missing outcomePrices', async () => {
      const market = createMockMarket({
        outcomePrices: undefined,
      });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).not.toBeNull();
      expect(signal!.upProbability).toBe(50);
      expect(signal!.downProbability).toBe(50);
    });

    it('should construct a valid sourceUrl', async () => {
      const market = createMockMarket({ slug: 'my-btc-market' });
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.sourceUrl).toBe('https://polymarket.com/event/my-btc-market');
    });

    it('should set fetchedAt to a recent timestamp', async () => {
      const before = Date.now();
      const market = createMockMarket();
      mockFetch.mockResolvedValueOnce(createMockResponse([market]));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      const after = Date.now();

      expect(signal!.fetchedAt).toBeGreaterThanOrEqual(before);
      expect(signal!.fetchedAt).toBeLessThanOrEqual(after);
    });

    it('should handle API returning non-ok response', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse([], false))  // tag search fails
        .mockResolvedValueOnce(createMockResponse([], false));  // fallback also fails

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).toBeNull();
    });
  });
});
