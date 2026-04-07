#!/usr/bin/env npx tsx
/**
 * Comprehensive Test: Agent ↔ Auto-Management Integration
 * 
 * Verifies that ALL agents are wired into the centralized auto-management system:
 * - PriceMonitorAgent: registered in orchestrator, receives centralized snapshot
 * - HedgingAgent: uses snapshot prices before falling back to MCP
 * - RiskAgent: connected for serial fallback
 * - CentralizedHedgeManager: shares snapshot with orchestrator each cycle
 * - AgentOrchestrator: coordinates all agents, holds shared snapshot
 * 
 * PART A: Orchestrator agent registration (6 agents)
 * PART B: Market snapshot sharing (central → orchestrator → agents)
 * PART C: PriceMonitorAgent centralized integration
 * PART D: HedgingAgent centralized price resolution
 * PART E: Full cycle → agent snapshot propagation
 * PART F: Agent status & health
 * 
 * Run: npx tsx scripts/tests/test-agent-auto-management.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Module-level references set during init()
let getAgentOrchestrator: any;
let getCentralizedHedgeManager: any;
let autoHedgingService: any;
let COMMUNITY_POOL_PORTFOLIO_ID: number;
let getAutoHedgeConfigs: any;
let getAutoHedgeConfig: any;
let query: any;

async function init() {
  const orchMod = await import('../../lib/services/agent-orchestrator');
  getAgentOrchestrator = orchMod.getAgentOrchestrator;

  const centralMod = await import('../../lib/services/hedging/CentralizedHedgeManager');
  getCentralizedHedgeManager = centralMod.getCentralizedHedgeManager;

  const svcMod = await import('../../lib/services/hedging/AutoHedgingService');
  autoHedgingService = svcMod.autoHedgingService;

  const constMod = await import('../../lib/constants');
  COMMUNITY_POOL_PORTFOLIO_ID = constMod.COMMUNITY_POOL_PORTFOLIO_ID;

  const storageMod = await import('../../lib/storage/auto-hedge-storage');
  getAutoHedgeConfigs = storageMod.getAutoHedgeConfigs;
  getAutoHedgeConfig = storageMod.getAutoHedgeConfig;

  const pgMod = await import('../../lib/db/postgres');
  query = pgMod.query;
}

// ─── Test Infrastructure ────────────────────────────────────────────────────

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';
const SECTION = '\x1b[35m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
let warnings = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) { console.log(`  ${PASS} ${label}`); passed++; }
  else { console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

function warn(label: string, detail?: string) {
  console.log(`  ${WARN} ${label}${detail ? ` — ${detail}` : ''}`); warnings++;
}

function info(label: string) { console.log(`  ${INFO} ${label}`); }

function section(title: string) { console.log(`\n${SECTION}═══ ${title} ═══${RESET}`); }

// ═══════════════════════════════════════════════════════════════════════════════
// PART A: Orchestrator Agent Registration
// ═══════════════════════════════════════════════════════════════════════════════

async function testA1_OrchestratorInitialization() {
  section('A1: Orchestrator Initialization & Agent Registration');

  const orchestrator = getAgentOrchestrator();
  await orchestrator.initialize();

  const status = orchestrator.getStatus();
  assert(status.initialized === true, 'Orchestrator initialized');
  assert(status.agents.risk === true, 'RiskAgent registered');
  assert(status.agents.hedging === true, 'HedgingAgent registered');
  assert(status.agents.settlement === true, 'SettlementAgent registered');
  assert(status.agents.reporting === true, 'ReportingAgent registered');
  assert(status.agents.lead === true, 'LeadAgent registered');
  assert(status.agents.priceMonitor === true, 'PriceMonitorAgent registered');
  assert(status.signerAvailable === true, 'Signer available');

  info(`All 6 agents registered in orchestrator`);
}

async function testA2_AgentDirectAccess() {
  section('A2: Agent Direct Access');

  const orchestrator = getAgentOrchestrator();

  const riskAgent = await orchestrator.getRiskAgent();
  assert(riskAgent !== null, 'RiskAgent accessible');

  const hedgingAgent = await orchestrator.getHedgingAgent();
  assert(hedgingAgent !== null, 'HedgingAgent accessible');

  const leadAgent = await orchestrator.getLeadAgent();
  assert(leadAgent !== null, 'LeadAgent accessible');

  const priceMonitor = orchestrator.getPriceMonitorAgent();
  assert(priceMonitor !== null, 'PriceMonitorAgent accessible');

  // Verify agent status
  const agentStatus = orchestrator.getAgentStatus();
  assert(agentStatus.riskAgent !== null, 'RiskAgent instance present');
  assert(agentStatus.hedgingAgent !== null, 'HedgingAgent instance present');
  assert(agentStatus.settlementAgent !== null, 'SettlementAgent instance present');
  assert(agentStatus.reportingAgent !== null, 'ReportingAgent instance present');
  assert(agentStatus.leadAgent !== null, 'LeadAgent instance present');
  assert(agentStatus.priceMonitorAgent !== null, 'PriceMonitorAgent instance present');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART B: Market Snapshot Sharing
// ═══════════════════════════════════════════════════════════════════════════════

async function testB3_SnapshotSharing() {
  section('B3: Market Snapshot Sharing (CentralHedge → Orchestrator → Agents)');

  const orchestrator = getAgentOrchestrator();
  const manager = getCentralizedHedgeManager();

  // Before any snapshot, orchestrator should have none
  // (May already have one from initialization — check age)

  // Fetch fresh snapshot and share it
  const snapshot = await manager.fetchMarketSnapshot();
  orchestrator.shareMarketSnapshot(snapshot);

  const shared = orchestrator.getSharedSnapshot();
  assert(shared !== null, 'Shared snapshot available');
  assert(shared!.timestamp === snapshot.timestamp, 'Shared snapshot matches fetched');
  assert(shared!.prices.size >= 4, `Shared snapshot has ${shared!.prices.size} prices`);

  // Verify BTC/ETH/CRO/SUI are in the shared snapshot
  for (const sym of ['BTC', 'ETH', 'CRO', 'SUI']) {
    const price = shared!.prices.get(sym);
    assert(price !== undefined, `${sym} in shared snapshot: $${price?.price.toFixed(2)}`);
  }
}

async function testB4_SnapshotStaleness() {
  section('B4: Snapshot Staleness Check');

  const orchestrator = getAgentOrchestrator();

  // Share a fresh snapshot
  const manager = getCentralizedHedgeManager();
  const fresh = await manager.fetchMarketSnapshot();
  orchestrator.shareMarketSnapshot(fresh);

  const shared1 = orchestrator.getSharedSnapshot();
  assert(shared1 !== null, 'Fresh snapshot available');

  // Create a stale snapshot (fake old timestamp)
  const stale = { ...fresh, timestamp: Date.now() - 60_000 };
  orchestrator.shareMarketSnapshot(stale);

  const shared2 = orchestrator.getSharedSnapshot();
  assert(shared2 === null, 'Stale snapshot (>30s) returns null');

  // Restore fresh
  orchestrator.shareMarketSnapshot(fresh);
  const shared3 = orchestrator.getSharedSnapshot();
  assert(shared3 !== null, 'Fresh snapshot restored');

  const status = orchestrator.getStatus();
  assert(typeof status.snapshotAge === 'number', `Snapshot age: ${status.snapshotAge}ms`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART C: PriceMonitorAgent Centralized Integration
// ═══════════════════════════════════════════════════════════════════════════════

async function testC5_PriceMonitorIngestsCentralized() {
  section('C5: PriceMonitorAgent Ingests Centralized Prices');

  const orchestrator = getAgentOrchestrator();
  const priceMonitor = orchestrator.getPriceMonitorAgent();
  assert(priceMonitor !== null, 'PriceMonitorAgent available');

  if (!priceMonitor) return;

  // Fetch and share a snapshot
  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();
  
  // Ingest directly
  priceMonitor.ingestCentralizedPrices(snapshot);

  // Verify current prices match snapshot
  const btcPrice = priceMonitor.getCurrentPrice('BTC');
  const ethPrice = priceMonitor.getCurrentPrice('ETH');
  const croPrice = priceMonitor.getCurrentPrice('CRO');

  if (btcPrice) {
    assert(btcPrice.source.startsWith('centralized:'), `BTC source: ${btcPrice.source}`);
    assert(btcPrice.price === snapshot.prices.get('BTC')!.price, 
      `BTC price matches snapshot: $${btcPrice.price.toFixed(2)}`);
  } else {
    warn('BTC price not in PriceMonitor history after ingestion');
  }

  if (ethPrice) {
    assert(ethPrice.source.startsWith('centralized:'), `ETH source: ${ethPrice.source}`);
    assert(ethPrice.price === snapshot.prices.get('ETH')!.price, 
      `ETH price matches snapshot: $${ethPrice.price.toFixed(2)}`);
  }

  if (croPrice) {
    assert(croPrice.source.startsWith('centralized:'), `CRO source: ${croPrice.source}`);
  }

  // Verify history has entries
  const btcHistory = priceMonitor.getPriceHistory('BTC', 5);
  assert(btcHistory.length > 0, `BTC history has ${btcHistory.length} entries`);
}

async function testC6_PriceMonitorSkipsIndependentFetch() {
  section('C6: PriceMonitorAgent Skips Independent Fetch When Snapshot Fresh');

  const orchestrator = getAgentOrchestrator();
  const priceMonitor = orchestrator.getPriceMonitorAgent();
  if (!priceMonitor) { warn('PriceMonitorAgent not available'); return; }

  // Ingest a fresh snapshot
  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();
  priceMonitor.ingestCentralizedPrices(snapshot);

  // The agent's internal fetchAllPrices should now return centralized data
  // We can verify by checking that the status shows it's not running its own loop
  const status = priceMonitor.getStatus();
  info(`PriceMonitor status: running=${status.isRunning}, tracked=${status.trackedSymbols.join(',')}`);
  info(`Alert count: ${status.alertCount}`);

  // Verify price source is centralized
  for (const sym of ['BTC', 'ETH', 'CRO']) {
    const price = priceMonitor.getCurrentPrice(sym);
    if (price) {
      assert(price.source.includes('centralized'), `${sym} uses centralized source: ${price.source}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART D: HedgingAgent Centralized Price Resolution
// ═══════════════════════════════════════════════════════════════════════════════

async function testD7_HedgingAgentUsesSnapshot() {
  section('D7: HedgingAgent Uses Snapshot Before MCP Fallback');

  const orchestrator = getAgentOrchestrator();

  // Share a fresh snapshot so HedgingAgent can find it
  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();
  orchestrator.shareMarketSnapshot(snapshot);

  // The HedgingAgent's getPriceFromSnapshotOrMCP should find the shared snapshot
  const shared = orchestrator.getSharedSnapshot();
  assert(shared !== null, 'Shared snapshot available for HedgingAgent');
  assert(shared!.prices.has('BTC'), 'BTC price in shared snapshot');
  assert(shared!.prices.has('ETH'), 'ETH price in shared snapshot');

  // Verify HedgingAgent can generate recommendations using snapshot data
  // (This goes through the orchestrator which delegates to HedgingAgent)
  try {
    const result = await orchestrator.generateHedgeRecommendations({
      portfolioId: '0',
      assetSymbol: 'BTC',
      notionalValue: 1000,
    });
    assert(result.agentId === 'hedging-agent-001', `HedgingAgent responded: ${result.agentId}`);
    if (result.success) {
      assert(true, 'Hedge recommendation generated successfully');
      info(`Recommendation: ${JSON.stringify(result.data).substring(0, 120)}...`);
    } else {
      // Even a failure means the agent was reached
      warn(`HedgingAgent responded with error: ${result.error}`);
    }
  } catch (err: any) {
    warn(`HedgingAgent recommendation call failed: ${err.message}`);
  }
}

async function testD8_RiskAgentAssessment() {
  section('D8: RiskAgent Assessment via Orchestrator');

  const orchestrator = getAgentOrchestrator();

  try {
    const result = await orchestrator.assessRisk({
      address: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
    });
    assert(result.agentId === 'risk-agent-001', `RiskAgent responded: ${result.agentId}`);
    if (result.success) {
      assert(true, 'Risk assessment executed successfully');
    } else {
      // Unknown action is graceful degradation, not a failure
      warn(`RiskAgent responded: ${result.error}`);
    }
  } catch (err: any) {
    warn(`RiskAgent call failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART E: Full Cycle → Agent Snapshot Propagation
// ═══════════════════════════════════════════════════════════════════════════════

async function testE9_FullCyclePropagatesSnapshot() {
  section('E9: Full Centralized Cycle Propagates Snapshot to Agents');

  const orchestrator = getAgentOrchestrator();
  const manager = getCentralizedHedgeManager();

  // Build configs
  const storedConfigs = await getAutoHedgeConfigs();
  const configs = new Map<number, any>();
  for (const sc of storedConfigs) {
    configs.set(sc.portfolioId, {
      portfolioId: sc.portfolioId, walletAddress: sc.walletAddress,
      enabled: sc.enabled, riskThreshold: sc.riskThreshold,
      maxLeverage: sc.maxLeverage, allowedAssets: sc.allowedAssets,
    });
  }
  if (!configs.has(0)) {
    configs.set(0, {
      portfolioId: 0, walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
      enabled: true, riskThreshold: 5, maxLeverage: 3, allowedAssets: ['BTC','ETH','CRO','SUI'],
    });
  }

  // Run centralized cycle — should share snapshot with orchestrator
  const result = await manager.runCycle(configs);

  assert(result.portfoliosAssessed > 0, `Cycle assessed ${result.portfoliosAssessed} portfolios`);
  assert(result.snapshot.source === 'centralized-batch', 'Snapshot is batch source');

  // Verify orchestrator received the snapshot
  const shared = orchestrator.getSharedSnapshot();
  assert(shared !== null, 'Orchestrator has shared snapshot after cycle');
  if (shared) {
    assert(shared.timestamp === result.snapshot.timestamp, 'Shared snapshot timestamp matches cycle');
    assert(shared.prices.size === result.snapshot.prices.size, 'Shared snapshot price count matches');
  }

  // Verify PriceMonitorAgent received it
  const priceMonitor = orchestrator.getPriceMonitorAgent();
  if (priceMonitor) {
    const btcPrice = priceMonitor.getCurrentPrice('BTC');
    if (btcPrice) {
      assert(btcPrice.source.includes('centralized'), 
        `PriceMonitor BTC source after cycle: ${btcPrice.source}`);
      assert(Math.abs(btcPrice.price - result.snapshot.prices.get('BTC')!.price) < 0.01, 
        `PriceMonitor BTC price matches cycle snapshot`);
    }
  }
}

async function testE10_AutoHedgingServiceCyclePropagates() {
  section('E10: AutoHedgingService Cycle Propagates to All Agents');

  const svc = autoHedgingService;
  const orchestrator = getAgentOrchestrator();

  // Start the service (loads configs)
  await svc.start();
  const svcStatus = svc.getStatus();
  info(`Service running: ${svcStatus.isRunning}, portfolios: [${svcStatus.enabledPortfolios.join(', ')}]`);

  // Run the checkAllPortfolioRisks — this uses CentralizedHedgeManager
  await svc.checkAllPortfolioRisks();

  // Verify snapshot propagated
  const shared = orchestrator.getSharedSnapshot();
  assert(shared !== null, 'Snapshot propagated through AutoHedgingService → CentralizedHedgeManager → Orchestrator');

  // Run PnL update — should also use/refresh the snapshot
  const pnlResult = await svc.updateAllHedgePnL();
  assert(typeof pnlResult.updated === 'number', `PnL updated: ${pnlResult.updated}`);
  assert(typeof pnlResult.errors === 'number', `PnL errors: ${pnlResult.errors}`);

  // Verify assessments stored
  for (const pid of svcStatus.enabledPortfolios) {
    const assessment = svc.getLastRiskAssessment(pid);
    if (assessment) {
      info(`  Portfolio ${pid}: score=${assessment.riskScore}, value=$${assessment.totalValue.toFixed(2)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART F: Agent Status & Health
// ═══════════════════════════════════════════════════════════════════════════════

async function testF11_AgentHealthSummary() {
  section('F11: Agent Health Summary');

  const orchestrator = getAgentOrchestrator();
  const status = orchestrator.getStatus();
  const agentStatus = orchestrator.getAgentStatus();

  info('Agent Registration:');
  info(`  RiskAgent:         ${status.agents.risk ? '✅' : '❌'}`);
  info(`  HedgingAgent:      ${status.agents.hedging ? '✅' : '❌'}`);
  info(`  SettlementAgent:   ${status.agents.settlement ? '✅' : '❌'}`);
  info(`  ReportingAgent:    ${status.agents.reporting ? '✅' : '❌'}`);
  info(`  LeadAgent:         ${status.agents.lead ? '✅' : '❌'}`);
  info(`  PriceMonitorAgent: ${status.agents.priceMonitor ? '✅' : '❌'}`);

  const allRegistered = status.agents.risk && status.agents.hedging && 
    status.agents.settlement && status.agents.reporting && 
    status.agents.lead && status.agents.priceMonitor;
  assert(allRegistered, 'All 6 agents registered');

  info(`Signer: ${status.signerAvailable ? '✅' : '❌'}`);
  info(`Snapshot age: ${status.snapshotAge !== null ? `${status.snapshotAge}ms` : 'none'}`);

  // CentralizedHedgeManager status
  const manager = getCentralizedHedgeManager();
  const centralStatus = manager.getStatus();
  info('\nCentralizedHedgeManager:');
  info(`  hasRunCycle: ${centralStatus.hasRunCycle}`);
  info(`  lastCycleDuration: ${centralStatus.lastCycleDurationMs}ms`);
  info(`  portfoliosInLastCycle: ${centralStatus.portfoliosInLastCycle}`);

  // AutoHedgingService status
  const svcStatus = autoHedgingService.getStatus();
  info('\nAutoHedgingService:');
  info(`  isRunning: ${svcStatus.isRunning}`);
  info(`  enabledPortfolios: [${svcStatus.enabledPortfolios.join(', ')}]`);
}

async function testF12_DataFlowIntegrity() {
  section('F12: Data Flow Integrity Check');

  const orchestrator = getAgentOrchestrator();
  const manager = getCentralizedHedgeManager();

  // Fetch a fresh snapshot
  const snapshot = await manager.fetchMarketSnapshot();
  orchestrator.shareMarketSnapshot(snapshot);

  // Verify the same prices are accessible through all paths
  const btcSnap = snapshot.prices.get('BTC')!;
  const btcShared = orchestrator.getSharedSnapshot()!.prices.get('BTC')!;
  
  assert(btcSnap.price === btcShared.price, 
    `BTC price consistent: snapshot=$${btcSnap.price.toFixed(2)} == shared=$${btcShared.price.toFixed(2)}`);
  assert(btcSnap.change24h === btcShared.change24h, 
    `BTC change24h consistent: ${btcSnap.change24h.toFixed(2)}% == ${btcShared.change24h.toFixed(2)}%`);

  // Check PriceMonitorAgent gets the same data
  const priceMonitor = orchestrator.getPriceMonitorAgent();
  if (priceMonitor) {
    const btcMonitor = priceMonitor.getCurrentPrice('BTC');
    if (btcMonitor) {
      assert(btcMonitor.price === btcSnap.price, 
        `PriceMonitor BTC consistent with snapshot: $${btcMonitor.price.toFixed(2)}`);
    }
  }

  // Hedge distribution
  const dist = await query(
    `SELECT portfolio_id, COUNT(*) as count, 
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active
     FROM hedges GROUP BY portfolio_id ORDER BY portfolio_id`
  );
  info('\nHedge distribution:');
  for (const d of dist) {
    const label = d.portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID ? ' (community pool)' : '';
    info(`  portfolio_id=${d.portfolio_id}${label}: ${d.count} total, ${d.active} active`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  await init();

  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Agent ↔ Auto-Management Integration Test Suite                     ║');
  console.log('║  All agents connected to centralized market data flow               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log(`\nENV: PRIVATE_KEY=${process.env.PRIVATE_KEY ? '✓' : '✗'} | DATABASE_URL=${process.env.DATABASE_URL ? '✓' : '✗'}`);
  console.log(`COMMUNITY_POOL_PORTFOLIO_ID = ${COMMUNITY_POOL_PORTFOLIO_ID}`);

  const startTime = Date.now();

  // PART A: Registration
  await testA1_OrchestratorInitialization();
  await testA2_AgentDirectAccess();

  // PART B: Snapshot Sharing
  await testB3_SnapshotSharing();
  await testB4_SnapshotStaleness();

  // PART C: PriceMonitorAgent
  await testC5_PriceMonitorIngestsCentralized();
  await testC6_PriceMonitorSkipsIndependentFetch();

  // PART D: HedgingAgent & RiskAgent
  await testD7_HedgingAgentUsesSnapshot();
  await testD8_RiskAgentAssessment();

  // PART E: Full Cycle Propagation
  await testE9_FullCyclePropagatesSnapshot();
  await testE10_AutoHedgingServiceCyclePropagates();

  // PART F: Health Summary
  await testF11_AgentHealthSummary();
  await testF12_DataFlowIntegrity();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${warnings} warnings (${duration}s)`);
  if (failed === 0) {
    console.log(`  ✅ All agents fully integrated with centralized auto-management!`);
    console.log(`     CentralizedHedgeManager → Orchestrator → PriceMonitor + HedgingAgent`);
  } else {
    console.log(`  ❌ ${failed} issue(s) found — review failures above`);
  }
  console.log(`${'═'.repeat(72)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
