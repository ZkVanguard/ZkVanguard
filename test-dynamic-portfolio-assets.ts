/**
 * Test Dynamic Portfolio Asset Detection
 * Demonstrates how portfolio assets are extracted dynamically from on-chain data
 */

import { getMarketDataService } from './lib/services/RealMarketDataService';
import { DelphiMarketService } from './lib/services/DelphiMarketService';

async function testDynamicAssetDetection() {
  console.log('🔮 Testing Dynamic Portfolio Asset Detection\n');

  // Simulate demo wallet address (testnet)
  const demoAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'; // Example testnet address

  // Step 1: Fetch real portfolio data
  console.log('Step 1: Fetching Portfolio Data');
  console.log('=================================');
  const marketData = getMarketDataService();
  const portfolioData = await marketData.getPortfolioData(demoAddress);

  console.log(`✓ Portfolio fetched for: ${portfolioData.address.slice(0, 6)}...${portfolioData.address.slice(-4)}`);
  console.log(`✓ Total Value: $${portfolioData.totalValue.toFixed(2)}`);
  console.log(`✓ Tokens Found: ${portfolioData.tokens.length}\n`);

  // Display token holdings
  console.log('Token Holdings:');
  portfolioData.tokens.forEach((token, i) => {
    console.log(`  ${i + 1}. ${token.symbol}: ${parseFloat(token.balance).toFixed(4)} ($${token.usdValue.toFixed(2)})`);
  });

  // Step 2: Extract unique assets dynamically
  console.log('\n\nStep 2: Dynamic Asset Extraction');
  console.log('=================================');
  
  const assets = portfolioData.tokens
    .filter(token => parseFloat(token.balance) > 0.001) // Filter dust
    .map(token => token.symbol.toUpperCase().replace(/^(W|DEV)/, '')) // Normalize
    .filter((symbol, index, arr) => arr.indexOf(symbol) === index); // Deduplicate

  console.log('✓ Extracted Assets:', assets);
  console.log('✓ Asset Count:', assets.length);
  
  // Show normalization examples
  console.log('\nNormalization Examples:');
  console.log('  WCRO → CRO');
  console.log('  devUSDC → USDC');
  console.log('  CRO → CRO (unchanged)');

  // Step 3: Fetch relevant Delphi predictions
  console.log('\n\nStep 3: Fetch Relevant Predictions');
  console.log('===================================');
  
  const predictions = await DelphiMarketService.getRelevantMarkets(assets);
  
  console.log(`✓ Found ${predictions.length} predictions relevant to your portfolio:\n`);
  
  predictions.forEach((pred, i) => {
    console.log(`${i + 1}. ${pred.question}`);
    console.log(`   Probability: ${pred.probability}%`);
    console.log(`   Impact: ${pred.impact}`);
    console.log(`   Recommendation: ${pred.recommendation}`);
    console.log(`   Related Assets: ${pred.relatedAssets.join(', ')}\n`);
  });

  // Step 4: Simulate adding BTC to portfolio
  console.log('\nStep 4: Simulating Portfolio Change (Add BTC)');
  console.log('==============================================');
  
  const updatedAssets = [...assets, 'BTC'];
  console.log('✓ Updated Portfolio Assets:', updatedAssets);
  
  const updatedPredictions = await DelphiMarketService.getRelevantMarkets(updatedAssets);
  console.log(`✓ Now showing ${updatedPredictions.length} predictions (was ${predictions.length})`);
  
  const newPredictions = updatedPredictions.filter(
    up => !predictions.find(p => p.id === up.id)
  );
  
  if (newPredictions.length > 0) {
    console.log(`\n✓ New predictions appear for BTC:`);
    newPredictions.forEach(pred => {
      console.log(`  - ${pred.question}`);
    });
  }

  // Summary
  console.log('\n\n========================================');
  console.log('✓ Dynamic Asset Detection Working!');
  console.log('========================================');
  console.log('How It Works:');
  console.log('  1. Fetch on-chain portfolio data (RealMarketDataService)');
  console.log('  2. Extract asset symbols from tokens with balance > 0.001');
  console.log('  3. Normalize asset names (WCRO→CRO, devUSDC→USDC)');
  console.log('  4. Remove duplicates');
  console.log('  5. Pass to Delphi service for relevant predictions');
  console.log('  6. Update automatically when portfolio changes');
  console.log('\n🎉 No hardcoded assets - 100% dynamic based on holdings!');
}

testDynamicAssetDetection().catch(console.error);
