/**
 * Execute Sepolia Pool Rebalance - Swap USDT to BTC/ETH/CRO/SUI
 * 
 * This script swaps the pool's USDT holdings into target allocation:
 * - 30% BTC
 * - 30% ETH
 * - 20% CRO
 * - 20% SUI
 * 
 * Run: npx hardhat run scripts/execute-sepolia-rebalance.cjs --network sepolia
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

// Load deployment
let DEX_DEPLOYMENT;
try {
  DEX_DEPLOYMENT = require('../deployments/sepolia-dex.json');
} catch (e) {
  console.error('❌ Deploy DEX first: npx hardhat run scripts/deploy/deploy-sepolia-dex.cjs --network sepolia');
  process.exit(1);
}

const CONFIG = {
  communityPool: DEX_DEPLOYMENT.communityPool,
  usdt: DEX_DEPLOYMENT.usdt,
  dex: DEX_DEPLOYMENT.simpleMockDEX,
  assets: DEX_DEPLOYMENT.assets,
  targetAllocation: DEX_DEPLOYMENT.targetAllocation,
};

const POOL_ABI = [
  'function dexRouter() view returns (address)',
  'function assetTokens(uint8) view returns (address)',
  'function assetBalances(uint8) view returns (uint256)',
  'function depositToken() view returns (address)',
  'function executeRebalanceTrade(uint8 assetIndex, uint256 amount, bool isBuy, uint256 minAmountOut) external',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function REBALANCER_ROLE() view returns (bytes32)',
  'function grantRole(bytes32 role, address account) external',
  'function getPoolStats() view returns (uint256 _totalNAV, uint256 _sharePrice, uint256 _totalShares, uint256 _memberCount)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       SEPOLIA POOL REBALANCE - USDT → BTC/ETH/CRO/SUI      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Executor:', deployer.address);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'ETH');
  console.log('');
  
  const pool = new ethers.Contract(CONFIG.communityPool, POOL_ABI, deployer);
  const usdt = new ethers.Contract(CONFIG.usdt, ERC20_ABI, deployer);
  
  // ═══════════════════════════════════════════════════════════════
  // 1. CHECK CURRENT STATE
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 1: Current Pool State ═══');
  
  const usdtBalance = await usdt.balanceOf(CONFIG.communityPool);
  console.log('USDT Balance:', ethers.formatUnits(usdtBalance, 6), 'USDT');
  
  if (usdtBalance === 0n) {
    console.log('⚠️  Pool has no USDT to rebalance');
    return;
  }
  
  const dexRouter = await pool.dexRouter();
  console.log('DEX Router:', dexRouter);
  
  if (dexRouter === '0x0000000000000000000000000000000000000000') {
    console.error('❌ DEX Router not set! Run deploy-sepolia-dex.cjs first');
    return;
  }
  
  // Check asset balances
  const assetNames = ['BTC', 'ETH', 'CRO', 'SUI'];
  console.log('\nCurrent Asset Balances:');
  for (let i = 0; i < 4; i++) {
    try {
      const tokenAddr = await pool.assetTokens(i);
      const balance = await pool.assetBalances(i);
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, deployer);
      const decimals = await token.decimals();
      const symbol = await token.symbol();
      console.log(`  [${i}] ${symbol}: ${ethers.formatUnits(balance, decimals)}`);
    } catch (e) {
      console.log(`  [${i}] ${assetNames[i]}: Not configured`);
    }
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 2. CHECK REBALANCER ROLE
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 2: Check Rebalancer Role ═══');
  
  const REBALANCER_ROLE = await pool.REBALANCER_ROLE();
  const hasRole = await pool.hasRole(REBALANCER_ROLE, deployer.address);
  
  if (!hasRole) {
    console.log('   Granting REBALANCER_ROLE to deployer...');
    const grantTx = await pool.grantRole(REBALANCER_ROLE, deployer.address);
    await grantTx.wait();
    console.log('   ✅ REBALANCER_ROLE granted');
  } else {
    console.log('   ✅ Already has REBALANCER_ROLE');
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 3. CALCULATE ALLOCATIONS
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 3: Calculate Allocations ═══');
  
  const totalUSDT = usdtBalance;
  const allocations = [
    { name: 'BTC', index: 0, percent: CONFIG.targetAllocation.BTC },
    { name: 'ETH', index: 1, percent: CONFIG.targetAllocation.ETH },
    { name: 'CRO', index: 2, percent: CONFIG.targetAllocation.CRO },
    { name: 'SUI', index: 3, percent: CONFIG.targetAllocation.SUI },
  ];
  
  for (const alloc of allocations) {
    const amount = (totalUSDT * BigInt(alloc.percent)) / 100n;
    alloc.usdtAmount = amount;
    console.log(`  ${alloc.name}: ${alloc.percent}% = ${ethers.formatUnits(amount, 6)} USDT`);
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 4. EXECUTE SWAPS
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 4: Execute Swaps ═══');
  
  for (const alloc of allocations) {
    if (alloc.usdtAmount === 0n) {
      console.log(`   Skipping ${alloc.name} (0 USDT)`);
      continue;
    }
    
    console.log(`   Swapping ${ethers.formatUnits(alloc.usdtAmount, 6)} USDT → ${alloc.name}...`);
    
    try {
      // executeRebalanceTrade(assetIndex, amount, isBuy, minAmountOut)
      // isBuy=true means we're buying the asset with USDT
      const tx = await pool.executeRebalanceTrade(
        alloc.index,
        alloc.usdtAmount,
        true, // isBuy = true (buying asset with USDT)
        0     // minAmountOut = 0 (no slippage protection for mock)
      );
      const receipt = await tx.wait();
      console.log(`   ✅ ${alloc.name} swap complete (gas: ${receipt.gasUsed.toString()})`);
    } catch (error) {
      console.error(`   ❌ ${alloc.name} swap failed:`, error.message);
    }
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 5. FINAL STATE
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 5: Final Pool State ═══');
  
  const finalUsdtBalance = await usdt.balanceOf(CONFIG.communityPool);
  console.log('USDT Balance:', ethers.formatUnits(finalUsdtBalance, 6), 'USDT');
  
  console.log('\nAsset Balances:');
  for (let i = 0; i < 4; i++) {
    try {
      const tokenAddr = await pool.assetTokens(i);
      const balance = await pool.assetBalances(i);
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, deployer);
      const decimals = await token.decimals();
      const symbol = await token.symbol();
      const price = CONFIG.assets[assetNames[i]].price;
      const valueUSD = Number(ethers.formatUnits(balance, decimals)) * price;
      console.log(`  [${i}] ${symbol}: ${ethers.formatUnits(balance, decimals)} (~$${valueUSD.toFixed(2)})`);
    } catch (e) {
      console.log(`  [${i}] Error reading balance`);
    }
  }
  
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                  REBALANCE COMPLETE!                       ║');
  console.log('║                                                            ║');
  console.log('║  Pool now holds BTC/ETH/CRO/SUI instead of USDT           ║');
  console.log('║  Withdrawals will sell assets back to USDT                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
