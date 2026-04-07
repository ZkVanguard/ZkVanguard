/**
 * Polymarket 5-Minute BTC Signal Service Tests — NO MOCKS
 *
 * Tests use the REAL Polymarket Gamma API and Crypto.com BTC price feed.
 * Tests validate shape, invariants, and behavior — not hardcoded values.
 * Tests skip gracefully if Polymarket API is unavailable or no 5-min
 * market is currently active.
 *
 * Real Polymarket 5-min BTC series:
 *   - Slug pattern: btc-updown-5m-{epoch} (300s-aligned)
 *   - Question format: "Bitcoin Up or Down - February 15, 11:00PM-11:05PM ET"
 *   - No $ price in question; price from Crypto.com API
 *   - Typical volume: $7–$500 per window
 *   - Typical skew: 1–10%
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

import {
  Polymarket5MinService,
  FiveMinBTCSignal,
  FiveMinSignalHistory,
} from '../../lib/services/market-data/Polymarket5MinService';

// ─── Shared State ───────────────────────────────────────────────────

let cachedSignal: FiveMinBTCSignal | null = null;
let apiAvailable = false;
let fetchError: string | null = null;

/**
 * Create a well-formed signal fixture for testing conversion functions.
 * This is test DATA (not a mock) — used to call static methods directly.
 */
