/**
 * BlueFin Testnet Test using Official SDK
 * 
 * Uses @bluefin-exchange/bluefin-v2-client for proper API integration
 */

import { BluefinClient, Networks, MARKET_SYMBOLS } from '@bluefin-exchange/bluefin-v2-client';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY || '';

// Convert bech32 key to hex for BlueFin SDK
function getHexPrivateKey(key: string): string {
  if (key.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(key);
    return Buffer.from(secretKey).toString('hex');
  }
  // Already hex
  return key.startsWith('0x') ? key.slice(2) : key;
}

async function testBluefinWithSDK() {
  console.log('🌊 BlueFin Testnet Test (Official SDK)');
  console.log('='.repeat(50));
  
  if (!PRIVATE_KEY) {
    console.error('❌ BLUEFIN_PRIVATE_KEY not set');
    process.exit(1);
  }

  try {
    // Initialize client
    console.log('\n📋 Step 1: Initialize BlueFin Client');
    const hexKey = getHexPrivateKey(PRIVATE_KEY);
    console.log(`   Key format: ${PRIVATE_KEY.startsWith('suiprivkey') ? 'bech32' : 'hex'}`);
    
    const client = new BluefinClient(
      true, // Use testnet
      Networks.TESTNET_SUI,
      hexKey,
      'ED25519' // Key type
    );
    
    await client.init();
    console.log(`✅ Connected to BlueFin Testnet`);
    console.log(`   Address: ${client.getPublicAddress()}`);

    // Get account info
    console.log('\n📋 Step 2: Account Info');
    const account = await client.getUserAccountData();
    console.log(`   USDC Balance: ${account?.freeCollateral || 0}`);
    console.log(`   Total Collateral: ${account?.totalAccountValue || 0}`);

    // Get market data
    console.log('\n📋 Step 3: Market Data');
    const markets = await client.getMarketData();
    if (markets && markets.length > 0) {
      markets.slice(0, 3).forEach((m: any) => {
        console.log(`   ${m.symbol}: $${m.lastPrice} (24h: ${m.priceChange24h}%)`);
      });
    }

    // Get SUI-PERP ticker
    console.log('\n📋 Step 4: SUI-PERP Ticker');
    try {
      const ticker = await client.getMarketData(MARKET_SYMBOLS.SUI);
      console.log(`   Price: $${ticker?.lastPrice || 'N/A'}`);
      console.log(`   24h Volume: $${ticker?.volume24h || 'N/A'}`);
      console.log(`   Funding Rate: ${ticker?.fundingRate || 'N/A'}%`);
    } catch (e) {
      console.log('   SUI-PERP ticker not available on testnet');
    }

    // Get positions
    console.log('\n📋 Step 5: Open Positions');
    const positions = await client.getUserPosition();
    if (!positions || positions.length === 0) {
      console.log('   No open positions');
    } else {
      positions.forEach((p: any) => {
        console.log(`   ${p.symbol}: ${p.side} ${p.quantity} @ ${p.avgEntryPrice}`);
      });
    }

    // Get order history
    console.log('\n📋 Step 6: Recent Orders');
    const orders = await client.getUserOrders({
      statuses: ['OPEN', 'PARTIAL_FILLED'],
    });
    if (!orders || orders.length === 0) {
      console.log('   No open orders');
    } else {
      orders.slice(0, 5).forEach((o: any) => {
        console.log(`   ${o.symbol}: ${o.side} ${o.quantity} @ ${o.price}`);
      });
    }

    console.log('\n✅ BlueFin testnet connection successful!');
    console.log('\n📝 Next steps for live trading:');
    console.log('   1. Get testnet USDC from BlueFin faucet');
    console.log('   2. Place test orders using client.postOrder()');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testBluefinWithSDK().catch(console.error);
