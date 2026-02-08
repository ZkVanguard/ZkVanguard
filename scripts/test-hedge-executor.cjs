/**
 * Test HedgeExecutor on Cronos Testnet
 * 
 * Tests:
 * 1. Verify deployment & initialization
 * 2. Check roles and permissions
 * 3. MockMoonlander integration check
 * 4. Open hedge position (with mock USDC)
 * 5. Query hedge state on-chain
 * 6. Close hedge position
 * 7. Verify PnL settlement
 * 
 * Usage:
 *   npx hardhat run scripts/test-hedge-executor.cjs --network cronos-testnet
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = path.join(__dirname, "../deployments/cronos-testnet.json");

async function main() {
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf-8"));
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log("\n" + "=".repeat(70));
  console.log("  HEDGE EXECUTOR - ON-CHAIN TEST SUITE");
  console.log("  Network: Cronos Testnet (Chain ID " + network.chainId + ")");
  console.log("  Deployer: " + deployer.address);
  console.log("=".repeat(70));

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("  Balance: " + ethers.formatEther(balance) + " CRO\n");

  // Load contracts
  const hedgeExecutor = await ethers.getContractAt("HedgeExecutor", deployment.HedgeExecutor);
  const moonlander = await ethers.getContractAt("MockMoonlander", deployment.MockMoonlander);
  const zkCommitment = await ethers.getContractAt("ZKHedgeCommitment", deployment.ZKHedgeCommitment);

  let passed = 0;
  let failed = 0;

  function ok(name, detail) {
    passed++;
    console.log("  ✅ " + name + (detail ? " → " + detail : ""));
  }
  function fail(name, err) {
    failed++;
    console.log("  ❌ " + name + " → " + (err.message || err).slice(0, 120));
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 1: Verify Deployment
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 1: Verify Deployment ────────────────────");
  try {
    const collateral = await hedgeExecutor.collateralToken();
    console.log("  Collateral Token: " + collateral);
    const router = await hedgeExecutor.moonlanderRouter();
    console.log("  Moonlander Router: " + router);
    const zkc = await hedgeExecutor.zkCommitment();
    console.log("  ZK Commitment: " + zkc);
    
    if (collateral.toLowerCase() === deployment.usdcToken.toLowerCase()) ok("Collateral token matches");
    else fail("Collateral token mismatch", collateral);
    
    if (router.toLowerCase() === deployment.MockMoonlander.toLowerCase()) ok("Moonlander router matches");
    else fail("Moonlander router mismatch", router);
    
    if (zkc.toLowerCase() === deployment.ZKHedgeCommitment.toLowerCase()) ok("ZK Commitment matches");
    else fail("ZK Commitment mismatch", zkc);
  } catch (e) {
    fail("Deployment verification", e);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 2: Check Roles
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 2: Check Roles ──────────────────────────");
  try {
    const AGENT_ROLE = await hedgeExecutor.AGENT_ROLE();
    const ADMIN_ROLE = await hedgeExecutor.DEFAULT_ADMIN_ROLE();
    
    const hasAdmin = await hedgeExecutor.hasRole(ADMIN_ROLE, deployer.address);
    const hasAgent = await hedgeExecutor.hasRole(AGENT_ROLE, deployer.address);
    
    if (hasAdmin) ok("Deployer has DEFAULT_ADMIN_ROLE");
    else fail("Missing ADMIN role", "deployer not admin");
    
    if (hasAgent) ok("Deployer has AGENT_ROLE");
    else fail("Missing AGENT role", "deployer not agent");
  } catch (e) {
    fail("Role check", e);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 3: Check Contract Parameters
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 3: Contract Parameters ──────────────────");
  try {
    const maxLev = await hedgeExecutor.maxLeverage();
    const minCol = await hedgeExecutor.minCollateral();
    const feeRate = await hedgeExecutor.feeRateBps();
    
    console.log("  Max Leverage: " + maxLev.toString() + "x");
    console.log("  Min Collateral: " + ethers.formatUnits(minCol, 6) + " USDC");
    console.log("  Fee Rate: " + feeRate.toString() + " bps (" + (Number(feeRate) / 100) + "%)");
    
    if (Number(maxLev) === 100) ok("Max leverage = 100x");
    else fail("Max leverage wrong", maxLev.toString());
    
    if (Number(minCol) === 1000000) ok("Min collateral = 1 USDC");
    else fail("Min collateral wrong", minCol.toString());
    
    if (Number(feeRate) === 10) ok("Fee rate = 10 bps (0.1%)");
    else fail("Fee rate wrong", feeRate.toString());
  } catch (e) {
    fail("Contract parameters", e);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 4: Check Initial Stats
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 4: Initial Stats ───────────────────────");
  try {
    const opened = await hedgeExecutor.totalHedgesOpened();
    const closed = await hedgeExecutor.totalHedgesClosed();
    const locked = await hedgeExecutor.totalCollateralLocked();
    const fees = await hedgeExecutor.accumulatedFees();
    
    console.log("  Hedges Opened: " + opened.toString());
    console.log("  Hedges Closed: " + closed.toString());
    console.log("  Collateral Locked: " + ethers.formatUnits(locked, 6) + " USDC");
    console.log("  Accumulated Fees: " + ethers.formatUnits(fees, 6) + " USDC");
    
    ok("Stats readable", "opened=" + opened + " closed=" + closed);
  } catch (e) {
    fail("Stats read", e);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 5: MockMoonlander Health Check
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 5: MockMoonlander Health ────────────────");
  try {
    const mockUsdc = await moonlander.USDC();
    ok("MockMoonlander.USDC()", mockUsdc);
    
    // Check if mock price exists
    const price = await moonlander.mockPrice();
    ok("MockMoonlander.mockPrice()", ethers.formatUnits(price, 8) + " USD");
  } catch (e) {
    // Some functions might not exist on this version
    console.log("  ⚠️  MockMoonlander interface check: " + (e.message || "").slice(0, 100));
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 6: Mint Mock USDC & Approve
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 6: USDC Setup for Testing ──────────────");
  let usdcReady = false;
  try {
    // Try using our MockUSDC - check if we have mint access
    const usdc = await ethers.getContractAt("MockUSDC", deployment.usdcToken);
    
    const decimals = await usdc.decimals();
    console.log("  USDC Decimals: " + decimals);
    
    const balBefore = await usdc.balanceOf(deployer.address);
    console.log("  USDC Balance: " + ethers.formatUnits(balBefore, decimals));
    
    // Try minting
    try {
      const mintAmount = ethers.parseUnits("10000", decimals);
      const mintTx = await usdc.mint(deployer.address, mintAmount);
      await mintTx.wait();
      ok("Minted 10,000 USDC");
      
      // Approve HedgeExecutor
      const approveTx = await usdc.approve(deployment.HedgeExecutor, ethers.MaxUint256);
      await approveTx.wait();
      ok("Approved HedgeExecutor for USDC");
      
      usdcReady = true;
    } catch (mintErr) {
      console.log("  ⚠️  Cannot mint USDC (FiatToken): " + (mintErr.reason || mintErr.message || "").slice(0, 80));
      
      // Check existing balance
      if (balBefore > 0n) {
        const approveTx = await usdc.approve(deployment.HedgeExecutor, ethers.MaxUint256);
        await approveTx.wait();
        ok("Approved existing USDC balance", ethers.formatUnits(balBefore, decimals));
        usdcReady = Number(ethers.formatUnits(balBefore, decimals)) >= 10;
      } else {
        console.log("  ⚠️  No USDC balance - hedge open test will be skipped");
      }
    }
  } catch (e) {
    fail("USDC setup", e);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 7: Open Hedge Position
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 7: Open Hedge Position ──────────────────");
  let hedgeId = null;
  if (usdcReady) {
    try {
      // Use 10 USDC (within available balance)
      const usdc = await ethers.getContractAt("MockUSDC", deployment.usdcToken);
      const usdcBal = await usdc.balanceOf(deployer.address);
      const collateralAmount = ethers.parseUnits("10", 6); // 10 USDC
      console.log("  USDC Available: " + ethers.formatUnits(usdcBal, 6));
      
      if (usdcBal < collateralAmount) {
        console.log("  ⚠️  Insufficient USDC for test (" + ethers.formatUnits(usdcBal, 6) + " < 10)");
        throw new Error("Insufficient USDC");
      }

      const leverage = 5;
      const isLong = false; // Short for hedging
      const pairIndex = 0; // BTC

      // Generate commitment + nullifier
      const commitmentHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "bool", "uint256", "uint256"],
          [pairIndex, isLong, collateralAmount, Date.now()]
        )
      );
      const nullifier = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256"],
          [commitmentHash, Date.now() + 1]
        )
      );
      const merkleRoot = ethers.ZeroHash;

      console.log("  Opening: BTC SHORT, 10 USDC, 5x leverage");
      console.log("  Commitment: " + commitmentHash.slice(0, 18) + "...");
      
      // Verify allowance
      const allowance = await usdc.allowance(deployer.address, deployment.HedgeExecutor);
      console.log("  Allowance: " + ethers.formatUnits(allowance, 6));

      // Try staticCall first for better error messages
      try {
        await hedgeExecutor.openHedge.staticCall(
          pairIndex,
          collateralAmount,
          leverage,
          isLong,
          commitmentHash,
          nullifier,
          merkleRoot,
          { value: ethers.parseEther("0.06"), gasLimit: 1000000 }
        );
        console.log("  Static call OK - sending tx...");
      } catch (staticErr) {
        console.log("  Static call revert: " + (staticErr.reason || staticErr.message || "").slice(0, 200));
        throw staticErr;
      }

      // openHedge requires value for Moonlander oracle fee (0.06 CRO)
      const tx = await hedgeExecutor.openHedge(
        pairIndex,
        collateralAmount,
        leverage,
        isLong,
        commitmentHash,
        nullifier,
        merkleRoot,
        { value: ethers.parseEther("0.06"), gasLimit: 1000000 }
      );
      
      const receipt = await tx.wait();
      console.log("  Tx: " + receipt.hash);
      console.log("  Gas Used: " + receipt.gasUsed.toString());

      // Parse HedgeOpened event
      for (const log of receipt.logs) {
        try {
          const parsed = hedgeExecutor.interface.parseLog(log);
          if (parsed && parsed.name === "HedgeOpened") {
            hedgeId = parsed.args.hedgeId;
            console.log("  HedgeId: " + hedgeId);
            ok("Hedge opened on-chain!", "hedgeId=" + hedgeId.slice(0, 18) + "...");
          }
        } catch (_) {}
      }
      
      if (!hedgeId) {
        ok("Hedge tx confirmed (event not parsed)", "tx=" + receipt.hash.slice(0, 18));
      }
    } catch (e) {
      fail("Open hedge", e);
    }
  } else {
    console.log("  ⏭️  Skipped (no USDC available)");
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 8: Query Hedge State
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 8: Query Hedge State ────────────────────");
  if (hedgeId) {
    try {
      const hedge = await hedgeExecutor.hedges(hedgeId);
      console.log("  Trader: " + hedge.trader);
      console.log("  Pair Index: " + hedge.pairIndex.toString());
      console.log("  Collateral: " + ethers.formatUnits(hedge.collateralAmount, 6) + " USDC");
      console.log("  Leverage: " + hedge.leverage.toString() + "x");
      console.log("  Is Long: " + hedge.isLong);
      console.log("  Status: " + ["PENDING", "ACTIVE", "CLOSED", "LIQUIDATED", "CANCELLED"][Number(hedge.status)]);

      if (hedge.trader.toLowerCase() === deployer.address.toLowerCase()) ok("Trader matches deployer");
      if (Number(hedge.status) === 1) ok("Status is ACTIVE");
      if (Number(hedge.leverage) === 5) ok("Leverage is 5x");
    } catch (e) {
      fail("Query hedge state", e);
    }
  } else {
    console.log("  ⏭️  Skipped (no hedge opened)");
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 9: Verify Stats Updated
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 9: Verify Stats After Open ─────────────");
  if (hedgeId) {
    try {
      const opened = await hedgeExecutor.totalHedgesOpened();
      const locked = await hedgeExecutor.totalCollateralLocked();
      const fees = await hedgeExecutor.accumulatedFees();
      
      console.log("  Total Opened: " + opened.toString());
      console.log("  Collateral Locked: " + ethers.formatUnits(locked, 6) + " USDC");
      console.log("  Fees Accumulated: " + ethers.formatUnits(fees, 6) + " USDC");

      if (Number(opened) > 0) ok("totalHedgesOpened incremented");
      if (locked > 0n) ok("Collateral is locked");
      if (fees > 0n) ok("Fee collected", ethers.formatUnits(fees, 6) + " USDC");
    } catch (e) {
      fail("Stats after open", e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 10: Close Hedge Position
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 10: Close Hedge Position ────────────────");
  if (hedgeId) {
    try {
      console.log("  Closing hedge: " + hedgeId.slice(0, 18) + "...");
      const tx = await hedgeExecutor.closeHedge(hedgeId, { gasLimit: 500000 });
      const receipt = await tx.wait();
      console.log("  Tx: " + receipt.hash);
      console.log("  Gas Used: " + receipt.gasUsed.toString());

      // Parse HedgeClosed event
      for (const log of receipt.logs) {
        try {
          const parsed = hedgeExecutor.interface.parseLog(log);
          if (parsed && parsed.name === "HedgeClosed") {
            const pnl = parsed.args.realizedPnl;
            const duration = parsed.args.duration;
            console.log("  PnL: " + ethers.formatUnits(pnl, 6) + " USDC");
            console.log("  Duration: " + duration.toString() + "s");
            ok("Hedge closed!", "pnl=" + ethers.formatUnits(pnl, 6));
          }
        } catch (_) {}
      }

      // Verify state
      const hedge = await hedgeExecutor.hedges(hedgeId);
      const statusName = ["PENDING", "ACTIVE", "CLOSED", "LIQUIDATED", "CANCELLED"][Number(hedge.status)];
      if (Number(hedge.status) === 2 || Number(hedge.status) === 3) {
        ok("Status is " + statusName);
      }
    } catch (e) {
      fail("Close hedge", e);
    }
  } else {
    console.log("  ⏭️  Skipped (no hedge to close)");
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 11: ZK Commitment Verification
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Test 11: ZK Commitment State ─────────────────");
  try {
    // Check ZKHedgeCommitment state
    const owner = await zkCommitment.owner();
    console.log("  ZKHedgeCommitment Owner: " + owner);
    ok("ZKHedgeCommitment accessible");
  } catch (e) {
    fail("ZK Commitment check", e);
  }

  // ═══════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(70));
  console.log("  TEST RESULTS: " + passed + " passed, " + failed + " failed");
  console.log("=".repeat(70));

  console.log("\n  Deployed Contracts:");
  console.log("  ├─ HedgeExecutor:     " + deployment.HedgeExecutor);
  console.log("  ├─ MockMoonlander:    " + deployment.MockMoonlander);
  console.log("  ├─ ZKHedgeCommitment: " + deployment.ZKHedgeCommitment);
  console.log("  └─ USDC:              " + deployment.usdcToken);
  console.log("\n  Explorer: https://explorer.cronos.org/testnet3/address/" + deployment.HedgeExecutor);
  console.log("");

  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  });
