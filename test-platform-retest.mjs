/**
 * Retest failed endpoints with correct parameters
 * Focus: POST endpoints that need body, API routes needing query params, ZK backend
 */

const BASE = 'https://zkvanguard.xyz';

async function fetchJSON(path, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 20000);
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
    return { status: res.status, ok: res.ok, data: json, headers: Object.fromEntries(res.headers) };
  } catch (err) {
    return { status: 0, ok: false, data: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('═══ RETEST: Investigating 11 failures ═══\n');

  // 1. POST endpoints that threw "fetch failed" — likely Vercel serverless function size/timeout
  console.log('--- POST Agent Commands (fetch failed — checking if serverless function error) ---');
  
  const agentCmd = await fetchJSON('/api/agents/command', {
    method: 'POST',
    body: JSON.stringify({ command: 'show portfolio status', userId: 'test-runner' }),
    timeout: 60000,
  });
  console.log(`Agent Command: status=${agentCmd.status}, error=${agentCmd.error}`);
  if (agentCmd.data) console.log(`  data: ${JSON.stringify(agentCmd.data).substring(0, 300)}`);

  const riskAssess = await fetchJSON('/api/agents/risk/assess', {
    method: 'POST',
    body: JSON.stringify({ portfolioId: '1' }),
    timeout: 60000,
  });
  console.log(`Risk Assess: status=${riskAssess.status}, error=${riskAssess.error}`);
  if (riskAssess.data) console.log(`  data: ${JSON.stringify(riskAssess.data).substring(0, 300)}`);

  const hedgeRec = await fetchJSON('/api/agents/hedging/recommend', {
    method: 'POST',
    body: JSON.stringify({ asset: 'ETH', portfolioValue: 50000 }),
    timeout: 60000,
  });
  console.log(`Hedging Recommend: status=${hedgeRec.status}, error=${hedgeRec.error}`);
  if (hedgeRec.data) console.log(`  data: ${JSON.stringify(hedgeRec.data).substring(0, 300)}`);

  // 2. APIs that need query params (these are NOT failures — they just need params)
  console.log('\n--- APIs needing params (corrected calls) ---');
  
  const prices = await fetchJSON('/api/prices?symbol=BTC');
  console.log(`Prices BTC: status=${prices.status}`);
  if (prices.data) console.log(`  data: ${JSON.stringify(prices.data).substring(0, 300)}`);

  const pricesMulti = await fetchJSON('/api/prices?symbols=BTC,ETH,CRO,SUI');
  console.log(`Prices Multi: status=${pricesMulti.status}`);
  if (pricesMulti.data) console.log(`  data: ${JSON.stringify(pricesMulti.data).substring(0, 300)}`);

  const cronosExplorer = await fetchJSON('/api/cronos-explorer?address=0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c');
  console.log(`Cronos Explorer: status=${cronosExplorer.status}`);
  if (cronosExplorer.data) console.log(`  data: ${JSON.stringify(cronosExplorer.data).substring(0, 300)}`);

  const oasisExplorer = await fetchJSON('/api/oasis-explorer?contracts=true');
  console.log(`Oasis Explorer: status=${oasisExplorer.status}`);
  if (oasisExplorer.data) console.log(`  data: ${JSON.stringify(oasisExplorer.data).substring(0, 300)}`);

  // 3. Cronos RPC
  console.log('\n--- Cronos RPC Proxy ---');
  const rpc = await fetchJSON('/api/rpc/cronos', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    timeout: 30000,
  });
  console.log(`Cronos RPC: status=${rpc.status}, error=${rpc.error}`);
  if (rpc.data) console.log(`  data: ${JSON.stringify(rpc.data).substring(0, 300)}`);

  // 4. ZK System
  console.log('\n--- ZK System Deep Check ---');
  
  const zkHealth = await fetchJSON('/api/zk-proof/health');
  console.log(`ZK Health: status=${zkHealth.status}`);
  if (zkHealth.data) console.log(`  data: ${JSON.stringify(zkHealth.data).substring(0, 400)}`);

  const zkGen = await fetchJSON('/api/zk-proof/generate', {
    method: 'POST',
    body: JSON.stringify({
      proofType: 'risk-calculation',
      inputs: { portfolioValue: 50000, riskScore: 0.3 },
    }),
    timeout: 60000,
  });
  console.log(`ZK Generate: status=${zkGen.status}, error=${zkGen.error}`);
  if (zkGen.data) console.log(`  data: ${JSON.stringify(zkGen.data).substring(0, 400)}`);

  const zkVerify = await fetchJSON('/api/zk-proof/verify', {
    method: 'POST',
    body: JSON.stringify({ proofHash: 'test-verification' }),
    timeout: 30000,
  });
  console.log(`ZK Verify: status=${zkVerify.status}, error=${zkVerify.error}`);
  if (zkVerify.data) console.log(`  data: ${JSON.stringify(zkVerify.data).substring(0, 400)}`);

  const zkOwnership = await fetchJSON('/api/zk/verify-ownership', {
    method: 'POST',
    body: JSON.stringify({ walletAddress: '0x0000000000000000000000000000000000000000', hedgeId: 'test-hedge' }),
    timeout: 30000,
  });
  console.log(`ZK Ownership: status=${zkOwnership.status}, error=${zkOwnership.error}`);
  if (zkOwnership.data) console.log(`  data: ${JSON.stringify(zkOwnership.data).substring(0, 400)}`);

  // 5. Additional checks — verify Vercel response headers for clues
  console.log('\n--- Response Header Analysis on failures ---');
  if (agentCmd.headers) {
    console.log(`Agent Command headers: server=${agentCmd.headers['server']}, x-vercel-error=${agentCmd.headers['x-vercel-error']}, content-type=${agentCmd.headers['content-type']}`);
  }

  console.log('\n═══ RETEST COMPLETE ═══');
}

main().catch(console.error);
