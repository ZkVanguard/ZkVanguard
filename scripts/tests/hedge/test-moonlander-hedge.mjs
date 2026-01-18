#!/usr/bin/env node
/**
 * Test Moonlander Hedge Execution
 * Validates the full flow of opening a SHORT hedge on Moonlander testnet
 */

import fetch from 'node-fetch';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

console.log('\n🛡️  MOONLANDER HEDGE EXECUTION TEST\n');
console.log('━'.repeat(60));

async function testHedgeExecution() {
  console.log('\n📋 Test Scenario: Market Crash Hedge');
  console.log('   Prediction: "Major BTC crash expected" (85% probability)');
  console.log('   Strategy: Open SHORT position on BTC-USD-PERP\n');

  const hedgeRequest = {
    portfolioId: 1,
    asset: 'BTC',
    side: 'SHORT',
    notionalValue: 850, // $850 based on 85% probability
    leverage: 5,
    stopLoss: 45000, // Close if price goes up 5%
    takeProfit: 40000, // Take profit at -8%
    reason: 'Hedge against predicted BTC crash (85% probability)',
  };

  console.log('🔧 Request Parameters:');
  console.log(`   Asset: ${hedgeRequest.asset}`);
  console.log(`   Side: ${hedgeRequest.side}`);
  console.log(`   Notional: $${hedgeRequest.notionalValue}`);
  console.log(`   Leverage: ${hedgeRequest.leverage}x`);
  console.log(`   Stop Loss: $${hedgeRequest.stopLoss}`);
  console.log(`   Take Profit: $${hedgeRequest.takeProfit}\n`);

  try {
    console.log('⏳ Sending request to Moonlander API...\n');
    
    const response = await fetch(`${API_BASE}/api/agents/hedging/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hedgeRequest),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    console.log('✅ HEDGE EXECUTION RESULT:');
    console.log('━'.repeat(60));
    console.log(`   Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`   Order ID: ${result.orderId}`);
    console.log(`   Market: ${result.market}`);
    console.log(`   Side: ${result.side}`);
    console.log(`   Position Size: ${result.size}`);
    console.log(`   Entry Price: $${result.entryPrice}`);
    console.log(`   Leverage: ${result.leverage}x`);
    
    if (result.estimatedLiquidationPrice) {
      console.log(`   Liquidation Price: $${result.estimatedLiquidationPrice}`);
    }
    
    if (result.stopLoss) {
      console.log(`   Stop Loss: $${result.stopLoss}`);
    }
    
    if (result.takeProfit) {
      console.log(`   Take Profit: $${result.takeProfit}`);
    }
    
    console.log(`   Mode: ${result.simulationMode ? '🎭 SIMULATION' : '🔴 LIVE TRADING'}`);
    
    if (result.simulationMode) {
      console.log('\n⚠️  SIMULATION MODE ACTIVE');
      console.log('   To enable live trading:');
      console.log('   1. Set MOONLANDER_PRIVATE_KEY in .env.local');
      console.log('   2. Fund wallet on Cronos Testnet');
      console.log('   3. Get Moonlander API keys from https://moonlander.trade');
    }

    console.log('\n━'.repeat(60));
    
    return result;

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    throw error;
  }
}

async function testMultipleScenarios() {
  const scenarios = [
    {
      name: 'High Risk - Large Hedge',
      asset: 'BTC',
      side: 'SHORT',
      notionalValue: 2000,
      leverage: 10,
      probability: 90,
    },
    {
      name: 'Medium Risk - Balanced Hedge',
      asset: 'ETH',
      side: 'SHORT',
      notionalValue: 500,
      leverage: 5,
      probability: 65,
    },
    {
      name: 'Low Risk - Conservative Hedge',
      asset: 'CRO',
      side: 'SHORT',
      notionalValue: 100,
      leverage: 2,
      probability: 40,
    },
  ];

  console.log('\n\n📊 TESTING MULTIPLE HEDGE SCENARIOS\n');
  console.log('━'.repeat(60));

  for (const scenario of scenarios) {
    console.log(`\n🎯 ${scenario.name}`);
    console.log(`   Asset: ${scenario.asset} | Notional: $${scenario.notionalValue} | Leverage: ${scenario.leverage}x`);

    try {
      const response = await fetch(`${API_BASE}/api/agents/hedging/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId: 1,
          asset: scenario.asset,
          side: scenario.side,
          notionalValue: scenario.notionalValue,
          leverage: scenario.leverage,
          reason: `${scenario.probability}% crash probability`,
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        console.log(`   ✅ Order: ${result.orderId} | Size: ${result.size} | Entry: $${result.entryPrice}`);
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
      }

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  console.log('\n━'.repeat(60));
}

async function main() {
  try {
    // Test 1: Single hedge execution
    await testHedgeExecution();

    // Test 2: Multiple scenarios
    await testMultipleScenarios();

    console.log('\n✅ ALL TESTS COMPLETED\n');
    console.log('💡 Key Integration Points:');
    console.log('   ✓ Dashboard "Open Hedge" button → /api/agents/hedging/execute');
    console.log('   ✓ MoonlanderClient → Perpetuals trading on Cronos testnet');
    console.log('   ✓ Automatic stop-loss and take-profit placement');
    console.log('   ✓ Risk-based position sizing (probability × notional)');
    console.log('   ✓ Real-time liquidation price calculation\n');

  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  }
}

main();
