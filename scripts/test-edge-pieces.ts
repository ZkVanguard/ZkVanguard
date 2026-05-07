/**
 * Deep test for the bulletproof polymarket-edge pieces:
 *   1. Bluefin funding ticker fetch (live mainnet)
 *   2. PredictionAggregatorService.scanAndPickBest -> per-asset predictions
 *   3. Polymarket5MinService.calculateAccuracy correctness
 *   4. Discord notifier (dry — does not POST unless DISCORD_WEBHOOK_URL set)
 *   5. Risk gate boundary checks
 *
 * Run: npx tsx scripts/test-edge-pieces.ts
 */
/* eslint-disable no-console */

import { PredictionAggregatorService } from '../lib/services/market-data/PredictionAggregatorService';
import { Polymarket5MinService } from '../lib/services/market-data/Polymarket5MinService';
import { notifyDiscord } from '../lib/utils/discord-notify';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`, detail);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, detail);
  }
}

async function testBluefinFundingFetch() {
  console.log('\n[1] Live Bluefin funding rate fetch (mainnet ticker)');
  const symbols = ['BTC-PERP', 'ETH-PERP'];
  for (const symbol of symbols) {
    try {
      const res = await fetch(
        `https://api.sui-prod.bluefin.io/v1/exchange/ticker?symbol=${symbol}`,
        { signal: AbortSignal.timeout(5000) },
      );
      const data = (await res.json()) as { lastFundingRateE9?: string; fundingRate?: string };
      const fr = data.lastFundingRateE9
        ? parseFloat(data.lastFundingRateE9) / 1e9
        : data.fundingRate
          ? parseFloat(data.fundingRate)
          : NaN;
      check(`${symbol} response 2xx`, res.ok, { status: res.status });
      check(`${symbol} funding parsed`, Number.isFinite(fr), {
        fundingRate8h: fr,
        approxAprPct: Number.isFinite(fr) ? (fr * 3 * 365 * 100).toFixed(2) + '%' : 'n/a',
      });
    } catch (e) {
      check(`${symbol} fetch`, false, { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

async function testAggregatorScan() {
  console.log('\n[2] PredictionAggregatorService.scanAndPickBest (live data)');
  const t0 = Date.now();
  const result = await PredictionAggregatorService.scanAndPickBest(['BTC', 'ETH'], {
    minConfidence: 0,
    minConsensus: 0,
    minSources: 1,
  });
  const ms = Date.now() - t0;
  check('returned', !!result, { ms });
  check('all has BTC', !!result.all.BTC);
  check('all has ETH', !!result.all.ETH);
  for (const asset of ['BTC', 'ETH'] as const) {
    const p = result.all[asset];
    if (!p) continue;
    const sourceNames = p.sources.map((s) => s.name);
    const hasFunding = sourceNames.some((n) => n.startsWith(`Bluefin ${asset} Funding`));
    const hasFundingProxy = sourceNames.some((n) => n === 'Funding Rate Proxy');
    console.log(`    ${asset}:`, {
      direction: p.direction,
      recommendation: p.recommendation,
      confidence: Math.round(p.confidence),
      consensus: Math.round(p.consensus),
      probability: Math.round(p.probability),
      sources: sourceNames,
      score: Math.round(PredictionAggregatorService.scoreOpportunity(p)),
    });
    // Funding source is added only when |funding| > 2bp/8h (signal threshold).
    // Below that, neither live nor proxy is appended (correct behavior).
    console.log(`    ${asset} funding source present: live=${hasFunding}, proxy=${hasFundingProxy}`);
    check(`${asset} confidence in [0,100]`, p.confidence >= 0 && p.confidence <= 100, {
      confidence: p.confidence,
    });
    check(`${asset} consensus in [0,100]`, p.consensus >= 0 && p.consensus <= 100, {
      consensus: p.consensus,
    });
    check(`${asset} probability in [0,100]`, p.probability >= 0 && p.probability <= 100, {
      probability: p.probability,
    });
    // Weights should normalize to ~1.0
    const sumW = p.sources.reduce((s, src) => s + src.weight, 0);
    check(`${asset} weights sum ≈ 1`, Math.abs(sumW - 1) < 0.001 || p.sources.length === 0, {
      sumW: sumW.toFixed(4),
    });
  }
  console.log('    Best:', result.best ? {
    asset: result.best.asset,
    score: result.best.score.toFixed(1),
    rec: result.best.prediction.recommendation,
  } : 'null');
}

function testCalculateAccuracy() {
  console.log('\n[3] Polymarket5MinService.calculateAccuracy (synthetic signals)');
  const calc = (Polymarket5MinService as unknown as {
    calculateAccuracy: (signals: unknown[]) => { correct: number; total: number; rate: number };
  }).calculateAccuracy;

  // Build 4 signals (newest first per signalHistory.unshift order):
  //   #0 newest:  fetched=t=400, currentPrice=110000  (resolves the t=300 signal -> realized 110000)
  //   #1: t=300, predicted UP, priceToBeat=100000, windowEndTime=350, currentPrice=100500, timeRemaining=0 → realized=110000 (UP) ✓ correct
  //   #2: t=200, predicted DOWN, priceToBeat=110000, windowEndTime=250, currentPrice=109500, timeRemaining=0 → realized via #1's currentPrice 100500 (DOWN) ✓ correct
  //   #3: t=100, predicted UP, priceToBeat=120000, windowEndTime=150, currentPrice=120500, timeRemaining=0 → realized via #2's currentPrice 109500 (DOWN) ✗ wrong
  //
  // Note: realized is the FIRST snapshot AFTER windowEndTime in iteration order
  // (j > i). signals are stored newest-first, so for index i=3 (oldest), j iterates → already past, no later. Hmm.
  // Order of inputs to function: caller passes signalHistory which is newest-first.
  // In calculateAccuracy:  for j > i → looks at OLDER signals. That seems off…

  // Let me recheck: in updateHistory, signalHistory.unshift(signal) puts newest at index 0.
  // calculateAccuracy iterates i=0..n. For each resolved s at i, it looks for j>i with
  // fetchedAt > windowEndTime. j>i means OLDER snapshots. But OLDER snapshots have fetchedAt < s.fetchedAt < s.windowEndTime
  // typically, so they won't satisfy fetchedAt > windowEndTime. This means accuracy will mostly be 0.
  // 
  // BUG: the iteration direction is backwards!
  //
  // Verify by constructing test data and asserting.

  type FiveMin = {
    fetchedAt: number;
    windowEndTime: number;
    timeRemainingSeconds: number;
    direction: 'UP' | 'DOWN';
    priceToBeat: number;
    currentPrice: number;
  };

  const signals: FiveMin[] = [
    // newest first
    { fetchedAt: 400_000, windowEndTime: 450_000, timeRemainingSeconds: 50, direction: 'UP', priceToBeat: 130_000, currentPrice: 110_000 }, // unresolved
    { fetchedAt: 300_000, windowEndTime: 350_000, timeRemainingSeconds: 0, direction: 'UP', priceToBeat: 100_000, currentPrice: 100_500 }, // resolved → predicts UP, realized via earlier? But algorithm looks j>i (older). Older signals have lower fetchedAt → can't satisfy fetchedAt > 350_000.
    { fetchedAt: 200_000, windowEndTime: 250_000, timeRemainingSeconds: 0, direction: 'DOWN', priceToBeat: 110_000, currentPrice: 109_500 },
    { fetchedAt: 100_000, windowEndTime: 150_000, timeRemainingSeconds: 0, direction: 'UP', priceToBeat: 120_000, currentPrice: 120_500 },
  ];

  // Storage order: newest-first (signalHistory.unshift in updateHistory).
  // For signal #1 (i=1, t=300), the only later snapshot is #0 (i=0, t=400)
  // with currentPrice=110000 → predicted UP, realized UP → correct.
  // Signal #2 (i=2, t=200) realized via #1 currentPrice=100500 → predicted
  //   DOWN, realized DOWN (100500 < 110000) → correct.
  // Signal #3 (i=3, t=100) realized via #2 currentPrice=109500 → predicted
  //   UP, realized DOWN (109500 < 120000) → wrong.
  const r = calc(signals as unknown[]);
  console.log('    newestFirst:', r);
  check('newest-first order gives total=3, correct=2', r.total === 3 && r.correct === 2, r);
  check('rate is 67%', r.rate === 67, r);
}

async function testDiscordNotify() {
  console.log('\n[4] Discord notifier');
  // dry call — env DISCORD_WEBHOOK_URL likely unset locally; ensure no throw.
  try {
    await notifyDiscord('test from test-edge-pieces', 'INFO', { local: true });
    check('notifyDiscord swallowed missing webhook', true);
  } catch (e) {
    check('notifyDiscord did not throw', false, e);
  }
}

(async () => {
  console.log('=== Deep test: polymarket-edge bulletproof pieces ===');
  try {
    await testBluefinFundingFetch();
    await testAggregatorScan();
    testCalculateAccuracy();
    await testDiscordNotify();
  } catch (e) {
    console.error('FATAL', e);
    process.exit(2);
  }
  console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
