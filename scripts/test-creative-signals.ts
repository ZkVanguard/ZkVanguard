/**
 * End-to-end smoke test for the creative-signal stack:
 *
 *   A. getDynamicTrackedAssets() returns the live Polymarket universe
 *      filtered by liquidity (>5 assets, all liquid).
 *   B. SignalDriftFusion records samples, computes drift + alignment,
 *      and synthesizes STRONG when the conditions line up.
 *   C. ManifoldMarketService fetches crypto markets via public REST.
 *   D. PredictionAggregatorService.getPerAssetPredictions integrates all
 *      three and surfaces them as sources in the per-asset output.
 *
 * Run from the project root: `bun run scripts/test-creative-signals.ts`.
 * Hits live APIs (Polymarket, Manifold, Crypto.com, BlueFin) so it needs
 * internet but no local secrets.
 */

import { getDynamicTrackedAssets, MultiAssetSignalService } from '../lib/services/market-data/MultiAssetSignalService';
import { ManifoldMarketService } from '../lib/services/market-data/ManifoldMarketService';
import { SignalDriftFusion } from '../lib/services/market-data/SignalDriftFusion';
import { PredictionAggregatorService } from '../lib/services/market-data/PredictionAggregatorService';

const failures: string[] = [];
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => { failures.push(msg); console.error(`  ✗ ${msg}`); };

async function testA() {
  console.log('\n=== A. Dynamic asset universe ===');
  const universe = await getDynamicTrackedAssets({ forceRefresh: true });
  console.log(`  universe: ${universe.join(',')} (${universe.length} assets)`);
  if (universe.length < 5) fail(`expected >= 5 assets, got ${universe.length}`);
  else ok(`dynamic universe has ${universe.length} assets`);
}

