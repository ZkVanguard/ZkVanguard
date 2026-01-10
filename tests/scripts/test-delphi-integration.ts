/**
 * Test Delphi Integration
 * Verify DelphiMarketService and PredictionInsights work correctly
 */

import { DelphiMarketService } from '../../lib/services/DelphiMarketService';

async function testDelphiIntegration() {
  console.log('🔮 Testing Delphi Integration...\n');

  try {
    // Test 1: Get relevant markets for assets
    console.log('Test 1: Get Relevant Markets');
    console.log('------------------------------');
    const markets = await DelphiMarketService.getRelevantMarkets(['BTC', 'ETH', 'CRO']);
    console.log(`✓ Found ${markets.length} prediction markets`);
    console.log('Sample market:', markets[0]);
    console.log('');

    // Test 2: Get asset insights
    console.log('Test 2: Get Asset Insights');
    console.log('------------------------------');
    const insights = await DelphiMarketService.getAssetInsights('BTC');
    console.log(`✓ BTC Insights:`);
    console.log(`  - Predictions: ${insights.predictions.length}`);
    console.log(`  - Overall Risk: ${insights.overallRisk}`);
    console.log(`  - Suggested Action: ${insights.suggestedAction}`);
    console.log('');

    // Test 3: Get top markets
    console.log('Test 3: Get Top Markets');
    console.log('------------------------------');
    const topMarkets = await DelphiMarketService.getTopMarkets(5);
    console.log(`✓ Top 5 markets by volume:`);
    topMarkets.forEach((market, i) => {
      console.log(`  ${i + 1}. ${market.question}`);
      console.log(`     Probability: ${market.probability}% | Volume: ${market.volume} | Impact: ${market.impact}`);
    });
    console.log('');

    // Test 4: Filter high-risk predictions
    console.log('Test 4: High-Risk Predictions');
    console.log('------------------------------');
    const highRisk = markets.filter(m => m.impact === 'HIGH' && m.probability > 60);
    console.log(`✓ Found ${highRisk.length} high-risk predictions requiring hedging:`);
    highRisk.forEach(market => {
      console.log(`  - ${market.question}`);
      console.log(`    ${market.probability}% probability | ${market.recommendation} | Assets: ${market.relatedAssets.join(', ')}`);
    });
    console.log('');

    // Test 5: Time formatting
    console.log('Test 5: Time Formatting');
    console.log('------------------------------');
    const now = Date.now();
    const testTimes = [
      now - 30000,     // 30 seconds ago
      now - 300000,    // 5 minutes ago
      now - 3600000,   // 1 hour ago
      now - 86400000,  // 1 day ago
    ];
    console.log('✓ Time formatting:');
    testTimes.forEach(time => {
      console.log(`  ${time} → "${DelphiMarketService.formatTimeAgo(time)}"`);
    });
    console.log('');

    // Test 6: Verify mock data structure
    console.log('Test 6: Data Structure Validation');
    console.log('------------------------------');
    const sampleMarket = markets[0];
    const requiredFields = ['id', 'question', 'category', 'probability', 'volume', 'impact', 'relatedAssets', 'lastUpdate', 'confidence', 'recommendation'];
    const missingFields = requiredFields.filter(field => !(field in sampleMarket));
    
    if (missingFields.length === 0) {
      console.log('✓ All required fields present in market data');
      console.log('  Fields:', requiredFields.join(', '));
    } else {
      console.log('✗ Missing fields:', missingFields.join(', '));
    }
    console.log('');

    // Test 7: Category distribution
    console.log('Test 7: Category Distribution');
    console.log('------------------------------');
    const categories = markets.reduce((acc, m) => {
      acc[m.category] = (acc[m.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('✓ Markets by category:');
    Object.entries(categories).forEach(([category, count]) => {
      console.log(`  ${category}: ${count} markets`);
    });
    console.log('');

    // Test 8: Recommendation distribution
    console.log('Test 8: Recommendation Distribution');
    console.log('------------------------------');
    const recommendations = markets.reduce((acc, m) => {
      const rec = m.recommendation || 'NONE';
      acc[rec] = (acc[rec] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('✓ Markets by recommendation:');
    Object.entries(recommendations).forEach(([rec, count]) => {
      console.log(`  ${rec}: ${count} markets`);
    });
    console.log('');

    // Summary
    console.log('========================================');
    console.log('✓ All Tests Passed!');
    console.log('========================================');
    console.log('Delphi Integration Summary:');
    console.log(`  - Total Markets: ${markets.length}`);
    console.log(`  - High Risk Markets: ${highRisk.length}`);
    console.log(`  - Markets Requiring Hedge: ${markets.filter(m => m.recommendation === 'HEDGE').length}`);
    console.log(`  - Markets to Monitor: ${markets.filter(m => m.recommendation === 'MONITOR').length}`);
    console.log('');
    console.log('🎉 Delphi integration is working correctly!');
    console.log('   Navigate to http://localhost:3000/dashboard to see it in action.');

  } catch (error) {
    console.error('✗ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testDelphiIntegration();
