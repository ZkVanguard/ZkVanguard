#!/usr/bin/env npx tsx
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

async function checkOwnership() {
  console.log('\n═══ SUI KEY OWNERSHIP CHECK ═══\n');
  
  // REQUIRED: Admin cap ID must be explicitly configured
  const adminCapId = process.env.NEXT_PUBLIC_SUI_USDC_ADMIN_CAP;
  if (!adminCapId) {
    console.error('❌ NEXT_PUBLIC_SUI_USDC_ADMIN_CAP not set in environment');
    process.exit(1);
  }
  
  // Check AdminCap
  console.log('📍 AdminCap:', adminCapId);
  const capObj = await client.getObject({ id: adminCapId, options: { showOwner: true } });
  
  if (capObj.data?.owner) {
    const owner = capObj.data.owner;
    if (typeof owner === 'object' && 'AddressOwner' in owner) {
      console.log('   Owner:', owner.AddressOwner);
      
      // Check both keys
      const keys = [
        { name: 'SUI_PRIVATE_KEY', key: process.env.SUI_PRIVATE_KEY },
        { name: 'SUI_POOL_ADMIN_KEY', key: process.env.SUI_POOL_ADMIN_KEY },
      ];
      
      for (const { name, key } of keys) {
        if (!key) continue;
        
        let keypair: Ed25519Keypair;
        try {
          if (key.startsWith('suiprivkey')) {
            const { secretKey } = decodeSuiPrivateKey(key);
            keypair = Ed25519Keypair.fromSecretKey(secretKey);
          } else {
            const hexKey = key.startsWith('0x') ? key.slice(2) : key;
            keypair = Ed25519Keypair.fromSecretKey(Buffer.from(hexKey, 'hex'));
          }
          
          const address = keypair.toSuiAddress();
          const isOwner = address === owner.AddressOwner;
          console.log(`\n   ${name}:`);
          console.log(`      Address: ${address}`);
          console.log(`      Is Owner: ${isOwner ? '✅ YES' : '❌ NO'}`);
        } catch (e: any) {
          console.log(`   ${name}: Error - ${e.message}`);
        }
      }
    }
  } else {
    console.log('   ❌ AdminCap not found');
  }
}

checkOwnership().catch(console.error);
