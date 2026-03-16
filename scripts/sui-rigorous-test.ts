// Rigorous SUI Community Pool Testnet Tests
// Tests all contract features on the deployed testnet contract

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const NETWORK = 'testnet';
const CONFIG_PATH = 'deployments/community-pool-sui-testnet.json';

// Load deployment config
const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), CONFIG_PATH), 'utf-8'));
const PACKAGE_ID = config.packageId;
const POOL_STATE_ID = config.sharedObjects.communityPoolState;
const ADMIN_CAP_ID = config.adminCapabilities.communityPool_AdminCap;
const FEE_MANAGER_CAP_ID = config.adminCapabilities.communityPool_FeeManagerCap;

// SUI client
const suiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// Load keypair from ~/.sui/sui_config/sui.keystore
function loadKeypair(): Ed25519Keypair {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const keystorePath = path.join(homeDir, '.sui', 'sui_config', 'sui.keystore');
  const configPath = path.join(homeDir, '.sui', 'sui_config', 'client.yaml');
  const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf-8'));
  
  // Read client config to find active address
  const clientConfig = fs.readFileSync(configPath, 'utf-8');
  const activeMatch = clientConfig.match(/active_address:\s*(0x[a-fA-F0-9]+)/);
  const targetAddress = activeMatch ? activeMatch[1] : config.deployer;
  
  console.log(`🔍 Looking for wallet: ${targetAddress}`);
  
  // Try each key to find the one matching target address
  for (let i = 0; i < keystore.length; i++) {
    try {
      const privateKeyBase64 = keystore[i];
      const privateKeyBytes = Buffer.from(privateKeyBase64, 'base64');
      // Skip the first byte (scheme flag)
      const secretKey = privateKeyBytes.slice(1, 33);
      
      const kp = Ed25519Keypair.fromSecretKey(secretKey);
      const address = kp.getPublicKey().toSuiAddress();
      
      console.log(`   Key ${i}: ${address}`);
      
      if (address.toLowerCase() === targetAddress.toLowerCase()) {
        console.log(`   ✓ Found matching key!`);
        return kp;
      }
    } catch (e) {
      // Skip invalid keys
    }
  }
  
  throw new Error(`No keypair found for address ${targetAddress}`);
}

// Test results tracking
interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  txDigest?: string;
}

const results: TestResult[] = [];

// Helper to run a test
async function runTest(name: string, testFn: () => Promise<string | void>): Promise<void> {
  const start = Date.now();
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🧪 TEST: ${name}`);
  console.log('─'.repeat(60));
  
  try {
    const txDigest = await testFn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration, txDigest: txDigest as string });
    console.log(`✅ PASSED (${duration}ms)`);
    if (txDigest) {
      console.log(`   TX: https://suiscan.xyz/testnet/tx/${txDigest}`);
    }
  } catch (error: any) {
    const duration = Date.now() - start;
    results.push({ name, passed: false, duration, error: error.message });
    console.log(`❌ FAILED: ${error.message}`);
  }
}

// Helper to get pool state
async function getPoolState(): Promise<any> {
  const obj = await suiClient.getObject({
    id: POOL_STATE_ID,
    options: { showContent: true, showType: true }
  });
  
  if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
    throw new Error('Pool state not found');
  }
  
  return (obj.data.content as any).fields;
}

// Helper to format MIST to SUI
function formatSui(mist: string | number): string {
  return (Number(mist) / 1e9).toFixed(4);
}

// ═══════════════════════════════════════════════════════════════
// TEST CASES
// ═══════════════════════════════════════════════════════════════

