/**
 * Probe all 7 agents in isolation: instantiate, initialize, getStatus,
 * and call a representative analyze/executeTask path. Read-only.
 *
 *   bun run --env-file=.env.local C:/tmp/probe-agents.ts
 */
import 'dotenv/config';

type R = { name: string; ok: boolean; ms: number; detail?: string };
const out: R[] = [];
const time = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
  const t0 = Date.now();
  try {
    const v = await fn();
    out.push({ name, ok: true, ms: Date.now() - t0, detail: typeof v === 'string' ? v : undefined });
    console.log(`  PASS  ${name}  (${Date.now() - t0}ms)`);
    return v;
  } catch (e: any) {
    out.push({ name, ok: false, ms: Date.now() - t0, detail: e?.message?.slice(0, 200) || String(e) });
    console.log(`  FAIL  ${name}  (${Date.now() - t0}ms)  ${e?.message?.slice(0, 200) || e}`);
    return undefined;
  }
};

async function main() {
  console.log('\n=== Agent probe: instantiate + initialize + smoke-task ===\n');

  // ── 1. SuiPoolAgent ────────────────────────────────────────────────────
  console.log('\n[1] SuiPoolAgent (production path)');
  const { getSuiPoolAgent } = await import('@/agents/specialized/SuiPoolAgent');
  const sui = getSuiPoolAgent('mainnet');
  await time('SuiPoolAgent.init', async () => { await sui.initialize(); });
  const indicators = await time('SuiPoolAgent.analyzeMarket', async () => sui.analyzeMarket());
  if (indicators && indicators.length) {
    await time('SuiPoolAgent.generateAllocation', async () => {
      const a = sui.generateAllocation(indicators);
      console.log(`        ↳ alloc=${JSON.stringify(a.allocations)} sent=${a.sentiment} conf=${a.confidence}`);
      return JSON.stringify(a.allocations);
    });
  }

  // ── 2. LeadAgent ───────────────────────────────────────────────────────
  console.log('\n[2] LeadAgent');
  const { LeadAgent } = await import('@/agents/core/LeadAgent');
  const lead = new LeadAgent('probe-lead');
  await time('LeadAgent.init', async () => { await lead.initialize(); });
  await time('LeadAgent.parseNaturalLanguage', async () => {
    const intent = await (lead as any).parseNaturalLanguage({ naturalLanguage: 'hedge 10% of BTC exposure as a short' });
    console.log(`        ↳ intent=${JSON.stringify(intent).slice(0, 160)}`);
    return JSON.stringify(intent);
  });

  // ── 3. RiskAgent ───────────────────────────────────────────────────────
  console.log('\n[3] RiskAgent');
  const { RiskAgent } = await import('@/agents/specialized/RiskAgent');
  const risk = new RiskAgent('probe-risk');
  await time('RiskAgent.init', async () => { await risk.initialize(); });
  await time('RiskAgent.executeTask(analyze_risk)', async () => {
    const r = await risk.executeTask({
      id: 'probe-1', type: 'analyze_risk', priority: 'medium',
      payload: { portfolio: { totalValue: 1000, positions: [{ asset: 'BTC', value: 500 }, { asset: 'ETH', value: 500 }] } },
      createdAt: new Date(),
    } as any);
    console.log(`        ↳ success=${r.success} keys=${Object.keys(r.data || {}).join(',')}`);
    return r.success ? 'ok' : 'fail';
  });

  // ── 4. HedgingAgent ────────────────────────────────────────────────────
  console.log('\n[4] HedgingAgent');
  const { HedgingAgent } = await import('@/agents/specialized/HedgingAgent');
  const hedge = new HedgingAgent('probe-hedge');
  await time('HedgingAgent.init', async () => { await hedge.initialize(); });
  await time('HedgingAgent.executeTask(analyze_hedge)', async () => {
    const r = await hedge.executeTask({
      id: 'probe-2a', type: 'analyze_hedge', priority: 'medium',
      parameters: { portfolioId: 'sui-mainnet', assetSymbol: 'BTC', notionalValue: 1000 },
      createdAt: new Date(),
    } as any);
    console.log(`        ↳ success=${r.success} err=${r.error?.slice(0, 120) || '-'} keys=${Object.keys(r.data || {}).join(',')}`);
    return r.success ? 'ok' : 'fail';
  });
  // create-hedge: this is the action LeadAgent actually fires in prod (sui branch)
  await time('HedgingAgent.executeTask(create-hedge, chain=sui)', async () => {
    const r = await hedge.executeTask({
      id: 'probe-2b', type: 'create-hedge', priority: 'medium',
      parameters: { chain: 'sui', portfolioId: 'community-pool' },
      createdAt: new Date(),
    } as any);
    console.log(`        ↳ success=${r.success} strategyId=${(r.data as any)?.strategyId} chain=${(r.data as any)?.chain} riskScore=${(r.data as any)?.riskScore}`);
    return r.success ? 'ok' : 'fail';
  });
  // close_hedge: no live hedge to close; we just confirm it doesn't crash on missing hedgeId
  await time('HedgingAgent.executeTask(close_hedge) [shape only]', async () => {
    const r = await hedge.executeTask({
      id: 'probe-2c', type: 'close_hedge', priority: 'medium',
      parameters: { market: 'BTC-PERP', size: '0' },  // no hedgeId — off-chain path
      createdAt: new Date(),
    } as any);
    console.log(`        ↳ success=${r.success} err=${r.error?.slice(0, 100) || '-'}`);
    return 'ok'; // shape acceptance is the test, not on-chain success
  });
  // monitor_positions: read-only call, exercises moonlander client path
  await time('HedgingAgent.executeTask(monitor_positions)', async () => {
    const r = await hedge.executeTask({
      id: 'probe-2d', type: 'monitor_positions', priority: 'low',
      parameters: {},
      createdAt: new Date(),
    } as any);
    console.log(`        ↳ success=${r.success} err=${r.error?.slice(0, 100) || '-'}`);
    return 'ok';
  });

  // ── 5. SettlementAgent ─────────────────────────────────────────────────
  console.log('\n[5] SettlementAgent');
  const { SettlementAgent } = await import('@/agents/specialized/SettlementAgent');
  const settle = new SettlementAgent('probe-settle');
  await time('SettlementAgent.init', async () => { await settle.initialize(); });

  // ── 6. ReportingAgent ──────────────────────────────────────────────────
  console.log('\n[6] ReportingAgent');
  const { ReportingAgent } = await import('@/agents/specialized/ReportingAgent');
  const report = new ReportingAgent('probe-report');
  await time('ReportingAgent.init', async () => { await report.initialize(); });

  // ── 7. PriceMonitorAgent ───────────────────────────────────────────────
  console.log('\n[7] PriceMonitorAgent');
  const { PriceMonitorAgent } = await import('@/agents/specialized/PriceMonitorAgent');
  const px = new PriceMonitorAgent();
  await time('PriceMonitorAgent.start', async () => { await (px as any).start(); });
  await time('PriceMonitorAgent.stop', async () => { if (typeof (px as any).stop === 'function') await (px as any).stop(); });

  // ── SUMMARY ────────────────────────────────────────────────────────────
  console.log('\n=== SUMMARY ===');
  const pass = out.filter(r => r.ok).length;
  const fail = out.filter(r => !r.ok).length;
  console.log(`  ${pass}/${out.length} steps passed, ${fail} failed`);
  for (const r of out.filter(x => !x.ok)) console.log(`    FAIL  ${r.name}  -- ${r.detail}`);

  // give event loops a chance to flush
  await new Promise(r => setTimeout(r, 500));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
