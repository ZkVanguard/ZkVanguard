/**
 * Comprehensive Integration Test
 * Tests all real agent integrations: x402, Moonlander, Market Data MCP
 */

const BASE_URL = 'http://localhost:3000';

async function testAgentStatus() {
  console.log('\n🔍 Testing Agent Orchestrator Status...');
  try {
    const response = await fetch(`${BASE_URL}/api/agents/status`);
    const data = await response.json();
    
    console.log('✅ Agent Status:', JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error('❌ Agent status check failed:', error);
    return null;
  }
}

async function testPortfolioAnalysisWithRealAgent() {
  console.log('\n📊 Testing Portfolio Analysis (Real Agent)...');
  try {
    const response = await fetch(`${BASE_URL}/api/agents/portfolio/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
        useRealAgent: true,
        portfolioData: {
          totalValue: 3080000,
          positions: 17,
        },
      }),
    });

    const data = await response.json();
    console.log('✅ Portfolio Analysis Result:');
    console.log(`   Real Agent: ${data.realAgent ? 'YES ✓' : 'NO ✗'}`);
    console.log(`   Agent ID: ${data.agentId || 'N/A'}`);
    console.log(`   Execution Time: ${data.executionTime || 'N/A'}ms`);
    console.log(`   Analysis: ${JSON.stringify(data.analysis, null, 2).substring(0, 200)}...`);
    
    return data;
  } catch (error) {
    console.error('❌ Portfolio analysis failed:', error);
    return null;
  }
}

async function testRiskAssessmentWithRealAgent() {
  console.log('\n⚠️  Testing Risk Assessment (Real Agent)...');
  try {
    const response = await fetch(`${BASE_URL}/api/agents/risk/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
        useRealAgent: true,
      }),
    });

    const data = await response.json();
    console.log('✅ Risk Assessment Result:');
    console.log(`   Real Agent: ${data.realAgent ? 'YES ✓' : 'NO ✗'}`);
    console.log(`   Agent ID: ${data.agentId || 'N/A'}`);
    console.log(`   Risk Score: ${data.riskScore || 'N/A'}`);
    console.log(`   Overall Risk: ${data.overallRisk || 'N/A'}`);
    
    return data;
  } catch (error) {
    console.error('❌ Risk assessment failed:', error);
    return null;
  }
}

async function testHedgingWithRealAgent() {
  console.log('\n🛡️  Testing Hedging Recommendations (Real Agent)...');
  try {
    const response = await fetch(`${BASE_URL}/api/agents/hedging/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
        useRealAgent: true,
        portfolioData: {
          totalValue: 3080000,
          dominantAsset: 'BTC',
        },
      }),
    });

    const data = await response.json();
    console.log('✅ Hedging Recommendations Result:');
    console.log(`   Real Agent: ${data.realAgent ? 'YES ✓' : 'NO ✗'}`);
    console.log(`   Agent ID: ${data.agentId || 'N/A'}`);
    console.log(`   Recommendations: ${data.recommendations?.length || 0}`);
    if (data.recommendations && data.recommendations.length > 0) {
      console.log(`   First Strategy: ${data.recommendations[0].strategy}`);
      console.log(`   Confidence: ${data.recommendations[0].confidence}%`);
    }
    
    return data;
  } catch (error) {
    console.error('❌ Hedging recommendations failed:', error);
    return null;
  }
}

async function testMoonlanderHedgeDemo() {
  console.log('\n🌙 Testing Moonlander Live Hedge Demo...');
  try {
    const response = await fetch(`${BASE_URL}/api/demo/moonlander-hedge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market: 'BTC-USD-PERP',
        side: 'SHORT',
        notionalValue: '1000',
        leverage: 2,
      }),
    });

    const data = await response.json();
    console.log('✅ Moonlander Hedge Result:');
    console.log(`   Live: ${data.live ? 'YES ✓' : 'NO (Demo Mode) ⚠️'}`);
    console.log(`   Order ID: ${data.hedge?.orderId || 'N/A'}`);
    console.log(`   Market: ${data.hedge?.market || 'N/A'}`);
    console.log(`   Side: ${data.hedge?.side || 'N/A'}`);
    console.log(`   Size: ${data.hedge?.size || 'N/A'}`);
    console.log(`   Fill Price: ${data.hedge?.avgFillPrice || 'N/A'}`);
    console.log(`   Status: ${data.hedge?.status || 'N/A'}`);
    console.log(`   Execution Time: ${data.executionTime}ms`);
    
    return data;
  } catch (error) {
    console.error('❌ Moonlander hedge demo failed:', error);
    return null;
  }
}

