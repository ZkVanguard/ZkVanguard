/**
 * BlueFin API Direct Test
 * Tests raw API endpoints without authentication
 */

async function testBluefinAPIs() {
  console.log('🌊 BlueFin API Endpoint Test');
  console.log('='.repeat(50));

  const endpoints = [
    // Production endpoints
    { name: 'Prod - Meta', url: 'https://dapi.api.sui-prod.bluefin.io/meta' },
    { name: 'Prod - Markets', url: 'https://dapi.api.sui-prod.bluefin.io/marketData' },
    { name: 'Prod - Ticker', url: 'https://dapi.api.sui-prod.bluefin.io/ticker?symbol=SUI-PERP' },
    // Testnet endpoints  
    { name: 'Test - Meta', url: 'https://dapi.api.sui-staging.bluefin.io/meta' },
    { name: 'Test - Markets', url: 'https://dapi.api.sui-staging.bluefin.io/marketData' },
    // Alternative URLs
    { name: 'Alt Prod', url: 'https://trade.api.sui-prod.bluefin.io/info' },
    { name: 'Alt Test', url: 'https://trade.api.sui-staging.bluefin.io/info' },
  ];

  for (const ep of endpoints) {
    try {
      const response = await fetch(ep.url, { 
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ ${ep.name}: OK`);
        if (data.serverTime) console.log(`   Server Time: ${new Date(data.serverTime).toISOString()}`);
        if (Array.isArray(data)) console.log(`   Items: ${data.length}`);
      } else {
        console.log(`❌ ${ep.name}: ${response.status} ${response.statusText}`);
      }
    } catch (error: any) {
      console.log(`❌ ${ep.name}: ${error.message || error}`);
    }
  }

  console.log('\n📝 Note: BlueFin testnet may be down for maintenance');
}

testBluefinAPIs();
