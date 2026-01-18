/**
 * Crypto.com Integration Test Script
 * Tests all new services to verify they're working correctly
 */

import { cryptocomExchangeService as cryptocomExchange } from '../lib/services/CryptocomExchangeService';
import { cryptocomDeveloperPlatform as cryptocomPlatform } from '../lib/services/CryptocomDeveloperPlatformService';
import { cryptocomAIAgent } from '../lib/services/CryptocomAIAgentService';
import { getMarketDataService } from '../lib/services/RealMarketDataService';

const realMarketDataService = getMarketDataService();

async function testExchangeAPI() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 TEST 1: Crypto.com Exchange API Service');
  console.log('='.repeat(60));

  try {
    // Test single price
    console.log('\n📊 Testing single price fetch...');
    const btcPrice = await cryptocomExchange.getPrice('BTC');
    console.log(`✅ BTC Price: $${btcPrice.toLocaleString()}`);

    // Test market data
    console.log('\n📊 Testing market data with 24h stats...');
    const ethData = await cryptocomExchange.getMarketData('ETH');
    console.log(`✅ ETH: $${ethData.price.toLocaleString()}`);
    console.log(`   24h Change: ${ethData.change24h.toFixed(2)}%`);
    console.log(`   24h Volume: $${ethData.volume24h.toLocaleString()}`);
    console.log(`   24h High: $${ethData.high24h?.toLocaleString() || 'N/A'}`);
    console.log(`   24h Low: $${ethData.low24h?.toLocaleString() || 'N/A'}`);

    // Test batch prices
    console.log('\n📊 Testing batch price fetch...');
    const symbols = ['BTC', 'ETH', 'CRO', 'USDC'];
    const prices = await cryptocomExchange.getBatchPrices(symbols);
    console.log('✅ Batch Prices:');
    Object.entries(prices).forEach(([symbol, price]) => {
      console.log(`   ${symbol}: $${price.toLocaleString()}`);
    });

    // Test health check
    console.log('\n📊 Testing health check...');
    const isHealthy = await cryptocomExchange.healthCheck();
    console.log(`✅ Exchange API Health: ${isHealthy ? '🟢 HEALTHY' : '🔴 UNHEALTHY'}`);

    return true;
  } catch (error: any) {
    console.error('❌ Exchange API Test Failed:', error.message);
    return false;
  }
}

async function testDeveloperPlatform() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 TEST 2: Developer Platform Client Service');
  console.log('='.repeat(60));

  try {
    // Initialize
    console.log('\n🔧 Initializing Developer Platform...');
    const apiKey = process.env.DASHBOARD_API_KEY || process.env.CRYPTOCOM_DEVELOPER_API_KEY;
    
    if (!apiKey) {
      console.log('⚠️  SKIPPED: No DASHBOARD_API_KEY found in environment');
      console.log('   Get your key from: https://developers.zkevm.cronos.org/user/apikeys');
      return true; // Not a failure, just skipped
    }

    await cryptocomPlatform.initialize({
      apiKey,
      network: 'CronosEvm.Testnet',
    });
    console.log('✅ Initialized on Cronos EVM Testnet (Chain ID: 338)');

    // Test latest block
    console.log('\n📊 Testing latest block query...');
    const block = await cryptocomPlatform.getLatestBlock();
    console.log(`✅ Latest Block: #${block.number}`);
    console.log(`   Timestamp: ${new Date(parseInt(block.timestamp) * 1000).toLocaleString()}`);
    console.log(`   Hash: ${block.hash}`);

    // Test with a known address (Cronos testnet faucet)
    const testAddress = '0x0000000000000000000000000000000000000000';
    console.log(`\n📊 Testing balance query for ${testAddress}...`);
    const balance = await cryptocomPlatform.getNativeBalance(testAddress);
    console.log(`✅ CRO Balance: ${balance.balanceFormatted} CRO`);

    // Test health check
    console.log('\n📊 Testing health check...');
    const isHealthy = await cryptocomPlatform.healthCheck();
    console.log(`✅ Developer Platform Health: ${isHealthy ? '🟢 HEALTHY' : '🔴 UNHEALTHY'}`);

    return true;
  } catch (error: any) {
    console.error('❌ Developer Platform Test Failed:', error.message);
    return false;
  }
}

