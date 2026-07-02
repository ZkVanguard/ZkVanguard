/**
 * Emergency: restore the production agent-directives cache from fresh
 * PredictionAggregator data. Used when the cache was wiped and the
 * operator can't wait for the next 30-min sui-cron tick to re-populate.
 *
 * Uses ONLY DB access + public prediction APIs — no CRON_SECRET or
 * signing keys required. Safe to run against production.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

async function main() {
  console.log('Fetching fresh per-asset predictions…');
  const { PredictionAggregatorService } = await import('../lib/services/market-data/PredictionAggregatorService');
  const perAsset = await PredictionAggregatorService.getPerAssetPredictions(['BTC', 'ETH', 'SUI', 'CRO']);
  console.log('Got predictions for:', Object.keys(perAsset));

  const byAsset: Record<string, unknown> = {};
  for (const [asset, pred] of Object.entries(perAsset)) {
    const dir = pred.direction;
    let side: 'LONG' | 'SHORT' | null = null;
    if (pred.recommendation.endsWith('LONG')) side = 'LONG';
    else if (pred.recommendation.endsWith('SHORT')) side = 'SHORT';
    else if (dir === 'UP') side = 'LONG';
    else if (dir === 'DOWN') side = 'SHORT';
    const shouldHedge = pred.recommendation !== 'WAIT' || dir !== 'NEUTRAL';
    const entry = {
      asset: asset.toUpperCase(),
      recommendedSide: side,
      confidence: Math.round(pred.confidence ?? 0),
      shouldHedge,
      reason: `${pred.recommendation} (dir=${dir}, conf=${Math.round(pred.confidence ?? 0)}%, cons=${Math.round(pred.consensus ?? 0)}%)`,
      riskScore: 50,
      computedAt: Date.now(),
    };
    byAsset[asset.toUpperCase()] = entry;
    console.log(`  ${asset.toUpperCase()}: side=${side} conf=${entry.confidence}% shouldHedge=${shouldHedge}`);
  }

  const { publishDirectives } = await import('../lib/services/agents/agent-trade-guard');
  await publishDirectives({
    ranAt: Date.now(),
    chain: 'sui',
    riskScore: 50,
    riskLevel: 'MEDIUM',
    byAsset: byAsset as never,
  });

  console.log('\n✅ Production directive cache restored.');
  console.log('   Verify with: curl -s https://www.zkvanguard.xyz/api/platform/risk-overview | jq .agents.directives');
  process.exit(0);
}

main().catch((e) => { console.error('RESTORE FAILED:', e); process.exit(1); });
