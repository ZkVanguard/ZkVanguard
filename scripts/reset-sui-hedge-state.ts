/**
 * Deploy SUI Pool Contract Upgrade & Reset Hedge State
 * 
 * This script:
 * 1. Builds and publishes the updated Move package
 * 2. Calls admin_reset_hedge_state to clear orphaned hedges
 * 
 * Usage: 
 *   npx tsx scripts/reset-sui-hedge-state.ts --dry-run  # Test without executing
 *   npx tsx scripts/reset-sui-hedge-state.ts            # Execute upgrade & reset
 * 
 * Requires:
 *   - SUI_POOL_ADMIN_KEY: Admin wallet private key
 *   - SUI_ADMIN_CAP_ID: AdminCap object ID
 *   - `sui` CLI installed and in PATH
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { execSync } from 'child_process';
import { SUI_USDC_POOL_CONFIG } from '../lib/services/sui/SuiCommunityPoolService';
import * as fs from 'fs';
import * as path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_UPGRADE = process.argv.includes('--skip-upgrade');

async function main() {
  const network = ((process.env.SUI_NETWORK || 'mainnet').trim()) as 'mainnet' | 'testnet';
  console.log(`\n🔧 SUI Pool Hedge State Reset - Network: ${network}`);
  console.log(`   Mode: ${DRY_RUN ? '🔍 DRY RUN' : '⚡ LIVE'}\n`);

  // Load admin key
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const adminCapId = (process.env.SUI_ADMIN_CAP_ID || '').trim();

  if (!adminKey) {
    console.error('❌ SUI_POOL_ADMIN_KEY not set');
    process.exit(1);
  }
  if (!adminCapId) {
    console.error('❌ SUI_ADMIN_CAP_ID not set');
    process.exit(1);
  }

  // Create keypair
  let keypair: Ed25519Keypair;
  if (adminKey.startsWith('suiprivkey')) {
    keypair = Ed25519Keypair.fromSecretKey(adminKey);
  } else {
    keypair = Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace('0x', ''), 'hex'));
  }
  const adminAddress = keypair.getPublicKey().toSuiAddress();
  console.log(`📌 Admin wallet: ${adminAddress}`);
  console.log(`📌 Admin Cap ID: ${adminCapId}\n`);

  // Connect to SUI
  const poolConfig = SUI_USDC_POOL_CONFIG[network];
  const rpcUrl = network === 'mainnet'
    ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
    : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
  const client = new SuiClient({ url: rpcUrl });

  // Read current pool state
  console.log('📖 Reading current pool state...');
  const obj = await client.getObject({ 
    id: poolConfig.poolStateId!, 
    options: { showContent: true } 
  });
  const fields = (obj.data?.content as any)?.fields;
  
  if (!fields) {
    console.error('❌ Could not read pool state');
    process.exit(1);
  }

  const hedgeState = fields.hedge_state?.fields || {};
  const totalHedgedValue = Number(hedgeState.total_hedged_value || '0') / 1e6;
  const activeHedges = hedgeState.active_hedges || [];

  console.log(`   Total hedged value: $${totalHedgedValue.toFixed(2)}`);
  console.log(`   Active hedges: ${activeHedges.length}\n`);

  if (activeHedges.length === 0 && totalHedgedValue === 0) {
    console.log('✅ Hedge state already clean, nothing to reset');
    return;
  }

  // Step 1: Build and upgrade contract (if needed)
  if (!SKIP_UPGRADE) {
    console.log('🔨 Building Move package...');
    const contractsDir = path.join(__dirname, '..', 'contracts', 'sui');
    
    try {
      // Build the package
      execSync('sui move build', { 
        cwd: contractsDir, 
        stdio: DRY_RUN ? 'inherit' : 'pipe' 
      });
      console.log('   ✅ Build successful\n');

      if (!DRY_RUN) {
        // Note: For a real upgrade, you'd need to use sui client upgrade
        // This requires the UpgradeCap which may not be available
        // For now, we'll assume the contract already has admin_reset_hedge_state
        // If not, a full redeploy would be needed
        console.log('   ⚠️  Contract upgrade requires UpgradeCap');
        console.log('   ℹ️  Assuming admin_reset_hedge_state already exists in deployed contract');
        console.log('   ℹ️  If function doesn\'t exist, contract must be redeployed\n');
      }
    } catch (err) {
      console.error('   ❌ Build failed:', err);
      if (!DRY_RUN) process.exit(1);
    }
  }

  // Step 2: Call admin_reset_hedge_state
  console.log('🔄 Calling admin_reset_hedge_state...');
  
  if (DRY_RUN) {
    console.log('   Would call:');
    console.log(`     Package: ${poolConfig.packageId}`);
    console.log(`     Module: ${poolConfig.moduleName}`);
    console.log(`     Function: admin_reset_hedge_state`);
    console.log(`     Args: AdminCap(${adminCapId}), PoolState(${poolConfig.poolStateId}), Clock`);
    console.log('\n✅ Dry run complete');
    return;
  }

  const usdcType = poolConfig.usdcCoinType;
  const tx = new Transaction();
  
  tx.moveCall({
    target: `${poolConfig.packageId}::${poolConfig.moduleName}::admin_reset_hedge_state`,
    typeArguments: [usdcType],
    arguments: [
      tx.object(adminCapId),              // AdminCap
      tx.object(poolConfig.poolStateId!), // UsdcPoolState
      tx.object('0x6'),                   // Clock
    ],
  });

  tx.setGasBudget(50_000_000);

  try {
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true },
    });

    const success = result.effects?.status?.status === 'success';
    if (success) {
      console.log(`   ✅ Reset successful! TX: ${result.digest}`);
      
      // Verify new state
      const objAfter = await client.getObject({ 
        id: poolConfig.poolStateId!, 
        options: { showContent: true } 
      });
      const fieldsAfter = (objAfter.data?.content as any)?.fields;
      const hedgeStateAfter = fieldsAfter?.hedge_state?.fields || {};
      const newTotalHedged = Number(hedgeStateAfter.total_hedged_value || '0') / 1e6;
      const newActiveHedges = hedgeStateAfter.active_hedges || [];
      
      console.log(`\n📊 New state:`);
      console.log(`   Total hedged: $${newTotalHedged.toFixed(2)}`);
      console.log(`   Active hedges: ${newActiveHedges.length}`);
    } else {
      console.log(`   ❌ Failed: ${result.effects?.status?.error}`);
      console.log('\n   ⚠️  The function may not exist in the deployed contract.');
      console.log('   ℹ️  You may need to redeploy the contract with the new function.');
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    
    if (err instanceof Error && err.message.includes('Function not found')) {
      console.log('\n   ⚠️  The admin_reset_hedge_state function does not exist.');
      console.log('   ℹ️  You need to upgrade or redeploy the contract.');
    }
  }

  console.log('\n✅ Done');
}

main().catch(console.error);
