/**
 * Comprehensive Platform Integration Test
 * Tests: AI Agents, Live Price Feeds, Oracles, Multi-Chain, ZK Proofs
 * Target: https://zkvanguard.xyz
 */

const BASE = 'https://www.zkvanguard.xyz';
const TIMEOUT = 15000;

const results = { pass: 0, fail: 0, skip: 0, details: [] };

async function test(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    results.pass++;
    results.details.push({ name, status: 'PASS', ms, data: result });
    console.log(`  ✅ ${name} (${ms}ms)`);
    if (result && typeof result === 'object') {
      const preview = JSON.stringify(result).substring(0, 200);
      console.log(`     ${preview}`);
    }
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err.message || String(err);
    if (msg.includes('SKIP')) {
      results.skip++;
      results.details.push({ name, status: 'SKIP', ms, error: msg });
      console.log(`  ⏭️  ${name} (SKIPPED: ${msg})`);
    } else {
      results.fail++;
      results.details.push({ name, status: 'FAIL', ms, error: msg });
      console.log(`  ❌ ${name} (${ms}ms) — ${msg}`);
    }
  }
}

async function fetchJSON(path, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || TIMEOUT);
  try {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.substring(0, 500) }; }
    if (!res.ok && !opts.allowError) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).substring(0, 200)}`);
    }
    return { status: res.status, data: json };
  } finally {
    clearTimeout(timer);
  }
}

// ════════════════════════════════════════════════════════
// 1. CORE HEALTH
// ════════════════════════════════════════════════════════
async function testCoreHealth() {
  console.log('\n═══ 1. CORE HEALTH ═══');
  
  await test('Platform Health Check', async () => {
    const { data } = await fetchJSON('/api/health');
    return data;
  });
  
  await test('Platform Stats (live metrics)', async () => {
    const { data } = await fetchJSON('/api/platform-stats');
    if (data.chains < 1) throw new Error('No chains reported');
    return data;
  });

  await test('Chat Health', async () => {
    const { data } = await fetchJSON('/api/chat/health');
    return data;
  });
}

// ════════════════════════════════════════════════════════
// 2. AI AGENTS
// ════════════════════════════════════════════════════════
async function testAgents() {
  console.log('\n═══ 2. AI AGENTS ═══');
  
  await test('Agent Status (all 6 agents)', async () => {
    const { data } = await fetchJSON('/api/agents/status');
    return data;
  });
  
  await test('Agent Activity Feed', async () => {
    const { data } = await fetchJSON('/api/agents/activity');
    return data;
  });

  await test('Agent Command (natural language)', async () => {
    const { data } = await fetchJSON('/api/agents/command', {
      method: 'POST',
      body: JSON.stringify({ command: 'what is the current BTC price?', userId: 'test' }),
      timeout: 30000,
    });
    return data;
  });

  await test('Risk Assessment Agent', async () => {
    const { data } = await fetchJSON('/api/agents/risk/assess', {
      method: 'POST',
      body: JSON.stringify({ address: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c', portfolioValue: 100000, positions: [{symbol: 'BTC', amount: 1}] }),
      timeout: 20000,
    });
    return data;
  });
  
  await test('Hedging Recommendation Agent', async () => {
    const { data } = await fetchJSON('/api/agents/hedging/recommend', {
      method: 'POST',
      body: JSON.stringify({ address: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c', portfolioValue: 100000, positions: [{symbol: 'BTC', amount: 1}] }),
      timeout: 20000,
    });
    return data;
  });

  await test('Agent Insight Summary', async () => {
    const { data } = await fetchJSON('/api/agents/insight-summary');
    return data;
  });

  await test('Agent Monitor', async () => {
    const { data } = await fetchJSON('/api/agents/monitor');
    return data;
  });
}

// ════════════════════════════════════════════════════════
// 3. LIVE PRICE FEEDS & ORACLES
// ════════════════════════════════════════════════════════
async function testPriceFeeds() {
  console.log('\n═══ 3. LIVE PRICE FEEDS & ORACLES ═══');
  
  await test('Market Data (BTC/ETH/CRO prices)', async () => {
    const { data } = await fetchJSON('/api/market-data');
    return data;
  });

  await test('Prices API', async () => {
    const { data } = await fetchJSON('/api/prices?symbol=BTC');
    return data;
  });

  await test('Polymarket Predictions', async () => {
    const { data } = await fetchJSON('/api/polymarket');
    return data;
  });

  await test('Price Predictions', async () => {
    const { data } = await fetchJSON('/api/predictions');
    return data;
  });

  await test('Price Alerts', async () => {
    const { data } = await fetchJSON('/api/price-alerts');
    return data;
  });
}

// ════════════════════════════════════════════════════════
// 4. MULTI-CHAIN INTEGRATION
// ════════════════════════════════════════════════════════
async function testChains() {
  console.log('\n═══ 4. MULTI-CHAIN INTEGRATION ═══');
  
  // Cronos
  await test('Cronos Explorer API', async () => {
    const { data } = await fetchJSON('/api/cronos-explorer?address=0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c');
    return data;
  });
  
  await test('Ethereum RPC Proxy', async () => {
    const { data } = await fetchJSON('/api/rpc/ethereum', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    return data;
  });

  // Oasis
  await test('Oasis Explorer API', async () => {
    const { data } = await fetchJSON('/api/oasis-explorer?address=0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c');
    return data;
  });

  await test('Oasis Portfolio', async () => {
    const { data } = await fetchJSON('/api/oasis/portfolio', { allowError: true });
    return data;
  });

  await test('Oasis Hedging', async () => {
    const { data } = await fetchJSON('/api/oasis/hedging', { allowError: true });
    return data;
  });

  await test('Oasis Community Pool', async () => {
    const { data } = await fetchJSON('/api/oasis/community-pool', { allowError: true });
    return data;
  });

  // SUI
  await test('SUI Community Pool', async () => {
    const { data } = await fetchJSON('/api/sui/community-pool', { allowError: true });
    return data;
  });

  // x402 Protocol
  await test('x402 Challenge', async () => {
    const { data } = await fetchJSON('/api/x402/challenge', { allowError: true });
    return data;
  });

  // Gasless
  await test('Gasless Paymaster', async () => {
    const { data } = await fetchJSON('/api/gasless/paymaster', { allowError: true });
    return data;
  });
}

// ════════════════════════════════════════════════════════
// 5. ZK PROOF SYSTEM
// ════════════════════════════════════════════════════════
async function testZK() {
  console.log('\n═══ 5. ZK PROOF SYSTEM ═══');
  
  await test('ZK Proof Health', async () => {
    const { data } = await fetchJSON('/api/zk-proof/health');
    return data;
  });

  await test('ZK Proof Generation', async () => {
    const { data } = await fetchJSON('/api/zk-proof/generate', {
      method: 'POST',
      body: JSON.stringify({
        scenario: 'risk-calculation',
        statement: {
          portfolioValue: 50000,
          riskScore: 0.35,
          hedgeRatio: 0.6,
        },
        witness: {
          secretKey: 'test-witness-key',
          timestamp: Date.now(),
        },
      }),
      timeout: 30000,
    });
    return data;
  });

  await test('ZK Proof Verify', async () => {
    const { data } = await fetchJSON('/api/zk-proof/verify', {
      method: 'POST',
      body: JSON.stringify({ proofHash: 'test-proof-hash', proofType: 'risk-calculation' }),
      allowError: true,
    });
    return data;
  });

  await test('ZK Proof Lookup', async () => {
    const { data } = await fetchJSON('/api/zk-proof/lookup?hash=test', { allowError: true });
    return data;
  });

  await test('ZK Verify Authenticity', async () => {
    const { data } = await fetchJSON('/api/zk-proof/verify-authenticity', { allowError: true });
    return data;
  });

  await test('ZK Ownership Verification', async () => {
    const { data } = await fetchJSON('/api/zk/verify-ownership', {
      method: 'POST',
      body: JSON.stringify({ walletAddress: '0x0000000000000000000000000000000000000000', hedgeId: 'test' }),
      allowError: true,
      timeout: 20000,
    });
    return data;
  });
}

// ════════════════════════════════════════════════════════
// 6. COMMUNITY POOL & PORTFOLIO
// ════════════════════════════════════════════════════════
async function testPoolAndPortfolio() {
  console.log('\n═══ 6. COMMUNITY POOL & PORTFOLIO ═══');
  
  await test('Community Pool Status', async () => {
    const { data } = await fetchJSON('/api/community-pool');
    return data;
  });

  await test('Community Pool Treasury', async () => {
    const { data } = await fetchJSON('/api/community-pool/treasury/status');
    return data;
  });

  await test('Community Pool Risk Metrics', async () => {
    const { data } = await fetchJSON('/api/community-pool/risk-metrics', { allowError: true });
    return data;
  });

  await test('Portfolio List', async () => {
    const { data } = await fetchJSON('/api/portfolio/list', { allowError: true });
    return data;
  });

  await test('On-Chain Portfolio', async () => {
    const { data } = await fetchJSON('/api/portfolio/onchain', { allowError: true });
    return data;
  });

  await test('Hedge Tracker', async () => {
    const { data } = await fetchJSON('/api/agents/hedging/tracker', { allowError: true });
    return data;
  });

  await test('Hedge List', async () => {
    const { data } = await fetchJSON('/api/agents/hedging/list', { allowError: true });
    return data;
  });

  await test('Hedge PnL', async () => {
    const { data } = await fetchJSON('/api/agents/hedging/pnl', { allowError: true });
    return data;
  });

  await test('Analytics', async () => {
    const { data } = await fetchJSON('/api/analytics', { allowError: true });
    return data;
  });
}

// ════════════════════════════════════════════════════════
// RUN ALL
// ════════════════════════════════════════════════════════
async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   ZkVanguard Platform Integration Test Suite         ║');
  console.log(`║   Target: ${BASE}                     ║`);
  console.log(`║   Date: ${new Date().toISOString()}             ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');

  await testCoreHealth();
  await testAgents();
  await testPriceFeeds();
  await testChains();
  await testZK();
  await testPoolAndPortfolio();

  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log(`║   RESULTS: ✅ ${results.pass} passed | ❌ ${results.fail} failed | ⏭️  ${results.skip} skipped  ║`);
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  // Print failures summary
  const failures = results.details.filter(d => d.status === 'FAIL');
  if (failures.length > 0) {
    console.log('FAILURES:');
    for (const f of failures) {
      console.log(`  ❌ ${f.name}: ${f.error}`);
    }
    console.log();
  }

  // Print JSON summary
  console.log(JSON.stringify({
    totalTests: results.pass + results.fail + results.skip,
    passed: results.pass,
    failed: results.fail,
    skipped: results.skip,
    timestamp: new Date().toISOString(),
  }));
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