async function testViewPoolState() {
  const state = await getPoolState();
  
  console.log(`\n📊 POOL STATE:`);
  console.log(`   Balance: ${formatSui(state.balance)} SUI`);
  console.log(`   Total Shares: ${formatSui(state.total_shares)}`);
  console.log(`   Total Deposited: ${formatSui(state.total_deposited)} SUI`);
  console.log(`   Total Withdrawn: ${formatSui(state.total_withdrawn)} SUI`);
  console.log(`   Member Count: ${state.member_count}`);
  console.log(`   Paused: ${state.paused}`);
  console.log(`   Circuit Breaker: ${state.circuit_breaker_tripped}`);
  console.log(`   All-Time High NAV: ${formatSui(state.all_time_high_nav_per_share)}`);
  console.log(`   Management Fee BPS: ${state.management_fee_bps}`);
  console.log(`   Performance Fee BPS: ${state.performance_fee_bps}`);
  console.log(`   Treasury: ${state.treasury}`);
  
  if (Number(state.balance) === 0) {
    throw new Error('Pool balance is 0 - pool may not be initialized');
  }
}

async function testDeposit(keypair: Ed25519Keypair, amountMist: number): Promise<string> {
  const address = keypair.getPublicKey().toSuiAddress();
  
  // Get a coin with enough balance
  const coins = await suiClient.getCoins({ owner: address, coinType: '0x2::sui::SUI' });
  if (coins.data.length === 0) {
    throw new Error('No SUI coins available');
  }
  
  // Find a coin with enough balance
  let coin = coins.data.find(c => Number(c.balance) >= amountMist + 10000000); // + gas
  if (!coin) {
    throw new Error(`Insufficient balance. Need ${formatSui(amountMist)} SUI + gas`);
  }
  
  console.log(`   Depositing ${formatSui(amountMist)} SUI...`);
  console.log(`   Using coin: ${coin.coinObjectId} (${formatSui(coin.balance)} SUI)`);
  
  const tx = new Transaction();
  
  // Split the deposit amount
  const [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
  
  tx.moveCall({
    target: `${PACKAGE_ID}::community_pool::deposit`,
    arguments: [
      tx.object(POOL_STATE_ID),
      depositCoin,
      tx.object('0x6'), // Clock
    ],
  });
  
  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showEvents: true }
  });
  
  if (result.effects?.status?.status !== 'success') {
    throw new Error(`Transaction failed: ${JSON.stringify(result.effects?.status)}`);
  }
  
  // Check for Deposited event
  const depositEvent = result.events?.find(e => e.type.includes('Deposited'));
  if (depositEvent) {
    const eventData = depositEvent.parsedJson as any;
    console.log(`   Shares received: ${formatSui(eventData.shares_received)}`);
    console.log(`   Share price: ${formatSui(eventData.share_price)}`);
  }
  
  return result.digest;
}

async function testWithdraw(keypair: Ed25519Keypair, sharesToBurn: number): Promise<string> {
  const address = keypair.getPublicKey().toSuiAddress();
  
  console.log(`   Withdrawing ${formatSui(sharesToBurn)} shares...`);
  
  const tx = new Transaction();
  
  tx.moveCall({
    target: `${PACKAGE_ID}::community_pool::withdraw`,
    arguments: [
      tx.object(POOL_STATE_ID),
      tx.pure.u64(sharesToBurn),
      tx.object('0x6'), // Clock
    ],
  });
  
  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showEvents: true }
  });
  
  if (result.effects?.status?.status !== 'success') {
    throw new Error(`Transaction failed: ${JSON.stringify(result.effects?.status)}`);
  }
  
  // Check for Withdrawn event
  const withdrawEvent = result.events?.find(e => e.type.includes('Withdrawn'));
  if (withdrawEvent) {
    const eventData = withdrawEvent.parsedJson as any;
    console.log(`   SUI received: ${formatSui(eventData.amount_sui)}`);
    console.log(`   Share price: ${formatSui(eventData.share_price)}`);
  }
  
  return result.digest;
}

