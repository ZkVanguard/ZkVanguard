#!/usr/bin/env node

/**
 * Create test hedges with real current market prices
 */

async function createTestHedge(asset, side, leverage) {
  // Get real current price from Crypto.com
  const tickerResponse = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers');
  const tickerData = await tickerResponse.json();
  
  const ticker = tickerData.result.data.find(t => 
    t.i === `${asset}_USDT`
  );
  
  if (!ticker) {
    console.error(`❌ Ticker not found for ${asset}`);
    return;
  }
  
  const currentPrice = parseFloat(ticker.a); // Ask price
  const size = asset === 'BTC' ? 0.01 : 0.1; // 0.01 BTC or 0.1 ETH
  const notionalValue = Math.round(size * currentPrice);
  
  console.log(`\n📊 Creating ${side} hedge for ${asset}:`);
  console.log(`  Current Price: $${currentPrice.toFixed(2)}`);
  console.log(`  Size: ${size} ${asset}`);
  console.log(`  Leverage: ${leverage}x`);
  console.log(`  Notional Value: $${notionalValue}`);
  
  const response = await fetch('http://localhost:3000/api/agents/hedging/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      portfolioId: 1,
      asset: `${asset}-PERP`,
      side,
      notionalValue,
      leverage,
      reason: `Test ${side} hedge on ${asset} at $${currentPrice.toFixed(2)}`
    })
  });
  
  const data = await response.json();
  
  if (data.success) {
    console.log(`✅ Hedge created: ${data.orderId}`);
  } else {
    console.error(`❌ Failed:`, data.error);
  }
}

async function main() {
  console.log('🛡️ Creating test hedges with real market prices...\n');
  
  // Create diverse test hedges
  await createTestHedge('BTC', 'LONG', 3);
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await createTestHedge('ETH', 'LONG', 5);
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await createTestHedge('BTC', 'SHORT', 2);
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await createTestHedge('ETH', 'SHORT', 4);
  
  console.log('\n✅ Test hedges created! Refresh your dashboard to see them.\n');
}

main().catch(console.error);
