/**
 * Clean up CommunityPool - withdraw all shares
 * 
 * Usage:
 *   npx hardhat run scripts/utils/cleanup-pool.js --network cronos-testnet
 */

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  const POOL = "0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B"; // V2
  
  const pool = await ethers.getContractAt("CommunityPool", POOL);
  
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║           Cleanup CommunityPool                               ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  // Check current state
  const statsBefore = await pool.getPoolStats();
  console.log("📊 Before Cleanup:");
  console.log("   Total Shares:", ethers.formatUnits(statsBefore._totalShares, 18));
  console.log("   Total NAV:", ethers.formatUnits(statsBefore._totalNAV, 6), "USD");
  console.log("   Members:", statsBefore._memberCount.toString());
  
  // Get deployer's position
  const myPos = await pool.getMemberPosition(deployer.address);
  console.log("\n📍 Your Position:");
  console.log("   Shares:", ethers.formatUnits(myPos.shares, 18));
  console.log("   Value:", ethers.formatUnits(myPos.valueUSD, 6), "USD");
  
  if (myPos.shares === 0n) {
    console.log("\n✅ You have no shares to withdraw.");
    return;
  }
  
  // Withdraw all shares
  console.log("\n🧹 Withdrawing all your shares...");
  const tx = await pool.connect(deployer)["withdraw(uint256,uint256)"](myPos.shares, 0, { gasLimit: 300000 });
  console.log("   Tx:", tx.hash);
  await tx.wait();
  console.log("   ✅ Withdrawal complete!");
  
  // Check final state
  const statsAfter = await pool.getPoolStats();
  console.log("\n📊 After Cleanup:");
  console.log("   Total Shares:", ethers.formatUnits(statsAfter._totalShares, 18));
  console.log("   Total NAV:", ethers.formatUnits(statsAfter._totalNAV, 6), "USD");
  console.log("   Members:", statsAfter._memberCount.toString());
  
  if (statsAfter._totalShares === 0n) {
    console.log("\n🎉 Pool is now EMPTY!");
    console.log("   Next deposit will require $100 minimum (first deposit rule).");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