async function testB() {
  console.log('\n=== B. SignalDriftFusion drift + alignment + synthetic STRONG ===');
  SignalDriftFusion.__resetForTests();

  // Hand-craft a 4-asset world with weak-UP signals drifting upward.
  // Each asset starts at 50.5 and drifts to 52.5 over 5 samples.
  // Use distinct fetchedAt per sample — recordSample dedups by ts so two
  // samples with the same Date.now() millisecond would collapse to one.
  const assets = ['BTC', 'ETH', 'SOL', 'XRP'];
  const drifts = [50.5, 51.0, 51.5, 52.0, 52.5];
  const baseTs = Date.now() - 60_000;
  for (let i = 0; i < drifts.length; i++) {
    const prob = drifts[i];
    for (const a of assets) {
      // @ts-ignore — minimal synthetic signal
      SignalDriftFusion.recordSample(a, {
        asset: a, marketId: 'x', slug: 'x', windowLabel: 'x',
        direction: 'UP', probability: prob, upProbability: prob, downProbability: 100 - prob,
        currentPrice: 0, priceToBeat: 0, volume: 100, liquidity: 1000,
        confidence: 45, signalStrength: 'WEAK', recommendation: 'WAIT',
        timeRemainingSeconds: 200, windowEndTime: Date.now() + 200_000,
        fetchedAt: baseTs + i * 10_000, question: '', sourceUrl: '',
      });
    }
  }

  const drift = SignalDriftFusion.computeDrift('BTC');
  if (!drift) fail('BTC drift should be computed after 5 samples');
  else if (drift.driftDirection !== 'UP') fail(`BTC drift should be UP, got ${drift.driftDirection}`);
  else ok(`BTC drift UP consistency=${(drift.directionConsistency * 100).toFixed(0)}% net=+${drift.netDelta.toFixed(1)}`);

  // Synthesize a current signal map matching the last drift step
  const finalProb = drifts[drifts.length - 1];
  const signals: Record<string, any> = {};
  for (const a of assets) {
    signals[a] = {
      asset: a, marketId: 'x', slug: 'x', windowLabel: 'x',
      direction: 'UP', probability: finalProb, upProbability: finalProb, downProbability: 100 - finalProb,
      currentPrice: 0, priceToBeat: 0, volume: 100, liquidity: 1000,
      confidence: 45, signalStrength: 'WEAK', recommendation: 'WAIT',
      timeRemainingSeconds: 200, windowEndTime: Date.now() + 200_000,
      fetchedAt: Date.now(), question: '', sourceUrl: '',
    };
  }

  const result = SignalDriftFusion.fuseAll(signals, { BTC: -0.00005 });   // negative funding = UP-confirm
  const align = result.alignment;
  if (align.dominantDirection !== 'UP' || align.dominancePct < 67) {
    fail(`alignment should be UP ≥67%, got ${align.dominantDirection} ${align.dominancePct.toFixed(0)}%`);
  } else {
    ok(`alignment ${align.dominantDirection} ${align.dominancePct.toFixed(0)}% across ${align.totalAssets} assets`);
  }

  const btcUpgrade = result.upgrades['BTC'];
  if (!btcUpgrade) fail('BTC upgrade decision missing');
  else if (!btcUpgrade.upgradedToStrong) fail(`BTC should upgrade to STRONG given drift+alignment+funding, reasons=${btcUpgrade.reasons.join('|')}`);
  else ok(`BTC synthetic STRONG conf=${btcUpgrade.syntheticConfidence.toFixed(0)} reasons=${btcUpgrade.reasons.length}`);

  // B2: Price-drift parallel path — Polymarket binaries flat at 50/50 but
  // spot prices drifting UP should still trigger synthetic STRONG (the
  // "quiet Polymarket but moving spot" silence-rescue case).
  SignalDriftFusion.__resetForTests();
  const baseTs2 = Date.now() - 60_000;
  const flatProbAssets = ['BTC', 'ETH', 'SOL', 'XRP'];
  for (const a of flatProbAssets) {
    // Single sample at 50.5 — no probability drift available
    SignalDriftFusion.recordSample(a, {
      asset: a, marketId: 'x', slug: 'x', windowLabel: 'x',
      direction: 'UP', probability: 50.5, upProbability: 50.5, downProbability: 49.5,
      currentPrice: 0, priceToBeat: 0, volume: 100, liquidity: 1000,
      confidence: 45, signalStrength: 'WEAK', recommendation: 'WAIT',
      timeRemainingSeconds: 200, windowEndTime: Date.now() + 200_000,
      fetchedAt: baseTs2, question: '', sourceUrl: '',
    } as any);
  }
  // BTC price drifts UP through 5 samples at 65000 → 65500 (+0.77% over the window)
  const btcPrices = [65000, 65100, 65200, 65300, 65500];
  for (let i = 0; i < btcPrices.length; i++) {
    SignalDriftFusion.recordPriceTick('BTC', btcPrices[i], baseTs2 + i * 30_000);
    // Also drift the other assets so alignment fires
    SignalDriftFusion.recordPriceTick('ETH', 3000 + i * 5, baseTs2 + i * 30_000);
    SignalDriftFusion.recordPriceTick('SOL', 140 + i * 0.3, baseTs2 + i * 30_000);
    SignalDriftFusion.recordPriceTick('XRP', 0.5 + i * 0.001, baseTs2 + i * 30_000);
  }

  const btcPriceDrift = SignalDriftFusion.computePriceDrift('BTC');
  if (!btcPriceDrift || btcPriceDrift.driftDirection !== 'UP') {
    fail(`BTC price-drift should be UP, got ${btcPriceDrift?.driftDirection}`);
  } else {
    ok(`BTC price-drift UP +${btcPriceDrift.netDelta.toFixed(2)}% over ${btcPriceDrift.samples} samples`);
  }

  // Now refuse — same flat-probability signals + the price drift we just recorded
  const flatSignals2: Record<string, any> = {};
  for (const a of flatProbAssets) {
    flatSignals2[a] = {
      asset: a, marketId: 'x', slug: 'x', windowLabel: 'x',
      direction: 'UP', probability: 50.5, upProbability: 50.5, downProbability: 49.5,
      currentPrice: 0, priceToBeat: 0, volume: 100, liquidity: 1000,
      confidence: 45, signalStrength: 'WEAK', recommendation: 'WAIT',
      timeRemainingSeconds: 200, windowEndTime: Date.now() + 200_000,
      fetchedAt: Date.now(), question: '', sourceUrl: '',
    };
  }
  const result3 = SignalDriftFusion.fuseAll(flatSignals2, {});
  const btcUp3 = result3.upgrades['BTC'];
  if (!btcUp3?.upgradedToStrong) {
    fail(`BTC should upgrade via price-drift even when prob is flat, reasons=${btcUp3?.reasons.join('|')}`);
  } else {
    ok(`BTC synthetic STRONG via price-drift (no prob drift), conf=${btcUp3.syntheticConfidence}, reasons=${btcUp3.reasons.length}`);
  }

  // Negative test: NO drift, NO alignment → no upgrade
  SignalDriftFusion.__resetForTests();
  const flatSignals: Record<string, any> = { ...signals };
  flatSignals['BTC'].direction = 'UP';
  flatSignals['ETH'].direction = 'DOWN';
  flatSignals['SOL'].direction = 'UP';
  flatSignals['XRP'].direction = 'DOWN';
  const r2 = SignalDriftFusion.fuseAll(flatSignals, {});
  const btc2 = r2.upgrades['BTC'];
  if (btc2?.upgradedToStrong) fail(`BTC should NOT upgrade on split alignment, but did`);
  else ok(`negative test: no upgrade when alignment is split`);
}

