/**
 * Polymarket 5-Minute BTC Signal Service Tests
 *
 * Tests slug-based market discovery, signal parsing, directional logic,
 * confidence scoring, signal strength classification, BTC price fetch,
 * history tracking, and agent integration format.
 *
 * Updated to match the real Polymarket 5-min BTC series:
 *   - Slug pattern: btc-updown-5m-{epoch} (300s-aligned)
 *   - Question format: "Bitcoin Up or Down - February 15, 11:00PM-11:05PM ET"
 *   - No $ price in question; price from Crypto.com API
 *   - Typical volume: $7–$500 per window
 *   - Typical skew: 1–10%
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

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

import {
  Polymarket5MinService,
  FiveMinBTCSignal,
  FiveMinSignalHistory,
} from '../../lib/services/Polymarket5MinService';

// ─── Helpers ────────────────────────────────────────────────────────

/** Compute the slug for the current 5-min window (mirrors service logic) */
function currentWindowSlug(): string {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowEpoch / 300) * 300;
  return `btc-updown-5m-${windowStart}`;
}

function createMockMarket(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'market-5min-001',
    conditionId: 'cond-001',
    slug: currentWindowSlug(),
    question: 'Bitcoin Up or Down - February 15, 11:00PM-11:05PM ET',
    description:
      'This market resolves based on Chainlink BTC/USD price feed.',
    outcomePrices: '["0.62", "0.38"]', // 62% UP, 38% DOWN → 24% skew
    volume: '52',
    volumeNum: '52',
    endDate: new Date(Date.now() + 180_000).toISOString(), // 3 min remaining
    closed: false,
    ...overrides,
  };
}

function createMockResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: jest.fn().mockResolvedValue(data),
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
  } as unknown as Response;
}

function createPriceResponse(btcPrice: number): Response {
  return createMockResponse({
    result: { data: [{ a: btcPrice.toString() }] },
  });
}

/**
 * Setup mockFetch to respond correctly to:
 *  - 4 parallel slug-based lookups (btc-updown-5m-{epoch})
 *  - 1 BTC price fetch from Crypto.com
 *
 * @param market - Market to return when its slug is requested (null → no market)
 * @param btcPrice - BTC/USD price from Crypto.com mock
 */
