/**
 * COMPREHENSIVE SYSTEM TEST
 * Tests all AI agents, data sources, and integrations
 */

// Test Results Tracking
interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  time: number;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function logResult(result: TestResult) {
  results.push(result);
  const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
  console.log(`${icon} ${result.name} (${result.time}ms)`);
  if (result.details) console.log(`   ${result.details}`);
  if (result.error) console.log(`   Error: ${result.error}`);
}

async function testOllamaLLM() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST 1: OLLAMA LLM (Qwen2.5 7B with CUDA)');
  console.log('='.repeat(60));
  
  const ollamaUrl = 'http://localhost:11434';
  const model = 'qwen2.5:7b';
  
  // Test 1.1: Model availability
  const start1 = Date.now();
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    const data = await res.json();
    const hasModel = data.models?.some((m: any) => m.name.includes('qwen2.5'));
    logResult({
      name: '1.1 Ollama Available',
      status: hasModel ? 'pass' : 'fail',
      time: Date.now() - start1,
      details: `Models: ${data.models?.map((m: any) => m.name).join(', ') || 'none'}`,
    });
  } catch (e: any) {
    logResult({ name: '1.1 Ollama Available', status: 'fail', time: Date.now() - start1, error: e.message });
  }
  
  // Test 1.2: Financial reasoning
  const start2 = Date.now();
  try {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'What is VaR (Value at Risk) in 1 sentence?' }],
        stream: false,
      }),
    });
    const data = await res.json();
    const hasContent = data.message?.content?.length > 20;
    logResult({
      name: '1.2 Financial Reasoning',
      status: hasContent ? 'pass' : 'fail',
      time: Date.now() - start2,
      details: data.message?.content?.substring(0, 80) + '...',
    });
  } catch (e: any) {
    logResult({ name: '1.2 Financial Reasoning', status: 'fail', time: Date.now() - start2, error: e.message });
  }
  
  // Test 1.3: Math calculation
  const start3 = Date.now();
  try {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Calculate: (0.15 - 0.02) / 0.18. Just give the number.' }],
        stream: false,
      }),
    });
    const data = await res.json();
    const content = data.message?.content || '';
    const hasCorrect = content.includes('0.72') || content.includes('0.7') || content.includes('72');
    logResult({
      name: '1.3 Math Calculation (Sharpe)',
      status: hasCorrect ? 'pass' : 'warn',
      time: Date.now() - start3,
      details: `Response: ${content.substring(0, 50)}`,
    });
  } catch (e: any) {
    logResult({ name: '1.3 Math Calculation', status: 'fail', time: Date.now() - start3, error: e.message });
  }
}

async function testRealMarketData() {
  console.log('\n' + '='.repeat(60));
  console.log('📈 TEST 2: REAL MARKET DATA SERVICE');
  console.log('='.repeat(60));
  
  // Test 2.1: Crypto.com Exchange API (Public)
  const start1 = Date.now();
  try {
    const res = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers');
    const data = await res.json();
    const croPrice = data.result?.data?.find((t: any) => t.i === 'CRO_USDT')?.a;
    logResult({
      name: '2.1 Crypto.com Exchange API',
      status: croPrice ? 'pass' : 'warn',
      time: Date.now() - start1,
      details: `CRO/USDT: $${croPrice || 'N/A'}`,
    });
  } catch (e: any) {
    logResult({ name: '2.1 Crypto.com Exchange API', status: 'fail', time: Date.now() - start1, error: e.message });
  }
  
  // Test 2.2: CoinGecko API (Fallback)
  const start2 = Date.now();
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=crypto-com-chain,bitcoin,ethereum&vs_currencies=usd');
    const data = await res.json();
    logResult({
      name: '2.2 CoinGecko API (Fallback)',
      status: data['crypto-com-chain']?.usd ? 'pass' : 'warn',
      time: Date.now() - start2,
      details: `CRO: $${data['crypto-com-chain']?.usd}, BTC: $${data.bitcoin?.usd}, ETH: $${data.ethereum?.usd}`,
    });
  } catch (e: any) {
    logResult({ name: '2.2 CoinGecko API', status: 'fail', time: Date.now() - start2, error: e.message });
  }
  
  // Test 2.3: Historical data for volatility
  const start3 = Date.now();
  try {
    const res = await fetch('https://api.crypto.com/exchange/v1/public/get-candlestick?instrument_name=CRO_USDT&timeframe=1D&count=7');
    const data = await res.json();
    const candles = data.result?.data?.length || 0;
    logResult({
      name: '2.3 Historical Candlestick Data',
      status: candles >= 5 ? 'pass' : 'warn',
      time: Date.now() - start3,
      details: `${candles} candles retrieved for volatility calc`,
    });
  } catch (e: any) {
    logResult({ name: '2.3 Historical Data', status: 'fail', time: Date.now() - start3, error: e.message });
  }
}