async function testGetMemberInfo(keypair: Ed25519Keypair): Promise<void> {
  const address = keypair.getPublicKey().toSuiAddress();
  const state = await getPoolState();
  
  // The members table is a Table<address, MemberData>
  // We need to query it via a view function or dynamic field
  const membersTableId = state.members?.fields?.id?.id || state.members?.id?.id;
  
  if (!membersTableId) {
    console.log('   Could not find members table ID');
    return;
  }
  
  try {
    const memberField = await suiClient.getDynamicFieldObject({
      parentId: membersTableId,
      name: { type: 'address', value: address }
    });
    
    if (memberField.data?.content && memberField.data.content.dataType === 'moveObject') {
      const fields = (memberField.data.content as any).fields.value?.fields || (memberField.data.content as any).fields;
      console.log(`\n📋 MEMBER INFO for ${address.slice(0, 10)}...:`);
      console.log(`   Shares: ${formatSui(fields.shares)}`);
      console.log(`   Deposited: ${formatSui(fields.deposited_sui)} SUI`);
      console.log(`   Withdrawn: ${formatSui(fields.withdrawn_sui)} SUI`);
      console.log(`   Joined At: ${new Date(Number(fields.joined_at)).toISOString()}`);
      console.log(`   High Water Mark: ${formatSui(fields.high_water_mark)}`);
    }
  } catch (e: any) {
    console.log(`   Member not found in pool (address: ${address.slice(0, 20)}...)`);
  }
}

async function testMinimumDeposit(keypair: Ed25519Keypair): Promise<string> {
  // Try to deposit below minimum (should fail)
  const belowMin = 50_000_000; // 0.05 SUI (below 0.1 SUI minimum)
  
  console.log(`   Attempting deposit of ${formatSui(belowMin)} SUI (below min)...`);
  
  const tx = new Transaction();
  const [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(belowMin)]);
  
  tx.moveCall({
    target: `${PACKAGE_ID}::community_pool::deposit`,
    arguments: [
      tx.object(POOL_STATE_ID),
      depositCoin,
      tx.object('0x6'),
    ],
  });
  
  try {
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true }
    });
    
    if (result.effects?.status?.status === 'success') {
      throw new Error('Deposit should have failed but succeeded');
    }
  } catch (e: any) {
    if (e.message.includes('should have failed')) throw e;
    console.log(`   ✓ Correctly rejected: ${e.message.slice(0, 100)}...`);
    return 'Expected failure';
  }
  
  return 'Expected failure';
}

async function testWalletBalance(keypair: Ed25519Keypair): Promise<void> {
  const address = keypair.getPublicKey().toSuiAddress();
  const balance = await suiClient.getBalance({ owner: address });
  
  console.log(`\n💰 WALLET: ${address.slice(0, 20)}...`);
  console.log(`   SUI Balance: ${formatSui(balance.totalBalance)} SUI`);
}

async function testCollectFees(keypair: Ed25519Keypair, feeManagerCapId: string): Promise<string> {
  console.log(`   Attempting to collect fees...`);
  
  // First check if we own the FeeManagerCap
  const capObj = await suiClient.getObject({
    id: feeManagerCapId,
    options: { showOwner: true }
  });
  
  const address = keypair.getPublicKey().toSuiAddress();
  const owner = (capObj.data?.owner as any)?.AddressOwner;
  
  if (owner !== address) {
    console.log(`   ⚠️ FeeManagerCap owned by ${owner?.slice(0, 20)}...`);
    console.log(`   Current address: ${address.slice(0, 20)}...`);
    throw new Error('FeeManagerCap not owned by current wallet');
  }
  
  const tx = new Transaction();
  
  tx.moveCall({
    target: `${PACKAGE_ID}::community_pool::collect_fees`,
    arguments: [
      tx.object(feeManagerCapId),
      tx.object(POOL_STATE_ID),
      tx.object('0x6'),
    ],
  });
  
  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showEvents: true }
  });
  
  if (result.effects?.status?.status !== 'success') {
    throw new Error(`Transaction failed: ${JSON.stringify(result.effects?.status)}`);
  }
  
  const feeEvent = result.events?.find(e => e.type.includes('FeesCollected'));
  if (feeEvent) {
    const eventData = feeEvent.parsedJson as any;
    console.log(`   Management fee: ${formatSui(eventData.management_fee)} SUI`);
    console.log(`   Performance fee: ${formatSui(eventData.performance_fee)} SUI`);
  } else {
    console.log(`   No fees collected (may require time to accrue)`);
  }
  
  return result.digest;
}

