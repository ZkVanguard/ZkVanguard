/**
 * BlueFin Testnet Integration Test
 * 
 * Tests the BlueFin perpetual DEX integration on SUI testnet.
 * Run with: npx ts-node --esm scripts/test-bluefin-testnet.ts
 */

import { bluefinService, mockBluefinService, BLUEFIN_PAIRS, BLUEFIN_NETWORKS } from '../lib/services/BluefinService';

// Load environment
import * as dotenv from 'dotenv';
dotenv.config();

const PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY;
const USE_MOCK = process.env.BLUEFIN_USE_MOCK === 'true' || !PRIVATE_KEY;

async function testBluefinTestnet() {
  console.log('🌊 BlueFin Testnet Integration Test');
  console.log('=' .repeat(50));
  console.log(`Mode: ${USE_MOCK ? 'MOCK' : 'LIVE'}`);
  console.log(`Network: SUI Testnet`);
  console.log(`API URL: ${BLUEFIN_NETWORKS.testnet.tradeApiUrl}`);
  console.log();

  const service = USE_MOCK ? mockBluefinService : bluefinService;

  try {
    // Step 1: Initialize
    console.log('📋 Step 1: Initialize BlueFin Client');
    if (!USE_MOCK && PRIVATE_KEY) {
      await bluefinService.initialize(PRIVATE_KEY, 'testnet');
      console.log(`✅ Wallet Address: ${bluefinService.getAddress()}`);
    } else {
      console.log('✅ Using mock service (no real transactions)');
    }
    console.log();

    // Step 2: Check supported pairs
    console.log('📋 Step 2: Supported Trading Pairs');
    Object.entries(BLUEFIN_PAIRS).forEach(([key, pair]) => {
      console.log(`  - ${pair.symbol}: ${pair.baseAsset}, max leverage ${pair.maxLeverage}x`);
    });
    console.log();

    // Step 3: Get account balance
    console.log('📋 Step 3: Account Balance');
    const balance = await service.getBalance();
    console.log(`  Available: ${balance.available} USDC`);
    console.log(`  Total: ${balance.total} USDC`);
    console.log(`  In Positions: ${balance.inPositions} USDC`);
    console.log();

    // Step 4: Get market data
    console.log('📋 Step 4: Market Data (SUI-PERP)');
    const marketData = await service.getMarketData('SUI-PERP');
    if (marketData) {
      console.log(`  Price: $${marketData.price}`);
      console.log(`  24h Change: ${marketData.change24h}%`);
      console.log(`  24h Volume: $${marketData.volume24h?.toLocaleString()}`);
      console.log(`  Funding Rate: ${marketData.fundingRate}%`);
    }
    console.log();

    // Step 5: Get current positions
    console.log('📋 Step 5: Current Positions');
    const positions = await service.getPositions();
    if (positions.length === 0) {
      console.log('  No open positions');
    } else {
      positions.forEach(pos => {
        console.log(`  ${pos.symbol}: ${pos.side} ${pos.size} @ ${pos.entryPrice}`);
        console.log(`    PnL: ${pos.unrealizedPnl > 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)} USDC`);
      });
    }
    console.log();

    // Step 6: Test mock hedge (only in mock mode for safety)
    if (USE_MOCK) {
      console.log('📋 Step 6: Test Mock Hedge Order');
      const hedgeResult = await mockBluefinService.openHedge({
        symbol: 'SUI-PERP',
        side: 'SHORT',
        size: 10,
        leverage: 5,
      });
      console.log(`  Success: ${hedgeResult.success}`);
      console.log(`  Hedge ID: ${hedgeResult.hedgeId}`);
      console.log(`  Order ID: ${hedgeResult.orderId}`);
      console.log(`  Execution Price: $${hedgeResult.executionPrice}`);
      console.log(`  Filled Size: ${hedgeResult.filledSize} SUI`);
      console.log();

      // Close mock position
      console.log('📋 Step 7: Test Mock Close Position');
      const closeResult = await mockBluefinService.closeHedge({
        symbol: 'SUI-PERP',
      });
      console.log(`  Success: ${closeResult.success}`);
      console.log(`  Close ID: ${closeResult.hedgeId}`);
    } else {
      console.log('📋 Step 6: Live Trading (Skipped - use with caution on testnet)');
      console.log('  To test live trading, uncomment the code below');
      // Uncomment to test live trading on testnet:
      // const hedgeResult = await bluefinService.openHedge({
      //   symbol: 'SUI-PERP',
      //   side: 'SHORT',
      //   size: 1, // Small size for testing
      //   leverage: 2,
      // });
      // console.log('Hedge Result:', hedgeResult);
    }

    console.log();
    console.log('✅ All BlueFin testnet tests passed!');
    console.log();
    console.log('📝 To enable live trading:');
    console.log('  1. Set BLUEFIN_PRIVATE_KEY in .env');
    console.log('  2. Set BLUEFIN_USE_MOCK=false');
    console.log('  3. Fund your wallet on SUI testnet');
    console.log('  4. Get testnet USDC from BlueFin faucet');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testBluefinTestnet().catch(console.error);
