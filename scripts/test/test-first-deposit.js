/**
 * Simple test to verify MIN_FIRST_DEPOSIT enforcement
 */

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  const POOL_ADDRESS = "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30";
  const USDC_ADDRESS = "0x28217DAddC55e3C4831b4A48A00Ce04880786967";
  
  const pool = await ethers.getContractAt("CommunityPool", POOL_ADDRESS);
  const usdc = await ethers.getContractAt("MockUSDC", USDC_ADDRESS);
  
  console.log("\n=== First Deposit Check Test ===\n");
  
  // Check current state
  const totalShares = await pool.totalShares();
  const minFirst = await pool.MIN_FIRST_DEPOSIT();
  const minDeposit = await pool.MIN_DEPOSIT();
  
  console.log("Pool State:");
  console.log("  totalShares:", totalShares.toString());
  console.log("  MIN_FIRST_DEPOSIT:", ethers.formatUnits(minFirst, 6), "USDC");
  console.log("  MIN_DEPOSIT:", ethers.formatUnits(minDeposit, 6), "USDC");
  
  console.log("\n--- Testing deposit logic ---\n");
  
  // Ensure we have USDC and approval
  const balance = await usdc.balanceOf(deployer.address);
  console.log("Deployer USDC balance:", ethers.formatUnits(balance, 6));
  
  if (balance < ethers.parseUnits("200", 6)) {
    console.log("Minting more USDC...");
    await (await usdc.mint(deployer.address, ethers.parseUnits("1000", 6))).wait();
  }
  
  const allowance = await usdc.allowance(deployer.address, POOL_ADDRESS);
  if (allowance < ethers.parseUnits("200", 6)) {
    console.log("Approving pool...");
    await (await usdc.approve(POOL_ADDRESS, ethers.MaxUint256)).wait();
  }
  
  if (totalShares === 0n) {
    console.log("\nPool is EMPTY - testing first deposit minimum...\n");
    
    // Test 1: $50 deposit (should fail)
    console.log("Attempting $50 deposit (expect: FAIL)...");
    try {
      const tx = await pool.deposit(ethers.parseUnits("50", 6), { gasLimit: 300000 });
      await tx.wait();
      console.log("  ❌ UNEXPECTED: $50 deposit SUCCEEDED");
    } catch (e) {
      if (e.message.includes("FirstDepositTooSmall") || e.data?.includes("0x97744197")) {
        console.log("  ✅ EXPECTED: $50 deposit correctly rejected (FirstDepositTooSmall)");
      } else {
        console.log("  ⚠️ Failed with other error:", e.reason || e.message);
      }
    }
    
    // Test 2: $100 deposit (should succeed)
    console.log("\nAttempting $100 deposit (expect: SUCCESS)...");
    try {
      const tx = await pool.deposit(ethers.parseUnits("100", 6), { gasLimit: 300000 });
      const receipt = await tx.wait();
      const newShares = await pool.totalShares();
      console.log("  ✅ $100 deposit succeeded. New totalShares:", ethers.formatUnits(newShares, 18));
    } catch (e) {
      console.log("  ❌ UNEXPECTED: $100 deposit failed:", e.reason || e.message);
    }
    
  } else {
    console.log("\nPool has existing shares - testing subsequent deposit minimum...\n");
    console.log("Existing totalShares:", ethers.formatUnits(totalShares, 18));
    
    // For subsequent deposits, MIN_DEPOSIT = $10
    // Test $5 (should fail) and $15 (should succeed)
    
    console.log("\nAttempting $5 deposit (expect: FAIL - below $10 minimum)...");
    try {
      const tx = await pool.deposit(ethers.parseUnits("5", 6), { gasLimit: 300000 });
      await tx.wait();
      console.log("  ❌ UNEXPECTED: $5 deposit SUCCEEDED");
    } catch (e) {
      if (e.message.includes("DepositTooSmall")) {
        console.log("  ✅ EXPECTED: $5 deposit correctly rejected (DepositTooSmall)");
      } else {
        console.log("  ⚠️ Failed with:", e.reason || e.message);
      }
    }
    
    console.log("\nAttempting $15 deposit (expect: SUCCESS)...");
    try {
      const tx = await pool.deposit(ethers.parseUnits("15", 6), { gasLimit: 300000 });
      await tx.wait();
      const newShares = await pool.totalShares();
      console.log("  ✅ $15 deposit succeeded. New totalShares:", ethers.formatUnits(newShares, 18));
    } catch (e) {
      console.log("  ❌ UNEXPECTED: $15 deposit failed:", e.reason || e.message);
    }
  }
  
  console.log("\n=== Test Complete ===\n");
}

main().catch(console.error);
