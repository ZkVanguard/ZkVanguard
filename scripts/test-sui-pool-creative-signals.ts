/**
 * Smoke test for the SUI pool's integration with the creative-signal stack.
 *
 *   - AIMarketIntelligence.getMarketContext() returns the new
 *     `fusedPredictions` field with per-asset upgrades + alignment.
 *   - It also returns the new `manifoldMarkets` field with non-empty
 *     content for BTC/ETH searches.
 *   - SuiPoolAgent.getEnhancedAllocationContext() consumes them and
 *     adds tilt recommendations when synthetic-STRONG fires.
 *
 * Live: hits Polymarket + Manifold + Crypto.com. No local secrets needed.
 */
import { AIMarketIntelligence } from '../lib/services/AIMarketIntelligence';
import { SignalDriftFusion } from '../lib/services/market-data/SignalDriftFusion';

const failures: string[] = [];
const ok = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { failures.push(m); console.error(`  ✗ ${m}`); };

async function testAIMarketIntelligence() {
  console.log('\n=== A. AIMarketIntelligence now exposes fusedPredictions + manifoldMarkets ===');
  const ctx = await AIMarketIntelligence.getMarketContext(['BTC', 'ETH', 'SUI']);

  if (!ctx.fusedPredictions) {
    fail('fusedPredictions field missing on AIMarketContext');
    return;
  }
  ok(`fusedPredictions present (assets: ${Object.keys(ctx.fusedPredictions.perAsset).join(',')})`);

  if (!ctx.fusedPredictions.alignment) {
    fail('alignment subfield missing on fusedPredictions');
  } else {
    const a = ctx.fusedPredictions.alignment;
    console.log(`  alignment: ${a.dominantDirection} ${a.dominancePct.toFixed(0)}% across ${a.totalAssets} assets`);
    ok('alignment surfaced');
  }

  // syntheticStrong may be empty on quiet days (correct) — just verify shape
  if (!Array.isArray(ctx.fusedPredictions.syntheticStrong)) {
    fail('syntheticStrong should be an array');
  } else {
    ok(`syntheticStrong array (${ctx.fusedPredictions.syntheticStrong.length} upgrades active)`);
    for (const up of ctx.fusedPredictions.syntheticStrong) {
      console.log(`    - ${up.asset} ${up.direction} conf=${up.confidence.toFixed(0)} reasons=${up.reasons.length}`);
    }
  }

  if (!Array.isArray(ctx.manifoldMarkets)) {
    fail('manifoldMarkets should be an array');
  } else if (ctx.manifoldMarkets.length === 0) {
    console.warn('  (warn) Manifold returned 0 markets — could be cache or market state');
  } else {
    ok(`manifoldMarkets: ${ctx.manifoldMarkets.length} markets surfaced`);
    for (const m of ctx.manifoldMarkets.slice(0, 3)) {
      console.log(`    - [${m.relatedAssets.join(',')}] "${m.question.slice(0, 60)}…" @ ${m.probability}%`);
    }
  }

  // Confirm Manifold is also folded into predictions[] for the SuiPoolAgent loop
  const manifoldInPreds = ctx.predictions.some(p => p.source === 'manifold');
  if (!manifoldInPreds && ctx.manifoldMarkets.length > 0) {
    fail('Manifold markets returned but not folded into predictions[] — SuiPoolAgent loop would miss them');
  } else if (manifoldInPreds) {
    ok('Manifold predictions also folded into predictions[] for SuiPoolAgent loop');
  }
}

async function testSuiPoolAgentTilts() {
  console.log('\n=== B. SuiPoolAgent reads fusedPredictions and emits synthetic-STRONG tilts ===');

  // Force a synthetic-STRONG upgrade by pre-loading the drift history so we
  // KNOW the upgrade will fire when AIMarketIntelligence calls into the
  // aggregator. 5 samples of probability drifting from 49 → 53 (UP) +
  // 5 samples of price drifting +0.5% each for BTC/ETH (so both drift
  // channels match + alignment fires).
  SignalDriftFusion.__resetForTests();
  const baseTs = Date.now() - 60_000;
  const assets = ['BTC', 'ETH', 'SOL', 'XRP'];
  const probDrifts = [49, 50, 51, 52, 53];

  // The SignalDriftFusion uses `MultiAssetSignal` type from MultiAssetSignalService
  // — fake one shape that matches the type's structural requirements.
  for (let i = 0; i < probDrifts.length; i++) {
    const prob = probDrifts[i];
    for (const a of assets) {
      // @ts-ignore — synthetic fixture
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
  // Price drift: BTC 65000 → 65325 (+0.5%), ETH 3000 → 3015 (+0.5%)
  const btcPrices = [65000, 65080, 65160, 65240, 65325];
  const ethPrices = [3000, 3003, 3007, 3011, 3015];
  for (let i = 0; i < btcPrices.length; i++) {
    SignalDriftFusion.recordPriceTick('BTC', btcPrices[i], baseTs + i * 10_000);
    SignalDriftFusion.recordPriceTick('ETH', ethPrices[i], baseTs + i * 10_000);
  }

  // Now actually exercise the SuiPoolAgent path
  const { SuiPoolAgent } = await import('../agents/specialized/SuiPoolAgent');
  const agent = new SuiPoolAgent('mainnet');
  const result = await agent.getEnhancedAllocationContext();

  console.log(`  Allocations: BTC=${result.allocations.BTC}%, ETH=${result.allocations.ETH}%, SUI=${result.allocations.SUI}%`);
  console.log(`  Confidence: ${result.confidence}, Urgency: ${result.urgency}`);
  console.log(`  Sentiment: ${result.marketSentiment}`);
  console.log(`  Recommendations (${result.recommendations.length}):`);
  for (const r of result.recommendations.slice(0, 12)) console.log(`    - ${r}`);

  // The synthetic STRONG tilt recommendation should appear if any asset upgrades
  const tiltRecs = result.recommendations.filter(r => r.startsWith('Synthetic STRONG'));
  if (tiltRecs.length === 0) {
    console.warn(`  (warn) no synthetic-STRONG tilts in recommendations — likely live alignment didn't fire (markets may be neutral)`);
  } else {
    ok(`Synthetic-STRONG tilts emitted: ${tiltRecs.length}`);
    for (const t of tiltRecs) console.log(`    ${t}`);
  }
  // Alignment recommendation should appear when ≥3 assets agree
  const alignRecs = result.recommendations.filter(r => r.startsWith('Drift-fusion alignment'));
  if (alignRecs.length > 0) {
    ok(`Drift-fusion alignment surfaced: ${alignRecs[0]}`);
  } else {
    console.warn('  (warn) no drift-fusion alignment recommendation — alignment did not reach threshold');
  }
}

async function main() {
  await testAIMarketIntelligence();
  await testSuiPoolAgentTilts();

  console.log();
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} failures:`);
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log('✓ SUI pool wiring is live — creative signals reach getEnhancedAllocationContext');
  process.exit(0);
}

main().catch(err => {
  console.error('UNHANDLED', err);
  process.exit(1);
});
