/**
 * SUI Community Pool E2E Test
 * Tests deposit and withdraw flow end-to-end
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// Config from deployment
const CONFIG = {
  network: 'testnet' as const,
  packageId: '0xcb37e4ea0109e5c91096c0733821e4b603a5ef8faa995cfcf6c47aa2e325b70c',
  poolStateId: '0xb9b9c58c8c023723f631455c95c21ad3d3b00ba0fef91e42a90c9f648fa68f56',
  moduleName: 'community_pool',
  clockId: '0x6',
};

// Private key (from sui keystore)
const SUI_PRIVKEY = '***REDACTED_LEAKED_KEY_2***';

function getKeypair(): Ed25519Keypair {
  const { secretKey } = decodeSuiPrivateKey(SUI_PRIVKEY);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

async function getPoolState(client: SuiClient) {
  const obj = await client.getObject({
    id: CONFIG.poolStateId,
    options: { showContent: true },
  });
  if (obj.data?.content && 'fields' in obj.data.content) {
    const f = obj.data.content.fields as any;
    return {
      balance: Number(f.balance) / 1e9,
      totalShares: Number(f.total_shares) / 1e9,
      memberCount: Number(f.member_count),
    };
  }
  return null;
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('      SUI COMMUNITY POOL E2E TEST');
  console.log('═'.repeat(60) + '\n');

  const client = new SuiClient({ url: getFullnodeUrl(CONFIG.network) });
  const keypair = getKeypair();
  const address = keypair.toSuiAddress();

  console.log(`📍 Wallet: ${address}`);
  
  // Check balance
  const balance = await client.getBalance({ owner: address });
  const suiBalance = Number(balance.totalBalance) / 1e9;
  console.log(`💰 SUI Balance: ${suiBalance.toFixed(4)} SUI\n`);

  // Get initial pool state
  console.log('📊 [1] INITIAL POOL STATE');
  const stateBefore = await getPoolState(client);
  if (stateBefore) {
    console.log(`   Balance: ${stateBefore.balance.toFixed(4)} SUI`);
    console.log(`   Shares:  ${stateBefore.totalShares.toFixed(4)}`);
    console.log(`   Members: ${stateBefore.memberCount}`);
  }

  // Deposit 0.1 SUI
  const depositAmount = 100_000_000n; // 0.1 SUI
  console.log(`\n📥 [2] DEPOSITING ${Number(depositAmount) / 1e9} SUI...`);
  
  try {
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(depositAmount)]);
    tx.moveCall({
      target: `${CONFIG.packageId}::${CONFIG.moduleName}::deposit`,
      arguments: [
        tx.object(CONFIG.poolStateId),
        coin,
        tx.object(CONFIG.clockId),
      ],
    });

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });

    console.log(`   ✅ Deposit TX: ${result.digest}`);
    console.log(`   🔗 https://suiscan.xyz/testnet/tx/${result.digest}`);
    
    // Wait for indexing
    await client.waitForTransaction({ digest: result.digest });
  } catch (e: any) {
    console.log(`   ❌ Deposit failed: ${e.message}`);
    if (e.message.includes('E_MIN_DEPOSIT_NOT_MET')) {
      console.log('   (Minimum deposit is 0.1 SUI)');
    }
    return;
  }

  // Get state after deposit
  console.log('\n📊 [3] STATE AFTER DEPOSIT');
  const stateAfterDeposit = await getPoolState(client);
  if (stateAfterDeposit) {
    console.log(`   Balance: ${stateAfterDeposit.balance.toFixed(4)} SUI (+${(stateAfterDeposit.balance - (stateBefore?.balance || 0)).toFixed(4)})`);
    console.log(`   Shares:  ${stateAfterDeposit.totalShares.toFixed(4)} (+${(stateAfterDeposit.totalShares - (stateBefore?.totalShares || 0)).toFixed(4)})`);
    console.log(`   Members: ${stateAfterDeposit.memberCount}`);
  }

  // Withdraw 0.05 shares
  const withdrawShares = 50_000_000n; // 0.05 shares (9 decimals)
  console.log(`\n📤 [4] WITHDRAWING ${Number(withdrawShares) / 1e9} SHARES...`);
  
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${CONFIG.packageId}::${CONFIG.moduleName}::withdraw`,
      arguments: [
        tx.object(CONFIG.poolStateId),
        tx.pure.u64(withdrawShares),
        tx.object(CONFIG.clockId),
      ],
    });

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });

    console.log(`   ✅ Withdraw TX: ${result.digest}`);
    console.log(`   🔗 https://suiscan.xyz/testnet/tx/${result.digest}`);
    
    // Wait for indexing
    await client.waitForTransaction({ digest: result.digest });
  } catch (e: any) {
    console.log(`   ❌ Withdraw failed: ${e.message}`);
    return;
  }

  // Get final state
  console.log('\n📊 [5] FINAL POOL STATE');
  const stateAfterWithdraw = await getPoolState(client);
  if (stateAfterWithdraw) {
    console.log(`   Balance: ${stateAfterWithdraw.balance.toFixed(4)} SUI`);
    console.log(`   Shares:  ${stateAfterWithdraw.totalShares.toFixed(4)}`);
    console.log(`   Members: ${stateAfterWithdraw.memberCount}`);
  }

  // Verify API matches
  console.log('\n🔄 [6] VERIFYING API...');
  try {
    const apiRes = await fetch('http://localhost:3000/api/sui/community-pool?network=testnet');
    const apiJson = await apiRes.json();
    if (apiJson.success) {
      const apiTotalNAV = parseFloat(apiJson.data.totalNAV);
      const apiShares = parseFloat(apiJson.data.totalShares);
      const apiMembers = apiJson.data.memberCount;
      
      console.log(`   API NAV:     ${apiTotalNAV.toFixed(4)} SUI`);
      console.log(`   Chain NAV:   ${stateAfterWithdraw?.balance.toFixed(4)} SUI`);
      console.log(`   API Shares:  ${apiShares.toFixed(4)}`);
      console.log(`   Chain Shares: ${stateAfterWithdraw?.totalShares.toFixed(4)}`);
      console.log(`   API Members: ${apiMembers} | Chain: ${stateAfterWithdraw?.memberCount}`);
      
      const navMatch = Math.abs(apiTotalNAV - (stateAfterWithdraw?.balance || 0)) < 0.001;
      const sharesMatch = Math.abs(apiShares - (stateAfterWithdraw?.totalShares || 0)) < 0.001;
      
      if (navMatch && sharesMatch) {
        console.log('\n   ✅ API and on-chain state are IN SYNC!');
      } else {
        console.log('\n   ⚠️  API and on-chain state mismatch (may need refresh)');
      }
    }
  } catch (e: any) {
    console.log(`   ⚠️  API check failed: ${e.message}`);
  }

  // Final balance
  const finalBalance = await client.getBalance({ owner: address });
  console.log(`\n💰 Final Wallet Balance: ${(Number(finalBalance.totalBalance) / 1e9).toFixed(4)} SUI`);

  console.log('\n' + '═'.repeat(60));
  console.log('      ✅ E2E TEST COMPLETE');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
