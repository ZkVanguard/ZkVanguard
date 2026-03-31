/**
 * Integration test for AI Market Intelligence system
 * Tests the comprehensive market data pipeline for AI agents
 */

import { AIMarketIntelligence, type AIMarketContext } from './lib/services/AIMarketIntelligence';
import { DelphiMarketService } from './lib/services/DelphiMarketService';
import { logger } from './lib/utils/logger';

async function testAIMarketIntelligence() {
  console.log('\n========================================');
  console.log('AI MARKET INTELLIGENCE INTEGRATION TEST');
  console.log('========================================\n');
  
  const results = {
    passed: 0,
    failed: 0,
    tests: [] as Array<{ name: string; status: 'PASS' | 'FAIL'; details?: string }>,
  };

  function recordTest(name: string, passed: boolean, details?: string) {
    if (passed) {
      results.passed++;
      results.tests.push({ name, status: 'PASS', details });
      console.log(`✅ ${name}`);
    } else {
      results.failed++;
      results.tests.push({ name, status: 'FAIL', details });
      console.log(`❌ ${name}: ${details}`);
    }
  }

  try {
    // Test 1: Get full AI Market Context
    console.log('\n📊 Test 1: Full AI Market Context');
    console.log('---------------------------------');
    const startTime = Date.now();
    const context = await AIMarketIntelligence.getMarketContext();
    const duration = Date.now() - startTime;
    
    recordTest('Context generated successfully', !!context);
    recordTest('Context has generatedAt timestamp', context.generatedAt > 0);
    recordTest(`Context generated in ${duration}ms`, duration < 10000, `${duration}ms`);
    
    // Test 2: Streaks Analysis
    console.log('\n📈 Test 2: Streak Analysis');
    console.log('--------------------------');
    recordTest('Streaks object exists', !!context.streaks);
    recordTest('5-min streak has direction', ['UP', 'DOWN', 'MIXED'].includes(context.streaks.streak5Min.direction));
    recordTest('5-min streak has count', typeof context.streaks.streak5Min.count === 'number');
    recordTest('30-min streak exists', !!context.streaks.streak30Min);
    recordTest('4-hour trend exists', !!context.streaks.trend4Hour);
    recordTest('Reversal probability in range', context.streaks.reversalProbability >= 0 && context.streaks.reversalProbability <= 100);
    
    console.log(`   Current 5-min streak: ${context.streaks.streak5Min.direction} (${context.streaks.streak5Min.count} count)`);
    
    // Test 3: Market Correlation
    console.log('\n🔗 Test 3: Market Correlation');
    console.log('-----------------------------');
    recordTest('Correlation object exists', !!context.correlation);
    recordTest('BTC-ETH correlation is number', typeof context.correlation.btcEthCorrelation === 'number');
    recordTest('BTC-ETH correlation in range 0-1', context.correlation.btcEthCorrelation >= 0 && context.correlation.btcEthCorrelation <= 1);
    recordTest('Market alignment is number', typeof context.correlation.marketAlignment === 'number');
    recordTest('Aligned assets is array', Array.isArray(context.correlation.alignedAssets));
    recordTest('Diverging assets is array', Array.isArray(context.correlation.divergingAssets));
    
    console.log(`   BTC-ETH Correlation: ${(context.correlation.btcEthCorrelation * 100).toFixed(1)}%`);
    console.log(`   Market Alignment: ${context.correlation.marketAlignment}%`);
    
    // Test 4: Risk Cascade Detection
    console.log('\n⚠️ Test 4: Risk Cascade Detection');
    console.log('---------------------------------');
    recordTest('Risk cascade object exists', !!context.riskCascade);
    recordTest('Detected is boolean', typeof context.riskCascade.detected === 'boolean');
    recordTest('Severity is number 0-100', context.riskCascade.severity >= 0 && context.riskCascade.severity <= 100);
    recordTest('Signals is array', Array.isArray(context.riskCascade.signals));
    recordTest('Recommendation is valid', ['HEDGE_IMMEDIATELY', 'HEDGE_SOON', 'MONITOR_CLOSELY', 'NO_ACTION'].includes(context.riskCascade.recommendation));
    
    console.log(`   Risk Detected: ${context.riskCascade.detected}`);
    console.log(`   Severity: ${context.riskCascade.severity}/100`);
    console.log(`   Recommendation: ${context.riskCascade.recommendation}`);
    
    // Test 5: Liquidity Analysis
    console.log('\n💧 Test 5: Liquidity Analysis');
    console.log('------------------------------');
    recordTest('Liquidity object exists', !!context.liquidity);
    recordTest('Prediction market liquidity exists', typeof context.liquidity.predictionMarketLiquidity === 'number');
    recordTest('Exchange liquidity exists', typeof context.liquidity.exchangeLiquidity === 'number');
    recordTest('Liquidity ratio exists', typeof context.liquidity.liquidityRatio === 'number');
    recordTest('Sufficient liquidity is boolean', typeof context.liquidity.sufficientLiquidity === 'boolean');
    
    console.log(`   Exchange Liquidity: $${context.liquidity.exchangeLiquidity.toLocaleString()}`);
    console.log(`   Sufficient: ${context.liquidity.sufficientLiquidity ? 'Yes' : 'No'}`);
    
    // Test 6: Implied Move Forecast
    console.log('\n📉 Test 6: Implied Move Forecast');
    console.log('--------------------------------');
    recordTest('Implied move object exists', !!context.impliedMove);
    recordTest('Expected change is number', typeof context.impliedMove.expectedChange5Min === 'number');
    recordTest('Price range exists', !!context.impliedMove.priceRange);
    recordTest('Confidence exists', typeof context.impliedMove.confidence === 'number');
    recordTest('Basis is array', Array.isArray(context.impliedMove.basis));
    
    console.log(`   Expected 5-min change: ${context.impliedMove.expectedChange5Min > 0 ? '+' : ''}${context.impliedMove.expectedChange5Min.toFixed(3)}%`);
    console.log(`   Confidence: ${context.impliedMove.confidence.toFixed(0)}%`);
    
    // Test 7: Predictions
    console.log('\n🔮 Test 7: Predictions');
    console.log('----------------------');
    recordTest('Predictions is array', Array.isArray(context.predictions));
    recordTest('Has predictions', context.predictions.length > 0);
    
    if (context.predictions.length > 0) {
      const firstPred = context.predictions[0];
      recordTest('Prediction has question', typeof firstPred.question === 'string');
      recordTest('Prediction has probability 0-100', firstPred.probability >= 0 && firstPred.probability <= 100);
      recordTest('Prediction has aiRelevanceScore', typeof firstPred.aiRelevanceScore === 'number');
      recordTest('Prediction has category', typeof firstPred.category === 'string');
      
      console.log(`   Top prediction: ${firstPred.question.substring(0, 60)}...`);
      console.log(`   Probability: ${firstPred.probability}% | Relevance: ${firstPred.aiRelevanceScore}`);
    }
    
    // Filter quality check
    const electionLeakage = context.predictions.filter(p => 
      /election|president|congress|senate|governor/i.test(p.question)
    );
    recordTest('No political markets leaked', electionLeakage.length === 0, 
      electionLeakage.length > 0 ? `Found ${electionLeakage.length} political markets` : undefined
    );
    
    // Test 8: Market Sentiment
    console.log('\n😊 Test 8: Market Sentiment');
    console.log('---------------------------');
    recordTest('Market sentiment object exists', !!context.marketSentiment);
    recordTest('Score is in range -100 to +100', context.marketSentiment.score >= -100 && context.marketSentiment.score <= 100);
    recordTest('Label is valid', ['EXTREME_FEAR', 'FEAR', 'NEUTRAL', 'GREED', 'EXTREME_GREED'].includes(context.marketSentiment.label));
    recordTest('Components exist', !!context.marketSentiment.components);
    
    console.log(`   Sentiment: ${context.marketSentiment.label} (${context.marketSentiment.score})`);
    console.log(`   Components: Price=${context.marketSentiment.components.priceAction}, Vol=${context.marketSentiment.components.volume}`);
    
    // Test 9: Summary
    console.log('\n📝 Test 9: Actionable Summary');
    console.log('-----------------------------');
    recordTest('Summary object exists', !!context.summary);
    recordTest('Primary signal is valid', ['BULLISH', 'BEARISH', 'NEUTRAL'].includes(context.summary.primarySignal));
    recordTest('Confidence exists', typeof context.summary.confidence === 'number');
    recordTest('Urgency is valid', ['HIGH', 'MEDIUM', 'LOW'].includes(context.summary.urgency));
    recordTest('Suggested action exists', typeof context.summary.suggestedAction === 'string');
    recordTest('Key factors is array', Array.isArray(context.summary.keyFactors));
    
    console.log(`   Signal: ${context.summary.primarySignal} | Urgency: ${context.summary.urgency}`);
    console.log(`   Action: ${context.summary.suggestedAction}`);
    
    // Test 10: Performance - Second call should be cached
    console.log('\n⚡ Test 10: Caching Performance');
    console.log('-------------------------------');
    const cacheStart = Date.now();
    const cachedContext = await AIMarketIntelligence.getMarketContext();
    const cacheDuration = Date.now() - cacheStart;
    
    recordTest('Cached call fast (<100ms)', cacheDuration < 100, `${cacheDuration}ms`);
    recordTest('Cached result matches', cachedContext.generatedAt === context.generatedAt);
    
    console.log(`   Cache retrieval: ${cacheDuration}ms`);
    
    // Test 11: DelphiMarketService Integration
    console.log('\n🔄 Test 11: DelphiMarketService Integration');
    console.log('-------------------------------------------');
    const relevantMarkets = await DelphiMarketService.getRelevantMarkets(['BTC', 'ETH', 'SUI']);
    recordTest('Relevant markets returned', relevantMarkets.length > 0);
    recordTest('Markets have required fields', relevantMarkets.every(m => m.question && m.probability !== undefined));
    recordTest('Max 10 markets returned', relevantMarkets.length <= 10);
    
    console.log(`   Returned ${relevantMarkets.length} relevant markets`);
    
  } catch (error) {
    console.error('Test error:', error);
    recordTest('Test suite completed', false, String(error));
  }

  // Summary
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');
  console.log(`Total: ${results.passed + results.failed} | Passed: ${results.passed} | Failed: ${results.failed}`);
  
  if (results.failed > 0) {
    console.log('\nFailed tests:');
    results.tests.filter(t => t.status === 'FAIL').forEach(t => {
      console.log(`  ❌ ${t.name}: ${t.details}`);
    });
  }
  
  console.log('\n' + (results.failed === 0 ? '✅ ALL TESTS PASSED!' : `❌ ${results.failed} TESTS FAILED`));
  
  return results;
}

// Run the test
testAIMarketIntelligence()
  .then((results) => {
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