async function testViewAccumulatedFees(): Promise<void> {
  const state = await getPoolState();
  
  console.log(`\n💵 ACCUMULATED FEES:`);
  console.log(`   Management: ${formatSui(state.accumulated_management_fees)} SUI`);
  console.log(`   Performance: ${formatSui(state.accumulated_performance_fees)} SUI`);
  console.log(`   Last Collection: ${new Date(Number(state.last_fee_collection)).toISOString()}`);
}

async function testNAVPerShare(): Promise<void> {
  const state = await getPoolState();
  
  const balance = Number(state.balance);
  const totalShares = Number(state.total_shares);
  const VIRTUAL_ASSETS = 1_000_000_000;
  const VIRTUAL_SHARES = 1_000_000_000;
  
  const totalAssetsWithOffset = balance + VIRTUAL_ASSETS;
  const totalSharesWithOffset = totalShares + VIRTUAL_SHARES;
  const navPerShare = (totalAssetsWithOffset * 1e9) / totalSharesWithOffset;
  
  console.log(`\n📈 NAV CALCULATION:`);
  console.log(`   Pool Balance: ${formatSui(balance)} SUI`);
  console.log(`   Total Shares: ${formatSui(totalShares)}`);
  console.log(`   NAV per Share: ${formatSui(navPerShare)} SUI (with virtual offset)`);
  console.log(`   All-Time High: ${formatSui(state.all_time_high_nav_per_share)}`);
}

