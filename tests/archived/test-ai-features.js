#!/usr/bin/env node
/**
 * Manual Testing Script for AI & Portfolio Features
 * Run: node test-ai-features.js
 */

const testAIService = async () => {
  console.log('\n🧪 Testing AI Service...\n');
  
  try {
    // Dynamic import for ES modules
    const { getCryptocomAIService } = await import('./lib/ai/cryptocom-service.ts');
    const service = getCryptocomAIService();
    
    console.log('✅ AI Service initialized');
    console.log(`   Available: ${service.isAvailable()}`);
    
    // Test intent parsing
    console.log('\n📝 Testing Intent Parsing...');
    const intents = [
      'analyze my portfolio',
      'what is my risk level',
      'suggest hedges',
      'execute settlement',
      'generate report'
    ];
    
    for (const input of intents) {
      const result = await service.parseIntent(input);
      console.log(`   "${input}" → ${result.intent} (${(result.confidence * 100).toFixed(0)}% confidence)`);
    }
    
    // Test portfolio analysis
    console.log('\n📊 Testing Portfolio Analysis...');
    const analysis = await service.analyzePortfolio('0x123', {});
    console.log(`   Total Value: $${(analysis.totalValue / 1000000).toFixed(2)}M`);
    console.log(`   Positions: ${analysis.positions}`);
    console.log(`   Health Score: ${analysis.healthScore.toFixed(1)}%`);
    console.log(`   Risk Score: ${analysis.riskScore.toFixed(1)}`);
    console.log(`   Top Assets: ${analysis.topAssets.map(a => a.symbol).join(', ')}`);
    
    // Test risk assessment
    console.log('\n⚠️  Testing Risk Assessment...');
    const risk = await service.assessRisk({});
    console.log(`   Overall Risk: ${risk.overallRisk.toUpperCase()}`);
    console.log(`   Risk Score: ${risk.riskScore.toFixed(1)}/100`);
    console.log(`   Volatility: ${(risk.volatility * 100).toFixed(1)}%`);
    console.log(`   VaR (95%): ${(risk.var95 * 100).toFixed(1)}%`);
    console.log(`   Sharpe Ratio: ${risk.sharpeRatio.toFixed(2)}`);
    console.log(`   Risk Factors: ${risk.factors.length}`);
    
    // Test hedge generation
    console.log('\n🛡️  Testing Hedge Generation...');
    const hedges = await service.generateHedgeRecommendations({}, {});
    hedges.forEach((hedge, i) => {
      console.log(`   ${i + 1}. ${hedge.strategy} (${(hedge.confidence * 100).toFixed(0)}% confidence)`);
      console.log(`      Expected reduction: ${(hedge.expectedReduction * 100).toFixed(0)}%`);
      console.log(`      Actions: ${hedge.actions.length}`);
    });
    
    console.log('\n✅ All AI Service tests passed!\n');
    return true;
  } catch (error) {
    console.error('❌ AI Service test failed:', error.message);
    return false;
  }
};

const testAPIEndpoints = async () => {
  console.log('\n🌐 Testing API Endpoints...\n');
  
  const baseURL = 'http://localhost:3000';
  
  try {
    // Test Portfolio Analysis API
    console.log('📊 Testing Portfolio Analysis API...');
    const portfolioResponse = await fetch(`${baseURL}/api/agents/portfolio/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' }),
    });
    
    if (!portfolioResponse.ok) {
      throw new Error(`Portfolio API failed: ${portfolioResponse.status}`);
    }
    
    const portfolioData = await portfolioResponse.json();
    console.log(`   ✅ Portfolio API: ${portfolioData.success ? 'Success' : 'Failed'}`);
    console.log(`   AI Powered: ${portfolioData.aiPowered}`);
    console.log(`   Total Value: $${(portfolioData.analysis.totalValue / 1000000).toFixed(2)}M`);
    
    // Test Risk Assessment API
    console.log('\n⚠️  Testing Risk Assessment API...');
    const riskResponse = await fetch(`${baseURL}/api/agents/risk/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' }),
    });
    
    if (!riskResponse.ok) {
      throw new Error(`Risk API failed: ${riskResponse.status}`);
    }
    
    const riskData = await riskResponse.json();
    console.log(`   ✅ Risk API: Success`);
    console.log(`   AI Powered: ${riskData.aiPowered}`);
    console.log(`   Risk Score: ${riskData.riskScore.toFixed(1)}/100`);
    console.log(`   Overall Risk: ${riskData.overallRisk}`);
    
    // Test Hedging API
    console.log('\n🛡️  Testing Hedging Recommendations API...');
    const hedgeResponse = await fetch(`${baseURL}/api/agents/hedging/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' }),
    });
    
    if (!hedgeResponse.ok) {
      throw new Error(`Hedge API failed: ${hedgeResponse.status}`);
    }
    
    const hedgeData = await hedgeResponse.json();
    console.log(`   ✅ Hedge API: Success`);
    console.log(`   AI Powered: ${hedgeData.aiPowered}`);
    console.log(`   Recommendations: ${hedgeData.recommendations.length}`);
    
    console.log('\n✅ All API tests passed!\n');
    return true;
  } catch (error) {
    console.error('❌ API test failed:', error.message);
    console.error('   Make sure Next.js dev server is running on port 3000');
    return false;
  }
};

const runAllTests = async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  🚀 AI & PORTFOLIO INTEGRATION - COMPREHENSIVE TESTS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const aiSuccess = await testAIService();
  const apiSuccess = await testAPIEndpoints();
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  📋 TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`  AI Service:     ${aiSuccess ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  API Endpoints:  ${apiSuccess ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('\n═══════════════════════════════════════════════════════════\n');
  
  process.exit(aiSuccess && apiSuccess ? 0 : 1);
};

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
