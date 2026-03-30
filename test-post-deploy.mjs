const BASE = 'https://www.zkvanguard.xyz/api';

async function test(name, url, opts) {
  try {
    const r = await fetch(url, opts);
    const headers = {};
    r.headers.forEach((v, k) => { if (k.startsWith('x-vercel') || k === 'server') headers[k] = v; });
    const body = await r.text();
    console.log(`${name}: HTTP ${r.status} ${r.statusText}`);
    if (Object.keys(headers).length) console.log('  Headers:', JSON.stringify(headers));
    console.log('  Body:', body.substring(0, 300));
  } catch(e) {
    const cause = e.cause ? `cause: ${e.cause.message} (${e.cause.code})` : '';
    console.log(`${name}: FETCH FAILED - ${e.message} ${cause}`);
  }
}

console.log('=== Checking site health ===');
await test('Health', BASE + '/health', {});
await test('Agent Status', BASE + '/agents/status', {});

console.log('\n=== Testing previously-failing POST routes ===');
await test('Agent Command', BASE + '/agents/command', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({command: 'analyze BTC risk'})
});

await test('Risk Assess', BASE + '/agents/risk/assess', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({portfolio: {positions: [{symbol: 'BTC', amount: 1}]}})
});

await test('Hedging Recommend', BASE + '/agents/hedging/recommend', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({portfolio: {positions: [{symbol: 'BTC', amount: 1}]}})
});

await test('Cronos RPC', BASE + '/rpc/cronos', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1})
});

await test('ZK Generate', BASE + '/zk-proof/generate', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({data: {test: true}})
});

await test('ZK Verify', BASE + '/zk-proof/verify', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({proof: 'test', publicInputs: []})
});

await test('ZK Ownership', BASE + '/zk/verify-ownership', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({address: '0x123'})
});

console.log('\n=== Testing ZK Health (GET) ===');
await test('ZK Health', BASE + '/zk-proof/health', {});
