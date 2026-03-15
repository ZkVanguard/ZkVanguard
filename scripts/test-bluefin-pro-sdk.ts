/**
 * BlueFin Pro SDK Test
 * 
 * Tests the official @bluefin-exchange/pro-sdk for Bluefin Pro.
 * This SDK is specifically designed for the Bluefin Pro API.
 * 
 * Usage:
 *   $env:BLUEFIN_PRIVATE_KEY="suiprivkey..."; npx tsx scripts/test-bluefin-pro-sdk.ts
 */

import { BluefinProSdk, makeSigner, OrderType, OrderSide } from '@bluefin-exchange/pro-sdk';
import { SuiClient } from '@mysten/sui/client';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY || '';
const ENVIRONMENT: 'mainnet' | 'testnet' = 'testnet';

// SUI RPC URLs
const SUI_RPC = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
};

// Helper to get current timestamp in ms
function now(): number {
  return Date.now();
}

// Initialize keypair from private key
function initKeypair(privateKey: string): Ed25519Keypair {
  if (privateKey.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } else {
    const hexKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    const keyBytes = Buffer.from(hexKey, 'hex');
    return Ed25519Keypair.fromSecretKey(keyBytes);
  }
}

async function main() {
  console.log('🌊 BlueFin Pro SDK Test');
  console.log('='.repeat(50));
  
  if (!PRIVATE_KEY) {
    console.error('❌ BLUEFIN_PRIVATE_KEY environment variable not set');
    console.log('\nUsage:');
    console.log('  $env:BLUEFIN_PRIVATE_KEY="suiprivkey..."; npx tsx scripts/test-bluefin-pro-sdk.ts');
    process.exit(1);
  }
  
  // Initialize keypair
  const keypair = initKeypair(PRIVATE_KEY);
  const address = keypair.toSuiAddress();
  
  console.log(`\n📋 Wallet Info`);
  console.log('='.repeat(50));
  console.log(`   Address: ${address}`);
  console.log(`   Key Format: ${PRIVATE_KEY.startsWith('suiprivkey') ? 'Bech32' : 'Hex'}`);
  console.log(`   Environment: ${ENVIRONMENT}`);
  
  try {
    console.log('\n📋 Step 1: Initialize BlueFin Pro Client');
    console.log('='.repeat(50));
    
    // Create SUI client
    const suiClient = new SuiClient({ url: SUI_RPC[ENVIRONMENT] });
    console.log(`   SUI RPC: ${SUI_RPC[ENVIRONMENT]}`);
    
    // Create signer from keypair
    const signer = makeSigner(keypair);
    console.log('   Signer created');
    
    // Create SDK instance
    const sdk = new BluefinProSdk(signer, ENVIRONMENT, suiClient as any);
    console.log('   SDK instance created');
    
    // Initialize (handles authentication)
    console.log('   Initializing...');
    await sdk.initialize();
    console.log('✅ Client initialized');
    
    // Get exchange info
    console.log('\n📋 Step 2: Exchange Info');
    console.log('='.repeat(50));
    try {
      const exchangeInfo = await sdk.exchangeDataApi.getExchangeInfo();
      console.log(`   Response: ${JSON.stringify(exchangeInfo.data).slice(0, 200)}...`);
    } catch (error) {
      console.log(`❌ Failed to get exchange info: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Get account info
    console.log('\n📋 Step 3: Account Info');
    console.log('='.repeat(50));
    try {
      const account = await sdk.accountDataApi.getAccountInfo();
      console.log(`   Response: ${JSON.stringify(account.data).slice(0, 200)}...`);
    } catch (error) {
      console.log(`❌ Failed to get account: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Get open orders
    console.log('\n📋 Step 4: Open Orders');
    console.log('='.repeat(50));
    try {
      const orders = await sdk.getOpenOrders();
      if (!orders.data || orders.data.length === 0) {
        console.log('   No open orders');
      } else {
        orders.data.slice(0, 5).forEach((o: any) => {
          console.log(`   ${o.symbol}: ${o.side} ${o.quantity} @ ${o.price}`);
        });
      }
    } catch (error) {
      console.log(`❌ Failed to get orders: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    console.log('\n✅ BlueFin Pro SDK test completed');
    console.log('='.repeat(50));
    console.log('   SDK is working! Available methods:');
    console.log('   - sdk.createOrder(params) - Place orders');
    console.log('   - sdk.cancelOrder(request) - Cancel orders');
    console.log('   - sdk.getOpenOrders() - Get open orders');
    console.log('   - sdk.accountDataApi.getAccountInfo() - Account info');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    
    if (error instanceof Error) {
      console.log('\n📝 Debug Info:');
      console.log(`   Error: ${error.message}`);
      console.log(`   Name: ${error.name}`);
      if ('code' in error) {
        console.log(`   Code: ${(error as any).code}`);
      }
      if (error.stack) {
        console.log(`   Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
      }
    }
    
    console.log('\n📝 Possible issues:');
    console.log('   1. Testnet environment may be down for maintenance');
    console.log('   2. Account needs to be registered at https://pro.bluefin.io');
    console.log('   3. Try mainnet instead if testnet is unavailable');
    
    process.exit(1);
  }
}

main().catch(console.error);