async function testAIAgent() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 TEST 3: AI Agent Service');
  console.log('='.repeat(60));

  try {
    // Check for API keys
    const openaiKey = process.env.OPENAI_API_KEY;
    const dashboardKey = process.env.DASHBOARD_API_KEY || process.env.CRYPTOCOM_DEVELOPER_API_KEY;

    if (!openaiKey || !dashboardKey) {
      console.log('⚠️  SKIPPED: Missing required API keys');
      console.log('   Required: OPENAI_API_KEY and DASHBOARD_API_KEY');
      return true; // Not a failure, just skipped
    }

    // Initialize
    console.log('\n🔧 Initializing AI Agent...');
    await cryptocomAIAgent.initialize({
      openaiApiKey: openaiKey,
      chainId: '338',
      dashboardApiKey: dashboardKey,
    });
    console.log('✅ AI Agent initialized with GPT-4o-mini on Cronos Testnet');

    // Test simple query
    console.log('\n📊 Testing natural language query...');
    const result = await cryptocomAIAgent.getLatestBlock();
    console.log(`✅ Query Response: ${result.response.substring(0, 100)}...`);

    // Test health check
    console.log('\n📊 Testing health check...');
    const isHealthy = await cryptocomAIAgent.healthCheck();
    console.log(`✅ AI Agent Health: ${isHealthy ? '🟢 HEALTHY' : '🔴 UNHEALTHY'}`);

    return true;
  } catch (error: any) {
    console.error('❌ AI Agent Test Failed:', error.message);
    return false;
  }
}

async function testMarketDataService() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 TEST 4: Enhanced Market Data Service (Multi-Source)');
  console.log('='.repeat(60));

  try {
    // Test fallback chain
    console.log('\n📊 Testing multi-source fallback for various tokens...');
    const symbols = ['BTC', 'ETH', 'CRO', 'USDC'];

    for (const symbol of symbols) {
      const price = await realMarketDataService.getTokenPrice(symbol);
      console.log(`✅ ${symbol}: $${price.price.toLocaleString()} from [${price.source}]`);
      
      // Show data freshness
      const age = Date.now() - price.timestamp;
      if (age > 60000) {
        console.log(`   ⚠️  Data is ${Math.round(age / 1000)}s old`);
      }
    }

    // Test batch fetch
    console.log('\n📊 Testing batch price fetch...');
    const batchPrices = await realMarketDataService.getTokenPrices(['BTC', 'ETH', 'CRO']);
    console.log('✅ Batch Prices:');
    batchPrices.forEach((price, symbol) => {
      console.log(`   ${symbol}: $${price.price.toLocaleString()} from [${price.source}]`);
    });

    return true;
  } catch (error: any) {
    console.error('❌ Market Data Service Test Failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' '.repeat(10) + 'CRYPTO.COM INTEGRATION TEST SUITE' + ' '.repeat(14) + '║');
  console.log('╚' + '═'.repeat(58) + '╝');

  const results = {
    exchangeAPI: false,
    developerPlatform: false,
    aiAgent: false,
    marketDataService: false,
  };

  // Run all tests
  results.exchangeAPI = await testExchangeAPI();
  results.developerPlatform = await testDeveloperPlatform();
  results.aiAgent = await testAIAgent();
  results.marketDataService = await testMarketDataService();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));

  const total = Object.keys(results).length;
  const passed = Object.values(results).filter(Boolean).length;
  const failed = total - passed;

  console.log(`\n✅ Passed: ${passed}/${total}`);
  console.log(`${failed > 0 ? '❌' : '✅'} Failed: ${failed}/${total}`);

  console.log('\n🔧 Service Status:');
  console.log(`   Exchange API: ${results.exchangeAPI ? '✅' : '❌'}`);
  console.log(`   Developer Platform: ${results.developerPlatform ? '✅' : '❌'}`);
  console.log(`   AI Agent: ${results.aiAgent ? '✅' : '❌'}`);
  console.log(`   Market Data Service: ${results.marketDataService ? '✅' : '❌'}`);

  console.log('\n💡 Setup Instructions:');
  console.log('   1. Get DASHBOARD_API_KEY from https://developers.zkevm.cronos.org/user/apikeys');
  console.log('   2. Get OPENAI_API_KEY from https://platform.openai.com/api-keys');
  console.log('   3. Add keys to .env.local');
  console.log('   4. Run: npm run dev');

  console.log('\n📖 Documentation: docs/CRYPTOCOM_INTEGRATION.md');
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
