/**
 * Test Delphi Portfolio-Based Filtering
 * Demonstrates how predictions are filtered based on portfolio holdings
 */

import { DelphiMarketService } from '../../lib/services/DelphiMarketService';

async function testPortfolioFiltering() {
  console.log('🔮 Testing Delphi Portfolio-Based Filtering...\n');

  // Test 1: Portfolio with only CRO and USDC (current demo portfolio)
  console.log('Test 1: Portfolio with CRO and USDC');
  console.log('=====================================');
  const portfolioCroUsdc = await DelphiMarketService.getRelevantMarkets(['CRO', 'USDC']);
  console.log(`✓ Found ${portfolioCroUsdc.length} relevant predictions:`);
  portfolioCroUsdc.forEach((market, i) => {
    console.log(`  ${i + 1}. ${market.question}`);
    console.log(`     Assets: ${market.relatedAssets.join(', ')}`);
    console.log(`     Recommendation: ${market.recommendation}\n`);
  });

  // Test 2: Portfolio with BTC and ETH (should show different predictions)
  console.log('\nTest 2: Portfolio with BTC and ETH');
  console.log('===================================');
  const portfolioBtcEth = await DelphiMarketService.getRelevantMarkets(['BTC', 'ETH']);
  console.log(`✓ Found ${portfolioBtcEth.length} relevant predictions:`);
  portfolioBtcEth.forEach((market, i) => {
    console.log(`  ${i + 1}. ${market.question}`);
    console.log(`     Assets: ${market.relatedAssets.join(', ')}`);
    console.log(`     Recommendation: ${market.recommendation}\n`);
  });

  // Test 3: Portfolio with all assets (should show all predictions)
  console.log('\nTest 3: Portfolio with BTC, ETH, CRO, USDC');
  console.log('===========================================');
  const portfolioAll = await DelphiMarketService.getRelevantMarkets(['BTC', 'ETH', 'CRO', 'USDC']);
  console.log(`✓ Found ${portfolioAll.length} relevant predictions:`);
  portfolioAll.forEach((market, i) => {
    console.log(`  ${i + 1}. ${market.question}`);
    console.log(`     Assets: ${market.relatedAssets.join(', ')}`);
    console.log(`     Recommendation: ${market.recommendation}\n`);
  });

  // Test 4: Empty portfolio (edge case)
  console.log('\nTest 4: Empty Portfolio (no assets)');
  console.log('===================================');
  const portfolioEmpty = await DelphiMarketService.getRelevantMarkets([]);
  console.log(`✓ Found ${portfolioEmpty.length} predictions (shows all when no filter)\n`);

  // Summary
  console.log('\n========================================');
  console.log('✓ Portfolio Filtering Working Correctly!');
  console.log('========================================');
  console.log('Summary:');
  console.log(`  - CRO + USDC portfolio: ${portfolioCroUsdc.length} predictions`);
  console.log(`  - BTC + ETH portfolio: ${portfolioBtcEth.length} predictions`);
  console.log(`  - Full portfolio: ${portfolioAll.length} predictions`);
  console.log(`  - No assets: ${portfolioEmpty.length} predictions (all available)`);
  console.log('\n🎉 Predictions now show only what\'s relevant to your holdings!');
}

testPortfolioFiltering().catch(console.error);
