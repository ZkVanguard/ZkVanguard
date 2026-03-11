/**
 * Simulate Auto-Hedging on Testnet
 * Tests the complete hedge flow via MockMoonlander
 */
const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const deployment = JSON.parse(fs.readFileSync("./deployments/cronos-testnet.json"));
  const [signer] = await ethers.getSigners();
  
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          AUTO-HEDGING SIMULATION TEST                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  
  console.log("Signer:", signer.address);
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("CRO Balance:", ethers.formatEther(balance), "CRO\n");

  // Contract addresses
  const HEDGE_EXECUTOR = deployment.HedgeExecutorV2 || deployment.HedgeExecutor;
  const MOCK_MOONLANDER = deployment.MockMoonlander;
  const MOCK_USDC = deployment.MockUSDC;

  console.log("=== Contract Addresses ===");
  console.log("HedgeExecutor:", HEDGE_EXECUTOR);
  console.log("MockMoonlander:", MOCK_MOONLANDER);
  console.log("MockUSDC:", MOCK_USDC);

  // Get contract instances - use V1 ABI (7 params) since that's what's deployed
  const hedgeExecutor = await ethers.getContractAt("HedgeExecutor", HEDGE_EXECUTOR);
  const mockUsdc = await ethers.getContractAt("MockUSDC", MOCK_USDC);
  const mockMoonlander = await ethers.getContractAt("MockMoonlander", MOCK_MOONLANDER);

  // Check configuration
  console.log("\n=== Pre-Flight Checks ===");
  const router = await hedgeExecutor.moonlanderRouter();
  const collateral = await hedgeExecutor.collateralToken();
  const paused = await hedgeExecutor.paused();
  
  console.log("Router set correctly:", router.toLowerCase() === MOCK_MOONLANDER.toLowerCase() ? "✅" : "❌");
  console.log("Collateral correct:", collateral.toLowerCase() === MOCK_USDC.toLowerCase() ? "✅" : "❌");
  console.log("Contract active:", !paused ? "✅" : "❌ (PAUSED)");

  if (paused) {
    console.log("\n⚠️  Contract is paused, cannot proceed");
    return;
  }

  // Check signer's USDC balance
  let signerUsdcBalance = await mockUsdc.balanceOf(signer.address);
  console.log("\nSigner USDC balance:", ethers.formatUnits(signerUsdcBalance, 6), "USDC");

  // Mint USDC if needed
  const requiredUsdc = ethers.parseUnits("1000", 6); // 1000 USDC for test
  if (signerUsdcBalance < requiredUsdc) {
    console.log("\n📦 Minting test USDC...");
    const mintTx = await mockUsdc.mint(signer.address, ethers.parseUnits("10000", 6));
    await mintTx.wait();
    signerUsdcBalance = await mockUsdc.balanceOf(signer.address);
    console.log("New USDC balance:", ethers.formatUnits(signerUsdcBalance, 6), "USDC ✅");
  }

  // Approve HedgeExecutor
  console.log("\n📝 Approving HedgeExecutor for USDC...");
  const allowance = await mockUsdc.allowance(signer.address, HEDGE_EXECUTOR);
  if (allowance < requiredUsdc) {
    const approveTx = await mockUsdc.approve(HEDGE_EXECUTOR, ethers.MaxUint256);
    await approveTx.wait();
    console.log("Approval granted ✅");
  } else {
    console.log("Already approved ✅");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMULATE AUTO-HEDGE: Open a BTC SHORT position
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║          OPENING AUTO-HEDGE POSITION                         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Hedge parameters (simulating AI decision)
  const pairIndex = 0; // BTC-USD
  const collateralAmount = ethers.parseUnits("100", 6); // 100 USDC
  const leverage = 5;
  const isLong = false; // SHORT (hedging against downside)
  
  // Generate commitment hash (ZK privacy layer)
  const commitmentHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bool", "uint256", "uint256"],
      [pairIndex, isLong, collateralAmount, Date.now()]
    )
  );
  const nullifier = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256"],
      [commitmentHash, Date.now()]
    )
  );

  console.log("Hedge Parameters:");
  console.log("  Asset: BTC-USD");
  console.log("  Side: SHORT (hedging downside)");
  console.log("  Collateral: 100 USDC");
  console.log("  Leverage: 5x");
  console.log("  Notional: $500");

  // Get stats before
  const openedBefore = await hedgeExecutor.totalHedgesOpened();
  console.log("\nTotal hedges before:", openedBefore.toString());

  // V1 uses merkleRoot instead of openPrice/tp/sl/pythUpdateData
  const merkleRoot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentHash])
  );

  // MockMoonlander requires oracle fee (0.06 CRO)
  const oracleFee = ethers.parseEther("0.06");
  console.log("Oracle fee:", ethers.formatEther(oracleFee), "CRO");

  // Open hedge - V1 signature (7 params)
  console.log("\n🚀 Executing on-chain hedge via MockMoonlander...");
  try {
    const tx = await hedgeExecutor.openHedge(
      pairIndex,
      collateralAmount,
      leverage,
      isLong,
      commitmentHash,
      nullifier,
      merkleRoot,
      { gasLimit: 800000, value: oracleFee }
    );
    
    console.log("TX Hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("Block:", receipt.blockNumber);
    console.log("Gas Used:", receipt.gasUsed.toString());

    // Parse HedgeOpened event
    let hedgeId;
    for (const log of receipt.logs) {
      try {
        const parsed = hedgeExecutor.interface.parseLog(log);
        if (parsed && parsed.name === "HedgeOpened") {
          hedgeId = parsed.args.hedgeId;
          console.log("\n✅ HEDGE OPENED SUCCESSFULLY!");
          console.log("  Hedge ID:", hedgeId);
          console.log("  Open Price:", ethers.formatUnits(parsed.args.openPrice, 8), "USD");
          break;
        }
      } catch (e) { /* ignore non-matching logs */ }
    }

    // Verify on-chain state
    const openedAfter = await hedgeExecutor.totalHedgesOpened();
    console.log("\nTotal hedges after:", openedAfter.toString());
    console.log("New hedges created:", (openedAfter - openedBefore).toString());

    // Get hedge details
    if (hedgeId) {
      const hedge = await hedgeExecutor.hedges(hedgeId);
      console.log("\n=== Hedge Position Details ===");
      console.log("  User:", hedge.user);
      console.log("  Pair Index:", hedge.pairIndex.toString());
      console.log("  Is Long:", hedge.isLong);
      console.log("  Collateral:", ethers.formatUnits(hedge.collateral, 6), "USDC");
      console.log("  Leverage:", hedge.leverage.toString(), "x");
      console.log("  Open Price:", ethers.formatUnits(hedge.openPrice, 8), "USD");
      console.log("  Active:", hedge.isActive);

      // ═══════════════════════════════════════════════════════════════════════════
      // SIMULATE CLOSE HEDGE
      // ═══════════════════════════════════════════════════════════════════════════
      console.log("\n╔══════════════════════════════════════════════════════════════╗");
      console.log("║          CLOSING HEDGE POSITION                              ║");
      console.log("╚══════════════════════════════════════════════════════════════╝\n");

      console.log("🔄 Closing hedge to simulate full cycle...");
      const closeTx = await hedgeExecutor.closeHedge(hedgeId, { gasLimit: 500000 });
      console.log("Close TX:", closeTx.hash);
      const closeReceipt = await closeTx.wait();

      // Parse HedgeClosed event
      for (const log of closeReceipt.logs) {
        try {
          const parsed = hedgeExecutor.interface.parseLog(log);
          if (parsed && parsed.name === "HedgeClosed") {
            console.log("\n✅ HEDGE CLOSED SUCCESSFULLY!");
            console.log("  Close Price:", ethers.formatUnits(parsed.args.closePrice, 8), "USD");
            console.log("  PnL:", ethers.formatUnits(parsed.args.pnl, 6), "USDC");
            break;
          }
        } catch (e) { /* ignore */ }
      }

      // Final stats
      const closedAfter = await hedgeExecutor.totalHedgesClosed();
      console.log("\n=== Final Statistics ===");
      console.log("Total Hedges Opened:", (await hedgeExecutor.totalHedgesOpened()).toString());
      console.log("Total Hedges Closed:", closedAfter.toString());
    }

    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║  ✅ AUTO-HEDGING SIMULATION COMPLETE - SYSTEM WORKS!         ║");
    console.log("╚══════════════════════════════════════════════════════════════╝\n");

  } catch (error) {
    console.error("\n❌ Hedge execution failed:", error.message);
    if (error.data) {
      try {
        const decoded = hedgeExecutor.interface.parseError(error.data);
        console.error("Contract error:", decoded);
      } catch (e) {
        console.error("Raw error data:", error.data);
      }
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