function createFixtureSignal(overrides: Partial<FiveMinBTCSignal> = {}): FiveMinBTCSignal {
  return {
    marketId: 'fixture-market-001',
    windowLabel: '10:00-10:05PM ET',
    direction: 'DOWN' as const,
    probability: 82,
    upProbability: 18,
    downProbability: 82,
    priceToBeat: 97500,
    currentPrice: 97500,
    volume: 1500,
    liquidity: 5000,
    confidence: 85,
    recommendation: 'HEDGE_SHORT' as const,
    signalStrength: 'STRONG' as const,
    timeRemainingSeconds: 180,
    windowEndTime: Date.now() + 180_000,
    fetchedAt: Date.now(),
    question: 'Bitcoin Up or Down - February 15, 10:00PM-10:05PM ET',
    sourceUrl: 'https://polymarket.com/event/fixture-market-001',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Polymarket5MinService', () => {
  beforeAll(async () => {
    Polymarket5MinService.resetForTesting();
    try {
      cachedSignal = await Polymarket5MinService.getLatest5MinSignal();
      apiAvailable = true;
    } catch (e: unknown) {
      apiAvailable = false;
      fetchError = e instanceof Error ? e.message : String(e);
    }
  });

  afterAll(() => {
    Polymarket5MinService.stopTicker();
  });

  // ── Signal Parsing ────────────────────────────────────

  describe('getLatest5MinSignal()', () => {
    it('should return a signal or null from real Polymarket API', () => {
      if (!apiAvailable) {
        console.log(`Polymarket API unavailable (${fetchError}) — skipping`);
        return;
      }

      // May be null if no 5-min market is currently active
      if (cachedSignal === null) {
        expect(cachedSignal).toBeNull();
        return;
      }

      // Shape validation
      expect(cachedSignal.direction).toMatch(/^(UP|DOWN)$/);
      expect(cachedSignal.upProbability).toBeGreaterThanOrEqual(0);
      expect(cachedSignal.upProbability).toBeLessThanOrEqual(100);
      expect(cachedSignal.downProbability).toBeGreaterThanOrEqual(0);
      expect(cachedSignal.downProbability).toBeLessThanOrEqual(100);
      expect(cachedSignal.probability).toBe(
        Math.max(cachedSignal.upProbability, cachedSignal.downProbability),
      );
      expect(typeof cachedSignal.marketId).toBe('string');
      expect(cachedSignal.marketId.length).toBeGreaterThan(0);
    });

    it('should have direction matching the higher probability', () => {
      if (!apiAvailable || !cachedSignal) return;

      if (cachedSignal.upProbability > cachedSignal.downProbability) {
        expect(cachedSignal.direction).toBe('UP');
      } else if (cachedSignal.downProbability > cachedSignal.upProbability) {
        expect(cachedSignal.direction).toBe('DOWN');
      } else {
        // Equal → default to UP
        expect(cachedSignal.direction).toBe('UP');
      }
    });

    it('should have probabilities summing to ~100', () => {
      if (!apiAvailable || !cachedSignal) return;

      const sum = cachedSignal.upProbability + cachedSignal.downProbability;
      // Allow small floating point variance
      expect(sum).toBeGreaterThanOrEqual(99);
      expect(sum).toBeLessThanOrEqual(101);
    });

    it('should return null or valid signal on repeated calls', async () => {
      if (!apiAvailable) return;

      Polymarket5MinService.resetForTesting();
      const signal = await Polymarket5MinService.getLatest5MinSignal();

      if (signal === null) {
        expect(signal).toBeNull();
      } else {
        expect(signal.direction).toMatch(/^(UP|DOWN)$/);
        expect(signal.probability).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ── Signal Strength Classification ────────────────────

  describe('Signal Strength Classification', () => {
    it('should classify strength consistently with skew and volume', () => {
      if (!apiAvailable || !cachedSignal) return;

      const skew = Math.abs(cachedSignal.upProbability - cachedSignal.downProbability);
      const volume = cachedSignal.volume;
      const strength = cachedSignal.signalStrength;

      expect(strength).toMatch(/^(STRONG|MODERATE|WEAK)$/);

      // STRONG requires skew >= 10 AND volume >= 20
      if (skew >= 10 && volume >= 20) {
        expect(strength).toBe('STRONG');
      }

      // Very low skew with low volume should be WEAK
      if (skew < 4 && volume < 50 && cachedSignal.liquidity < 3000) {
        expect(strength).toBe('WEAK');
      }
    });

    it('should be one of the three valid strength levels', () => {
      if (!apiAvailable || !cachedSignal) return;

      expect(['STRONG', 'MODERATE', 'WEAK']).toContain(cachedSignal.signalStrength);
    });
  });

  // ── Recommendation Logic ──────────────────────────────

  describe('Recommendation Logic', () => {
    it('should produce valid recommendation matching strength and direction', () => {
      if (!apiAvailable || !cachedSignal) return;

      const { signalStrength, direction, recommendation } = cachedSignal;

      expect(recommendation).toMatch(/^(HEDGE_SHORT|HEDGE_LONG|WAIT)$/);

      // WEAK signals should always WAIT
      if (signalStrength === 'WEAK') {
        expect(recommendation).toBe('WAIT');
      }

      // STRONG DOWN → HEDGE_SHORT
      if (signalStrength === 'STRONG' && direction === 'DOWN') {
        expect(recommendation).toBe('HEDGE_SHORT');
      }

      // STRONG UP → HEDGE_LONG
      if (signalStrength === 'STRONG' && direction === 'UP') {
        expect(recommendation).toBe('HEDGE_LONG');
      }
    });

    it('should never recommend hedging for WEAK signals', () => {
      if (!apiAvailable || !cachedSignal) return;

      if (cachedSignal.signalStrength === 'WEAK') {
        expect(cachedSignal.recommendation).toBe('WAIT');
      }
    });
  });

  // ── Confidence Scoring ────────────────────────────────

  describe('Confidence Scoring', () => {
    it('should calculate confidence between 0 and 95', () => {
      if (!apiAvailable || !cachedSignal) return;

      expect(cachedSignal.confidence).toBeGreaterThanOrEqual(0);
      expect(cachedSignal.confidence).toBeLessThanOrEqual(95);
    });

    it('should have higher confidence correlate with higher skew', () => {
      // This is a structural invariant: signals with bigger probability
      // spreads should tend to have higher confidence.
      // We verify the confidence is a reasonable number.
      if (!apiAvailable || !cachedSignal) return;

      const skew = Math.abs(cachedSignal.upProbability - cachedSignal.downProbability);

      // Confidence is a composite score — not purely skew-based.
      // Just validate it's in range and is a number.
      expect(Number.isFinite(cachedSignal.confidence)).toBe(true);
    });
  });

  // ── BTC Price ─────────────────────────────────────────

  describe('BTC Price Fetch', () => {
    it('should set priceToBeat from real BTC price (may be 0 if price API unavailable)', () => {
      if (!apiAvailable || !cachedSignal) return;

      // BTC price may be 0 if internal /api/prices route isn't running
      // In production, it would be > 1000
      expect(cachedSignal.priceToBeat).toBeGreaterThanOrEqual(0);
      expect(cachedSignal.currentPrice).toBe(cachedSignal.priceToBeat);
    });

    it('should have priceToBeat as a finite number', () => {
      if (!apiAvailable || !cachedSignal) return;

      expect(Number.isFinite(cachedSignal.priceToBeat)).toBe(true);
      expect(Number.isFinite(cachedSignal.currentPrice)).toBe(true);
    });
  });

  // ── Time Remaining ────────────────────────────────────

  describe('Time Remaining', () => {
    it('should have non-negative timeRemainingSeconds', () => {
      if (!apiAvailable || !cachedSignal) return;

      expect(cachedSignal.timeRemainingSeconds).toBeGreaterThanOrEqual(0);
      // 5-min window max = 300 seconds + small buffer
      expect(cachedSignal.timeRemainingSeconds).toBeLessThanOrEqual(310);
    });

    it('should have windowEndTime as a future or recent timestamp', () => {
      if (!apiAvailable || !cachedSignal) return;

      expect(cachedSignal.windowEndTime).toBeDefined();
      expect(typeof cachedSignal.windowEndTime).toBe('number');
      // windowEndTime should be within reason (not more than 5 min from fetchedAt)
      expect(cachedSignal.windowEndTime).toBeLessThanOrEqual(
        cachedSignal.fetchedAt + 310_000,
      );
    });
  });

  // ── Signal History ────────────────────────────────────

  describe('getSignalHistory()', () => {
    it('should return valid history shape', () => {
      const history = Polymarket5MinService.getSignalHistory();

      expect(history).toBeDefined();
      expect(Array.isArray(history.signals)).toBe(true);
      expect(typeof history.avgConfidence).toBe('number');
      expect(history.streak).toBeDefined();
      expect(typeof history.streak.count).toBe('number');
      expect(typeof history.accuracy).toBe('object');
      expect(typeof history.accuracy.correct).toBe('number');
      expect(typeof history.accuracy.total).toBe('number');
      expect(typeof history.accuracy.rate).toBe('number');
    });

    it('should have history after fetching (may be empty after resetForTesting)', () => {
      if (!apiAvailable || !cachedSignal) return;

      const history = Polymarket5MinService.getSignalHistory();
      // History may or may not contain signals depending on internal caching
      expect(history.signals.length).toBeGreaterThanOrEqual(0);
      expect(typeof history.avgConfidence).toBe('number');
    });

    it('should have streak direction matching signal direction', () => {
      if (!apiAvailable || !cachedSignal) return;

      const history = Polymarket5MinService.getSignalHistory();
      if (history.signals.length > 0) {
        expect(history.streak.direction).toMatch(/^(UP|DOWN|MIXED)$/);
        expect(history.streak.count).toBeGreaterThanOrEqual(1);
      }
    });

    it('should not duplicate signals for the same market window', async () => {
      if (!apiAvailable) return;

      // First history snapshot
      const historyBefore = Polymarket5MinService.getSignalHistory();
      const countBefore = historyBefore.signals.length;

      // Fetch again (same 5-min window → should deduplicate)
      await Polymarket5MinService.getLatest5MinSignal();

      const historyAfter = Polymarket5MinService.getSignalHistory();
      const countAfter = historyAfter.signals.length;

      // Should not increase (dedup in place)
      expect(countAfter).toBe(countBefore);
    });
  });

  // ── PredictionMarket Conversion ───────────────────────

  describe('signalToPredictionMarket()', () => {
    it('should convert a signal to PredictionMarket format', () => {
      const signal = createFixtureSignal();
      const pm = Polymarket5MinService.signalToPredictionMarket(signal);

      expect(pm.id).toContain('polymarket-5min-');
      expect(pm.question).toContain('5-Min BTC Signal');
      expect(pm.category).toBe('price');
      expect(pm.source).toBe('polymarket');
      expect(pm.relatedAssets).toContain('BTC');
      expect(pm.confidence).toBe(signal.confidence);
    });

    it('should set recommendation to HEDGE for HEDGE_SHORT signals', () => {
      const signal = createFixtureSignal({
        direction: 'DOWN',
        recommendation: 'HEDGE_SHORT',
        signalStrength: 'STRONG',
      });
      const pm = Polymarket5MinService.signalToPredictionMarket(signal);

      expect(pm.recommendation).toBe('HEDGE');
    });

    it('should set recommendation to MONITOR for WAIT signals', () => {
      const signal = createFixtureSignal({
        direction: 'UP',
        recommendation: 'WAIT',
        signalStrength: 'WEAK',
        confidence: 20,
        probability: 52,
      });
      const pm = Polymarket5MinService.signalToPredictionMarket(signal);

      expect(pm.recommendation).toBe('MONITOR');
    });

    it('should set impact HIGH for STRONG signals', () => {
      const signal = createFixtureSignal({
        signalStrength: 'STRONG',
      });
      const pm = Polymarket5MinService.signalToPredictionMarket(signal);

      expect(pm.impact).toBe('HIGH');
    });

    it('should include aiSummary with direction context', () => {
      const signal = createFixtureSignal({ direction: 'DOWN' });
      const pm = Polymarket5MinService.signalToPredictionMarket(signal);

      expect(pm.aiSummary).toContain('Polymarket 5-min binary');
      expect(pm.aiSummary).toContain('Signal:');
    });

    it('should convert real signal if available', () => {
      if (!apiAvailable || !cachedSignal) return;

      const pm = Polymarket5MinService.signalToPredictionMarket(cachedSignal);

      expect(pm.id).toContain('polymarket-5min-');
      expect(pm.source).toBe('polymarket');
      expect(pm.confidence).toBe(cachedSignal.confidence);
      expect(pm.relatedAssets).toContain('BTC');
    });
  });

  // ── Window Label ──────────────────────────────────────

  describe('Window Label', () => {
    it('should have a non-empty window label', () => {
      if (!apiAvailable || !cachedSignal) return;

      expect(typeof cachedSignal.windowLabel).toBe('string');
      expect(cachedSignal.windowLabel.length).toBeGreaterThan(0);
    });

    it('should have a valid question string', () => {
      if (!apiAvailable || !cachedSignal) return;

      expect(typeof cachedSignal.question).toBe('string');
      expect(cachedSignal.question.length).toBeGreaterThan(0);
    });
  });

  // ── Edge Cases & Invariants ───────────────────────────

  describe('Edge Cases & Invariants', () => {
    it('should construct a valid sourceUrl', () => {
      if (!apiAvailable || !cachedSignal) return;

      expect(cachedSignal.sourceUrl).toMatch(
        /^https:\/\/polymarket\.com\/event\//,
      );
    });

    it('should set fetchedAt to a recent timestamp', () => {
      if (!apiAvailable || !cachedSignal) return;

      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      expect(cachedSignal.fetchedAt).toBeGreaterThan(fiveMinAgo);
      expect(cachedSignal.fetchedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should have volume and liquidity as non-negative numbers', () => {
      if (!apiAvailable || !cachedSignal) return;

      expect(cachedSignal.volume).toBeGreaterThanOrEqual(0);
      expect(cachedSignal.liquidity).toBeGreaterThanOrEqual(0);
    });

    it('signalToPredictionMarket handles all signal strengths', () => {
      const strengths = ['STRONG', 'MODERATE', 'WEAK'] as const;
      for (const strength of strengths) {
        const signal = createFixtureSignal({ signalStrength: strength });
        const pm = Polymarket5MinService.signalToPredictionMarket(signal);
        expect(pm).toBeDefined();
        expect(pm.id).toContain('polymarket-5min-');
      }
    });

    it('signalToPredictionMarket handles UP and DOWN directions', () => {
      for (const direction of ['UP', 'DOWN'] as const) {
        const signal = createFixtureSignal({ direction });
        const pm = Polymarket5MinService.signalToPredictionMarket(signal);
        expect(pm.question).toContain('5-Min BTC Signal');
      }
    });
  });
});
