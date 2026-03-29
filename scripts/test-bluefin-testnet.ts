/**
 * BlueFin Testnet Integration Test
 * 
 * Tests the BlueFin perpetual DEX integration on SUI testnet.
 * Run with: npx tsx scripts/test-bluefin-testnet.ts
 */

import { bluefinService, BLUEFIN_PAIRS, BLUEFIN_NETWORKS } from '../lib/services/BluefinService';

// Load environment
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback to .env

const PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY;

async function testBluefinTestnet() {
  console.log('🌊 BlueFin Testnet Integration Test');
  console.log('=' .repeat(50));
  console.log(`Mode: LIVE`);
  console.log(`Network: SUI Testnet`);
  console.log(`API URL: ${BLUEFIN_NETWORKS.testnet.tradeApiUrl}`);
  console.log();

  if (!PRIVATE_KEY) {
    console.error('❌ BLUEFIN_PRIVATE_KEY not set — cannot run BlueFin tests');
    process.exit(1);
  }

  try {
    // Step 1: Initialize
    console.log('📋 Step 1: Initialize BlueFin Client');
    await bluefinService.initialize(PRIVATE_KEY, 'testnet');
    console.log(`✅ Wallet Address: ${bluefinService.getAddress()}`);
    console.log();

    // Step 2: Check supported pairs
    console.log('📋 Step 2: Supported Trading Pairs');
    Object.entries(BLUEFIN_PAIRS).forEach(([key, pair]) => {
      console.log(`  - ${pair.symbol}: ${pair.baseAsset}, max leverage ${pair.maxLeverage}x`);
    });
    console.log();

    // Step 3: Get account balance
    console.log('📋 Step 3: Account Balance');
    const balance = await bluefinService.getBalance();
    console.log(`  Available: ${balance} USDC`);
    console.log();

    // Step 4: Get market data
    console.log('📋 Step 4: Market Data (SUI-PERP)');
    const marketData = await bluefinService.getMarketData('SUI-PERP');
    if (marketData) {
      console.log(`  Price: $${marketData.price}`);
      console.log(`  Funding Rate: ${marketData.fundingRate}%`);
    }
    console.log();

    // Step 5: Get current positions
    console.log('📋 Step 5: Current Positions');
    const positions = await bluefinService.getPositions();
    if (positions.length === 0) {
      console.log('  No open positions');
    } else {
      positions.forEach(pos => {
        console.log(`  ${pos.symbol}: ${pos.side} ${pos.size} @ ${pos.entryPrice}`);
        console.log(`    PnL: ${pos.unrealizedPnl > 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)} USDC`);
      });
    }
    console.log();

    // Step 6: Live test — open and close a small hedge
    console.log('📋 Step 6: Live Hedge Test (SUI-PERP SHORT 1 SUI)');
    const hedgeResult = await bluefinService.openHedge({
      symbol: 'SUI-PERP',
      side: 'SHORT',
      size: 1, // Small size for testing
      leverage: 2,
      reason: 'Integration test',
    });
    console.log(`  Success: ${hedgeResult.success}`);
    if (hedgeResult.success) {
      console.log(`  Hedge ID: ${hedgeResult.hedgeId}`);
      console.log(`  Order ID: ${hedgeResult.orderId}`);
      console.log(`  Execution Price: $${hedgeResult.executionPrice}`);
      console.log(`  Filled Size: ${hedgeResult.filledSize} SUI`);
      console.log();

      // Close position
      console.log('📋 Step 7: Close Position');
      const closeResult = await bluefinService.closeHedge({
        symbol: 'SUI-PERP',
      });
      console.log(`  Success: ${closeResult.success}`);
      console.log(`  Close Price: $${closeResult.executionPrice}`);
    } else {
      console.log(`  Error: ${hedgeResult.error}`);
      console.log('  (This is expected if account is not onboarded on BlueFin testnet)');
    }

    console.log();
    console.log('✅ All BlueFin testnet tests completed!');
    console.log();
    console.log('📝 To use BlueFin hedging:');
    console.log('  1. Set BLUEFIN_PRIVATE_KEY in .env');
    console.log('  2. Fund your wallet on SUI testnet');
    console.log('  3. Onboard at https://testnet.bluefin.io/perps');
    console.log('  4. Get testnet USDC from BlueFin faucet');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testBluefinTestnet().catch(console.error);