async function testX402GaslessPaymentDemo() {
  console.log('\n💸 Testing x402 Gasless Payment Demo...');
  try {
    const response = await fetch(`${BASE_URL}/api/demo/x402-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        beneficiary: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
        amount: '100',
        token: '0x0000000000000000000000000000000000000000',
        purpose: 'Demo gasless payment',
        priority: 'HIGH',
      }),
    });

    const data = await response.json();
    console.log('✅ x402 Gasless Payment Result:');
    console.log(`   Live: ${data.live ? 'YES ✓' : 'NO (Demo Mode) ⚠️'}`);
    console.log(`   x402 Powered: ${data.x402Powered ? 'YES ✓' : 'NO ✗'}`);
    console.log(`   Settlement ID: ${data.settlement?.requestId || 'N/A'}`);
    console.log(`   Status: ${data.settlement?.status || 'N/A'}`);
    console.log(`   Gas Saved: ${data.settlement?.gasSaved || 'N/A'}`);
    console.log(`   ZK Proof: ${data.zkProofGenerated ? 'YES ✓' : 'NO ✗'}`);
    console.log(`   Execution Time: ${data.executionTime}ms`);
    
    return data;
  } catch (error) {
    console.error('❌ x402 gasless payment demo failed:', error);
    return null;
  }
}

async function testMarketDataMCP() {
  console.log('\n📈 Testing Market Data MCP Integration...');
  try {
    const response = await fetch(`${BASE_URL}/api/market-data?symbol=BTC`);
    const data = await response.json();
    
    console.log('✅ Market Data MCP Result:');
    console.log(`   MCP Powered: ${data.mcpPowered ? 'YES ✓' : 'NO ✗'}`);
    console.log(`   Demo Mode: ${data.demoMode ? 'YES' : 'NO (Live Data) ✓'}`);
    console.log(`   Symbol: ${data.data?.symbol || 'N/A'}`);
    console.log(`   Price: $${data.data?.price?.toFixed(2) || 'N/A'}`);
    console.log(`   24h Change: ${data.data?.change24h?.toFixed(2) || 'N/A'}%`);
    console.log(`   24h Volume: $${data.data?.volume24h?.toLocaleString() || 'N/A'}`);
    
    return data;
  } catch (error) {
    console.error('❌ Market data MCP test failed:', error);
    return null;
  }
}

async function testBatchSettlement() {
  console.log('\n🔄 Testing Batch Settlement (x402)...');
  try {
    const response = await fetch(`${BASE_URL}/api/agents/settlement/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        useRealAgent: true,
        transactions: [
          {
            beneficiary: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
            amount: '100',
            token: '0x0000000000000000000000000000000000000000',
            purpose: 'Batch payment 1',
          },
          {
            beneficiary: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
            amount: '200',
            token: '0x0000000000000000000000000000000000000000',
            purpose: 'Batch payment 2',
          },
        ],
      }),
    });

    const data = await response.json();
    console.log('✅ Batch Settlement Result:');
    console.log(`   Real Agent: ${data.realAgent ? 'YES ✓' : 'NO ✗'}`);
    console.log(`   x402 Powered: ${data.x402Powered ? 'YES ✓' : 'NO ✗'}`);
    console.log(`   Batch ID: ${data.batchId || 'N/A'}`);
    console.log(`   Transaction Count: ${data.transactionCount || 0}`);
    console.log(`   Gas Saved: ${data.gasSaved || 'N/A'}`);
    console.log(`   Execution Time: ${data.executionTime || 'N/A'}ms`);
    
    return data;
  } catch (error) {
    console.error('❌ Batch settlement failed:', error);
    return null;
  }
}

