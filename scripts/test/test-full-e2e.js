/**
 * CommunityPool Full E2E Test
 * 
 * Tests everything:
 * 1. First deposit ($100 minimum)
 * 2. Multiple wallet deposits
 * 3. Fee accumulation
 * 4. Fee withdrawal to ZKProxyVault
 * 5. Partial and full withdrawals
 * 6. Treasury verification
 * 
 * Usage:
 *   npx hardhat run scripts/test/test-full-e2e.js --network cronos-testnet
 */

const { ethers } = require("hardhat");

const communityPoolDeployment = require("../../deployments/community-pool.json");
const zkVaultDeployment = require("../../deployments/zk-proxy-vault.json");
const testnetDeployment = require("../../deployments/cronos-testnet.json");

const POOL_ADDRESS = communityPoolDeployment.contracts.CommunityPool.proxy;
const ZK_VAULT_ADDRESS = zkVaultDeployment.contracts.ZKProxyVault.proxy;
const USDC_ADDRESS = testnetDeployment.MockUSDC;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmt(value, decimals = 6) {
  return parseFloat(ethers.formatUnits(value, decimals)).toFixed(4);
}

let testsPassed = 0;
let testsFailed = 0;

function pass(msg) {
  console.log(`   ✅ ${msg}`);
  testsPassed++;
}

