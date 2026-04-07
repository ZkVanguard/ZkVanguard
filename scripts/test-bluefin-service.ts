/**
 * Test BluefinService integration
 * 
 * Tests the BluefinService class directly with wallet-based authentication.
 * 
 * Usage:
 *   npx tsx scripts/test-bluefin-service.ts
 * 
 * Requires: BLUEFIN_PRIVATE_KEY environment variable
 */

import { BluefinService } from '../lib/services/sui/BluefinService';

const PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY || '';

async function main() {
  console.log('🌊 BlueFin Service Integration Test');
  console.log('='.repeat(50));

  if (!PRIVATE_KEY) {
    console.error('❌ BLUEFIN_PRIVATE_KEY environment variable not set');
    console.log('\nUsage:');
    console.log('  $env:BLUEFIN_PRIVATE_KEY="suiprivkey..."; npx tsx scripts/test-bluefin-service.ts');
    process.exit(1);
  }

  const bluefin = BluefinService.getInstance();
  
  try {
    // Initialize on testnet
    console.log('\n📋 Initializing BluefinService...');
    await bluefin.initialize(PRIVATE_KEY, 'testnet');
    console.log('✅ BluefinService initialized');
    
    // Check if we're in mock mode
    const status = bluefin.getStatus();
    console.log('\n📊 Service Status:');
    console.log(`   Initialized: ${status.initialized}`);
    console.log(`   Mock Mode: ${status.mockMode}`);
    console.log(`   Network: ${status.network}`);
    console.log(`   Address: ${status.walletAddress}`);
    
    if (status.mockMode) {
      console.log('\n⚠️  Running in mock mode (API may be unavailable)');
    } else {
      console.log('\n✅ Running in LIVE mode');
    }
    
    // Try to get market data (may fail on testnet if exchange API is down)
    console.log('\n📊 Fetching market data...');
    try {
      const marketData = await bluefin.getMarketData('ETH-PERP');
      if (marketData && marketData.price > 0) {
        console.log(`   ETH-PERP Price: $${marketData.price.toFixed(2)}`);
        console.log(`   Funding Rate: ${(marketData.fundingRate * 100).toFixed(4)}%`);
        console.log(`   24h Change: ${marketData.change24h?.toFixed(2) || 'N/A'}%`);
      } else {
        console.log('   No market data available (testnet exchange API may be down)');
      }
    } catch (e) {
      console.log(`   Market data error: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    // Try to get positions (requires exchange API which may be down on testnet)
    console.log('\n📊 Fetching positions (exchange API)...');
    try {
      const positions = await bluefin.getPositions();
      console.log(`   Found ${positions.length} position(s)`);
      for (const pos of positions) {
        console.log(`   - ${pos.symbol}: ${pos.side} ${pos.size} @ ${pos.entryPrice}`);
      }
    } catch (e) {
      console.log(`   Positions error: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    // Try to get open orders (uses trade API which is usually available)
    console.log('\n📊 Fetching open orders (trade API)...');
    try {
      const orders = await bluefin.getOpenOrders();
      console.log(`   Found ${orders.length} open order(s)`);
      for (const order of orders) {
        console.log(`   - ${order.symbol}: ${order.side} ${order.quantity} @ ${order.price}`);
      }
    } catch (e) {
      console.log(`   Orders error: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    console.log('\n='.repeat(50));
    console.log('✅ Test completed');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch(console.error);