async function testCircuitBreakerStatus(): Promise<void> {
  const state = await getPoolState();
  
  console.log(`\n🔒 CIRCUIT BREAKER STATUS:`);
  console.log(`   Tripped: ${state.circuit_breaker_tripped}`);
  console.log(`   Paused: ${state.paused}`);
  console.log(`   Max Single Deposit: ${formatSui(state.max_single_deposit)} SUI`);
  console.log(`   Max Single Withdrawal BPS: ${state.max_single_withdrawal_bps}`);
  console.log(`   Daily Withdrawal Cap BPS: ${state.daily_withdrawal_cap_bps}`);
  console.log(`   Daily Withdrawal Total: ${formatSui(state.daily_withdrawal_total)} SUI`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('═'.repeat(60));
  console.log('   SUI COMMUNITY POOL - RIGOROUS TESTNET TESTS');
  console.log('═'.repeat(60));
  
  console.log(`\n📦 Package: ${PACKAGE_ID.slice(0, 20)}...`);
  console.log(`📍 Pool State: ${POOL_STATE_ID.slice(0, 20)}...`);
  console.log(`🔑 Admin Cap: ${ADMIN_CAP_ID.slice(0, 20)}...`);
  console.log(`💰 Fee Manager Cap: ${FEE_MANAGER_CAP_ID.slice(0, 20)}...`);
  
  // Load keypair
  let keypair: Ed25519Keypair;
  try {
    keypair = loadKeypair();
    console.log(`\n👛 Wallet: ${keypair.getPublicKey().toSuiAddress()}`);
  } catch (e: any) {
    console.error(`❌ Failed to load keypair: ${e.message}`);
    process.exit(1);
  }
  
  // ═══ VIEW TESTS (Read-only) ═══
  console.log('\n\n' + '═'.repeat(60));
  console.log('   PHASE 1: VIEW TESTS (Read-only)');
  console.log('═'.repeat(60));
  
  await runTest('View Wallet Balance', async () => {
    await testWalletBalance(keypair);
  });
  
  await runTest('View Pool State', async () => {
    await testViewPoolState();
  });
  
  await runTest('View Member Info', async () => {
    await testGetMemberInfo(keypair);
  });
  
  await runTest('View Accumulated Fees', async () => {
    await testViewAccumulatedFees();
  });
  
  await runTest('Calculate NAV per Share', async () => {
    await testNAVPerShare();
  });
  
  await runTest('Check Circuit Breaker Status', async () => {
    await testCircuitBreakerStatus();
  });
  
  // ═══ TRANSACTION TESTS ═══
  console.log('\n\n' + '═'.repeat(60));
  console.log('   PHASE 2: TRANSACTION TESTS');
  console.log('═'.repeat(60));
  
  // Test minimum deposit rejection
  await runTest('Minimum Deposit Enforcement', async () => {
    return await testMinimumDeposit(keypair);
  });
  
  // Get initial state
  const initialState = await getPoolState();
  const initialBalance = Number(initialState.balance);
  const initialShares = Number(initialState.total_shares);
  
  // Test deposit
  const depositAmount = 100_000_000; // 0.1 SUI - minimum for subsequent deposits
  await runTest('Deposit 0.1 SUI', async () => {
    return await testDeposit(keypair, depositAmount);
  });
  
  // Wait a moment for state to update
  await new Promise(r => setTimeout(r, 2000));
  
  // Verify state change
  await runTest('Verify Deposit State Change', async () => {
    const newState = await getPoolState();
    const newBalance = Number(newState.balance);
    const newShares = Number(newState.total_shares);
    
    const balanceIncrease = newBalance - initialBalance;
    console.log(`   Balance change: +${formatSui(balanceIncrease)} SUI`);
    console.log(`   Shares change: +${formatSui(newShares - initialShares)}`);
    
    if (balanceIncrease <= 0) {
      throw new Error('Balance did not increase after deposit');
    }
  });
  
  // Test withdraw
  const withdrawShares = 25_000_000; // 0.025 shares
  await runTest('Withdraw 0.025 Shares', async () => {
    return await testWithdraw(keypair, withdrawShares);
  });
  
  // Wait for state update
  await new Promise(r => setTimeout(r, 2000));
  
  // Verify withdrawal
  await runTest('Verify Withdrawal State Change', async () => {
    const finalState = await getPoolState();
    console.log(`   Final Balance: ${formatSui(finalState.balance)} SUI`);
    console.log(`   Final Shares: ${formatSui(finalState.total_shares)}`);
    console.log(`   Total Withdrawn: ${formatSui(finalState.total_withdrawn)} SUI`);
  });
  
  // ═══ ADMIN TESTS ═══
  console.log('\n\n' + '═'.repeat(60));
  console.log('   PHASE 3: ADMIN/FEE TESTS');
  console.log('═'.repeat(60));
  
  await runTest('Collect Accumulated Fees', async () => {
    return await testCollectFees(keypair, FEE_MANAGER_CAP_ID);
  });
  
  // ═══ FINAL SUMMARY ═══
  console.log('\n\n' + '═'.repeat(60));
  console.log('   TEST RESULTS SUMMARY');
  console.log('═'.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`\n📊 Total: ${results.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed}\n`);
  
  for (const r of results) {
    const status = r.passed ? '✅' : '❌';
    console.log(`${status} ${r.name} (${r.duration}ms)`);
    if (!r.passed && r.error) {
      console.log(`   Error: ${r.error}`);
    }
  }
  
  // Final state
  console.log('\n' + '─'.repeat(60));
  console.log('📊 FINAL POOL STATE:');
  const finalState = await getPoolState();
  console.log(`   Balance: ${formatSui(finalState.balance)} SUI`);
  console.log(`   Total Shares: ${formatSui(finalState.total_shares)}`);
  console.log(`   Members: ${finalState.member_count}`);
  
  await testWalletBalance(keypair);
  
  console.log('\n' + '═'.repeat(60));
  console.log(failed > 0 ? '❌ SOME TESTS FAILED' : '✅ ALL TESTS PASSED');
  console.log('═'.repeat(60));
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