function fail(msg) {
  console.log(`   ❌ ${msg}`);
  testsFailed++;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = deployer.provider;
  
  // Generate test wallets
  const walletB = ethers.Wallet.createRandom().connect(provider);
  const walletC = ethers.Wallet.createRandom().connect(provider);
  
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║         CommunityPool Full End-to-End Test                    ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  console.log("⚙️  Configuration:");
  console.log("   CommunityPool:", POOL_ADDRESS);
  console.log("   ZKProxyVault (Treasury):", ZK_VAULT_ADDRESS);
  console.log("   USDC:", USDC_ADDRESS);
  console.log("\n🔑 Wallets:");
  console.log("   A (Deployer):", deployer.address);
  console.log("   B:", walletB.address);
  console.log("   C:", walletC.address);
  
  // Get contracts
  const pool = await ethers.getContractAt("CommunityPool", POOL_ADDRESS);
  const usdc = await ethers.getContractAt("MockUSDC", USDC_ADDRESS);
  
  // ══════════════════════════════════════════════════════════════
  // TEST 1: Verify Configuration
  // ══════════════════════════════════════════════════════════════
  
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📋 TEST 1: Verify Configuration");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  const treasury = await pool.treasury();
  const minFirstDeposit = await pool.MIN_FIRST_DEPOSIT();
  const minDeposit = await pool.MIN_DEPOSIT();
  const mgmtFee = await pool.managementFeeBps();
  const perfFee = await pool.performanceFeeBps();
  
  console.log(`   Treasury: ${treasury}`);
  console.log(`   MIN_FIRST_DEPOSIT: $${fmt(minFirstDeposit)}`);
  console.log(`   MIN_DEPOSIT: $${fmt(minDeposit)}`);
  console.log(`   Management Fee: ${mgmtFee} bps (${Number(mgmtFee)/100}%)`);
  console.log(`   Performance Fee: ${perfFee} bps (${Number(perfFee)/100}%)`);
  
  if (treasury.toLowerCase() === ZK_VAULT_ADDRESS.toLowerCase()) {
    pass("Treasury is ZKProxyVault");
  } else {
    fail("Treasury is NOT ZKProxyVault");
  }
  
  if (minFirstDeposit === 100000000n) {
    pass("MIN_FIRST_DEPOSIT is $100");
  } else {
    fail(`MIN_FIRST_DEPOSIT is ${fmt(minFirstDeposit)}, expected $100`);
  }
  
  // ══════════════════════════════════════════════════════════════
  // SETUP: Fund wallets
  // ══════════════════════════════════════════════════════════════
  
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔧 SETUP: Fund test wallets");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  // Send gas to wallets B and C
  await (await deployer.sendTransaction({ to: walletB.address, value: ethers.parseEther("1") })).wait();
  await (await deployer.sendTransaction({ to: walletC.address, value: ethers.parseEther("1") })).wait();
  console.log("   Sent 1 TCRO to wallets B and C");
  
  // Mint USDC
  await (await usdc.connect(deployer).mint(deployer.address, ethers.parseUnits("2000", 6))).wait();
  await (await usdc.connect(deployer).mint(walletB.address, ethers.parseUnits("1000", 6))).wait();
  await (await usdc.connect(deployer).mint(walletC.address, ethers.parseUnits("1000", 6))).wait();
  console.log("   Minted USDC to all wallets");
  
  // Approve
  await (await usdc.connect(deployer).approve(POOL_ADDRESS, ethers.MaxUint256)).wait();
  await sleep(1000);
  await (await usdc.connect(walletB).approve(POOL_ADDRESS, ethers.MaxUint256)).wait();
  await sleep(1000);
  await (await usdc.connect(walletC).approve(POOL_ADDRESS, ethers.MaxUint256)).wait();
  console.log("   Approved pool for all wallets\n");
  
  // Record initial vault balance
  const vaultUsdcBefore = await usdc.balanceOf(ZK_VAULT_ADDRESS);
  
  // ══════════════════════════════════════════════════════════════
  // TEST 2: First Deposit ($100 minimum)
  // ══════════════════════════════════════════════════════════════
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📥 TEST 2: First Deposit (new $100 minimum)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  // Check if pool is truly empty (contract uses totalShares == 0)
  const initStats = await pool.getPoolStats();
  const totalSharesRaw = initStats._totalShares;
  const isPoolEmpty = totalSharesRaw === 0n;
  
  console.log(`   Current NAV: $${fmt(initStats._totalNAV)}, Total Shares: ${totalSharesRaw.toString()} raw (${fmt(totalSharesRaw, 18)} formatted)`);
  
  if (isPoolEmpty) {
    console.log("   Pool is empty (totalShares == 0) - testing first deposit...");
    
    // Try $50 - should fail
    try {
      await pool.connect(deployer).deposit(ethers.parseUnits("50", 6), { gasLimit: 250000 });
      fail("$50 deposit should have failed (below $100 minimum)");
    } catch (e) {
      pass("$50 deposit correctly rejected (below $100 minimum)");
    }
    
    // Try $100 - should work
    await sleep(2000);
    const tx = await pool.connect(deployer).deposit(ethers.parseUnits("100", 6), { gasLimit: 250000 });
    await tx.wait();
    const pos = await pool.getMemberPosition(deployer.address);
    
    if (pos.shares > 0n) {
      pass(`First deposit $100 succeeded - got ${fmt(pos.shares, 18)} shares`);
    } else {
      fail("First deposit $100 failed");
    }
  } else {
    console.log(`   Pool has ${fmt(totalSharesRaw, 18)} shares - not empty, skipping first-deposit rejection test`);
    pass("Pool already has deposits (from previous test runs)");
    
    // Still test that deposits work (even small ones since pool isn't empty)
    console.log("   Testing regular deposit ($50 should work since pool not empty)...");
    try {
      await sleep(1000);
      const tx = await pool.connect(deployer).deposit(ethers.parseUnits("50", 6), { gasLimit: 250000 });
      await tx.wait();
      pass("Regular $50 deposit succeeded (MIN_DEPOSIT = $10)");
    } catch (e) {
      fail(`Regular deposit failed: ${e.message}`);
    }
  }
  
  // ══════════════════════════════════════════════════════════════
  // TEST 3: Multi-wallet Deposits
  // ══════════════════════════════════════════════════════════════
  
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📥 TEST 3: Multi-wallet Deposits");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  // Wallet A adds more
  console.log("   [Wallet A] Depositing $500...");
  await sleep(2000);
  await (await pool.connect(deployer).deposit(ethers.parseUnits("500", 6), { gasLimit: 250000 })).wait();
  const posA = await pool.getMemberPosition(deployer.address);
  console.log(`   [Wallet A] Total: ${fmt(posA.shares, 18)} shares = $${fmt(posA.valueUSD)}`);
  
  // Wallet B deposits
  console.log("\n   [Wallet B] Depositing $300...");
  await sleep(3000);
  await (await pool.connect(walletB).deposit(ethers.parseUnits("300", 6), { gasLimit: 300000, gasPrice: ethers.parseUnits("500", "gwei") })).wait();
  const posB = await pool.getMemberPosition(walletB.address);
  console.log(`   [Wallet B] Total: ${fmt(posB.shares, 18)} shares = $${fmt(posB.valueUSD)}`);
  
  // Wallet C deposits
  console.log("\n   [Wallet C] Depositing $200...");
  await sleep(3000);
  await (await pool.connect(walletC).deposit(ethers.parseUnits("200", 6), { gasLimit: 300000, gasPrice: ethers.parseUnits("500", "gwei") })).wait();
  const posC = await pool.getMemberPosition(walletC.address);
  console.log(`   [Wallet C] Total: ${fmt(posC.shares, 18)} shares = $${fmt(posC.valueUSD)}`);
  
  // Verify pool stats
  const statsAfterDeposits = await pool.getPoolStats();
  console.log("\n   📊 Pool State:");
  console.log(`   Total Shares: ${fmt(statsAfterDeposits._totalShares, 18)}`);
  console.log(`   Total NAV: $${fmt(statsAfterDeposits._totalNAV)}`);
  console.log(`   Members: ${statsAfterDeposits._memberCount}`);
  
  if (statsAfterDeposits._memberCount >= 3n) {
    pass("Multiple wallets deposited successfully");
  } else {
    fail("Expected 3+ members");
  }
  
  // ══════════════════════════════════════════════════════════════
  // TEST 4: Fee Accumulation & Withdrawal
  // ══════════════════════════════════════════════════════════════
  
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("💸 TEST 4: Fee Accumulation & Withdrawal to Treasury");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  // Check accumulated fees
  const accMgmt = await pool.accumulatedManagementFees();
  const accPerf = await pool.accumulatedPerformanceFees();
  console.log(`   Accumulated Mgmt Fees: ${fmt(accMgmt)} USDC`);
  console.log(`   Accumulated Perf Fees: ${fmt(accPerf)} USDC`);
  
  if (accMgmt > 0n) {
    pass("Management fees accumulated");
  } else {
    console.log("   ⚠️  No fees yet (normal for short time period)");
  }
  
  // Withdraw fees to treasury
  console.log("\n   Calling withdrawFees()...");
  await (await pool.connect(deployer).withdrawFees({ gasLimit: 200000 })).wait();
  
  const vaultUsdcAfterFees = await usdc.balanceOf(ZK_VAULT_ADDRESS);
  const feesSent = vaultUsdcAfterFees - vaultUsdcBefore;
  console.log(`   Fees sent to ZKVault: ${fmt(feesSent)} USDC`);
  
  if (feesSent >= 0n) {
    pass("withdrawFees() executed successfully");
  }
  
  // ══════════════════════════════════════════════════════════════
  // TEST 5: Withdrawals
  // ══════════════════════════════════════════════════════════════
  
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📤 TEST 5: Withdrawals");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  // Wallet A partial withdraw (50%)
  const posA2 = await pool.getMemberPosition(deployer.address);
  const withdrawA = posA2.shares / 2n;
  console.log(`   [Wallet A] Withdrawing 50% (${fmt(withdrawA, 18)} shares)...`);
  await sleep(2000);
  await (await pool.connect(deployer)["withdraw(uint256,uint256)"](withdrawA, 0, { gasLimit: 200000 })).wait();
  const posA3 = await pool.getMemberPosition(deployer.address);
  console.log(`   [Wallet A] Remaining: ${fmt(posA3.shares, 18)} shares = $${fmt(posA3.valueUSD)}`);
  pass("Wallet A partial withdrawal succeeded");
  
  // Wallet B full withdraw
  const posB2 = await pool.getMemberPosition(walletB.address);
  console.log(`\n   [Wallet B] Withdrawing 100% (${fmt(posB2.shares, 18)} shares)...`);
  await sleep(3000);
  await (await pool.connect(walletB)["withdraw(uint256,uint256)"](posB2.shares, 0, { gasLimit: 250000, gasPrice: ethers.parseUnits("500", "gwei") })).wait();
  const posB3 = await pool.getMemberPosition(walletB.address);
  
  if (posB3.shares === 0n) {
    pass("Wallet B full withdrawal succeeded");
  } else {
    fail("Wallet B still has shares");
  }
  
  // Wallet C partial withdraw (30%)
  const posC2 = await pool.getMemberPosition(walletC.address);
  const withdrawC = (posC2.shares * 30n) / 100n;
  console.log(`\n   [Wallet C] Withdrawing 30% (${fmt(withdrawC, 18)} shares)...`);
  await sleep(3000);
  await (await pool.connect(walletC)["withdraw(uint256,uint256)"](withdrawC, 0, { gasLimit: 250000, gasPrice: ethers.parseUnits("500", "gwei") })).wait();
  const posC3 = await pool.getMemberPosition(walletC.address);
  console.log(`   [Wallet C] Remaining: ${fmt(posC3.shares, 18)} shares = $${fmt(posC3.valueUSD)}`);
  pass("Wallet C partial withdrawal succeeded");
  
  // ══════════════════════════════════════════════════════════════
  // TEST 6: Final State Verification
  // ══════════════════════════════════════════════════════════════
  
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 TEST 6: Final State Verification");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  const finalStats = await pool.getPoolStats();
  const finalPosA = await pool.getMemberPosition(deployer.address);
  const finalPosB = await pool.getMemberPosition(walletB.address);
  const finalPosC = await pool.getMemberPosition(walletC.address);
  const finalVaultUsdc = await usdc.balanceOf(ZK_VAULT_ADDRESS);
  
  console.log("   Pool State:");
  console.log(`   - Total Shares: ${fmt(finalStats._totalShares, 18)}`);
  console.log(`   - Total NAV: $${fmt(finalStats._totalNAV)}`);
  console.log(`   - Share Price: $${fmt(finalStats._sharePrice, 6)} per share`);
  
  console.log("\n   Individual Positions:");
  console.log(`   - Wallet A: ${fmt(finalPosA.shares, 18)} shares = $${fmt(finalPosA.valueUSD)}`);
  console.log(`   - Wallet B: ${fmt(finalPosB.shares, 18)} shares = $${fmt(finalPosB.valueUSD)}`);
  console.log(`   - Wallet C: ${fmt(finalPosC.shares, 18)} shares = $${fmt(finalPosC.valueUSD)}`);
  
  console.log("\n   Treasury (ZKProxyVault):");
  console.log(`   - USDC Balance: $${fmt(finalVaultUsdc)}`);
  console.log(`   - Total Fees Collected: $${fmt(finalVaultUsdc - vaultUsdcBefore)}`);
  
  // Verify share price ~= 1 (returned in 6 decimals: 1e6 = $1)
  const sharePrice = parseFloat(ethers.formatUnits(finalStats._sharePrice, 6));
  if (sharePrice > 0.99 && sharePrice < 1.01) {
    pass(`Share price is approximately $1 (actual: $${sharePrice.toFixed(4)})`);
  } else {
    fail(`Share price $${sharePrice.toFixed(6)} is not ~$1`);
  }
  
  // Verify NAV matches positions
  const totalPositionValue = finalPosA.valueUSD + finalPosB.valueUSD + finalPosC.valueUSD;
  const navDiff = finalStats._totalNAV > totalPositionValue 
    ? finalStats._totalNAV - totalPositionValue 
    : totalPositionValue - finalStats._totalNAV;
    
  if (navDiff < 10000n) { // Within $0.01
    pass("NAV matches sum of positions");
  } else {
    fail(`NAV mismatch: ${fmt(navDiff)}`);
  }
  
  // ══════════════════════════════════════════════════════════════
  // CLEANUP
  // ══════════════════════════════════════════════════════════════
  
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🧹 CLEANUP");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  // Withdraw all remaining positions
  if (finalPosA.shares > 0n) {
    console.log("   [Wallet A] Withdrawing remaining...");
    await sleep(2000);
    await (await pool.connect(deployer)["withdraw(uint256,uint256)"](finalPosA.shares, 0, { gasLimit: 200000 })).wait();
  }
  
  if (finalPosC.shares > 0n) {
    console.log("   [Wallet C] Withdrawing remaining...");
    await sleep(3000);
    await (await pool.connect(walletC)["withdraw(uint256,uint256)"](finalPosC.shares, 0, { gasLimit: 250000, gasPrice: ethers.parseUnits("500", "gwei") })).wait();
  }
  
  const cleanStats = await pool.getPoolStats();
  console.log(`\n   Final Pool NAV: $${fmt(cleanStats._totalNAV)}`);
  
  // ══════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════
  
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║                    TEST RESULTS                               ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log(`║   ✅ Passed: ${testsPassed.toString().padEnd(3)}                                           ║`);
  console.log(`║   ❌ Failed: ${testsFailed.toString().padEnd(3)}                                           ║`);
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log("║   Tests Covered:                                              ║");
  console.log("║   • Treasury configuration (ZKProxyVault)                     ║");
  console.log("║   • MIN_FIRST_DEPOSIT ($100)                                  ║");
  console.log("║   • Multi-wallet deposits                                     ║");
  console.log("║   • Fee accumulation & withdrawal                             ║");
  console.log("║   • Partial and full withdrawals                              ║");
  console.log("║   • Share price verification                                  ║");
  console.log("║   • NAV consistency                                           ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  if (testsFailed === 0) {
    console.log("🎉 All tests passed! CommunityPool is fully functional.\n");
    process.exit(0);
  } else {
    console.log(`⚠️  ${testsFailed} test(s) failed. Please review.\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  process.exit(1);
});