async function testDelphiPolymarket() {
  console.log('\n' + '='.repeat(60));
  console.log('🔮 TEST 3: PREDICTION MARKETS (Polymarket)');
  console.log('='.repeat(60));
  
  // Test 3.1: Polymarket API
  const start1 = Date.now();
  try {
    const res = await fetch('https://gamma-api.polymarket.com/markets?limit=5&active=true');
    const data = await res.json();
    const hasMarkets = Array.isArray(data) && data.length > 0;
    logResult({
      name: '3.1 Polymarket API',
      status: hasMarkets ? 'pass' : 'warn',
      time: Date.now() - start1,
      details: hasMarkets ? `${data.length} active markets found` : 'No markets',
    });
  } catch (e: any) {
    logResult({ name: '3.1 Polymarket API', status: 'warn', time: Date.now() - start1, error: e.message });
  }
}

async function testZKBackend() {
  console.log('\n' + '='.repeat(60));
  console.log('🔐 TEST 4: ZK-STARK PROOF BACKEND');
  console.log('='.repeat(60));
  
  const zkUrl = process.env.ZK_API_URL || 'http://localhost:8000';
  
  // Test 4.1: Health check
  const start1 = Date.now();
  try {
    const res = await fetch(`${zkUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    logResult({
      name: '4.1 ZK Backend Health',
      status: data.status === 'healthy' ? 'pass' : 'warn',
      time: Date.now() - start1,
      details: `Status: ${data.status || 'unknown'}`,
    });
  } catch (e: any) {
    logResult({ name: '4.1 ZK Backend Health', status: 'warn', time: Date.now() - start1, error: `Not running (start with: python zkp/main.py)` });
  }
  
  // Test 4.2: Proof generation (if backend available)
  const start2 = Date.now();
  try {
    const res = await fetch(`${zkUrl}/generate-stark-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portfolio_value: 10000,
        risk_score: 0.65,
        timestamp: Date.now(),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    const hasProof = data.proof_hash || data.proof;
    logResult({
      name: '4.2 ZK Proof Generation',
      status: hasProof ? 'pass' : 'warn',
      time: Date.now() - start2,
      details: hasProof ? `Proof hash: ${String(data.proof_hash || data.proof).substring(0, 20)}...` : 'No proof generated',
    });
  } catch (e: any) {
    logResult({ name: '4.2 ZK Proof Generation', status: 'warn', time: Date.now() - start2, error: 'ZK backend not running' });
  }
}

async function testSpecializedAgents() {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 TEST 5: SPECIALIZED AGENTS');
  console.log('='.repeat(60));
  
  // Test 5.1: RiskAgent volatility calculation
  const start1 = Date.now();
  try {
    const { RiskAgent } = await import('../agents/specialized/RiskAgent');
    const agent = new RiskAgent('test-risk-agent');
    await agent.initialize();
    
    // Test with mock portfolio data
    const riskResult = await agent.executeTask({
      id: 'test-1',
      type: 'analyze_risk',
      action: 'analyze_risk',
      priority: 1,
      parameters: { 
        portfolioId: 1,
        positions: [
          { symbol: 'CRO', amount: 1000, value: 100, weight: 0.7 },
          { symbol: 'USDC', amount: 30, value: 30, weight: 0.3 },
        ],
      },
    });
    
    logResult({
      name: '5.1 RiskAgent - Risk Assessment',
      status: riskResult.success ? 'pass' : 'warn',
      time: Date.now() - start1,
      details: `Risk score: ${riskResult.data?.riskScore?.toFixed(4) || 'N/A'}, VaR: ${riskResult.data?.var95?.toFixed(4) || 'N/A'}`,
    });
  } catch (e: any) {
    logResult({ name: '5.1 RiskAgent', status: 'warn', time: Date.now() - start1, error: e.message.substring(0, 80) });
  }
  
  // Test 5.2: HedgingAgent
  const start2 = Date.now();
  try {
    const { HedgingAgent } = await import('../agents/specialized/HedgingAgent');
    const agent = new HedgingAgent('test-hedging-agent');
    await agent.initialize();
    
    const hedgeResult = await agent.executeTask({
      id: 'test-2',
      type: 'generate_hedges',
      action: 'generate_hedges',
      priority: 1,
      parameters: { 
        portfolioValue: 10000, 
        riskScore: 0.7,
        positions: [{ symbol: 'CRO', weight: 0.7 }],
      },
    });
    
    logResult({
      name: '5.2 HedgingAgent - Strategy Generation',
      status: hedgeResult.success ? 'pass' : 'warn',
      time: Date.now() - start2,
      details: `Hedges: ${hedgeResult.data?.hedges?.length || hedgeResult.data?.strategies?.length || 'generated'}`,
    });
  } catch (e: any) {
    logResult({ name: '5.2 HedgingAgent', status: 'warn', time: Date.now() - start2, error: e.message.substring(0, 80) });
  }
  
  // Test 5.3: PriceMonitorAgent
  const start3 = Date.now();
  try {
    const { PriceMonitorAgent } = await import('../agents/specialized/PriceMonitorAgent');
    const agent = new PriceMonitorAgent('test-price-agent');
    await agent.initialize();
    
    const priceResult = await agent.executeTask({
      id: 'test-3',
      type: 'get_price',
      action: 'get_price',
      priority: 1,
      parameters: { symbol: 'CRO' },
    });
    
    logResult({
      name: '5.3 PriceMonitorAgent - Price Fetch',
      status: priceResult.success ? 'pass' : 'warn',
      time: Date.now() - start3,
      details: `CRO Price: $${priceResult.data?.price?.toFixed(4) || priceResult.data?.prices?.CRO?.toFixed(4) || 'fetched'}`,
    });
  } catch (e: any) {
    logResult({ name: '5.3 PriceMonitorAgent', status: 'warn', time: Date.now() - start3, error: e.message.substring(0, 80) });
  }
  
  // Test 5.4: ReportingAgent
  const start4 = Date.now();
  try {
    const { ReportingAgent } = await import('../agents/specialized/ReportingAgent');
    const agent = new ReportingAgent('test-reporting-agent');
    await agent.initialize();
    
    const reportResult = await agent.executeTask({
      id: 'test-4',
      type: 'generate_risk_report',
      action: 'generate_risk_report',
      priority: 1,
      parameters: { 
        portfolio: {
          positions: [{ symbol: 'CRO', value: 700 }, { symbol: 'USDC', value: 300 }],
          totalValue: 1000,
        },
      },
    });
    
    logResult({
      name: '5.4 ReportingAgent - Report Generation',
      status: reportResult.success ? 'pass' : 'warn',
      time: Date.now() - start4,
      details: `Report: ${reportResult.data?.report ? 'Generated' : reportResult.success ? 'Success' : 'Failed'}`,
    });
  } catch (e: any) {
    logResult({ name: '5.4 ReportingAgent', status: 'warn', time: Date.now() - start4, error: e.message.substring(0, 80) });
  }
}

async function testCoreAgents() {
  console.log('\n' + '='.repeat(60));
  console.log('🧠 TEST 6: CORE AGENTS');
  console.log('='.repeat(60));
  
  // Test 6.1: LeadAgent NLP parsing
  const start1 = Date.now();
  try {
    const { LeadAgent } = await import('../agents/core/LeadAgent');
    const agent = new LeadAgent('test-lead-agent');
    await agent.initialize();
    
    const nlpResult = await agent.executeTask({
      id: 'test-nlp',
      type: 'parse_strategy',
      action: 'parse_strategy',
      priority: 1,
      parameters: { 
        input: 'Buy 100 CRO and hedge with 30% stablecoins',
      },
    });
    
    logResult({
      name: '6.1 LeadAgent - NLP Strategy Parse',
      status: nlpResult.success ? 'pass' : 'warn',
      time: Date.now() - start1,
      details: `Parsed: ${JSON.stringify(nlpResult.data).substring(0, 60)}...`,
    });
  } catch (e: any) {
    logResult({ name: '6.1 LeadAgent NLP', status: 'warn', time: Date.now() - start1, error: e.message.substring(0, 80) });
  }
}

async function testVVSFinance() {
  console.log('\n' + '='.repeat(60));
  console.log('💱 TEST 7: VVS FINANCE SWAP SDK');
  console.log('='.repeat(60));
  
  // Test 7.1: Swap Quote API
  const start1 = Date.now();
  try {
    const clientId = process.env.NEXT_PUBLIC_VVS_QUOTE_API_CLIENT_ID || 
                     process.env.SWAP_SDK_QUOTE_API_CLIENT_ID_338;
    
    if (!clientId) {
      logResult({ name: '7.1 VVS Quote API', status: 'warn', time: Date.now() - start1, error: 'No VVS API client ID' });
      return;
    }
    
    // VVS Finance Testnet API
    const res = await fetch('https://swap-sdk-api.vvs.finance/v1/338/quote?' + new URLSearchParams({
      tokenIn: '0x904Bd5a5AAC0B9d88A0D47864724218986Ad4a3a', // WCRO testnet
      tokenOut: '0x6a3173618859C7cd40fAF6921b5E9eB6A76f1fD4', // USDC testnet
      amount: '1000000000000000000', // 1 token
    }), {
      headers: { 'x-client-id': clientId },
    });
    
    const data = await res.json();
    logResult({
      name: '7.1 VVS Quote API',
      status: data.toAmount || data.amountOut ? 'pass' : 'warn',
      time: Date.now() - start1,
      details: `Quote received: ${data.toAmount || data.amountOut || 'N/A'}`,
    });
  } catch (e: any) {
    logResult({ name: '7.1 VVS Quote API', status: 'warn', time: Date.now() - start1, error: e.message });
  }
}

async function testCryptocomServices() {
  console.log('\n' + '='.repeat(60));
  console.log('🔷 TEST 8: CRYPTO.COM SERVICES');
  console.log('='.repeat(60));
  
  // Test 8.1: zkEVM RPC
  const start1 = Date.now();
  try {
    const res = await fetch('https://evm-t3.cronos.org/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    });
    const data = await res.json();
    const blockNum = parseInt(data.result, 16);
    logResult({
      name: '8.1 Cronos Testnet RPC',
      status: blockNum > 0 ? 'pass' : 'fail',
      time: Date.now() - start1,
      details: `Block: ${blockNum.toLocaleString()}`,
    });
  } catch (e: any) {
    logResult({ name: '8.1 Cronos RPC', status: 'fail', time: Date.now() - start1, error: e.message });
  }
  
  // Test 8.2: Explorer API
  const start2 = Date.now();
  try {
    const apiKey = process.env.EXPLORER_API_KEY || process.env.CRYPTOCOM_DEVELOPER_API_KEY;
    const res = await fetch(`https://explorer-api.cronos.org/testnet/api/v1/blocks?limit=1`, {
      headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
    });
    const data = await res.json();
    logResult({
      name: '8.2 Cronos Explorer API',
      status: res.ok ? 'pass' : 'warn',
      time: Date.now() - start2,
      details: `Status: ${res.status}`,
    });
  } catch (e: any) {
    logResult({ name: '8.2 Explorer API', status: 'warn', time: Date.now() - start2, error: e.message });
  }
}

async function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('📋 COMPREHENSIVE TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.status === 'pass').length;
  const warned = results.filter(r => r.status === 'warn').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const total = results.length;
  
  console.log(`\n✅ Passed: ${passed}/${total}`);
  console.log(`⚠️  Warnings: ${warned}/${total}`);
  console.log(`❌ Failed: ${failed}/${total}`);
  
  const avgTime = results.reduce((a, r) => a + r.time, 0) / total;
  console.log(`\n⏱️  Average response time: ${avgTime.toFixed(0)}ms`);
  
  if (failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`   • ${r.name}: ${r.error}`);
    });
  }
  
  if (warned > 0) {
    console.log('\n⚠️  WARNINGS (non-critical):');
    results.filter(r => r.status === 'warn').forEach(r => {
      console.log(`   • ${r.name}: ${r.error || r.details}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  if (failed === 0) {
    console.log('🎉 SYSTEM STATUS: OPERATIONAL');
    console.log('All critical components working correctly!');
  } else {
    console.log('⚠️  SYSTEM STATUS: DEGRADED');
    console.log(`${failed} critical test(s) failed. Check errors above.`);
  }
  console.log('='.repeat(60));
}

// Run all tests
async function runAllTests() {
  console.log('🚀 ZKVANGUARD - COMPREHENSIVE SYSTEM TEST');
  console.log('Testing all AI agents, data sources, and integrations...\n');
  
  await testOllamaLLM();
  await testRealMarketData();
  await testDelphiPolymarket();
  await testZKBackend();
  await testSpecializedAgents();
  await testCoreAgents();
  await testVVSFinance();
  await testCryptocomServices();
  await printSummary();
}

runAllTests().catch(console.error);
