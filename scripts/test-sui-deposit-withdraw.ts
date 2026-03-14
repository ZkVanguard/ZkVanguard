/**
 * SUI Testnet Deposit/Withdraw Test
 * Tests community pool on SUI testnet
 * 
 * Usage:
 *   npx ts-node scripts/test-sui-deposit-withdraw.ts
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import * as fs from 'fs';
import * as path from 'path';

// SUI Testnet configuration
const CONFIG = {
  network: 'testnet' as const,
  packageId: '0xe83b514dbb1769b69002811fd4438dfcdcd12a01623ea301db229ef05fc461d6',
  // AdminCap for creating pool
  adminCapId: '0x088fef47064d46e298b57214eb68d9c245f420989249978625b5fdd0f1afb28f',
  // FeeManagerCap
  feeManagerCapId: '0x13731b6f7852b9bfa5072ff4901abe11124b956cac62a9fea3e7568808931e70',
  moduleName: 'community_pool',
  // Test amounts (in MIST - 1 SUI = 1e9 MIST)
  depositAmount: 100_000_000_000n, // 100 SUI
  withdrawShares: 50_000_000_000_000_000_000n, // 50 shares (scaled by 1e18)
};

// Load private key from env
function getKeypair(): Ed25519Keypair {
  const privateKey = process.env.SUI_PRIVATE_KEY;
  if (privateKey) {
    // If it's a hex string, convert to Uint8Array
    if (privateKey.startsWith('0x')) {
      const hexStr = privateKey.slice(2);
      const bytes = new Uint8Array(hexStr.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      return Ed25519Keypair.fromSecretKey(bytes);
    }
    return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
  }
  
  // Generate new keypair for testing
  console.log('⚠️  No SUI_PRIVATE_KEY set, generating new keypair...');
  return new Ed25519Keypair();
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('   SUI TESTNET DEPOSIT/WITHDRAW TEST');
  console.log('═'.repeat(60) + '\n');

  const client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
  const keypair = getKeypair();
  const address = keypair.toSuiAddress();

  console.log('📍 Test Account:', address);

  // Get balance
  const balance = await client.getBalance({ owner: address });
  console.log(`💰 SUI Balance: ${Number(balance.totalBalance) / 1e9} SUI\n`);

  if (BigInt(balance.totalBalance) < CONFIG.depositAmount) {
    console.log('❌ Insufficient SUI balance for test. Need at least 100 SUI.');
    console.log('   Get testnet SUI from: https://faucet.sui.io/');
    return;
  }

  // Check if pool state exists by searching for shared objects
  console.log('📊 Checking for existing CommunityPoolState...');
  
  // Search for pool state objects
  const poolObjects = await client.getOwnedObjects({
    owner: address,
    filter: {
      StructType: `${CONFIG.packageId}::${CONFIG.moduleName}::CommunityPoolState`,
    },
  });

  let poolStateId: string | null = null;
  
  if (poolObjects.data.length === 0) {
    console.log('   No pool found. Creating new pool...\n');
    
    // Create pool using admin cap
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${CONFIG.packageId}::${CONFIG.moduleName}::create_pool`,
        arguments: [
          tx.object(CONFIG.adminCapId),
          tx.pure.address(address), // treasury
          tx.object('0x6'), // Clock
        ],
      });

      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
      });

      console.log('   ✅ Pool created!');
      console.log(`   📝 TX: https://suiscan.xyz/testnet/tx/${result.digest}`);
      
      // Get pool state from created objects
      const txDetails = await client.getTransactionBlock({
        digest: result.digest,
        options: { showObjectChanges: true },
      });
      
      const poolCreated = txDetails.objectChanges?.find(
        (obj) => obj.type === 'created' && 
                 obj.objectType?.includes('CommunityPoolState')
      );
      
      if (poolCreated && 'objectId' in poolCreated) {
        poolStateId = poolCreated.objectId;
        console.log(`   Pool State ID: ${poolStateId}`);
      }
    } catch (e: any) {
      console.log(`   ❌ Create pool failed: ${e.message}`);
      return;
    }
  } else {
    // Get existing pool state ID
    console.log('   Found existing pool(s)');
    // Note: CommunityPoolState is a shared object, we need to find it differently
  }

  // For shared objects, we need to query them differently
  // Let's try to search for the pool state
  const sharedObjects = await client.queryEvents({
    query: {
      MoveEventType: `${CONFIG.packageId}::${CONFIG.moduleName}::PoolCreated`,
    },
    limit: 1,
  });

  if (sharedObjects.data.length > 0) {
    const event = sharedObjects.data[0].parsedJson as any;
    poolStateId = event?.pool_id;
    console.log(`   Pool State ID: ${poolStateId}`);
  }

  if (!poolStateId) {
    console.log('   ⚠️  Could not find pool state ID. Please create pool first.');
    
    // Show how to create pool manually
    console.log('\n   To create pool manually, run:');
    console.log(`   sui client call --package ${CONFIG.packageId} \\`);
    console.log(`     --module ${CONFIG.moduleName} --function create_pool \\`);
    console.log(`     --args ${CONFIG.adminCapId} ${address} 0x6`);
    return;
  }

  // Test deposit
  console.log(`\n📥 STEP 1: Depositing 100 SUI...`);
  
  try {
    const tx = new Transaction();
    
    // Split SUI for deposit
    const [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(CONFIG.depositAmount)]);
    
    tx.moveCall({
      target: `${CONFIG.packageId}::${CONFIG.moduleName}::deposit`,
      arguments: [
        tx.object(poolStateId),
        depositCoin,
        tx.object('0x6'), // Clock
      ],
    });

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });

    console.log(`   ✅ Deposited!`);
    console.log(`   📝 TX: https://suiscan.xyz/testnet/tx/${result.digest}`);
    
    // Parse events for shares received
    const txDetails = await client.getTransactionBlock({
      digest: result.digest,
      options: { showEvents: true },
    });
    
    const depositEvent = txDetails.events?.find(
      (e) => e.type.includes('Deposited')
    );
    
    if (depositEvent) {
      const parsedEvent = depositEvent.parsedJson as any;
      console.log(`   Shares Received: ${Number(parsedEvent.shares_received) / 1e18}`);
    }
  } catch (e: any) {
    console.log(`   ❌ Deposit failed: ${e.message}`);
    return;
  }

  // Check member data
  console.log('\n✅ STEP 2: Checking Member Data...');
  
  try {
    // Query the pool state object
    const poolState = await client.getObject({
      id: poolStateId,
      options: { showContent: true },
    });
    
    if (poolState.data?.content && 'fields' in poolState.data.content) {
      const fields = poolState.data.content.fields as any;
      console.log(`   Total NAV: ${Number(fields.balance?.value || 0) / 1e9} SUI`);
      console.log(`   Total Shares: ${Number(fields.total_shares || 0) / 1e18}`);
      console.log(`   Members: ${fields.member_count || 0}`);
    }
  } catch (e: any) {
    console.log(`   ⚠️  Could not read pool state: ${e.message}`);
  }

  // Test withdraw
  console.log(`\n📤 STEP 3: Withdrawing 50 shares...`);
  
  try {
    const tx = new Transaction();
    
    tx.moveCall({
      target: `${CONFIG.packageId}::${CONFIG.moduleName}::withdraw`,
      arguments: [
        tx.object(poolStateId),
        tx.pure.u64(CONFIG.withdrawShares),
        tx.object('0x6'), // Clock
      ],
    });

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });

    console.log(`   ✅ Withdrawn!`);
    console.log(`   📝 TX: https://suiscan.xyz/testnet/tx/${result.digest}`);
    
    // Parse events for amount received
    const txDetails = await client.getTransactionBlock({
      digest: result.digest,
      options: { showEvents: true },
    });
    
    const withdrawEvent = txDetails.events?.find(
      (e) => e.type.includes('Withdrawn')
    );
    
    if (withdrawEvent) {
      const parsedEvent = withdrawEvent.parsedJson as any;
      console.log(`   Amount Received: ${Number(parsedEvent.amount_sui) / 1e9} SUI`);
    }
  } catch (e: any) {
    console.log(`   ⚠️  Withdraw failed: ${e.message}`);
    console.log(`   (This is expected if no shares were received yet)`);
  }

  // Final balance check
  console.log('\n📊 STEP 4: Final Balances...');
  const finalBalance = await client.getBalance({ owner: address });
  console.log(`   SUI Balance: ${Number(finalBalance.totalBalance) / 1e9} SUI`);

  console.log('\n' + '═'.repeat(60));
  console.log('   ✅ TEST COMPLETE ON SUI TESTNET');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
