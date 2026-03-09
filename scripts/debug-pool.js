const { ethers } = require("hardhat");

async function main() {
  const poolAddress = "0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B";
  const routerAddress = "0xaf1e47949eF0fb7E04c5c258C99BAE4660Bcc3d9";
  const pythAddress = "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320";
  
  const pool = await ethers.getContractAt("CommunityPool", poolAddress);
  const router = await ethers.getContractAt("MockDEXRouter", routerAddress);
  
  console.log("\n=== COMMUNITY POOL DEBUG ===\n");
  
  // Check balances
  const btcToken = await pool.assetTokens(0);
  const btc = await ethers.getContractAt("MockWrappedToken", btcToken);
  const btcBalance = await btc.balanceOf(poolAddress);
  console.log("Actual BTC token balance:", ethers.formatUnits(btcBalance, 8), "BTC");
  
  // Check internal assetBalances
  console.log("\nInternal assetBalances (stored in pool):");
  for (let i = 0; i < 4; i++) {
    const token = await pool.assetTokens(i);
    const t = await ethers.getContractAt("MockWrappedToken", token);
    const dec = await t.decimals();
    try {
      // Read assetBalances storage directly
      const slot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256"],
        [i, 164] // assetBalances slot
      ));
      const balance = await ethers.provider.getStorage(poolAddress, slot);
      console.log(`  [${i}]: stored=${balance}`);
    } catch (e) {
      console.log(`  [${i}]: error reading storage`);
    }
  }
  
  // Check Pyth prices used by pool
  console.log("\nPyth Price IDs in Pool:");
  for (let i = 0; i < 4; i++) {
    const priceId = await pool.pythPriceIds(i);
    console.log(`  [${i}]:`, priceId);
  }
  
  // Check mock router quote
  console.log("\nMock DEX Router Quote (1000 USDC -> BTC):");
  const usdc = await pool.depositToken();
  const path = [usdc, btcToken];
  try {
    const amounts = await router.getAmountsOut(1000_000000n, path);
    console.log("  Input:", ethers.formatUnits(amounts[0], 6), "USDC");
    console.log("  Output:", ethers.formatUnits(amounts[1], 8), "BTC");
    console.log("  Implied BTC price:", (1000 * 10**8 / Number(amounts[1])).toFixed(2), "USD");
  } catch(e) {
    console.log("  Error:", e.message.slice(0, 100));
  }
  
  // Check pool's NAV calculation
  console.log("\nPool NAV Breakdown:");
  const nav = await pool.calculateTotalNAV();
  const usdcAddr = "0x28217DAddC55e3C4831b4A48A00Ce04880786967";
  const usdcC = await ethers.getContractAt("MockUSDC", usdcAddr);
  const usdcBal = await usdcC.balanceOf(poolAddress);
  console.log("  USDC balance:", ethers.formatUnits(usdcBal, 6));
  console.log("  Total NAV:", ethers.formatUnits(nav, 6));
  console.log("  Implied asset value:", ethers.formatUnits(nav - usdcBal, 6));
  
  // Get pool's view of swap quote
  console.log("\nPool getSwapQuote (1000 USDC -> BTC):");
  try {
    const quote = await pool.getSwapQuote(0, 1000_000000n, true);
    console.log("  Expected BTC:", ethers.formatUnits(quote, 8));
    console.log("  Implied BTC price:", (1000 * 10**8 / Number(quote)).toFixed(2), "USD");
  } catch(e) {
    console.log("  Error:", e.message.slice(0, 100));
  }
}

main().catch(console.error);
