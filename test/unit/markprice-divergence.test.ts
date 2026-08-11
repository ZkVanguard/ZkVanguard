/**
 * Unit tests for checkMarkPriceDivergence — silent-PnL-corruption barrier.
 *
 * The concern: PR #48's fallback records realizedPnl from BlueFin's own
 * unrealizedPnl (derived from BlueFin's markPrice). If markPrice is
 * stale, PnL is stale too. This helper flags divergence > threshold so
 * ops can spot venue-side issues before they cost meaningful capital.
 */
import { describe, it, expect } from '@jest/globals';
import { checkMarkPriceDivergence } from '@/lib/services/sui/bluefin/markprice-divergence';

describe('checkMarkPriceDivergence', () => {
  describe('warn thresholds', () => {
    it('does NOT warn for tight cross-venue basis (< 1%)', () => {
      // Real BTC-PERP mark vs BTC spot: usually 0.05-0.5% depending on funding
      expect(checkMarkPriceDivergence(64_100, 64_200).warn).toBe(false);
    });

    it('does NOT warn at threshold boundary (exactly 2%)', () => {
      const r = checkMarkPriceDivergence(102, 100);
      expect(r.divergencePct).toBe(2);
      expect(r.warn).toBe(false);
    });

    it('WARNs just above threshold (2.01%)', () => {
      const r = checkMarkPriceDivergence(102.01, 100);
      expect(r.warn).toBe(true);
      expect(r.detail).toContain('$102.0100');
      expect(r.detail).toContain('$100.0000');
    });

    it('WARNs on large divergence (10%)', () => {
      const r = checkMarkPriceDivergence(110, 100);
      expect(r.warn).toBe(true);
      expect(r.divergencePct).toBe(10);
    });

    it('respects custom threshold', () => {
      // Same 3% divergence, but threshold at 5% → no warn
      expect(checkMarkPriceDivergence(103, 100, 5).warn).toBe(false);
      // Threshold at 1% → warn
      expect(checkMarkPriceDivergence(103, 100, 1).warn).toBe(true);
    });

    it('is symmetric — undershoot flagged equally', () => {
      const up = checkMarkPriceDivergence(105, 100);
      const down = checkMarkPriceDivergence(100, 105);
      expect(up.warn).toBe(down.warn);
    });
  });

  describe('boundary + sanity', () => {
    it('returns no warn when either input is invalid', () => {
      expect(checkMarkPriceDivergence(0, 100).warn).toBe(false);
      expect(checkMarkPriceDivergence(100, 0).warn).toBe(false);
      expect(checkMarkPriceDivergence(NaN, 100).warn).toBe(false);
      expect(checkMarkPriceDivergence(100, NaN).warn).toBe(false);
      expect(checkMarkPriceDivergence(-1, 100).warn).toBe(false);
      expect(checkMarkPriceDivergence(100, -1).warn).toBe(false);
    });

    it('empty detail string when not warning', () => {
      expect(checkMarkPriceDivergence(100, 100).detail).toBe('');
    });
  });
});
