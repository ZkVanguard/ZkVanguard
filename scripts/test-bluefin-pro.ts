/**
 * BlueFin Pro API Direct Test
 * 
 * Tests the Bluefin Pro REST API directly without using any SDK.
 * Uses wallet signature authentication per Bluefin Pro docs:
 * - No API keys needed - wallet signature authentication only
 * - Auth endpoint: /auth/v2/token with payloadSignature header
 * 
 * Usage:
 *   $env:BLUEFIN_PRIVATE_KEY="suiprivkey..."; npx tsx scripts/test-bluefin-pro.ts
 */

import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY || '';

// Bluefin Pro API endpoints per documentation
// https://bluefin.gitbook.io/bluefin-pro-docs/api-documentation/api-endpoints-details

// Authentication API for obtaining tokens
const AUTH_API = {
  testnet: 'https://auth.api.sui-staging.bluefin.io',
  mainnet: 'https://auth.api.sui-prod.bluefin.io',
};

// Exchange API for public market data (no auth needed)
const EXCHANGE_API = {
  testnet: 'https://api.sui-staging.bluefin.io',
  mainnet: 'https://api.sui-prod.bluefin.io',
};

// Trade API for authenticated requests (orders, positions)
const TRADE_API = {
  testnet: 'https://trade.api.sui-staging.bluefin.io',
  mainnet: 'https://trade.api.sui-prod.bluefin.io',
};

interface Keypair {
  keypair: Ed25519Keypair;
  address: string;
}

function initKeypair(privateKey: string): Keypair {
  let keypair: Ed25519Keypair;
  
  if (privateKey.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
  } else {
    const hexKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    const keyBytes = Buffer.from(hexKey, 'hex');
    keypair = Ed25519Keypair.fromSecretKey(keyBytes);
  }
  
  return {
    keypair,
    address: keypair.toSuiAddress(),
  };
}

/**
 * Sign a message for Bluefin Pro authentication using SUI standard signing
 * Uses the keypair's signPersonalMessage which handles BCS encoding and intent prefix
 */
async function signForBluefin(keypair: Ed25519Keypair, message: string): Promise<string> {
  const messageBytes = new TextEncoder().encode(message);
  // Use the standard SUI signPersonalMessage which handles:
  // 1. BCS encoding the message as vector<u8>
  // 2. Adding intent prefix ("PersonalMessage")
  // 3. Blake2b hashing
  // 4. Signing
  // 5. Serializing with flag + signature + pubkey in base64
  const { signature } = await keypair.signPersonalMessage(messageBytes);
  return signature;
}

