/**
 * Force deposit test on Arbitrum - bypass ERC20 checks
 */
const { ethers } = require("hardhat");

const POOL = "0xfd6B402b860aD57f1393E2b60E1D676b57e0E63B";
const USDC = "0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1";

async function main() {
  console.log("\n=== Quick Arbitrum Deposit Test ===\n");
  
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  
  // Get USDC
  const usdc = await ethers.getContractAt("MockUSDC", USDC);
  const usdcBal = await usdc.balanceOf(signer.address);
  console.log("USDC Balance:", ethers.formatUnits(usdcBal, 6));
  
  if (usdcBal < 100n * 10n**6n) {
    console.log("Minting test USDC...");
    try {
      const tx = await usdc.mint(signer.address, 1000n * 10n**6n);
      await tx.wait();
      console.log("✅ Minted");
    } catch (e) {
      console.log("Mint failed:", e.message.slice(0, 100));
    }
  }
  
  // Approve
  console.log("\nApproving...");
  const approveTx = await usdc.approve(POOL, ethers.MaxUint256);
  await approveTx.wait();
  console.log("✅ Approved");
  
  // Try deposit with minimal ABI
  const poolAbi = [
    "function deposit(uint256 amount, uint256 minShares) external",
    "function totalSupply() view returns (uint256)",
    "function totalDeposited() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)"
  ];
  const pool = new ethers.Contract(POOL, poolAbi, signer);
  
  console.log("\nDepositing 100 USDC...");
  try {
    const tx = await pool.deposit(100n * 10n**6n, 0n);
    console.log("TX:", tx.hash);
    const receipt = await tx.wait();
    console.log("Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED");
    console.log("Gas:", receipt.gasUsed.toString());
    
    // Check results
    try {
      const shares = await pool.balanceOf(signer.address);
      console.log("Share balance:", ethers.formatEther(shares));
    } catch (e) {
      console.log("balanceOf failed:", e.message.slice(0, 80));
    }
    
    try {
      const supply = await pool.totalSupply();
      console.log("Total supply:", ethers.formatEther(supply));
    } catch (e) {
      console.log("totalSupply failed:", e.message.slice(0, 80));
    }
    
  } catch (error) {
    console.log("❌ Deposit failed:", error.message.slice(0, 200));
    
    // Try to decode error
    if (error.data) {
      console.log("Error data:", error.data);
    }
  }
  
  console.log("\n=== Done ===\n");
}

main().catch(console.error);
