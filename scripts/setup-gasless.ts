/**
 * Complete Gasless System Setup
 * 
 * Sets up TRUE gasless hedge execution:
 * 1. Grants AGENT_ROLE to relayer
 * 2. Funds HedgeExecutor contract with USDC
 * 3. Verifies configuration
 * 
 * Usage:
 *   npx hardhat run scripts/setup-gasless.ts --network cronos-testnet
 */

import { ethers } from 'hardhat';

const HEDGE_EXECUTOR = '0x090b6221137690EbB37667E4644287487CE462B9';
const MOCK_USDC = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';
const RELAYER_ADDRESS = '0xb61C1cF5152015E66d547F9c1c45cC592a870D10'; // From RELAYER_PRIVATE_KEY

async function main() {
  console.log('\n🚀 GASLESS SYSTEM SETUP\n' + '='.repeat(60));

  const [admin] = await ethers.getSigners();
  console.log('Admin:', admin.address);
  console.log('Relayer:', RELAYER_ADDRESS);
  console.log('HedgeExecutor:', HEDGE_EXECUTOR);
  console.log('MockUSDC:', MOCK_USDC);

  const HedgeExecutor = await ethers.getContractAt('HedgeExecutor', HEDGE_EXECUTOR);
  const MockUSDC = await ethers.getContractAt('MockUSDC', MOCK_USDC, admin);

  // ═════════════════════════════════════════════════════════════
  // STEP 1: Grant AGENT_ROLE
  // ═════════════════════════════════════════════════════════════
  console.log('\n📋 STEP 1: Granting AGENT_ROLE...');
  
  const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('AGENT_ROLE'));
  const hasRole = await HedgeExecutor.hasRole(AGENT_ROLE, RELAYER_ADDRESS);
  
  if (hasRole) {
    console.log('   ✅ Relayer already has AGENT_ROLE');
  } else {
    console.log('   ⏳ Granting role...');
    const tx = await HedgeExecutor.grantRole(AGENT_ROLE, RELAYER_ADDRESS);
    await tx.wait();
    console.log('   ✅ AGENT_ROLE granted');
    console.log('   TX:', tx.hash);
  }

  // ═════════════════════════════════════════════════════════════
  // STEP 2: Fund HedgeExecutor Contract
  // ═════════════════════════════════════════════════════════════
  console.log('\n💰 STEP 2: Funding HedgeExecutor contract...');
  
  const currentBalance = await MockUSDC.balanceOf(HEDGE_EXECUTOR);
  const currentBalanceFormatted = ethers.formatUnits(currentBalance, 6);
  console.log(`   Current balance: ${currentBalanceFormatted} USDC`);
  
  const TARGET_BALANCE = ethers.parseUnits('200000000', 6); // 200M USDC
  
  if (currentBalance >= TARGET_BALANCE) {
    console.log('   ✅ Contract already has sufficient funds');
  } else {
    const needed = TARGET_BALANCE - currentBalance;
    console.log(`   ⏳ Minting ${ethers.formatUnits(needed, 6)} USDC...`);
    
    const mintTx = await MockUSDC.mint(HEDGE_EXECUTOR, needed);
    await mintTx.wait();
    
    const newBalance = await MockUSDC.balanceOf(HEDGE_EXECUTOR);
    console.log('   ✅ Contract funded');
    console.log(`   New balance: ${ethers.formatUnits(newBalance, 6)} USDC`);
    console.log('   TX:', mintTx.hash);
  }

  // ═════════════════════════════════════════════════════════════
  // STEP 3: Verify Configuration
  // ═════════════════════════════════════════════════════════════
  console.log('\n🔍 STEP 3: Verifying configuration...');
  
  const finalBalance = await MockUSDC.balanceOf(HEDGE_EXECUTOR);
  const finalHasRole = await HedgeExecutor.hasRole(AGENT_ROLE, RELAYER_ADDRESS);
  
  console.log('\n✅ SETUP COMPLETE!');
  console.log('━'.repeat(60));
  console.log('Configuration:');
  console.log(`  • Relayer AGENT_ROLE: ${finalHasRole ? '✅' : '❌'}`);
  console.log(`  • Contract USDC Balance: ${ethers.formatUnits(finalBalance, 6)} USDC`);
  console.log('\nGasless hedges are now enabled!');
  console.log('Users pay: $0.00 gas (relayer pays ~$0.03 per hedge)');
  console.log('\nAPI Endpoint: /api/agents/hedging/open-onchain-gasless');
  console.log('━'.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Setup failed:', error);
    process.exit(1);
  });