async function testPublicEndpoints(network: 'testnet' | 'mainnet') {
  const baseUrl = EXCHANGE_API[network];
  console.log(`\n📊 Testing Public Exchange API Endpoints (${network})`);
  console.log('='.repeat(50));
  console.log(`   Base URL: ${baseUrl}`);
  
  // Exchange API endpoints for public market data
  const endpoints = [
    { name: 'Meta', path: '/meta' },
    { name: 'Markets', path: '/marketData' },
    { name: 'Ticker (ETH-PERP)', path: '/ticker?symbol=ETH-PERP' },
    { name: 'Ticker (SUI-PERP)', path: '/ticker?symbol=SUI-PERP' },
    { name: 'Orderbook (ETH-PERP)', path: '/orderbook?symbol=ETH-PERP' },
  ];
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${baseUrl}${endpoint.path}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      
      if (response.ok) {
        const data = await response.json();
        const preview = JSON.stringify(data).slice(0, 150) + '...';
        console.log(`✅ ${endpoint.name}: ${preview}`);
      } else {
        console.log(`❌ ${endpoint.name}: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.log(`❌ ${endpoint.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function testAuthentication(keypair: Ed25519Keypair, address: string, network: 'testnet' | 'mainnet') {
  const authUrl = AUTH_API[network];
  const tradeUrl = TRADE_API[network];
  console.log(`\n🔐 Testing Authentication (${network})`);
  console.log('='.repeat(50));
  console.log(`   Auth API: ${authUrl}`);
  console.log(`   Trade API: ${tradeUrl}`);
  console.log(`   Address: ${address}`);
  
  const signedAtMillis = Date.now();
  
  // Per the SDK source code in @bluefin-exchange/pro-sdk:
  // - audience must be 'api'
  // - Sign the JSON with wallet.signPersonalMessage
  const loginRequest = {
    accountAddress: address,
    signedAtMillis,
    audience: 'api',
  };
  
  const payload = JSON.stringify(loginRequest);
  const signature = await signForBluefin(keypair, payload);
  
  console.log(`\n   Login Request: ${payload}`);
  console.log(`   Signature: ${signature.substring(0, 50)}...`);
  
  try {
    console.log(`\n   POST ${authUrl}/auth/v2/token`);
    
    const response = await fetch(`${authUrl}/auth/v2/token`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'payloadSignature': signature,
      },
      body: payload,
      signal: AbortSignal.timeout(15000),
    });
    
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }
    
    console.log(`   Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      console.log(`\n✅ Authentication successful!`);
      console.log(`   Access Token: ${(responseData.accessToken || '').substring(0, 50)}...`);
      console.log(`   Refresh Token: ${(responseData.refreshToken || 'N/A').substring(0, 30)}...`);
      return responseData.accessToken || responseData.token || responseData.jwt;
    } else {
      console.log(`\n❌ Authentication failed: ${response.status}`);
      console.log(`   Error: ${JSON.stringify(responseData)}`);
      
      // Check if account needs to be registered
      if (responseData.message?.includes('not found') || responseData.message?.includes('onboard')) {
        console.log('\n   ⚠️  Your account may need to be registered on Bluefin Pro:');
        console.log('   1. Visit https://trade.bluefin.io/pro (mainnet) or https://testnet.bluefin.io/perps (testnet)');
        console.log('   2. Connect your SUI wallet');
        console.log('   3. Complete onboarding');
      }
    }
  } catch (error) {
    console.log(`\n❌ Auth request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return null;
}

async function tryAlternativeAuth(keypair: Ed25519Keypair, address: string, network: 'testnet' | 'mainnet'): Promise<string | null> {
  const authUrl = AUTH_API[network];
  const signedAtMillis = Date.now();
  
  // Try with raw signature (no SUI intent prefix/BCS encoding)
  // Some APIs expect just the raw Ed25519 signature
  const payload = JSON.stringify({
    accountAddress: address,
    signedAtMillis,
    audience: 'bluefin-exchange',
  });
  
  const messageBytes = new TextEncoder().encode(payload);
  const signatureBytes = await keypair.sign(messageBytes);
  
  // Try format 1: raw signature bytes in base64
  const rawSignature = Buffer.from(signatureBytes).toString('base64');
  
  // Try format 2: flag + signature + pubkey in base64 (SUI standard)
  const pubKeyBytes = keypair.getPublicKey().toRawBytes();
  const fullSignature = new Uint8Array(1 + signatureBytes.length + pubKeyBytes.length);
  fullSignature[0] = 0x00; // Ed25519 flag
  fullSignature.set(signatureBytes, 1);
  fullSignature.set(pubKeyBytes, 1 + signatureBytes.length);
  const flaggedSignature = Buffer.from(fullSignature).toString('base64');
  
  const formats = [
    { name: 'Raw signature', sig: rawSignature },
    { name: 'Flag+sig+pubkey', sig: flaggedSignature },
  ];
  
  for (const format of formats) {
    try {
      console.log(`   Trying ${format.name} format...`);
      const response = await fetch(`${authUrl}/auth/v2/token`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'payloadSignature': format.sig,
        },
        body: payload,
        signal: AbortSignal.timeout(15000),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`\n✅ ${format.name} auth successful!`);
        return data.accessToken || data.token;
      } else {
        const errorText = await response.text();
        console.log(`   ${format.name} failed: ${response.status} - ${errorText.substring(0, 100)}`);
      }
    } catch (e) {
      console.log(`   ${format.name} error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  
  return null;
}

async function testAccountData(network: 'testnet' | 'mainnet', authToken: string | null) {
  const exchangeUrl = EXCHANGE_API[network];
  const tradeUrl = TRADE_API[network];
  console.log('\n💰 Testing Account Data');
  console.log('='.repeat(50));
  
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  
  // Account info is on Exchange API (api.sui-staging)
  const exchangeEndpoints = [
    { name: 'Account Info (Exchange)', url: `${exchangeUrl}/api/v1/account` },
  ];
  
  // Open orders is on Trade API (trade.api.sui-staging)
  const tradeEndpoints = [
    { name: 'Open Orders (Trade)', url: `${tradeUrl}/api/v1/trade/openOrders` },
  ];
  
  // Test exchange API endpoints
  for (const endpoint of exchangeEndpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ ${endpoint.name}: ${JSON.stringify(data).slice(0, 150)}...`);
      } else {
        console.log(`❌ ${endpoint.name}: ${response.status} - ${await response.text()}`);
      }
    } catch (error) {
      console.log(`❌ ${endpoint.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Test trade API endpoints
  for (const endpoint of tradeEndpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ ${endpoint.name}: ${JSON.stringify(data).slice(0, 150)}...`);
      } else {
        console.log(`❌ ${endpoint.name}: ${response.status} - ${await response.text()}`);
      }
    } catch (error) {
      console.log(`❌ ${endpoint.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function main() {
  console.log('🌊 BlueFin Pro API Direct Test');
  console.log('='.repeat(50));
  
  if (!PRIVATE_KEY) {
    console.error('❌ BLUEFIN_PRIVATE_KEY environment variable not set');
    console.log('\nUsage:');
    console.log('  $env:BLUEFIN_PRIVATE_KEY="suiprivkey..."; npx tsx scripts/test-bluefin-pro.ts');
    process.exit(1);
  }
  
  // Initialize keypair
  const { keypair, address } = initKeypair(PRIVATE_KEY);
  console.log(`\n📋 Wallet Info`);
  console.log('='.repeat(50));
  console.log(`   Address: ${address}`);
  console.log(`   Key Format: ${PRIVATE_KEY.startsWith('suiprivkey') ? 'Bech32' : 'Hex'}`);
  
  const network: 'testnet' | 'mainnet' = 'testnet';
  
  // Test 1: Public endpoints (Data API - no auth needed)
  await testPublicEndpoints(network);
  
  // Test 2: Authentication (Trade API)
  const authToken = await testAuthentication(keypair, address, network);
  
  // Test 3: Account data (Trade API - requires auth)
  await testAccountData(network, authToken);
  
  console.log('\n📝 Summary');
  console.log('='.repeat(50));
  if (authToken) {
    console.log('✅ Authentication successful');
    console.log('   You can now place orders using the authenticated client');
  } else {
    console.log('⚠️  Authentication not successful');
    console.log('   This could be due to:');
    console.log('   - Invalid private key');
    console.log('   - Account not registered on Bluefin');
    console.log('   - API endpoint changes');
    console.log('\n   Steps to fix:');
    console.log('   1. Visit https://trade.bluefin.io/pro (mainnet) or https://testnet.bluefin.io/perps (testnet) to register your wallet');
    console.log('   2. Connect your SUI wallet and complete onboarding');
    console.log('   3. Run this test again');
  }
}

main().catch(console.error);
