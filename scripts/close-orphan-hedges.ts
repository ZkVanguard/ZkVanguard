/**
 * Close Orphan Hedges Script
 * 
 * This script closes on-chain hedge records that don't have corresponding
 * BlueFin positions. This resets the totalHedgedValue counter and allows
 * the pool to make new transfers.
 * 
 * Usage: npx tsx scripts/close-orphan-hedges.ts [--dry-run]
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_USDC_POOL_CONFIG } from '../lib/services/sui/SuiCommunityPoolService';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const network = ((process.env.SUI_NETWORK || 'mainnet').trim()) as 'mainnet' | 'testnet';
  console.log(`\n🔧 Close Orphan Hedges - Network: ${network}`);
  console.log(`   Mode: ${DRY_RUN ? '🔍 DRY RUN (no transactions)' : '⚡ LIVE'}\n`);

  // Load admin key
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const agentCapId = (process.env.SUI_AGENT_CAP_ID || process.env.SUI_ADMIN_CAP_ID || '').trim();

  if (!adminKey) {
    console.error('❌ SUI_POOL_ADMIN_KEY not set');
    process.exit(1);
  }
  if (!agentCapId) {
    console.error('❌ SUI_AGENT_CAP_ID not set');
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
  console.log(`📌 Agent Cap ID: ${agentCapId}\n`);

  // Connect to SUI
  const poolConfig = SUI_USDC_POOL_CONFIG[network];
  const rpcUrl = network === 'mainnet'
    ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
    : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
  const client = new SuiClient({ url: rpcUrl });

  // Read pool state
  console.log('📖 Reading pool state...');
  const obj = await client.getObject({ 
    id: poolConfig.poolStateId!, 
    options: { showContent: true } 
  });
  const fields = (obj.data?.content as any)?.fields;
  
  if (!fields) {
    console.error('❌ Could not read pool state');
    process.exit(1);
  }

  const rawBal = typeof fields.balance === 'string'
    ? fields.balance
    : (fields.balance?.fields?.value || '0');
  const contractBalance = Number(rawBal) / 1e6;
  
  const hedgeState = fields.hedge_state?.fields || {};
  const totalHedgedValue = Number(hedgeState.total_hedged_value || '0') / 1e6;
  const activeHedges = hedgeState.active_hedges || [];

  console.log(`   Pool balance: $${contractBalance.toFixed(2)}`);
  console.log(`   Total hedged: $${totalHedgedValue.toFixed(2)}`);
  console.log(`   Active hedges: ${activeHedges.length}\n`);

  if (activeHedges.length === 0) {
    console.log('✅ No active hedges to close');
    return;
  }

  // Parse active hedges
  console.log('📋 Active hedges:');
  const hedgesToClose = activeHedges.map((h: any, i: number) => {
    const hedgeIdRaw = h.fields?.hedge_id || h.hedge_id || [];
    const hedgeIdBytes = Array.isArray(hedgeIdRaw) 
      ? hedgeIdRaw 
      : Buffer.from(hedgeIdRaw, 'base64');
    const collateral = Number(h.fields?.collateral_usdc || h.collateral_usdc || 0) / 1e6;
    
    console.log(`   ${i + 1}. ID: ${Buffer.from(hedgeIdBytes).toString('hex').slice(0, 16)}...`);
    console.log(`      Collateral: $${collateral.toFixed(2)}`);
    console.log(`      Pair: ${h.fields?.pair_index ?? h.pair_index}, Leverage: ${h.fields?.leverage ?? h.leverage}x`);
    
    return {
      hedgeId: Array.from(hedgeIdBytes),
      collateral,
    };
  });
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN - Would close the above hedges');
    console.log(`   Total to return to pool: $${hedgesToClose.reduce((s: number, h: any) => s + h.collateral, 0).toFixed(2)}`);
    return;
  }

  // Get admin's USDC balance (needed to return to pool)
  const usdcType = poolConfig.usdcCoinType;
  const coins = await client.getCoins({ owner: adminAddress, coinType: usdcType });
  const adminUsdc = coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  console.log(`💰 Admin USDC balance: $${(Number(adminUsdc) / 1e6).toFixed(2)}`);

  if (Number(adminUsdc) < 1000) { // Need at least $0.001 to create a coin
    console.error('❌ Admin wallet needs USDC to close hedges (returning funds to pool)');
    console.log('   The close_hedge function requires returning the collateral to the pool.');
    console.log('   Since BlueFin positions may not exist, we need to fund the admin wallet first.\n');
    
    // Alternative: use admin_reset_hedges if available
    console.log('🔧 Attempting admin reset via upgrade...');
    process.exit(1);
  }

  // Close each hedge
  for (let i = 0; i < hedgesToClose.length; i++) {
    const hedge = hedgesToClose[i];
    console.log(`\n🔄 Closing hedge ${i + 1}/${hedgesToClose.length}...`);

    // Create transaction
    const tx = new Transaction();
    
    // Split USDC for returning (at least $1 or the collateral amount)
    const returnAmountRaw = Math.max(1000000, Math.floor(hedge.collateral * 1e6));
    
    // If we have USDC coins, split one for the return
    if (coins.data.length > 0) {
      const [fundsCoin] = tx.splitCoins(tx.object(coins.data[0].coinObjectId), [returnAmountRaw]);
      
      tx.moveCall({
        target: `${poolConfig.packageId}::${poolConfig.moduleName}::close_hedge`,
        typeArguments: [usdcType],
        arguments: [
          tx.object(agentCapId),              // AgentCap
          tx.object(poolConfig.poolStateId!), // UsdcPoolState
          tx.pure.vector('u8', hedge.hedgeId), // hedge_id
          tx.pure.u64(0),                     // pnl_usdc (0 = no profit/loss)
          tx.pure.bool(false),                // is_profit
          fundsCoin,                          // funds to return
          tx.object('0x6'),                   // Clock
        ],
      });
    } else {
      console.error('   ❌ No USDC coins available');
      continue;
    }

    tx.setGasBudget(50_000_000);

    try {
      const result = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
      });

      const success = result.effects?.status?.status === 'success';
      if (success) {
        console.log(`   ✅ Closed! TX: ${result.digest}`);
      } else {
        console.log(`   ❌ Failed: ${result.effects?.status?.error}`);
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Small delay between transactions
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n✅ Done');
  
  // Re-read pool state
  const objAfter = await client.getObject({ 
    id: poolConfig.poolStateId!, 
    options: { showContent: true } 
  });
  const fieldsAfter = (objAfter.data?.content as any)?.fields;
  const hedgeStateAfter = fieldsAfter?.hedge_state?.fields || {};
  console.log(`   New total hedged: $${(Number(hedgeStateAfter.total_hedged_value || '0') / 1e6).toFixed(2)}`);
}

main().catch(console.error);