// Run all tests
async function runAllTests() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  🚀 COMPREHENSIVE INTEGRATION TEST SUITE                 ║');
  console.log('║  Testing Real Agent Integration + x402 + Moonlander      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const results = {
    agentStatus: await testAgentStatus(),
    portfolioAnalysis: await testPortfolioAnalysisWithRealAgent(),
    riskAssessment: await testRiskAssessmentWithRealAgent(),
    hedging: await testHedgingWithRealAgent(),
    moonlanderDemo: await testMoonlanderHedgeDemo(),
    x402Demo: await testX402GaslessPaymentDemo(),
    marketData: await testMarketDataMCP(),
    batchSettlement: await testBatchSettlement(),
  };

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  📊 TEST SUMMARY                                          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const testResults = [
    ['Agent Status', results.agentStatus !== null],
    ['Portfolio Analysis (Real Agent)', results.portfolioAnalysis?.realAgent || false],
    ['Risk Assessment (Real Agent)', results.riskAssessment?.realAgent || false],
    ['Hedging (Real Agent)', results.hedging?.realAgent || false],
    ['Moonlander Live Demo', results.moonlanderDemo?.success || false],
    ['x402 Gasless Payment Demo', results.x402Demo?.success || false],
    ['Market Data MCP', results.marketData?.success || false],
    ['Batch Settlement', results.batchSettlement !== null],
  ];

  const totalTests = testResults.length;
  const passedTests = testResults.filter(([_, passed]) => passed).length;

  console.log('');
  testResults.forEach(([name, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${name}`);
  });

  console.log('');
  console.log(`TOTAL: ${passedTests}/${totalTests} tests passed (${((passedTests/totalTests)*100).toFixed(1)}%)`);
  
  if (passedTests === totalTests) {
    console.log('\n🏆 ALL TESTS PASSED! System is production-ready!');
  } else if (passedTests >= totalTests * 0.8) {
    console.log('\n⚠️  MOST TESTS PASSED. Minor issues detected.');
  } else {
    console.log('\n❌ SOME TESTS FAILED. Review errors above.');
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  🎯 HACKATHON READINESS ASSESSMENT                       ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const features = {
    'Real Agent Orchestration': results.portfolioAnalysis?.realAgent,
    'x402 Integration': results.x402Demo?.x402Powered,
    'Moonlander Integration': results.moonlanderDemo?.platform === 'Moonlander',
    'Market Data MCP': results.marketData?.mcpPowered,
    'ZK Proof Generation': results.x402Demo?.zkProofGenerated,
    'Batch Processing': results.batchSettlement !== null,
    'Crypto.com AI SDK': results.portfolioAnalysis?.analysis !== null,
    'Gasless Transactions': results.x402Demo?.gasless,
  };

  Object.entries(features).forEach(([feature, enabled]) => {
    console.log(`${enabled ? '✅' : '❌'} ${feature}`);
  });

  const enabledFeatures = Object.values(features).filter(Boolean).length;
  const readinessScore = (enabledFeatures / Object.keys(features).length) * 100;

  console.log(`\n📊 Hackathon Readiness Score: ${readinessScore.toFixed(0)}%`);
  
  if (readinessScore >= 90) {
    console.log('🏆 SUBMISSION READY! All major features operational!');
  } else if (readinessScore >= 75) {
    console.log('⭐ STRONG SUBMISSION! Most features working, minor gaps.');
  } else if (readinessScore >= 60) {
    console.log('⚠️  NEEDS WORK. Core features present but integration incomplete.');
  } else {
    console.log('❌ NOT READY. Critical features missing.');
  }

  console.log('\n');
}

// Execute tests
runAllTests().catch(console.error);
