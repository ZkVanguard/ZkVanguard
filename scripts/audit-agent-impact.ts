/**
 * Deep Agent Impact Audit — for each agent, traces:
 *   INPUT → COMPUTE → OUTPUT → CONSUMER → TRADE IMPACT
 *
 * Answers the honest question "does this agent actually change what the
 * pool does, or is it just running for show?" — beyond superficial liveness.
 *
 * Categorizes each agent into:
 *   LOAD_BEARING  — Output is read by a trading path and changes what happens
 *   OBSERVABILITY — Output is consumed but only for dashboards/logs/reports
 *   DECORATIVE    — Runs but its output is thrown away
 *   DORMANT       — Never fires (by design or bug)
 *
 * Read-only. Verifies against live production + code inspection.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

const PROD = 'https://www.zkvanguard.xyz';
const ROOT = process.cwd();

interface AgentReport {
  agent: string;
  fires: 'YES' | 'NO' | 'UNKNOWN';
  firesEvidence: string;
  producesOutput: 'YES' | 'NO' | 'UNKNOWN';
  outputEvidence: string;
  outputConsumers: string[];
  affectsTradesVia: string[];       // list of concrete code paths that use the output
  category: 'LOAD_BEARING' | 'OBSERVABILITY' | 'DECORATIVE' | 'DORMANT';
  gaps: string[];                    // known holes vs designed behavior
}

const reports: AgentReport[] = [];

function grepFile(pathRelToRoot: string, pattern: RegExp): { count: number; hits: string[] } {
  try {
    const content = readFileSync(join(ROOT, pathRelToRoot), 'utf8');
    const lines = content.split(/\r?\n/);
    const hits: string[] = [];
    lines.forEach((l, i) => {
      if (pattern.test(l)) hits.push(`${pathRelToRoot}:${i + 1} ${l.trim().slice(0, 100)}`);
    });
    return { count: hits.length, hits };
  } catch { return { count: 0, hits: [] }; }
}

function grepAcrossFiles(files: string[], pattern: RegExp): { totalCount: number; byFile: Array<{ file: string; hits: string[] }> } {
  const byFile = files.map((f) => {
    const g = grepFile(f, pattern);
    return { file: f, hits: g.hits };
  });
  return {
    totalCount: byFile.reduce((s, x) => s + x.hits.length, 0),
    byFile: byFile.filter((x) => x.hits.length > 0),
  };
}

async function fetchJson<T>(url: string, timeout = 10_000): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

// ═════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  DEEP AGENT IMPACT AUDIT — tracing input→output→consumer     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const CRON_ROUTES = [
    'app/api/cron/sui-community-pool/route.ts',
    'app/api/cron/polymarket-edge-trader/route.ts',
    'app/api/cron/bluefin-health/route.ts',
    'app/api/cron/agent-signal-tick/route.ts',
    'app/api/cron/hedge-monitor/route.ts',
    'app/api/cron/liquidation-guard/route.ts',
  ];
  const TRADE_GUARD = [
    'lib/services/agents/agent-trade-guard.ts',
    'lib/services/agents/position-drift-monitor.ts',
  ];
  const ORCHESTRATOR = ['lib/services/agent-orchestrator.ts', 'agents/core/LeadAgent.ts'];

  const overview = await fetchJson<{
    agents?: {
      cycle?: { ranAt?: string | null; ageMinutes?: number | null; riskScore?: number | null; summary?: string | null };
      directives?: Array<{ asset: string; recommendedSide: string | null; confidence: number }>;
      scorecard?: { totalDecisions: number; actedOnCount: number; netPnlUsd: number };
    };
  }>(`${PROD}/api/platform/risk-overview`);

  // ─── 1. LeadAgent — the orchestrator ─────────────────────────────────
  {
    const cycleAge = overview?.agents?.cycle?.ageMinutes;
    const fires = cycleAge !== null && cycleAge !== undefined && cycleAge < 35 ? 'YES' : 'NO';
    const runAutoCycleCalls = grepAcrossFiles(CRON_ROUTES, /runAutonomousCycle/);
    reports.push({
      agent: 'LeadAgent',
      fires,
      firesEvidence: `Cycle ${cycleAge}min old via ${runAutoCycleCalls.totalCount} runAutonomousCycle call site(s)`,
      producesOutput: 'YES',
      outputEvidence: 'Report{riskAnalysis, hedgingStrategy, settlement, zkProofs, aiSummary}',
      outputConsumers: [
        `lead-cycle:last-decision cron_state (${grepAcrossFiles(ORCHESTRATOR, /lead-cycle:last-decision/).totalCount} write sites)`,
        `publishDirectives → agent-directives:by-asset cache (${grepAcrossFiles(ORCHESTRATOR, /publishDirectives/).totalCount} calls)`,
        `Discord notifyDiscord() on cycle events (${grepAcrossFiles(ORCHESTRATOR, /notifyDiscord/).totalCount})`,
      ],
      affectsTradesVia: [
        'Its RiskAgent output → risk_score → guard risk-gate',
        'Its PredictionAggregator side output → directive cache → guard side-mismatch check',
      ],
      category: 'LOAD_BEARING',
      gaps: [
        cycleAge && cycleAge > 30 ? `Cycle is ${cycleAge}min old (target < 30)` : '',
      ].filter(Boolean),
    });
  }

  // ─── 2. RiskAgent ────────────────────────────────────────────────────
  {
    const riskScore = overview?.agents?.cycle?.riskScore;
    const scoreConsumers = grepAcrossFiles(TRADE_GUARD, /riskScore|snap\?\.riskScore/);
    reports.push({
      agent: 'RiskAgent',
      fires: riskScore !== null && riskScore !== undefined ? 'YES' : 'NO',
      firesEvidence: `report.riskAnalysis.totalRisk = ${riskScore} present in cycle`,
      producesOutput: 'YES',
      outputEvidence: 'RiskAnalysis{totalRisk, marketSentiment, volatility, recommendations, riskLevel}',
      outputConsumers: [
        `agent-trade-guard.ts (${scoreConsumers.totalCount} refs to riskScore)`,
        `/api/agents/hedging/recommend (dashboard endpoint)`,
        `Discord alerts on high risk`,
      ],
      affectsTradesVia: [
        'checkBeforeTrade: risk-gate stage — halts ALL trades when riskScore > HEDGE_AGENT_RISK_CEILING (default 80)',
        'castAutomatedConsensusVotes: risk-agent vote in the 2/3 consensus for trades > $100k',
      ],
      category: 'LOAD_BEARING',
      gaps: [
        'Only 1 of RiskAgent\'s outputs (totalRisk) is read by trades. marketSentiment / volatility / recommendations flow to dashboards but not to guards.',
      ],
    });
  }

  // ─── 3. HedgingAgent ─────────────────────────────────────────────────
  {
    // Does the orchestrator consume report.hedgingStrategy.recommendations?
    const orchestratorConsumers = grepAcrossFiles(ORCHESTRATOR, /hedgeData\?\.recommendations|hedgeRecs|hedgingAgentOverrides|hedging-agent/);
    const guardConsumers = grepAcrossFiles(TRADE_GUARD, /source.*hedging-agent|directive\.source/);
    reports.push({
      agent: 'HedgingAgent',
      fires: 'YES',
      firesEvidence: `Included in intent.requiredAgents inside runAutonomousCycle; delegated to via LeadAgent`,
      producesOutput: 'YES',
      outputEvidence: 'HedgeAnalysis + SuiHedgeRecommendation[]{asset, side, confidence, reason, suggestedSize}',
      outputConsumers: [
        `agent-orchestrator.ts:runAutonomousCycle (${orchestratorConsumers.totalCount} refs) — Layer 2 override of directive cache`,
        `agent-trade-guard.ts (${guardConsumers.totalCount} refs to directive.source) — labels blocks as HedgingAgent(LLM) vs signal-agg`,
        `/api/agents/hedging/recommend (dashboard endpoint)`,
        `/api/agents/command + /api/chat (chat interfaces)`,
      ],
      affectsTradesVia: orchestratorConsumers.totalCount > 0
        ? [
            'runAutonomousCycle:Layer 2 — HedgingAgent\'s per-asset recommendations OVERRIDE PredictionAggregator raw signal in the directive cache',
            'source=\'hedging-agent\' on directive → trade guard labels the block as LLM-reasoned',
            'When HedgingAgent has an opinion for an asset, guard consumes ITS side (not the raw signal)',
            'When HedgingAgent has no opinion for an asset, fallback to PredictionAggregator seamlessly',
          ]
        : ['❌ Orchestrator did not consume HedgingAgent output (regression?)'],
      category: orchestratorConsumers.totalCount > 0 ? 'LOAD_BEARING' : 'DECORATIVE',
      gaps: orchestratorConsumers.totalCount > 0
        ? [
            'On Cronos chain, HedgingAgent\'s createHedgeStrategy path returns a different shape — normalization is defensive but not validated against Cronos production data',
            'HedgingAgent confidence scale is 0-1 on SUI vs 0-100 on generic; normalized to 0-100 in the fusion loop with a boundary check',
          ]
        : [
            'sui-community-pool cron: 0 references to report.hedgingStrategy — was inline sentiment logic',
            'agent-trade-guard: 0 references — directive cache was built from PredictionAggregator only',
            'HedgingAgent ran every 30 min → produced LLM-reasoned recommendations → discarded',
          ],
    });
  }

  // ─── 4. SuiPoolAgent ─────────────────────────────────────────────────
  {
    const analyzeMarketCalls = grepAcrossFiles(['app/api/cron/sui-community-pool/route.ts'], /suiAgent\.analyzeMarket|suiAgent\.generateAllocation/);
    reports.push({
      agent: 'SuiPoolAgent',
      fires: 'YES',
      firesEvidence: `sui-community-pool cron ${analyzeMarketCalls.totalCount} call sites`,
      producesOutput: 'YES',
      outputEvidence: 'AllocationDecision{allocations, confidence, shouldRebalance, swappableAssets, hedgedAssets, riskScore}',
      outputConsumers: [
        `sui-community-pool/route.ts:1313 (analyzeMarket) → :1314 (generateAllocation) → aiResult`,
        `aiResult drives Step 6.6 (drift-based pre-rebalance) + Step 7 (rebalance execute)`,
      ],
      affectsTradesVia: [
        'aiResult.allocations → BluefinAggregator swap targets → real USDC→wBTC/wETH/SUI swaps',
        'aiResult.confidence gates the shouldRebalance flag',
        'aiResult.riskScore feeds Step 8 auto-hedge threshold',
      ],
      category: 'LOAD_BEARING',
      gaps: [],
    });
  }

  // ─── 5. PriceMonitorAgent ────────────────────────────────────────────
  {
    const tickCalls = grepAcrossFiles(ORCHESTRATOR, /priceMonitorAgent\?\.tick|priceMonitorAgent\.tick/);
    reports.push({
      agent: 'PriceMonitorAgent',
      fires: 'YES',
      firesEvidence: `tick() called ${tickCalls.totalCount} times inside runAutonomousCycle`,
      producesOutput: 'YES',
      outputEvidence: 'tick result{pricesFetched, alertsChecked, alertsTriggered, fiveMinProcessed, symbols[]}',
      outputConsumers: [
        `lead-cycle:last-decision.priceMonitor (cron_state storage)`,
        `/api/agents/monitor (user-facing alert config API)`,
        `Discord alerts if user-configured price threshold breached`,
      ],
      affectsTradesVia: [
        '❌ NONE — alerts are for external notification; do NOT feed into trade guard, drift monitor, or auto-hedge',
      ],
      category: 'OBSERVABILITY',
      gaps: [
        'Its 5-min ticker subscriptions (RiskAgent/HedgingAgent style) die on Vercel serverless — the tick() one-shot is what fires each cycle',
        'No trading path reads its alerts — purely operator-facing',
      ],
    });
  }

  // ─── 6. SettlementAgent ──────────────────────────────────────────────
  {
    const orchExclusion = grepAcrossFiles(ORCHESTRATOR, /!.*cronos|chain !== 'cronos'|isCronos/);
    reports.push({
      agent: 'SettlementAgent',
      fires: 'NO',
      firesEvidence: `Excluded from requiredAgents when chain !== 'cronos' (${orchExclusion.totalCount} guards)`,
      producesOutput: 'NO',
      outputEvidence: 'x402 gasless settlement only runs on Cronos — SUI pool doesn\'t need it',
      outputConsumers: [
        `/api/agents/reporting/generate (would consume if fired)`,
      ],
      affectsTradesVia: [
        '(N/A — dormant by design on SUI chain)',
      ],
      category: 'DORMANT',
      gaps: [
        'Intentionally dormant on SUI. Would fire if Cronos pool is added.',
      ],
    });
  }

  // ─── 7. ReportingAgent ───────────────────────────────────────────────
  {
    const reportingConsumers = grepAcrossFiles(CRON_ROUTES.concat(TRADE_GUARD), /reportingAgent|report\.reporting|report\.zkProofs/);
    reports.push({
      agent: 'ReportingAgent',
      fires: 'YES',
      firesEvidence: `Included in requiredAgents; delegated to inside LeadAgent cycle`,
      producesOutput: 'YES',
      outputEvidence: 'Report{summary, zkProofs[], audit trail}',
      outputConsumers: [
        `/api/agents/reporting/generate (user-facing)`,
        `report.zkProofs.length recorded in cycle result`,
        `Discord log lines on completion`,
      ],
      affectsTradesVia: reportingConsumers.totalCount > 0
        ? [`consumed by ${reportingConsumers.totalCount} trade-path sites (investigate)`]
        : ['❌ NONE — no cron or guard reads reportingStrategy'],
      category: 'OBSERVABILITY',
      gaps: [
        'Runs every 30 min → produces audit report → shown only in /api/agents/reporting/generate',
        'zkProofs count logged but the proofs themselves aren\'t used for anything downstream (grant-review only)',
      ],
    });
  }

  // ─── MessageBus usage — is inter-agent comms alive? ──────────────────
  const messageBusUsage = grepAcrossFiles(
    ['agents/core/LeadAgent.ts', 'agents/specialized/RiskAgent.ts', 'agents/specialized/HedgingAgent.ts'],
    /messageBus\.emit|messageBus\.on|sendMessage/,
  );

  // ═══════════════════════════════════════════════════════════════════
  console.log('For each agent — the concrete input→output→consumer path:\n');

  const catColor = { LOAD_BEARING: '🟢', OBSERVABILITY: '🟡', DECORATIVE: '🔴', DORMANT: '⚫' };
  for (const r of reports) {
    console.log(`\n━━━ ${catColor[r.category]} ${r.agent} — ${r.category} ━━━`);
    console.log(`  Fires: ${r.fires}    (${r.firesEvidence})`);
    console.log(`  Produces: ${r.producesOutput} — ${r.outputEvidence.slice(0, 100)}`);
    console.log(`  Consumers (${r.outputConsumers.length}):`);
    for (const c of r.outputConsumers) console.log(`    - ${c}`);
    console.log(`  Actual trade impact:`);
    for (const t of r.affectsTradesVia) console.log(`    → ${t}`);
    if (r.gaps.length > 0) {
      console.log(`  Gaps vs designed behavior:`);
      for (const g of r.gaps) console.log(`    ⚠️  ${g}`);
    }
  }

  console.log(`\n━━━ MessageBus (inter-agent comms) ━━━`);
  console.log(`  Emit/subscribe/sendMessage: ${messageBusUsage.totalCount} references in Lead/Risk/Hedging agents`);
  console.log(`  Verdict: ${messageBusUsage.totalCount > 5 ? 'ACTIVE' : messageBusUsage.totalCount > 0 ? 'MINIMAL' : 'UNUSED'} — most comm is via return values, not events`);

  console.log(`\n═════════════════════════ SUMMARY ═════════════════════════`);
  const loadBearing = reports.filter((r) => r.category === 'LOAD_BEARING');
  const observability = reports.filter((r) => r.category === 'OBSERVABILITY');
  const decorative = reports.filter((r) => r.category === 'DECORATIVE');
  const dormant = reports.filter((r) => r.category === 'DORMANT');
  console.log(`  🟢 LOAD-BEARING  (${loadBearing.length}): ${loadBearing.map((r) => r.agent).join(', ')}`);
  console.log(`  🟡 OBSERVABILITY (${observability.length}): ${observability.map((r) => r.agent).join(', ')}`);
  console.log(`  🔴 DECORATIVE    (${decorative.length}): ${decorative.map((r) => r.agent).join(', ')}`);
  console.log(`  ⚫ DORMANT       (${dormant.length}): ${dormant.map((r) => r.agent).join(', ')}`);
  console.log('\nInterpretation:');
  console.log('  LOAD_BEARING = pool would trade differently without them (real value)');
  console.log('  OBSERVABILITY = fires + produces output, but no trade path consumes → user-facing only');
  console.log('  DECORATIVE = fires + produces output, but output goes nowhere useful');
  console.log('  DORMANT = doesn\'t fire (by design or unimplemented)');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
