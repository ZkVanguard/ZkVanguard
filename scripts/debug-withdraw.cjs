const { ethers } = require("hardhat");

async function main() {
  const poolAddress = "0x2DCbd1EDaD4638e836E78E65A2831D077ce0eB72";
  const [signer] = await ethers.getSigners();
  
  const pool = await ethers.getContractAt("CommunityPool", poolAddress, signer);
  
  console.log("=== Debug Withdraw Issue ===\n");
  
  // Check basic state
  console.log("1. Basic State:");
  const shares = await pool.balanceOf(signer.address);
  console.log("   User shares:", ethers.formatEther(shares));
  const totalShares = await pool.totalSupply();
  console.log("   Total shares:", ethers.formatEther(totalShares));
  
  // Check circuit breaker
  console.log("\n2. Circuit Breaker:");
  const circuitBreaker = await pool.circuitBreakerTripped();
  console.log("   Circuit breaker tripped:", circuitBreaker);
  const emergencyEnabled = await pool.emergencyWithdrawEnabled();
  console.log("   Emergency withdraw enabled:", emergencyEnabled);
  
  // Check withdrawal limits
  console.log("\n3. Withdrawal Limits:");
  const maxSingle = await pool.maxSingleWithdrawalBps();
  console.log("   Max single withdrawal (bps):", maxSingle);
  const dailyCap = await pool.dailyWithdrawalCapBps();
  console.log("   Daily withdrawal cap (bps):", dailyCap);
  
  // Check NAV
  console.log("\n4. NAV Calculation:");
  try {
    const nav = await pool.calculateTotalNAV();
    console.log("   Total NAV:", ethers.formatUnits(nav, 6), "USDC");
  } catch (e) {
    console.log("   ERROR calculating NAV:", e.message);
  }
  
  // Check deposit token balance
  console.log("\n5. Contract Balances:");
  const depositToken = await pool.depositToken();
  const usdc = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", depositToken);
  const poolUsdcBal = await usdc.balanceOf(poolAddress);
  console.log("   Pool USDC balance:", ethers.formatUnits(poolUsdcBal, 6));
  
  // Check asset balances
  console.log("\n6. Asset Balances:");
  for (let i = 0; i < 4; i++) {
    const balance = await pool.assetBalances(i);
    console.log(`   Asset ${i}:`, balance.toString());
  }
  
  // Check Pyth price IDs
  console.log("\n7. Pyth Price IDs:");
  for (let i = 0; i < 4; i++) {
    const priceId = await pool.pythPriceIds(i);
    console.log(`   Asset ${i}:`, priceId);
  }
  
  // Get paused state
  console.log("\n8. Contract State:");
  const paused = await pool.paused();
  console.log("   Paused:", paused);
  
  // Try to estimate gas for withdraw to get the error
  console.log("\n9. Simulating Withdraw:");
  // Max single withdrawal is 25% (2500 bps), so withdraw 20% to be safe
  const sharesToWithdraw = shares / 5n;  // 20% = within max limit
  console.log("   Attempting to withdraw:", ethers.formatEther(sharesToWithdraw), "shares (20%)");
  
  try {
    const gasEstimate = await pool.withdraw.estimateGas(sharesToWithdraw, 0n);
    console.log("   Gas estimate:", gasEstimate.toString());
  } catch (e) {
    console.log("   REVERT REASON:", e.message);
    
    // Try to decode custom error
    if (e.data) {
      console.log("   Error data:", e.data);
    }
  }
  
  // Try static call
  console.log("\n10. Static Call Test:");
  try {
    const result = await pool.withdraw.staticCall(sharesToWithdraw, 0n);
    console.log("   Static call result:", result.toString());
  } catch (e) {
    console.log("   Static call error:", e.message);
    if (e.reason) {
      console.log("   Reason:", e.reason);
    }
    if (e.revert) {
      console.log("   Revert:", e.revert);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
