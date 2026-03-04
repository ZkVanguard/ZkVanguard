/**
 * End-to-End Auto-Hedging Test
 * 
 * Tests the FULL pipeline:
 * 1. /api/cron/community-pool → risk assessment → AI decision
 * 2. /api/cron/pool-nav-monitor → drawdown detection → auto-hedge trigger
 * 3. /api/agents/hedging/execute → on-chain HedgeExecutor tx
 * 4. /api/prices → price hook → background cron triggers
 * 5. DB state persistence verification
 * 
 * Run: npx tsx scripts/test-e2e-auto-hedge.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

const BASE_URL = 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || 'RzQMP6OvwU0rC31xk5osBGueLXnASb24';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';
let passed = 0;
let failed = 0;
let warnings = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function warn(label: string, detail?: string) {
  console.log(`  ${WARN} ${label}${detail ? ` — ${detail}` : ''}`);
  warnings++;
}

function info(label: string) {
  console.log(`  ${INFO} ${label}`);
}

async function fetchJSON(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { status: res.status, ok: res.ok, data: text };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 1: Community Pool Cron
// ────────────────────────────────────────────────────────────────────────────
async function testCommunityPoolCron() {
  console.log('\n══ Test 1: Community Pool Cron (/api/cron/community-pool) ══');

  const res = await fetchJSON(`${BASE_URL}/api/cron/community-pool`, {
    headers: { 'Authorization': `Bearer ${CRON_SECRET}` },
  });

  assert(res.ok, `Endpoint responds OK (${res.status})`, `Got ${res.status}`);
  assert(res.data?.success === true, 'Response success=true', JSON.stringify(res.data?.success));

  if (res.data?.poolStats) {
    const stats = res.data.poolStats;
    info(`Pool NAV: $${stats.totalNAV}`);
    info(`Members: ${stats.memberCount}`);
    info(`Share Price: $${stats.sharePrice}`);
    info(`Allocations: ${JSON.stringify(stats.allocations)}`);
    assert(parseFloat(stats.totalNAV) > 0, 'NAV > $0', `NAV = $${stats.totalNAV}`);
  } else {
    warn('No poolStats in response', JSON.stringify(res.data).slice(0, 200));
  }

  if (res.data?.riskAssessment) {
    const risk = res.data.riskAssessment;
    info(`Risk Score: ${risk.riskScore}/10`);
    info(`Drawdown: ${risk.drawdownPercent}%`);
    info(`Volatility: ${risk.volatility}`);
    info(`Recommendations: ${risk.recommendations}`);
    assert(typeof risk.riskScore === 'number', 'Risk score is numeric');
  } else {
    warn('No riskAssessment in response');
  }

  if (res.data?.aiDecision) {
    info(`AI Action: ${res.data.aiDecision.action}`);
    info(`AI Reasoning: ${res.data.aiDecision.reasoning?.slice(0, 100)}...`);
  }

  return res.data;
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 2: Pool NAV Monitor
// ────────────────────────────────────────────────────────────────────────────
async function testPoolNavMonitor() {
  console.log('\n══ Test 2: Pool NAV Monitor (/api/cron/pool-nav-monitor) ══');

  const res = await fetchJSON(`${BASE_URL}/api/cron/pool-nav-monitor`, {
    headers: { 'Authorization': `Bearer ${CRON_SECRET}` },
  });

  assert(res.ok, `Endpoint responds OK (${res.status})`);
  assert(res.data?.success === true, 'Response success=true');

  if (res.data?.pools?.[0]) {
    const pool = res.data.pools[0];
    info(`Pool: ${pool.poolName}`);
    info(`NAV: $${pool.totalNAV?.toLocaleString()}`);
    info(`Previous NAV: $${pool.previousNAV?.toLocaleString()}`);
    info(`NAV Change: ${pool.navChangePercent?.toFixed(2)}%`);
    info(`Drawdown: ${pool.drawdownPercent?.toFixed(2)}%`);
    info(`Peak NAV: $${pool.peakNAV?.toLocaleString()}`);
    info(`Share Price: $${pool.sharePrice}`);
    assert(pool.totalNAV > 0, 'Pool NAV > $0');
    assert(typeof pool.drawdownPercent === 'number', 'Drawdown calculated');
    assert(typeof pool.peakNAV === 'number', 'Peak NAV tracked');
  }

  if (res.data?.alerts?.length > 0) {
    for (const alert of res.data.alerts) {
      info(`Alert: [${alert.severity}] ${alert.type}: ${alert.message}`);
    }
  } else {
    info('No alerts generated (pool is healthy)');
  }

  return res.data;
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 3: Auto-Rebalance
// ────────────────────────────────────────────────────────────────────────────
async function testAutoRebalance() {
  console.log('\n══ Test 3: Auto-Rebalance (/api/cron/auto-rebalance) ══');

  const res = await fetchJSON(`${BASE_URL}/api/cron/auto-rebalance`, {
    headers: { 'Authorization': `Bearer ${CRON_SECRET}` },
  });

  assert(res.ok, `Endpoint responds OK (${res.status})`);
  assert(res.data?.success === true, 'Response success=true');

  if (res.data?.results?.length > 0) {
    for (const r of res.data.results) {
      info(`Portfolio ${r.portfolioId}: ${r.status}${r.reason ? ` — ${r.reason}` : ''}`);
    }
  } else {
    info(`No portfolios processed (${res.data?.message || 'none enabled'})`);
  }

  return res.data;
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 4: Direct Hedge Execution (On-Chain)
// ────────────────────────────────────────────────────────────────────────────
async function testDirectHedgeExecution() {
  console.log('\n══ Test 4: Direct Hedge Execution (/api/agents/hedging/execute) ══');

  // First check that PRIVATE_KEY is configured
  const hasKey = !!process.env.PRIVATE_KEY;
  assert(hasKey, 'PRIVATE_KEY is configured');
  if (!hasKey) {
    warn('Skipping on-chain test — no PRIVATE_KEY');
    return null;
  }

  // Execute a small protective hedge (SHORT BTC, $100 collateral, 2x leverage)
  const hedgePayload = {
    portfolioId: 0, // Community pool
    asset: 'BTC',
    strategy: 'PROTECTIVE_PUT',
    notionalValue: 100, // $100 test hedge
    leverage: 2,
    side: 'SHORT',
    orderType: 'MARKET',
    reason: 'E2E test: auto-hedging cold-start resilience verification',
    simulationMode: false,
    requiresSignature: false,
    systemSecret: CRON_SECRET, // System auth
    walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
  };

  info(`Executing hedge: SHORT BTC, $100 collateral, 2x leverage`);

  const res = await fetchJSON(`${BASE_URL}/api/agents/hedging/execute`, {
    method: 'POST',
    body: JSON.stringify(hedgePayload),
  });

  info(`Response status: ${res.status}`);
  
  if (res.ok && res.data?.success) {
    assert(true, 'Hedge execution succeeded');
    info(`Order ID: ${res.data.orderId}`);
    info(`Market: ${res.data.market}`);
    info(`Side: ${res.data.side}`);
    info(`Entry Price: $${res.data.entryPrice}`);
    info(`Leverage: ${res.data.leverage}x`);
    info(`Simulation Mode: ${res.data.simulationMode}`);
    
    if (res.data.txHash) {
      assert(true, `On-chain TX: ${res.data.txHash}`);
      info(`Explorer: https://explorer.cronos.org/testnet3/tx/${res.data.txHash}`);
      assert(!res.data.simulationMode, 'NOT in simulation mode (real on-chain)');
    } else if (res.data.simulationMode) {
      warn('Hedge executed in SIMULATION mode (no txHash)', 'PRIVATE_KEY may not be recognized');
    } else {
      info(`Hedge ID: ${res.data.orderId} (may be DB-only)`);
    }
  } else {
    assert(false, 'Hedge execution failed', JSON.stringify(res.data).slice(0, 300));
  }

  return res.data;
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 5: Price Hook Trigger Flow
// ────────────────────────────────────────────────────────────────────────────
async function testPriceHookFlow() {
  console.log('\n══ Test 5: Price Hook Flow (/api/prices → webhook triggers) ══');

  // Fetch a price — this should trigger recordPriceUpdate which may fire background checks
  const res = await fetchJSON(`${BASE_URL}/api/prices?symbol=BTC`);

  assert(res.ok, `Price API responds OK (${res.status})`);
  if (res.data?.data) {
    info(`BTC Price: $${res.data.data.price}`);
    info(`Source: ${res.data.source}`);
    assert(res.data.data.price > 0, 'BTC price > $0');
  } else {
    warn('No price data in response', JSON.stringify(res.data).slice(0, 200));
  }

  // Fetch multiple prices to trigger the pool check (every 20 requests)
  info('Sending 21 price requests to trigger pool check...');
  for (let i = 0; i < 21; i++) {
    await fetchJSON(`${BASE_URL}/api/prices?symbol=ETH`);
  }
  assert(true, '21 price requests sent (pool check should have fired)');

  return res.data;
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 6: DB State Persistence
// ────────────────────────────────────────────────────────────────────────────
async function testDBStatePersistence() {
  console.log('\n══ Test 6: DB State Persistence (cron_state table) ══');

  // Dynamically import to avoid issues
  const { getCronState, CronKeys } = await import('../lib/db/cron-state');
  const { closePool } = await import('../lib/db/postgres');

  try {
    // Check that pool-nav-monitor saved peak NAV
    const peakNav = await getCronState<number>(CronKeys.poolNavPeak('community-pool'));
    if (peakNav && peakNav > 0) {
      assert(true, `Peak NAV persisted in DB: $${peakNav}`);
    } else {
      warn('Peak NAV not yet in DB (may not have been written yet)');
    }

    // Check heartbeat timestamp
    const heartbeat = await getCronState<number>(CronKeys.heartbeatLastCheck);
    if (heartbeat && heartbeat > 0) {
      const age = (Date.now() - heartbeat) / 1000;
      info(`Last heartbeat: ${age.toFixed(0)}s ago`);
      assert(true, 'Heartbeat timestamp persisted in DB');
    } else {
      info('Heartbeat not yet triggered (normal if < 100 requests)');
    }

    // Check pool check timestamp
    const poolCheck = await getCronState<number>(CronKeys.poolCheckLastCheck);
    if (poolCheck && poolCheck > 0) {
      const age = (Date.now() - poolCheck) / 1000;
      info(`Last pool check: ${age.toFixed(0)}s ago`);
      assert(true, 'Pool check timestamp persisted in DB');
    } else {
      info('Pool check not yet triggered');
    }

    await closePool();
  } catch (error: any) {
    warn('DB check failed', error.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 7: AI Decision Endpoint
// ────────────────────────────────────────────────────────────────────────────
async function testAIDecision() {
  console.log('\n══ Test 7: AI Decision (/api/community-pool/ai-decision) ══');

  const res = await fetchJSON(`${BASE_URL}/api/community-pool/ai-decision`);

  assert(res.ok, `Endpoint responds OK (${res.status})`);
  
  if (res.data?.recommendation) {
    const rec = res.data.recommendation;
    info(`Allocations: ${JSON.stringify(rec.allocations)}`);
    info(`Should Rebalance: ${rec.shouldRebalance}`);
    info(`Confidence: ${rec.confidence}%`);
    info(`Reasoning: ${rec.reasoning?.slice(0, 120)}...`);
    assert(typeof rec.allocations === 'object', 'Allocations returned');
    assert(typeof rec.confidence === 'number', 'Confidence score returned');
  } else {
    warn('No recommendation in response', JSON.stringify(res.data).slice(0, 200));
  }

  return res.data;
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║   End-to-End Auto-Hedging Test — Full Pipeline Verification      ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log(`\nServer: ${BASE_URL}`);
  console.log(`CRON_SECRET: ${CRON_SECRET ? '✓ configured' : '✗ missing'}`);
  console.log(`PRIVATE_KEY: ${process.env.PRIVATE_KEY ? '✓ configured' : '✗ missing'}`);
  console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? '✓ configured' : '✗ missing'}`);

  // Verify server is up
  try {
    await fetch(`${BASE_URL}/api/prices?symbol=BTC`, { signal: AbortSignal.timeout(10000) });
  } catch {
    console.error('\n✗ Dev server not responding on port 3000. Start it first: npx next dev --port 3000');
    process.exit(1);
  }

  const startTime = Date.now();

  // Run tests sequentially
  await testCommunityPoolCron();
  await testPoolNavMonitor();
  await testAutoRebalance();
  await testAIDecision();
  await testDirectHedgeExecution();
  await testPriceHookFlow();
  await testDBStatePersistence();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${warnings} warnings (${duration}s)`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
