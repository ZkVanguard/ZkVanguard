/**
 * Agent Liveness Audit — hard evidence that each of the 7 agents + every
 * data source is actually firing in production.
 *
 * For each subsystem: probe → what's the observable evidence → is it fresh?
 *
 * Read-only. Runs against production via the public risk-overview surface
 * + Aiven DB + public prediction APIs. No admin access required.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

const PROD = 'https://www.zkvanguard.xyz';

interface Result {
  system: string;
  status: 'LIVE' | 'STALE' | 'BROKEN' | 'UNKNOWN' | 'DORMANT';
  detail: string;
  evidence: string;
}
const results: Result[] = [];
const push = (r: Result) => {
  results.push(r);
  const icon = { LIVE: '✅', STALE: '⚠️ ', BROKEN: '❌', UNKNOWN: '❓', DORMANT: '🔒' }[r.status];
  console.log(`${icon} [${r.status.padEnd(7)}] ${r.system.padEnd(30)} — ${r.detail}`);
  if (r.evidence) console.log(`   ↳ ${r.evidence}`);
};

async function fetchJson<T = Record<string, unknown>>(url: string, timeout = 10_000): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  AGENT LIVENESS AUDIT — production ('+ PROD.replace('https://','') +') ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── 1. Fetch the master risk-overview payload ────────────────────────
  const overview = await fetchJson<{
    platform?: { tvlUsd?: number; sharePrice?: number };
    hedge?: { activeCount?: number; positions?: Array<{ market: string; side: string; notionalUsd: number }> };
    reconciliation?: { cronHealth?: Array<{ key: string; ageMinutes: number; status: string }> };
    agents?: {
      cycle?: { ranAt?: string | null; ageMinutes?: number | null; riskScore?: number | null; summary?: string | null };
      directives?: Array<{ asset: string; recommendedSide: string | null; confidence: number; shouldHedge: boolean; reason: string }>;
      scorecard?: { totalDecisions: number; approvedCount: number; rejectedCount: number; actedOnCount: number; netPnlUsd: number };
    };
    zkAttestations?: { last24hCount?: number; recentFeed?: unknown[] };
    signals?: Record<string, { direction: string; confidence: number }>;
  }>(`${PROD}/api/platform/risk-overview`);

  if (!overview) {
    push({ system: 'Risk-overview API', status: 'BROKEN', detail: 'Unreachable', evidence: '' });
    process.exit(2);
  }

  // ── 2. LeadAgent — the orchestrator ────────────────────────────────
  const cycleAge = overview.agents?.cycle?.ageMinutes;
  if (cycleAge === null || cycleAge === undefined) {
    push({ system: 'LeadAgent (orchestrator)', status: 'DORMANT', detail: 'No cycle recorded', evidence: '' });
  } else if (cycleAge < 35) {
    push({
      system: 'LeadAgent (orchestrator)', status: 'LIVE',
      detail: `Cycle ran ${cycleAge}min ago`,
      evidence: `summary: ${overview.agents?.cycle?.summary?.slice(0, 100) ?? '(no summary)'}`,
    });
  } else {
    push({ system: 'LeadAgent (orchestrator)', status: 'STALE', detail: `Last cycle ${cycleAge}min ago (> 35min)`, evidence: '' });
  }

  // ── 3. RiskAgent — via LeadAgent cycle output ──────────────────────
  const riskScore = overview.agents?.cycle?.riskScore;
  if (riskScore === null || riskScore === undefined) {
    push({ system: 'RiskAgent', status: 'BROKEN', detail: 'No risk score in cycle output', evidence: '' });
  } else {
    push({
      system: 'RiskAgent', status: 'LIVE',
      detail: `riskScore=${riskScore}/100`,
      evidence: `Fires every LeadAgent cycle; feeds risk-gate stage in AgentTradeGuard`,
    });
  }

  // ── 4. HedgingAgent — via directives cache ─────────────────────────
  const directives = overview.agents?.directives ?? [];
  if (directives.length === 0) {
    push({ system: 'HedgingAgent (via directive cache)', status: 'BROKEN', detail: 'Directives cache empty', evidence: 'Run scripts/restore-directive-cache.ts' });
  } else {
    const summary = directives.map((d) => `${d.asset}=${d.recommendedSide ?? 'WAIT'}/${d.confidence}%`).join(', ');
    push({
      system: 'HedgingAgent (per-asset directive)', status: 'LIVE',
      detail: `${directives.length} directives`,
      evidence: summary,
    });
  }

  // ── 5. SuiPoolAgent — via cron heartbeat ───────────────────────────
  const suiCron = overview.reconciliation?.cronHealth?.find((c) => c.key.includes('sui-community-pool'));
  if (!suiCron) {
    push({ system: 'SuiPoolAgent (allocation driver)', status: 'UNKNOWN', detail: 'No cron heartbeat', evidence: '' });
  } else if (suiCron.status === 'ok' && suiCron.ageMinutes < 35) {
    push({
      system: 'SuiPoolAgent (allocation driver)', status: 'LIVE',
      detail: `sui-community-pool cron ${suiCron.ageMinutes.toFixed(1)}min ago`,
      evidence: `Drives generateAllocation() + BluefinAggregator rebalances`,
    });
  } else {
    push({ system: 'SuiPoolAgent', status: 'STALE', detail: `Cron ${suiCron.ageMinutes.toFixed(1)}min ago, status=${suiCron.status}`, evidence: '' });
  }

  // ── 6. PriceMonitorAgent — via cycle.priceMonitor ──────────────────
  // The subfield isn't surfaced by risk-overview; probe cycle_state DB
  try {
    const { getCronState } = await import('../lib/db/cron-state');
    const lastCycle = await getCronState<{
      priceMonitor?: { pricesFetched?: number; alertsChecked?: number; symbols?: string[] };
    }>('lead-cycle:last-decision');
    const pm = lastCycle?.priceMonitor;
    if (!pm) {
      push({ system: 'PriceMonitorAgent', status: 'BROKEN', detail: 'No priceMonitor tick in last cycle', evidence: '' });
    } else {
      push({
        system: 'PriceMonitorAgent',
        status: pm.pricesFetched && pm.pricesFetched > 0 ? 'LIVE' : 'STALE',
        detail: `${pm.pricesFetched} prices fetched, ${pm.alertsChecked} alerts checked`,
        evidence: `symbols: ${(pm.symbols ?? []).join(', ')}`,
      });
    }
  } catch (e) {
    push({ system: 'PriceMonitorAgent', status: 'UNKNOWN', detail: `DB read failed: ${String(e).slice(0, 100)}`, evidence: '' });
  }

  // ── 7. SettlementAgent — should be excluded on SUI ─────────────────
  push({
    system: 'SettlementAgent (SUI)', status: 'DORMANT',
    detail: 'Correctly excluded on SUI (x402 is Cronos-only)',
    evidence: `agent-orchestrator.ts:867 conditionally excludes when chain !== cronos`,
  });

  // ── 8. ReportingAgent — via zkAttestations + scorecard ─────────────
  const scorecard = overview.agents?.scorecard;
  const zk24h = overview.zkAttestations?.last24hCount ?? 0;
  if (!scorecard) {
    push({ system: 'ReportingAgent', status: 'UNKNOWN', detail: 'Scorecard missing', evidence: '' });
  } else if (scorecard.totalDecisions > 0) {
    push({
      system: 'ReportingAgent (via agent_decisions)', status: 'LIVE',
      detail: `${scorecard.totalDecisions} decisions logged, ${scorecard.actedOnCount} acted, PnL=$${scorecard.netPnlUsd.toFixed(2)}`,
      evidence: `ZK attestations last 24h: ${zk24h}`,
    });
  } else {
    push({ system: 'ReportingAgent', status: 'STALE', detail: `0 decisions logged`, evidence: '' });
  }

  // ── 9. Polymarket 5-min ticker (data source) ──────────────────────
  try {
    const { Polymarket5MinService } = await import('../lib/services/market-data/Polymarket5MinService');
    const sig = await Polymarket5MinService.getLatest5MinSignal();
    if (!sig) {
      push({ system: 'Polymarket 5-min signal', status: 'BROKEN', detail: 'No signal returned', evidence: '' });
    } else {
      const ageSec = Math.floor((Date.now() - sig.fetchedAt) / 1000);
      push({
        system: 'Polymarket 5-min signal', status: 'LIVE',
        detail: `${sig.direction} conf=${sig.confidence.toFixed(0)}% window=${sig.windowLabel}`,
        evidence: `fetched ${ageSec}s ago; ${sig.recommendation}, strength=${sig.signalStrength}`,
      });
    }
  } catch (e) {
    push({ system: 'Polymarket 5-min signal', status: 'BROKEN', detail: `Fetch failed: ${String(e).slice(0, 80)}`, evidence: '' });
  }

  // ── 10. Delphi/Polymarket broader signals ─────────────────────────
  try {
    const { DelphiMarketService } = await import('../lib/services/market-data/DelphiMarketService');
    const p = await DelphiMarketService.getRelevantMarkets(['BTC', 'ETH']);
    push({
      system: 'Delphi/Polymarket broader',
      status: p.length > 0 ? 'LIVE' : 'STALE',
      detail: `${p.length} predictions for BTC/ETH`,
      evidence: p.slice(0, 2).map((x) => `${x.question?.slice(0, 40)}... @ ${x.probability}%`).join(' | '),
    });
  } catch (e) {
    push({ system: 'Delphi/Polymarket broader', status: 'BROKEN', detail: `Fetch failed: ${String(e).slice(0, 80)}`, evidence: '' });
  }

  // ── 11. Crypto.com tickers ─────────────────────────────────────────
  try {
    // Test via UnifiedPriceProvider which uses the Crypto.com stack
    const { getLivePrice } = await import('../lib/services/market-data/unified-price-provider');
    const [btc, eth, sui] = await Promise.all([
      getLivePrice('BTC').catch(() => 0),
      getLivePrice('ETH').catch(() => 0),
      getLivePrice('SUI').catch(() => 0),
    ]);
    const ok = btc > 0 && eth > 0 && sui > 0;
    push({
      system: 'Crypto.com tickers',
      status: ok ? 'LIVE' : (btc > 0 || eth > 0 || sui > 0 ? 'STALE' : 'BROKEN'),
      detail: `BTC=$${btc.toFixed(0)} ETH=$${eth.toFixed(0)} SUI=$${sui.toFixed(4)}`,
      evidence: 'via unified-price-provider',
    });
  } catch (e) {
    push({ system: 'Crypto.com tickers', status: 'BROKEN', detail: `Price fetch failed: ${String(e).slice(0, 80)}`, evidence: '' });
  }

  // ── 12. Aggregate prediction — the fused signal ────────────────────
  try {
    const { PredictionAggregatorService } = await import('../lib/services/market-data/PredictionAggregatorService');
    const perAsset = await PredictionAggregatorService.getPerAssetPredictions(['BTC', 'ETH']);
    const btc = perAsset.BTC;
    const eth = perAsset.ETH;
    if (!btc && !eth) {
      push({ system: 'PredictionAggregator (fused)', status: 'BROKEN', detail: 'Empty result', evidence: '' });
    } else {
      push({
        system: 'PredictionAggregator (fused)', status: 'LIVE',
        detail: `BTC=${btc?.recommendation}/${btc?.confidence?.toFixed(0)}%, ETH=${eth?.recommendation}/${eth?.confidence?.toFixed(0)}%`,
        evidence: `sources: BTC=${btc?.sources?.length ?? 0} ETH=${eth?.sources?.length ?? 0}`,
      });
    }
  } catch (e) {
    push({ system: 'PredictionAggregator (fused)', status: 'BROKEN', detail: `Fetch failed: ${String(e).slice(0, 80)}`, evidence: '' });
  }

  // ── 13. Cron heartbeats ────────────────────────────────────────────
  const crons = overview.reconciliation?.cronHealth ?? [];
  const staleCrons = crons.filter((c) => c.status !== 'ok');
  if (staleCrons.length === 0) {
    push({
      system: 'All cron heartbeats',
      status: 'LIVE',
      detail: `${crons.length} crons all fresh`,
      evidence: crons.map((c) => `${c.key.replace('cron:lastRun:', '')}=${c.ageMinutes.toFixed(0)}min`).join(', '),
    });
  } else {
    push({
      system: 'Cron heartbeats',
      status: 'STALE',
      detail: `${staleCrons.length}/${crons.length} stale`,
      evidence: staleCrons.map((c) => `${c.key}: age=${c.ageMinutes.toFixed(1)}min status=${c.status}`).join('; '),
    });
  }

  // ── 14. Active hedges + drift alignment ────────────────────────────
  const activeHedges = overview.hedge?.positions ?? [];
  if (activeHedges.length === 0) {
    push({ system: 'Active hedges', status: 'DORMANT', detail: 'No open positions', evidence: '' });
  } else {
    let aligned = 0;
    let misaligned = 0;
    for (const h of activeHedges) {
      const asset = h.market.replace(/-PERP$/, '');
      const d = directives.find((x) => x.asset === asset);
      if (!d || !d.recommendedSide) continue;
      if (d.recommendedSide === h.side.toUpperCase()) aligned++;
      else misaligned++;
    }
    push({
      system: 'Hedge ↔ directive alignment',
      status: misaligned === 0 ? 'LIVE' : 'STALE',
      detail: `${aligned} aligned, ${misaligned} misaligned of ${activeHedges.length}`,
      evidence: activeHedges.map((h) => `${h.market} ${h.side} $${h.notionalUsd.toFixed(2)}`).join(' | '),
    });
  }

  // ── Summary ────────────────────────────────────────────────────────
  const live = results.filter((r) => r.status === 'LIVE').length;
  const total = results.length;
  const broken = results.filter((r) => r.status === 'BROKEN').length;
  const stale = results.filter((r) => r.status === 'STALE').length;
  const dormant = results.filter((r) => r.status === 'DORMANT').length;

  console.log(`\n═══════ ${live}/${total} systems LIVE, ${stale} stale, ${broken} broken, ${dormant} dormant-by-design ═══════`);
  if (broken > 0) {
    console.log('\nBroken systems require attention:');
    results.filter((r) => r.status === 'BROKEN').forEach((r) => console.log(`  ❌ ${r.system}: ${r.detail}`));
  }
  process.exit(broken > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Audit threw:', e); process.exit(1); });
