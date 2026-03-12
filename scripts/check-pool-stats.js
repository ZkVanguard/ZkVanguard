const { ethers } = require("hardhat");

async function main() {
  const pool = await ethers.getContractAt(
    "CommunityPool", 
    "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30"
  );
  
  console.log("\n=== COMMUNITY POOL STATUS ===\n");
  
  // Get pool stats
  const stats = await pool.getPoolStats();
  console.log("Total Shares:", ethers.formatUnits(stats._totalShares, 18));
  console.log("Total NAV:", ethers.formatUnits(stats._totalNAV, 6), "USDC");
  console.log("Share Price:", ethers.formatUnits(stats._sharePrice, 6), "$/share");
  console.log("Member Count:", stats._memberCount.toString());
  
  // Check DEX router
  const dexRouter = await pool.dexRouter();
  console.log("\nDEX Router:", dexRouter);
  
  // Check asset tokens
  console.log("\nAsset Tokens:");
  for (let i = 0; i < 4; i++) {
    try {
      const token = await pool.assetTokens(i);
      console.log(`  [${i}]:`, token);
    } catch (e) {
      console.log(`  [${i}]: ERROR -`, e.message.slice(0, 50));
    }
  }
  
  // Check USDC balance using MockUSDC
  const usdc = await ethers.getContractAt("MockUSDC", "0x28217DAddC55e3C4831b4A48A00Ce04880786967");
  const usdcBalance = await usdc.balanceOf(pool.target);
  console.log("\nPool USDC Balance:", ethers.formatUnits(usdcBalance, 6), "USDC");
}

main().catch(console.error);