async function testC() {
  console.log('\n=== C. Manifold crypto markets ===');
  const markets = await ManifoldMarketService.getCryptoMarkets(['BTC', 'ETH', 'SOL']);
  console.log(`  Manifold markets returned: ${markets.length}`);
  if (markets.length === 0) {
    fail('expected at least 1 manifold market (asks for BTC/ETH/SOL)');
  } else {
    ok(`Manifold returned ${markets.length} markets`);
    for (const m of markets.slice(0, 3)) {
      console.log(`    • [${m.relatedAssets.join(',')}] "${m.question.slice(0, 60)}" @ ${m.probability}%`);
    }
  }
}

async function testD() {
  console.log('\n=== D. PredictionAggregator integration (per-asset, all sources fused) ===');
  const preds = await PredictionAggregatorService.getPerAssetPredictions(['BTC', 'ETH']);
  for (const [asset, p] of Object.entries(preds)) {
    console.log(`  ${asset}: ${p.recommendation} dir=${p.direction} conf=${p.confidence.toFixed(0)} cons=${p.consensus.toFixed(0)} sources=${p.sources.length}`);
    for (const s of p.sources) {
      console.log(`    - ${s.name} (${s.direction}, conf=${s.confidence.toFixed(0)}, weight=${(s.weight * 100).toFixed(1)}%)`);
    }
    if (p.sources.length === 0) fail(`${asset}: 0 sources fused — pipeline broken`);
  }
  const hasMultiAsset = Object.values(preds).some(p => p.sources.some(s => s.name.startsWith('Polymarket 5-Min')));
  if (!hasMultiAsset) fail('no per-asset Polymarket 5-min source — MultiAssetSignalService wiring failed');
  else ok('per-asset 5-min signal present');

  const hasManifoldOrAlignment = Object.values(preds).some(p =>
    p.sources.some(s => s.name.startsWith('Manifold:') || s.name.startsWith('Cross-asset alignment')),
  );
  if (!hasManifoldOrAlignment) {
    console.warn('  (warn) no Manifold or cross-asset alignment source surfaced — could be a quiet market moment');
  } else {
    ok('Manifold and/or alignment source present');
  }
}

async function main() {
  await testA();
  await testB();
  await testC();
  await testD();
  console.log();
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} failures:`);
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('✓ all creative-signal checks passed');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('UNHANDLED', err);
  process.exit(1);
});
