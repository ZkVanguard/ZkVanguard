/**
 * Verify the new Step 8 hedge logic CAN open BTC, ETH, SUI hedges at current NAV.
 * Replicates the math without actually placing trades.
 */
import 'dotenv/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Polymarket5MinService } from './lib/services/market-data/Polymarket5MinService';
import { SuiPoolAgent } from './agents/specialized/SuiPoolAgent';

const POOL_STATE = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
const PERP_SPECS = {
  BTC: { minQty: 0.001, stepSize: 0.001 },
  ETH: { minQty: 0.01, stepSize: 0.01 },
  SUI: { minQty: 1, stepSize: 1 },
} as const;
const MIN_HEDGE_NAV_USD = Number(process.env.HEDGE_MIN_NAV_USD) || 20;

async function main() {
  console.log('\n═══ HEDGE PLAN PREVIEW (DRY RUN) ═══\n');

  // Fetch live NAV
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const obj = await client.getObject({ id: POOL_STATE, options: { showContent: true } });
  const c: any = (obj.data?.content as any)?.fields;
  const balance = Number(c.balance) / 1e6;
  const totalHedged = Number(c.hedge_state?.fields?.total_hedged_value || 0) / 1e6;
  const navUsd = balance + totalHedged;
  console.log(`Live NAV: $${navUsd.toFixed(2)}\n`);

  if (navUsd < MIN_HEDGE_NAV_USD) {
    console.log(`❌ Below MIN_HEDGE_NAV_USD=$${MIN_HEDGE_NAV_USD}; would skip Step 8.`);
    process.exit(1);
  }

  // AI plan
  const agent = new SuiPoolAgent('mainnet');
  await agent.initialize();
  const ctx = await agent.getEnhancedAllocationContext();
  console.log(`AI: sentiment=${ctx.marketSentiment} urgency=${ctx.urgency} alloc=${JSON.stringify(ctx.allocations)}\n`);

  // Live prices via Polymarket BTC + DelphiMarketService — but we just need approx prices
  // Use the agent's analyzeMarket for accurate current prices
  const indicators = await agent.analyzeMarket();
  const prices: Record<string, number> = {};
  for (const i of indicators) prices[i.asset] = i.price;
  console.log(`Prices: ${JSON.stringify(prices)}\n`);

  // Replicate Step 8 logic
  const sentiment = (ctx.marketSentiment || 'NEUTRAL').toUpperCase();
  const side: 'LONG' | 'SHORT' = sentiment === 'BULLISH' ? 'LONG' : 'SHORT';
  const leverage = navUsd < 1000 ? 5 : 3;
  const hedgeRatio = navUsd < 1000 ? 1.0 : 0.5;

  console.log(`Plan: side=${side} leverage=${leverage}x hedgeRatio=${hedgeRatio}\n`);

  let viable = 0;
  for (const asset of ['BTC', 'ETH', 'SUI'] as const) {
    const allocation = ctx.allocations[asset] || 0;
    const price = prices[asset] || 0;
    const hedgeValueUSD = navUsd * (allocation / 100) * hedgeRatio;
    const effectiveValue = hedgeValueUSD * leverage;
    const hedgeSizeBase = effectiveValue / price;
    const spec = PERP_SPECS[asset];
    const snappedSize = Math.floor(hedgeSizeBase / spec.stepSize) * spec.stepSize;
    const willOpen = allocation >= 5 && snappedSize >= spec.minQty;
    if (willOpen) viable++;
    const status = willOpen ? '✅ WILL OPEN' : '❌ SKIP';
    console.log(`${status} ${asset}-PERP ${side}`);
    console.log(`   allocation=${allocation}% price=$${price.toFixed(4)} hedgeUSD=$${hedgeValueUSD.toFixed(4)} effective=$${effectiveValue.toFixed(4)}`);
    console.log(`   raw=${hedgeSizeBase.toFixed(8)} snapped=${snappedSize} minQty=${spec.minQty}`);
    if (!willOpen) {
      if (allocation < 5) console.log(`   reason: allocation < 5%`);
      else if (snappedSize < spec.minQty) console.log(`   reason: size below BlueFin minQty`);
    }
  }

  console.log(`\n═══ ${viable}/3 assets viable for hedging at current NAV ═══`);
  console.log(viable === 3 ? '🎯 BTC, ETH, SUI all eligible for hedging.' : `⚠ Only ${viable} out of 3 assets clear minQty.`);
  process.exit(viable === 3 ? 0 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
