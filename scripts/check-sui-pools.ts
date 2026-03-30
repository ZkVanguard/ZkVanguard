#!/usr/bin/env npx tsx
import { SuiClient } from '@mysten/sui/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

async function checkPools() {
  console.log('\n═══ SUI POOL STATE VERIFICATION ═══\n');
  
  const pools = [
    { name: 'USDC Pool (env)', id: process.env.NEXT_PUBLIC_SUI_USDC_POOL_STATE_TESTNET },
    { name: 'Base Pool (env)', id: process.env.NEXT_PUBLIC_SUI_POOL_STATE_ID },
  ];
  
  for (const pool of pools) {
    console.log(`\n📍 ${pool.name}:`);
    console.log(`   ID: ${pool.id}`);
    
    if (!pool.id) {
      console.log('   ❌ Not set');
      continue;
    }
    
    try {
      const obj = await client.getObject({ 
        id: pool.id, 
        options: { showContent: true, showType: true } 
      });
      
      if (obj.data) {
        console.log('   ✅ Found on-chain');
        console.log(`   Type: ${obj.data.type}`);
        
        if (obj.data.content && 'fields' in obj.data.content) {
          const fields = obj.data.content.fields as Record<string, any>;
          console.log(`   Treasury: ${fields.treasury || 'not set'}`);
          console.log(`   Perf Fee: ${fields.performance_fee_bps || 'not set'} bps`);
          console.log(`   Mgt Fee: ${fields.management_fee_bps || 'not set'} bps`);
          console.log(`   Total Shares: ${fields.total_shares || '0'}`);
        }
      } else {
        console.log('   ❌ NOT FOUND on chain');
        if (obj.error) {
          console.log(`   Error: ${JSON.stringify(obj.error)}`);
        }
      }
    } catch (e: any) {
      console.log(`   ❌ Error: ${e.message}`);
    }
  }
  
  // Also check AdminCap
  console.log('\n📍 Admin Cap:');
  const adminCapId = process.env.NEXT_PUBLIC_SUI_USDC_ADMIN_CAP;
  console.log(`   ID: ${adminCapId}`);
  
  if (adminCapId) {
    try {
      const obj = await client.getObject({ id: adminCapId, options: { showType: true, showOwner: true } });
      if (obj.data) {
        console.log('   ✅ Found on-chain');
        console.log(`   Type: ${obj.data.type}`);
        console.log(`   Owner: ${JSON.stringify(obj.data.owner)}`);
      } else {
        console.log('   ❌ NOT FOUND');
      }
    } catch (e: any) {
      console.log(`   ❌ Error: ${e.message}`);
    }
  }
}

checkPools().catch(console.error);