function setupFetchMocks(
  market: Record<string, unknown> | null = null,
  btcPrice = 97500,
) {
  mockFetch.mockImplementation(
    async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : (input as URL).toString();

      // Crypto.com BTC price endpoint
      if (url.includes('api.crypto.com') || url.includes('get-ticker')) {
        return createPriceResponse(btcPrice);
      }

      // Polymarket slug-based market lookup
      if (url.includes('slug=btc-updown-5m-') && market) {
        const slugMatch = url.match(/slug=(btc-updown-5m-\d+)/);
        if (slugMatch && slugMatch[1] === market.slug) {
          return createMockResponse([market]);
        }
      }

      // Default: empty array (no matching markets)
      return createMockResponse([]);
    },
  );
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Polymarket5MinService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    const { cache } = require('../../lib/utils/cache');
    cache.get.mockReturnValue(null);
  });

  // ── Signal Parsing ────────────────────────────────────

  describe('getLatest5MinSignal()', () => {
    it('should return a valid signal when a 5-min BTC market exists', async () => {
      const mockMarket = createMockMarket();
      setupFetchMocks(mockMarket, 97500);

      const signal = await Polymarket5MinService.getLatest5MinSignal();

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('UP');
      expect(signal!.upProbability).toBe(62);
      expect(signal!.downProbability).toBe(38);
      expect(signal!.probability).toBe(62); // max(up, down)
      expect(signal!.marketId).toBe('market-5min-001');
      expect(signal!.priceToBeat).toBe(97500); // from Crypto.com, not question text
    });

    it('should parse DOWN direction when downProbability > upProbability', async () => {
      const mockMarket = createMockMarket({
        outcomePrices: '["0.35", "0.65"]',
      });
      setupFetchMocks(mockMarket);

      const signal = await Polymarket5MinService.getLatest5MinSignal();

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('DOWN');
      expect(signal!.upProbability).toBe(35);
      expect(signal!.downProbability).toBe(65);
      expect(signal!.probability).toBe(65);
    });

    it('should default to UP when probabilities are exactly equal', async () => {
      const mockMarket = createMockMarket({
        outcomePrices: '["0.50", "0.50"]',
      });
      setupFetchMocks(mockMarket);

      const signal = await Polymarket5MinService.getLatest5MinSignal();

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('UP');
      expect(signal!.upProbability).toBe(50);
      expect(signal!.downProbability).toBe(50);
    });

    it('should return null when no markets are found', async () => {
      setupFetchMocks(null); // No matching market for any slug

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).toBeNull();
    });

    it('should return null on API error and no cached data', async () => {
      // All slug fetches reject
      mockFetch.mockRejectedValue(new Error('Network error'));

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).toBeNull();
    });

    it('should return cached signal when available and fresh', async () => {
      const cachedSignal: FiveMinBTCSignal = {
        marketId: 'cached-001',
        windowLabel: '10:00PM-10:05PM ET',
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
        fetchedAt: Date.now() - 5000, // 5s ago — within 15s TTL
        question:
          'Bitcoin Up or Down - February 15, 10:00PM-10:05PM ET',
        sourceUrl: 'https://polymarket.com/event/cached-001',
      };
      const { cache } = require('../../lib/utils/cache');
      cache.get.mockReturnValueOnce(cachedSignal);

      const signal = await Polymarket5MinService.getLatest5MinSignal();

      expect(signal).not.toBeNull();
      expect(signal!.marketId).toBe('cached-001');
      expect(mockFetch).not.toHaveBeenCalled(); // No API call needed
    });
  });

  // ── Signal Strength Classification ────────────────────

  describe('Signal Strength Classification', () => {
    it('should classify as STRONG when probability skew >= 10 and volume >= 20', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.56", "0.44"]', // 12% skew (>= 10)
        volume: '30', // >= 20
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.signalStrength).toBe('STRONG');
    });

    it('should classify as MODERATE when skew >= 4 (even with low volume)', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.53", "0.47"]', // 6% skew (>= 4)
        volume: '15', // < 20, so not STRONG; < 50
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.signalStrength).toBe('MODERATE');
    });

    it('should classify as MODERATE with high volume even when skew is low', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.51", "0.49"]', // 2% skew (< 4)
        volume: '60', // >= 50
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.signalStrength).toBe('MODERATE');
    });

    it('should classify as WEAK when skew < 4 and volume < 50', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.51", "0.49"]', // 2% skew (< 4)
        volume: '10', // < 50
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.signalStrength).toBe('WEAK');
    });
  });

  // ── Recommendation Logic ──────────────────────────────

  describe('Recommendation Logic', () => {
    it('should recommend HEDGE_SHORT for STRONG DOWN signal', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.40", "0.60"]', // 20% skew, DOWN
        volume: '100',
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.recommendation).toBe('HEDGE_SHORT');
      expect(signal!.direction).toBe('DOWN');
    });

    it('should recommend HEDGE_LONG for STRONG UP signal', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.60", "0.40"]', // 20% skew, UP
        volume: '100',
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.recommendation).toBe('HEDGE_LONG');
      expect(signal!.direction).toBe('UP');
    });

    it('should recommend WAIT for WEAK signals', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.51", "0.49"]', // 2% skew → WEAK
        volume: '10',
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.recommendation).toBe('WAIT');
    });

    it('should recommend hedge for MODERATE signal with maxProb >= 54', async () => {
      // skew=8 (≥4 → MODERATE), but <10 so NOT STRONG.  maxProb=54 → hedge.
      const market = createMockMarket({
        outcomePrices: '["0.54", "0.46"]', // skew=8, maxProb=54
        volume: '15',
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.signalStrength).toBe('MODERATE');
      expect(signal!.recommendation).toBe('HEDGE_LONG');
    });
  });

  // ── Confidence Scoring ────────────────────────────────

  describe('Confidence Scoring', () => {
    it('should calculate confidence as a number between 0 and 95', async () => {
      const market = createMockMarket({ volume: '100' });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.confidence).toBeGreaterThanOrEqual(0);
      expect(signal!.confidence).toBeLessThanOrEqual(95);
    });

    it('should produce higher confidence with larger volume and skew', async () => {
      // High volume + high skew
      const highMarket = createMockMarket({
        outcomePrices: '["0.70", "0.30"]', // 40% skew
        volume: '500',
      });
      setupFetchMocks(highMarket, 97500);
      const highSignal =
        await Polymarket5MinService.getLatest5MinSignal();

      // Reset cache between calls
      const { cache } = require('../../lib/utils/cache');
      cache.get.mockReturnValue(null);
      mockFetch.mockReset();

      // Low volume + low skew
      const lowMarket = createMockMarket({
        outcomePrices: '["0.51", "0.49"]', // 2% skew
        volume: '10',
      });
      setupFetchMocks(lowMarket, 97500);
      const lowSignal =
        await Polymarket5MinService.getLatest5MinSignal();

      expect(highSignal!.confidence).toBeGreaterThan(
        lowSignal!.confidence,
      );
    });
  });

  // ── BTC Price (replaces Price-to-Beat extraction) ─────

  describe('BTC Price Fetch', () => {
    it('should use BTC price from Crypto.com as priceToBeat', async () => {
      const market = createMockMarket();
      setupFetchMocks(market, 102350);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.priceToBeat).toBe(102350);
      expect(signal!.currentPrice).toBe(102350);
    });

    it('should degrade gracefully when BTC price fetch fails', async () => {
      const market = createMockMarket();
      mockFetch.mockImplementation(
        async (input: string | URL | Request) => {
          const url =
            typeof input === 'string'
              ? input
              : (input as URL).toString();
          // Price API throws
          if (
            url.includes('api.crypto.com') ||
            url.includes('get-ticker')
          ) {
            throw new Error('Price API down');
          }
          // Slug lookups succeed
          if (
            url.includes('slug=btc-updown-5m-') &&
            url.includes(market.slug as string)
          ) {
            return createMockResponse([market]);
          }
          return createMockResponse([]);
        },
      );

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).not.toBeNull();
      expect(signal!.priceToBeat).toBe(0);
    });
  });

  // ── Time Remaining ────────────────────────────────────

  describe('Time Remaining', () => {
    it('should calculate timeRemainingSeconds from endDate', async () => {
      const futureEnd = new Date(Date.now() + 120_000).toISOString();
      const market = createMockMarket({ endDate: futureEnd });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.timeRemainingSeconds).toBeGreaterThan(100);
      expect(signal!.timeRemainingSeconds).toBeLessThanOrEqual(120);
    });

    it('should return very low time remaining for market about to close', async () => {
      const barelyFuture = new Date(Date.now() + 1500).toISOString();
      const market = createMockMarket({ endDate: barelyFuture });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).not.toBeNull();
      expect(signal!.timeRemainingSeconds).toBeLessThanOrEqual(2);
    });

    it('should skip markets with no endDate during discovery', async () => {
      // Discovery code: if (!endStr) continue;
      const market = createMockMarket({ endDate: undefined });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).toBeNull();
    });
  });

  // ── Signal History ────────────────────────────────────

  describe('getSignalHistory()', () => {
    it('should return history with streak and avgConfidence', async () => {
      for (let i = 0; i < 3; i++) {
        const market = createMockMarket({
          id: `market-${i}`,
          outcomePrices: '["0.70", "0.30"]',
          volume: '100',
        });
        mockFetch.mockReset();
        setupFetchMocks(market);
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

    it('should return valid history shape when no signals exist', () => {
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
        outcomePrices: '["0.60", "0.40"]', // 20% skew → STRONG
        volume: '200',
      });
      setupFetchMocks(market, 97500);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).not.toBeNull();

      const pm = Polymarket5MinService.signalToPredictionMarket(
        signal!,
      );

      expect(pm.id).toContain('polymarket-5min-');
      expect(pm.question).toContain('5-Min BTC Signal');
      expect(pm.question).toContain('UP');
      expect(pm.question).toContain('BTC @');
      expect(pm.category).toBe('price');
      expect(pm.source).toBe('polymarket');
      expect(pm.relatedAssets).toContain('BTC');
      expect(pm.confidence).toBe(signal!.confidence);
      expect(pm.impact).toBe('HIGH'); // STRONG → HIGH
    });

    it('should set recommendation to HEDGE for HEDGE_SHORT signals', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.40", "0.60"]', // Strong DOWN
        volume: '100',
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      const pm = Polymarket5MinService.signalToPredictionMarket(
        signal!,
      );

      expect(pm.recommendation).toBe('HEDGE');
    });

    it('should set recommendation to MONITOR for WAIT/HEDGE_LONG signals', async () => {
      const market = createMockMarket({
        outcomePrices: '["0.51", "0.49"]', // WEAK
        volume: '10',
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      const pm = Polymarket5MinService.signalToPredictionMarket(
        signal!,
      );

      expect(pm.recommendation).toBe('MONITOR');
    });

    it('should include aiSummary with signal details', async () => {
      const market = createMockMarket();
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      const pm = Polymarket5MinService.signalToPredictionMarket(
        signal!,
      );

      expect(pm.aiSummary).toContain('Polymarket 5-min binary');
      expect(pm.aiSummary).toContain('UP');
      expect(pm.aiSummary).toContain('DOWN');
      expect(pm.aiSummary).toContain('Signal:');
    });
  });

  // ── Window Label Parsing ──────────────────────────────

  describe('Window Label Parsing', () => {
    it('should extract time window from real Polymarket question format', async () => {
      const market = createMockMarket({
        question:
          'Bitcoin Up or Down - February 15, 11:00PM-11:05PM ET',
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.windowLabel).toContain('11:05PM');
    });

    it('should extract date portion when no time range is parseable', async () => {
      const market = createMockMarket({
        question:
          'Bitcoin Up or Down - March 1, late night session',
      });
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.windowLabel).toBe(
        'March 1, late night session',
      );
    });

    it('should fallback to "Current Window" when question has no dash separator', async () => {
      const market = createMockMarket({
        question: 'Will BTC go up or down 5 min?',
      });
      setupFetchMocks(market);

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
      setupFetchMocks(market);

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
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).not.toBeNull();
      expect(signal!.upProbability).toBe(50);
      expect(signal!.downProbability).toBe(50);
    });

    it('should construct a valid sourceUrl from market slug', async () => {
      const market = createMockMarket();
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal!.sourceUrl).toMatch(
        /^https:\/\/polymarket\.com\/event\/btc-updown-5m-\d+$/,
      );
    });

    it('should set fetchedAt to a recent timestamp', async () => {
      const before = Date.now();
      const market = createMockMarket();
      setupFetchMocks(market);

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      const after = Date.now();

      expect(signal!.fetchedAt).toBeGreaterThanOrEqual(before);
      expect(signal!.fetchedAt).toBeLessThanOrEqual(after);
    });

    it('should handle non-ok responses for all slug lookups', async () => {
      mockFetch.mockImplementation(async () =>
        createMockResponse([], false),
      );

      const signal = await Polymarket5MinService.getLatest5MinSignal();
      expect(signal).toBeNull();
    });
  });
});
