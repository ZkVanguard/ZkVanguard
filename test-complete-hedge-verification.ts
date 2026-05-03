/**
 * COMPLETE END-TO-END VERIFICATION
 * Validates every link in the BTC/ETH/SUI hedging chain.
 */
import 'dotenv/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { BluefinService } from './lib/services/sui/BluefinService';
import { Polymarket5MinService } from './lib/services/market-data/Polymarket5MinService';
import { SuiPoolAgent } from './agents/specialized/SuiPoolAgent';

const POOL_STATE = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
const PERP_SPECS = {
  BTC: { minQty: 0.001, stepSize: 0.001 },
  ETH: { minQty: 0.01, stepSize: 0.01 },
  SUI: { minQty: 1, stepSize: 1 },
} as const;

interface Check { name: string; ok: boolean; detail: string }
const checks: Check[] = [];
const ok = (name: string, detail: string) => { checks.push({ name, ok: true, detail }); console.log(`✅ ${name}\n   ${detail}`); };
const warn = (name: string, detail: string) => { checks.push({ name, ok: false, detail }); console.log(`⚠ ${name}\n   ${detail}`); };
const bad = (name: string, detail: string) => { checks.push({ name, ok: false, detail }); console.log(`❌ ${name}\n   ${detail}`); };

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  COMPLETE BTC/ETH/SUI HEDGE PIPELINE VERIFICATION            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── 1. Pool on-chain state ────────────────────────────────────
  console.log('── 1. POOL STATE ──');
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const obj = await client.getObject({ id: POOL_STATE, options: { showContent: true } });
  const c: any = (obj.data?.content as any)?.fields;
  const poolBalance = Number(c.balance) / 1e6;
  const totalHedged = Number(c.hedge_state?.fields?.total_hedged_value || 0) / 1e6;
  const dailyTotal = Number(c.hedge_state?.fields?.daily_hedge_total || 0) / 1e6;
  const navUsd = poolBalance + totalHedged;
  ok('Pool readable', `NAV=$${navUsd.toFixed(2)} balance=$${poolBalance.toFixed(2)} hedged=$${totalHedged.toFixed(2)} dailyTotal=$${dailyTotal.toFixed(2)}`);

  // ── 2. NAV gate (new $20 floor) ─────────────────────────────
  const MIN_NAV = Number(process.env.HEDGE_MIN_NAV_USD) || 20;
  if (navUsd >= MIN_NAV) ok('NAV gate (new $20 floor)', `$${navUsd.toFixed(2)} ≥ $${MIN_NAV}`);
  else { bad('NAV gate', `$${navUsd.toFixed(2)} < $${MIN_NAV}`); return done(); }

  // ── 3. AI signal pipeline ──────────────────────────────────
  console.log('\n── 2. AI SIGNAL PIPELINE ──');
  const sig = await Polymarket5MinService.getLatest5MinSignal();
  if (sig) ok('Polymarket 5-min', `${sig.direction} prob=${sig.probability}% conf=${sig.confidence}%`);
  else bad('Polymarket 5-min', 'no signal');

  const agent = new SuiPoolAgent('mainnet');
  await agent.initialize();
  const ctx = await agent.getEnhancedAllocationContext();
  ok('AI allocation', `sentiment=${ctx.marketSentiment} urgency=${ctx.urgency} BTC=${ctx.allocations.BTC}%/ETH=${ctx.allocations.ETH}%/SUI=${ctx.allocations.SUI}% signals=${ctx.predictionSignals?.length || 0}`);

  const sentiment = (ctx.marketSentiment || 'NEUTRAL').toUpperCase();
  const side: 'LONG' | 'SHORT' = sentiment === 'BULLISH' ? 'LONG' : 'SHORT';
  ok('Direction logic', `sentiment=${sentiment} → side=${side}`);

  // ── 4. Hedge sizing per asset ─────────────────────────────
  console.log('\n── 3. PER-ASSET HEDGE SIZING ──');
  const indicators = await agent.analyzeMarket();
  const prices: Record<string, number> = {};
  for (const i of indicators) prices[i.asset] = i.price;

  const leverage = navUsd < 1000 ? 10 : 3;
  const hedgeRatio = navUsd < 1000 ? 1.0 : 0.5;
  let totalMarginNeeded = 0;
  const planned: { asset: string; size: number; margin: number }[] = [];

  for (const asset of ['BTC', 'ETH', 'SUI'] as const) {
    const allocation = ctx.allocations[asset] || 0;
    const price = prices[asset] || 0;
    const hedgeUSD = navUsd * (allocation / 100) * hedgeRatio;
    const effective = hedgeUSD * leverage;
    const raw = effective / price;
    const spec = PERP_SPECS[asset];
    const snapped = Math.floor(raw / spec.stepSize) * spec.stepSize;
    if (allocation >= 5 && snapped >= spec.minQty) {
      totalMarginNeeded += hedgeUSD;
      planned.push({ asset, size: snapped, margin: hedgeUSD });
      ok(`${asset}-PERP`, `size=${snapped} ($${effective.toFixed(2)} eff @ ${leverage}x) margin=$${hedgeUSD.toFixed(2)}`);
    } else {
      warn(`${asset}-PERP`, `alloc=${allocation}% snapped=${snapped} minQty=${spec.minQty} → SKIP`);
    }
  }

  // ── 5. BlueFin account state ────────────────────────────
  console.log('\n── 4. BLUEFIN MARGIN ACCOUNT ──');
  const key = (process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  if (!key) { bad('BlueFin key', 'BLUEFIN_PRIVATE_KEY missing'); return done(); }

  const bf = BluefinService.getInstance();
  if (!bf.isInitialized()) await bf.initialize(key, 'mainnet');
  const positions = await bf.getPositions();
  ok('BlueFin auth', `wallet=${bf.getAddress()?.slice(0, 12)}… positions=${positions.length}`);

  const acct: any = await (bf as any).apiRequest(
    'GET', `/api/v1/account?accountAddress=${bf.getAddress()}`, undefined, 'exchange'
  );
  const freeCollat = Number(acct?.freeCollateral || 0);
  const dedup = new Set(positions.map(p => `${p.symbol}|${p.side}`));

  if (freeCollat >= totalMarginNeeded) {
    ok('Free collateral', `$${freeCollat.toFixed(2)} ≥ $${totalMarginNeeded.toFixed(2)} needed`);
  } else {
    bad('Free collateral', `$${freeCollat.toFixed(2)} < $${totalMarginNeeded.toFixed(2)} needed → hedges will fail with insufficient-margin`);
  }

  console.log('\n── 5. DEDUP GATE PREVIEW ──');
  let willActuallyOpen = 0;
  for (const p of planned) {
    const k = `${p.asset}-PERP|${side}`;
    if (dedup.has(k)) {
      warn(`${p.asset}-PERP ${side}`, 'already-active → SKIPPED_DUP');
    } else {
      willActuallyOpen++;
      ok(`${p.asset}-PERP ${side}`, `clear to open (no existing ${side} position)`);
    }
  }

  // ── 6. Cron deployment freshness ────────────────────────
  console.log('\n── 6. PRODUCTION CRON FRESHNESS ──');
  const { Pool } = await import('pg');
  const cs = process.env.DB_V2_DATABASE_URL || process.env.DATABASE_URL;
  if (cs) {
    const pg = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });
    try {
      const r: any = await pg.query(`
        SELECT created_at, details->>'action' AS action,
               details->'rebalanceQuotes'->'poolTransfer'->>'error' AS pt_err
        FROM community_pool_transactions
        WHERE type='AI_DECISION' AND details->>'chain'='sui'
        ORDER BY created_at DESC LIMIT 1
      `);
      if (r.rows[0]) {
        const ageMin = (Date.now() - new Date(r.rows[0].created_at).getTime()) / 60000;
        const newCode = (r.rows[0].pt_err || '').includes('On-chain limits exhausted');
        ok('Last cron run', `${ageMin.toFixed(1)}m ago, action=${r.rows[0].action}`);
        if (newCode) ok('My fixes are LIVE', 'new daily-cap error message detected in latest run');
      }
    } finally { await pg.end(); }
  }

  done();
}

function done() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY                                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  const passed = checks.filter(c => c.ok).length;
  const total = checks.length;
  console.log(`Passed ${passed}/${total}`);
  const failed = checks.filter(c => !c.ok);
  if (failed.length > 0) {
    console.log('\nBlockers:');
    for (const f of failed) console.log(`  ❌ ${f.name}: ${f.detail}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
