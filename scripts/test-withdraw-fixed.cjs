const { ethers } = require("hardhat");

async function main() {
  const poolAddress = "0x2DCbd1EDaD4638e836E78E65A2831D077ce0eB72";
  const [signer] = await ethers.getSigners();
  
  const pool = await ethers.getContractAt("CommunityPool", poolAddress, signer);
  const usdc = await ethers.getContractAt("MockUSDC", await pool.depositToken(), signer);
  
  console.log("=== Test Withdraw (Within Limits) ===\n");
  
  const shares = await pool.balanceOf(signer.address);
  console.log("Current shares:", ethers.formatEther(shares));
  
  const usdcBefore = await usdc.balanceOf(signer.address);
  console.log("USDC before:", ethers.formatUnits(usdcBefore, 6));
  
  // Withdraw 20% (within 25% max single withdrawal limit)
  const sharesToWithdraw = shares / 5n;
  console.log("\nWithdrawing:", ethers.formatEther(sharesToWithdraw), "shares (20%)...");
  
  const tx = await pool.withdraw(sharesToWithdraw, 0n);
  const receipt = await tx.wait();
  console.log("✅ Withdraw successful! Gas:", receipt.gasUsed.toString());
  
  const usdcAfter = await usdc.balanceOf(signer.address);
  console.log("USDC after:", ethers.formatUnits(usdcAfter, 6));
  console.log("USDC received:", ethers.formatUnits(usdcAfter - usdcBefore, 6));
  
  const sharesAfter = await pool.balanceOf(signer.address);
  console.log("Shares remaining:", ethers.formatEther(sharesAfter));
  
  console.log("\n=== All Tests Passed ===");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error.message);
    process.exit(1);
  });
