/**
 * End-to-End Deposit Test Script
 * 
 * Tests the complete deposit flow for AI agents:
 * 1. Check USDT balance
 * 2. Check/reset allowance (USDT quirk)
 * 3. Approve USDT
 * 4. Deposit to pool
 * 5. Verify shares received
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load env files - try multiple
require('dotenv').config({ path: '.env.vercel.temp' });
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env.prod' });

// Configuration
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const POOL_ADDRESS = '0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086';
const USDT_ADDRESS = '0xd077a400968890eacc75cdc901f0356c943e4fdb';

// ABIs
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
  'function nonces(address) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
];

const POOL_ABI = [
  'function deposit(uint256 amount) returns (uint256 shares)',
  'function totalShares() view returns (uint256)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 lastDepositAt, uint256 joinedAt, uint256 withdrawnUSD, uint256 highWaterMark)',
  'function isMember(address) view returns (bool)',
];

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     END-TO-END DEPOSIT TEST - AI AGENT SIMULATION            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Setup - try multiple env var names
  const privateKey = (process.env.SERVER_WALLET_PRIVATE_KEY || process.env.SERVER_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY env var required');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  const userAddress = wallet.address;

  console.log('🔑 Wallet:', userAddress);
  console.log('🌐 Network: Sepolia (chainId: 11155111)');
  console.log('📍 Pool:', POOL_ADDRESS);
  console.log('💵 USDT:', USDT_ADDRESS);
  console.log('');

  // Contracts
  const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, wallet);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, wallet);

  // ============================================
  // STEP 1: Check USDT Balance
  // ============================================
  console.log('═══ STEP 1: Check USDT Balance ═══');
  const balance = await usdt.balanceOf(userAddress);
  const balanceFormatted = ethers.formatUnits(balance, 6);
  console.log(`💰 USDT Balance: ${balanceFormatted} USDT`);

  if (balance === 0n) {
    console.error('❌ No USDT balance. Get WDK USDT from https://wdk.tether.io');
    process.exit(1);
  }
  console.log('✅ Has USDT balance');
  console.log('');

  // Deposit amount (use 10 USDT for test, or less if balance is lower)
  const DEPOSIT_AMOUNT = balance < ethers.parseUnits('10', 6) 
    ? balance 
    : ethers.parseUnits('10', 6);
  console.log(`📝 Will deposit: ${ethers.formatUnits(DEPOSIT_AMOUNT, 6)} USDT`);
  console.log('');

  // ============================================
  // STEP 2: Check Current Allowance
  // ============================================
  console.log('═══ STEP 2: Check Allowance ═══');
  let allowance = await usdt.allowance(userAddress, POOL_ADDRESS);
  console.log(`🔐 Current Allowance: ${ethers.formatUnits(allowance, 6)} USDT`);

  // USDT requires reset-to-zero before changing allowance
  if (allowance > 0n && allowance < DEPOSIT_AMOUNT) {
    console.log('⚠️  USDT quirk: Must reset allowance to 0 first');
    console.log('📤 Sending reset approval tx...');
    const resetTx = await usdt.approve(POOL_ADDRESS, 0n);
    console.log(`   Tx: ${resetTx.hash}`);
    await resetTx.wait();
    console.log('✅ Allowance reset to 0');
    allowance = 0n;
  }
  console.log('');

  // ============================================
  // STEP 3: Approve USDT (if needed)
  // ============================================
  console.log('═══ STEP 3: Approve USDT ═══');
  if (allowance < DEPOSIT_AMOUNT) {
    console.log(`📤 Approving ${ethers.formatUnits(DEPOSIT_AMOUNT, 6)} USDT...`);
    const approveTx = await usdt.approve(POOL_ADDRESS, DEPOSIT_AMOUNT);
    console.log(`   Tx: ${approveTx.hash}`);
    await approveTx.wait();
    console.log('✅ Approval confirmed');
  } else {
    console.log('✅ Sufficient allowance already exists');
  }
  console.log('');

  // ============================================
  // STEP 4: Get Member State Before
  // ============================================
  console.log('═══ STEP 4: State Before Deposit ═══');
  const isMemberBefore = await pool.isMember(userAddress);
  let sharesBefore = 0n;
  if (isMemberBefore) {
    const memberBefore = await pool.members(userAddress);
    sharesBefore = memberBefore.shares;
    console.log(`📊 Already a member with ${ethers.formatUnits(sharesBefore, 18)} shares`);
  } else {
    console.log('📊 New member (first deposit)');
  }
  console.log('');

  // ============================================
  // STEP 5: Deposit to Pool
  // ============================================
  console.log('═══ STEP 5: Deposit to Pool ═══');
  console.log(`📤 Depositing ${ethers.formatUnits(DEPOSIT_AMOUNT, 6)} USDT...`);
  
  try {
    const depositTx = await pool.deposit(DEPOSIT_AMOUNT);
    console.log(`   Tx: ${depositTx.hash}`);
    console.log('   Waiting for confirmation...');
    const receipt = await depositTx.wait();
    console.log(`✅ Deposit confirmed in block ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
  } catch (error) {
    console.error('❌ Deposit failed:', error.message);
    if (error.data) {
      console.error('   Error data:', error.data);
    }
    process.exit(1);
  }
  console.log('');

  // ============================================
  // STEP 6: Verify Shares Received
  // ============================================
  console.log('═══ STEP 6: Verify Shares ═══');
  const memberAfter = await pool.members(userAddress);
  const sharesAfter = memberAfter.shares;
  const sharesReceived = sharesAfter - sharesBefore;
  
  console.log(`📊 Shares before: ${ethers.formatUnits(sharesBefore, 18)}`);
  console.log(`📊 Shares after:  ${ethers.formatUnits(sharesAfter, 18)}`);
  console.log(`📊 Shares received: ${ethers.formatUnits(sharesReceived, 18)}`);
  
  if (sharesReceived > 0n) {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ TEST PASSED!                            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('The deposit flow works end-to-end for AI agents:');
    console.log('1. ✅ Check USDT balance');
    console.log('2. ✅ Reset allowance (USDT quirk)');
    console.log('3. ✅ Approve USDT');
    console.log('4. ✅ Deposit to pool');
    console.log('5. ✅ Received pool shares');
  } else {
    console.error('❌ No shares received!');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
