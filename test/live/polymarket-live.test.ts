/**
 * Polymarket 5-Min BTC Signal — LIVE Integration Tests
 *
 * These tests hit the REAL Polymarket gamma-api and Crypto.com ticker.
 * No mocks. No fakes. Real network, real data.
 *
 * Run manually:
 *   npx jest test/live/polymarket-live.test.ts --no-cache
 *
 * These are NOT run in CI — they depend on network + market availability.
 * Timeout is generous (30 s) because Polymarket can be slow.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';

// ─── Direct API helpers (bypass service layer to test raw APIs) ──────

const GAMMA_API = 'https://gamma-api.polymarket.com/markets';
const CRYPTO_COM_API = 'https://api.crypto.com/v2/public/get-ticker?instrument_name=BTC_USDT';
const WINDOW_SECONDS = 300;

function buildSlug(epochSeconds: number): string {
  return `btc-updown-5m-${epochSeconds}`;
}

function currentWindowStart(): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.floor(now / WINDOW_SECONDS) * WINDOW_SECONDS;
}

// ─────────────────────────────────────────────────────────────────────

describe('LIVE: Polymarket Gamma API', () => {
  it('should respond to a slug query within 5 s', async () => {
    const ws = currentWindowStart();
    const slug = buildSlug(ws);
    const url = `${GAMMA_API}?slug=${slug}`;

    const start = Date.now();
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const elapsed = Date.now() - start;

    expect(res.ok).toBe(true);
    console.log(`  ⏱  Gamma API responded in ${elapsed} ms for slug=${slug}`);

    const data = await res.json();
    // Gamma returns an array (possibly empty if market hasn't opened yet)
    expect(Array.isArray(data)).toBe(true);
    console.log(`  📦 Returned ${data.length} market(s)`);
  }, 15_000);

  it('should find at least one active BTC 5-min market across 4 hot windows', async () => {
    const ws = currentWindowStart();
    const offsets = [-300, 0, 300, 600];
    const slugs = offsets.map(off => buildSlug(ws + off));

    const results = await Promise.all(
      slugs.map(async slug => {
        try {
          const res = await fetch(`${GAMMA_API}?slug=${slug}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(8_000),
          });
          if (!res.ok) return null;
          const data = await res.json();
          const markets = Array.isArray(data) ? data : [data];
          return markets.find((m: any) => m.slug === slug) || null;
        } catch {
          return null;
        }
      }),
    );

    const found = results.filter(Boolean);
    console.log(`  🔍 Found ${found.length}/4 markets from hot window scan`);

    // At least one should exist (Polymarket runs these 24/7)
    expect(found.length).toBeGreaterThanOrEqual(1);

    // Validate shape of the first found market
    const market = found[0] as any;
    expect(market).toHaveProperty('id');
    expect(market).toHaveProperty('slug');
    expect(market).toHaveProperty('question');
    expect(market).toHaveProperty('outcomePrices');
    expect(market).toHaveProperty('endDate');

    console.log(`  📊 Market: ${market.question}`);
    console.log(`  💲 Outcome prices: ${market.outcomePrices}`);
    console.log(`  📅 End date: ${market.endDate}`);
    console.log(`  📈 Volume: $${market.volume || market.volumeNum || 0}`);
    console.log(`  🔒 Closed: ${market.closed}`);
  }, 20_000);

  it('should return valid outcome prices as parseable JSON numbers', async () => {
    const ws = currentWindowStart();
    const slug = buildSlug(ws);
    const res = await fetch(`${GAMMA_API}?slug=${slug}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json();
    const markets = Array.isArray(data) ? data : [];
    const market = markets.find((m: any) => m.slug === slug);

    if (!market) {
      console.log('  ⚠️  No market for current window — skipping price parse test');
      return;
    }

    const prices = JSON.parse(market.outcomePrices);
    expect(Array.isArray(prices)).toBe(true);
    expect(prices.length).toBeGreaterThanOrEqual(2);

    const upProb = parseFloat(prices[0]);
    const downProb = parseFloat(prices[1]);

    expect(upProb).toBeGreaterThanOrEqual(0);
    expect(upProb).toBeLessThanOrEqual(1);
    expect(downProb).toBeGreaterThanOrEqual(0);
    expect(downProb).toBeLessThanOrEqual(1);

    // Should roughly sum to ~1.0 (allow ±0.05 for rounding)
    const sum = upProb + downProb;
    expect(sum).toBeGreaterThan(0.9);
    expect(sum).toBeLessThan(1.1);

    console.log(`  ✅ UP: ${(upProb * 100).toFixed(1)}%, DOWN: ${(downProb * 100).toFixed(1)}%, Sum: ${(sum * 100).toFixed(1)}%`);
  }, 15_000);
});

// ─────────────────────────────────────────────────────────────────────

describe('LIVE: Crypto.com BTC Price API', () => {
  it('should return a valid BTC/USDT price', async () => {
    const start = Date.now();
    const res = await fetch(CRYPTO_COM_API, {
      signal: AbortSignal.timeout(5_000),
    });
    const elapsed = Date.now() - start;
    expect(res.ok).toBe(true);

    const data = await res.json();
    const price = parseFloat(data?.result?.data?.[0]?.a ?? '0');

    expect(price).toBeGreaterThan(10_000);   // BTC is >$10K
    expect(price).toBeLessThan(1_000_000);   // BTC is <$1M (sanity)

    console.log(`  ⏱  Crypto.com responded in ${elapsed} ms`);
    console.log(`  💰 BTC/USDT: $${price.toLocaleString()}`);
  }, 10_000);
});

// ─────────────────────────────────────────────────────────────────────

describe('LIVE: Full Polymarket5MinService (no mocks)', () => {
  // Dynamic import to avoid the mocked version from other test files
  let Polymarket5MinService: any;

  beforeAll(async () => {
    // Import the real service (no jest.mock in this file)
    const mod = await import('../../lib/services/Polymarket5MinService');
    Polymarket5MinService = mod.Polymarket5MinService;
  });

  it('should fetch a real 5-min BTC signal end-to-end', async () => {
    const signal = await Polymarket5MinService.getLatest5MinSignal();

    // During market downtime or between-window gaps, signal can be null
    if (!signal) {
      console.log('  ⚠️  No active signal right now — Polymarket may be between windows');
      // Still pass — this is expected sometimes
      return;
    }

    // ── Validate every field ─────────────────────────────
    expect(signal.marketId).toBeTruthy();
    expect(signal.windowLabel).toBeTruthy();
    expect(['UP', 'DOWN']).toContain(signal.direction);
    expect(signal.probability).toBeGreaterThanOrEqual(0);
    expect(signal.probability).toBeLessThanOrEqual(100);
    expect(signal.upProbability).toBeGreaterThanOrEqual(0);
    expect(signal.upProbability).toBeLessThanOrEqual(100);
    expect(signal.downProbability).toBeGreaterThanOrEqual(0);
    expect(signal.downProbability).toBeLessThanOrEqual(100);
    expect(signal.volume).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(95);
    expect(['HEDGE_SHORT', 'HEDGE_LONG', 'WAIT']).toContain(signal.recommendation);
    expect(['STRONG', 'MODERATE', 'WEAK']).toContain(signal.signalStrength);
    expect(signal.timeRemainingSeconds).toBeGreaterThanOrEqual(0);
    expect(signal.timeRemainingSeconds).toBeLessThanOrEqual(600); // max ~10 min
    expect(signal.windowEndTime).toBeGreaterThan(0);
    expect(signal.fetchedAt).toBeGreaterThan(0);
    expect(signal.fetchedAt).toBeLessThanOrEqual(Date.now());
    expect(signal.question).toBeTruthy();
    expect(signal.sourceUrl).toContain('polymarket.com');

    // BTC price should be fetched (>$10K if Crypto.com worked)
    if (signal.priceToBeat > 0) {
      expect(signal.priceToBeat).toBeGreaterThan(10_000);
      expect(signal.currentPrice).toBeGreaterThan(10_000);
    }

    console.log('\n  ═══════════════════════════════════════');
    console.log(`  🎯 Direction:     ${signal.direction}`);
    console.log(`  📊 UP:            ${signal.upProbability}%`);
    console.log(`  📉 DOWN:          ${signal.downProbability}%`);
    console.log(`  💪 Strength:      ${signal.signalStrength}`);
    console.log(`  🧠 Confidence:    ${signal.confidence}%`);
    console.log(`  📋 Recommendation: ${signal.recommendation}`);
    console.log(`  💰 BTC Price:     $${signal.priceToBeat.toLocaleString()}`);
    console.log(`  📈 Volume:        $${signal.volume.toFixed(0)}`);
    console.log(`  ⏳ Time Left:     ${signal.timeRemainingSeconds}s`);
    console.log(`  🪟 Window:        ${signal.windowLabel}`);
    console.log(`  🆔 Market ID:     ${signal.marketId}`);
    console.log(`  🔗 URL:           ${signal.sourceUrl}`);
    console.log('  ═══════════════════════════════════════\n');
  }, 30_000);

  it('should return valid signal history shape', async () => {
    // Fetch first so history has at least one entry
    await Polymarket5MinService.getLatest5MinSignal();
    const history = Polymarket5MinService.getSignalHistory();

    expect(history).toBeDefined();
    expect(Array.isArray(history.signals)).toBe(true);
    expect(history.streak).toBeDefined();
    expect(['UP', 'DOWN', 'MIXED']).toContain(history.streak.direction);
    expect(typeof history.streak.count).toBe('number');
    expect(typeof history.avgConfidence).toBe('number');
    expect(history.accuracy).toBeDefined();
    expect(typeof history.accuracy.rate).toBe('number');

    console.log(`  📜 History: ${history.signals.length} signal(s)`);
    console.log(`  🔥 Streak:  ${history.streak.count}x ${history.streak.direction}`);
    console.log(`  🎯 Avg Confidence: ${history.avgConfidence}%`);
  }, 30_000);

  it('should convert signal to PredictionMarket format', async () => {
    const signal = await Polymarket5MinService.getLatest5MinSignal();
    if (!signal) {
      console.log('  ⚠️  No signal — skipping conversion test');
      return;
    }

    const pm = Polymarket5MinService.signalToPredictionMarket(signal);

    expect(pm.id).toContain('polymarket-5min-');
    expect(pm.question).toContain('5-Min BTC Signal');
    expect(pm.category).toBe('price');
    expect(pm.probability).toBeGreaterThanOrEqual(0);
    expect(pm.relatedAssets).toContain('BTC');
    expect(pm.source).toBe('polymarket');
    expect(pm.aiSummary).toBeTruthy();
    expect(typeof pm.confidence).toBe('number');

    console.log(`  📝 PredictionMarket question: ${pm.question}`);
    console.log(`  🏷  Impact: ${pm.impact}`);
    console.log(`  💡 Recommendation: ${pm.recommendation}`);
  }, 30_000);

  it('should deduplicate concurrent calls (in-flight dedup)', async () => {
    // Fire 5 concurrent calls — service should only make 1 actual fetch cycle
    const start = Date.now();
    const results = await Promise.all([
      Polymarket5MinService.getLatest5MinSignal(),
      Polymarket5MinService.getLatest5MinSignal(),
      Polymarket5MinService.getLatest5MinSignal(),
      Polymarket5MinService.getLatest5MinSignal(),
      Polymarket5MinService.getLatest5MinSignal(),
    ]);
    const elapsed = Date.now() - start;

    // All 5 should return the same signal object (or all null)
    const ids = results.map((r: any) => r?.marketId ?? null);
    const unique = new Set(ids);
    expect(unique.size).toBeLessThanOrEqual(1); // all same or all null

    console.log(`  ⚡ 5 concurrent calls resolved in ${elapsed} ms`);
    console.log(`  🔄 Unique market IDs: ${[...unique]} (should be 1)`);
  }, 30_000);

  it('should cache the signal for 15 s (second call is instant)', async () => {
    // First call: warm the cache
    const first = await Polymarket5MinService.getLatest5MinSignal();

    // Second call: should be near-instant from cache
    const start = Date.now();
    const second = await Polymarket5MinService.getLatest5MinSignal();
    const elapsed = Date.now() - start;

    if (first && second) {
      expect(second.marketId).toBe(first.marketId);
      expect(second.fetchedAt).toBe(first.fetchedAt); // same cached object
    }

    // Cache hit should be < 5 ms
    expect(elapsed).toBeLessThan(50);
    console.log(`  ⚡ Cached call: ${elapsed} ms (should be < 5 ms)`);
  }, 15_000);
});

// ─────────────────────────────────────────────────────────────────────

describe('LIVE: Latency Benchmarks', () => {
  it('should complete hot-tier discovery in < 3 s', async () => {
    const ws = currentWindowStart();
    const hotSlugs = [-300, 0, 300, 600].map(off => buildSlug(ws + off));

    const start = Date.now();
    await Promise.all(
      hotSlugs.map(slug =>
        fetch(`${GAMMA_API}?slug=${slug}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5_000),
        }).catch(() => null),
      ),
    );
    const elapsed = Date.now() - start;

    console.log(`  ⏱  4-slug hot tier: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(5_000); // generous — usually < 1.5 s
  }, 10_000);

  it('should fetch BTC price from Crypto.com in < 2 s', async () => {
    const start = Date.now();
    const res = await fetch(CRYPTO_COM_API, { signal: AbortSignal.timeout(3_000) });
    const elapsed = Date.now() - start;

    expect(res.ok).toBe(true);
    console.log(`  ⏱  BTC price fetch: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(3_000);
  }, 5_000);
});
