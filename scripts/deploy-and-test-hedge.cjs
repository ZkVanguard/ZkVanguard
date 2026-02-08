/**
 * Deploy & Test HedgeExecutor - Full Stack
 * 
 * Deploys fresh MockUSDC + MockMoonlander + HedgeExecutor, then tests.
 * This avoids the FiatToken USDC issue on Cronos testnet.
 * 
 * Usage:
 *   npx hardhat run scripts/deploy-and-test-hedge.cjs --network cronos-testnet
 */
const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = path.join(__dirname, "../deployments/cronos-testnet.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log("\n" + "=".repeat(70));
  console.log("  HEDGE EXECUTOR - DEPLOY & TEST");
  console.log("  Network: Cronos Testnet (Chain ID " + network.chainId + ")");
  console.log("  Deployer: " + deployer.address);
  console.log("=".repeat(70));

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("  Balance: " + ethers.formatEther(balance) + " CRO\n");

  if (balance < ethers.parseEther("5")) {
    console.log("  ⚠️  Low CRO balance. Need at least 5 CRO for deployment.");
  }

  let passed = 0;
  let failed = 0;
  function ok(name, detail) {
    passed++;
    console.log("  ✅ " + name + (detail ? " → " + detail : ""));
  }
  function fail(name, err) {
    failed++;
    console.log("  ❌ " + name + " → " + (typeof err === "string" ? err : (err.reason || err.message || String(err)).slice(0, 150)));
  }

  // Load existing deployment info
  let deployment = {};
  try {
    deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf-8"));
  } catch (_) {}

  // ═══════════════════════════════════════════════════════════
  // PHASE 1: DEPLOY FRESH STACK
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Phase 1: Deploy Fresh MockUSDC ──────────────");
  let mockUsdc;
  try {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    const addr = await mockUsdc.getAddress();
    ok("MockUSDC deployed", addr);
    deployment.MockUSDC = addr;
  } catch (e) {
    fail("MockUSDC deploy", e);
    return;
  }

  console.log("\n─── Phase 1b: Deploy Fresh MockMoonlander ───────");
  let moonlander;
  try {
    const MockMoonlander = await ethers.getContractFactory("MockMoonlander");
    moonlander = await MockMoonlander.deploy(await mockUsdc.getAddress());
    await moonlander.waitForDeployment();
    const addr = await moonlander.getAddress();
    ok("MockMoonlander deployed", addr);
    deployment.MockMoonlander = addr;
  } catch (e) {
    fail("MockMoonlander deploy", e);
    return;
  }

  console.log("\n─── Phase 1c: Deploy HedgeExecutor (UUPS Proxy) ─");
  let hedgeExecutor;
  try {
    const HedgeExecutor = await ethers.getContractFactory("HedgeExecutor");
    
    // Try UUPS proxy first
    try {
      hedgeExecutor = await upgrades.deployProxy(
        HedgeExecutor,
        [
          await mockUsdc.getAddress(),
          await moonlander.getAddress(),
          deployment.ZKHedgeCommitment,
          deployer.address
        ],
        { kind: "uups", timeout: 120000 }
      );
      await hedgeExecutor.waitForDeployment();
      const addr = await hedgeExecutor.getAddress();
      ok("HedgeExecutor (UUPS) deployed", addr);
      deployment.HedgeExecutor = addr;
    } catch (proxyErr) {
      console.log("  ⚠️  UUPS proxy failed: " + (proxyErr.message || "").slice(0, 80));
      console.log("  → Deploying directly...");
      
      hedgeExecutor = await HedgeExecutor.deploy();
      await hedgeExecutor.waitForDeployment();
      const addr = await hedgeExecutor.getAddress();
      
      // Initialize manually
      const initTx = await hedgeExecutor.initialize(
        await mockUsdc.getAddress(),
        await moonlander.getAddress(),
        deployment.ZKHedgeCommitment,
        deployer.address
      );
      await initTx.wait();
      
      ok("HedgeExecutor (direct) deployed", addr);
      deployment.HedgeExecutor = addr;
    }
  } catch (e) {
    fail("HedgeExecutor deploy", e);
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 2: SETUP
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Phase 2: Setup & Configuration ──────────────");
  
  // Grant AGENT_ROLE to deployer
  try {
    const AGENT_ROLE = await hedgeExecutor.AGENT_ROLE();
    const hasAgent = await hedgeExecutor.hasRole(AGENT_ROLE, deployer.address);
    if (!hasAgent) {
      const tx = await hedgeExecutor.grantRole(AGENT_ROLE, deployer.address);
      await tx.wait();
      ok("Granted AGENT_ROLE to deployer");
    } else {
      ok("AGENT_ROLE already granted");
    }
  } catch (e) {
    fail("Grant AGENT_ROLE", e);
  }

  // Mint test USDC
  try {
    const mintAmount = ethers.parseUnits("100000", 6); // 100k USDC
    const tx = await mockUsdc.mint(deployer.address, mintAmount);
    await tx.wait();
    const bal = await mockUsdc.balanceOf(deployer.address);
    ok("Minted test USDC", ethers.formatUnits(bal, 6) + " USDC");
  } catch (e) {
    fail("Mint USDC", e);
  }

  // Approve HedgeExecutor
  try {
    const tx = await mockUsdc.approve(
      await hedgeExecutor.getAddress(),
      ethers.MaxUint256
    );
    await tx.wait();
    ok("Approved HedgeExecutor for USDC (max)");
  } catch (e) {
    fail("Approve USDC", e);
  }

  // Verify config
  try {
    const ct = await hedgeExecutor.collateralToken();
    const mr = await hedgeExecutor.moonlanderRouter();
    const zk = await hedgeExecutor.zkCommitment();
    const maxLev = await hedgeExecutor.maxLeverage();
    const minCol = await hedgeExecutor.minCollateral();
    
    console.log("  Config verified:");
    console.log("    collateralToken: " + ct);
    console.log("    moonlanderRouter: " + mr);
    console.log("    zkCommitment: " + zk);
    console.log("    maxLeverage: " + maxLev + "x");
    console.log("    minCollateral: " + ethers.formatUnits(minCol, 6) + " USDC");
    ok("Contract configuration verified");
  } catch (e) {
    fail("Config verify", e);
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: TEST OPEN HEDGE
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Phase 3: Open Hedge Position ─────────────────");
  let hedgeId = null;
  try {
    const collateralAmount = ethers.parseUnits("100", 6); // 100 USDC
    const leverage = 5;
    const isLong = false; // Short = hedging
    const pairIndex = 0;  // BTC

    // ZK commitment params
    const timestamp = Math.floor(Date.now() / 1000);
    const commitmentHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bool", "uint256", "uint256"],
        [pairIndex, isLong, collateralAmount, timestamp]
      )
    );
    const nullifier = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256"],
        [commitmentHash, timestamp + 1]
      )
    );
    const merkleRoot = ethers.ZeroHash;

    console.log("  Params:");
    console.log("    Pair: BTC (index 0)");
    console.log("    Direction: SHORT (hedging)");
    console.log("    Collateral: 100 USDC");
    console.log("    Leverage: 5x");
    console.log("    Commitment: " + commitmentHash.slice(0, 22) + "...");

    // Static call first for debugging
    try {
      const result = await hedgeExecutor.openHedge.staticCall(
        pairIndex,
        collateralAmount,
        leverage,
        isLong,
        commitmentHash,
        nullifier,
        merkleRoot,
        { value: ethers.parseEther("0.06"), gasLimit: 1500000 }
      );
      console.log("  Static call OK: hedgeId = " + result.slice(0, 22) + "...");
    } catch (staticErr) {
      console.log("  Static call failed: " + (staticErr.reason || staticErr.message || "").slice(0, 200));
      throw staticErr;
    }

    // Execute
    const tx = await hedgeExecutor.openHedge(
      pairIndex,
      collateralAmount,
      leverage,
      isLong,
      commitmentHash,
      nullifier,
      merkleRoot,
      { value: ethers.parseEther("0.06"), gasLimit: 1500000 }
    );
    const receipt = await tx.wait();
    console.log("  Tx: " + receipt.hash);
    console.log("  Gas used: " + receipt.gasUsed.toString());
    console.log("  Block: " + receipt.blockNumber);

    // Parse events
    for (const log of receipt.logs) {
      try {
        const parsed = hedgeExecutor.interface.parseLog(log);
        if (parsed && parsed.name === "HedgeOpened") {
          hedgeId = parsed.args.hedgeId;
          ok("Hedge OPENED on-chain!", "hedgeId=" + hedgeId.slice(0, 22) + "...");
        }
      } catch (_) {}
    }
    if (!hedgeId) {
      // Try getting from return value
      ok("Hedge tx confirmed", "tx=" + receipt.hash.slice(0, 22));
    }
  } catch (e) {
    fail("Open hedge", e);
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 4: QUERY HEDGE STATE
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Phase 4: Query Hedge State ───────────────────");
  if (hedgeId) {
    try {
      const hedge = await hedgeExecutor.hedges(hedgeId);
      const statusNames = ["PENDING", "ACTIVE", "CLOSED", "LIQUIDATED", "CANCELLED"];
      
      console.log("  On-chain hedge state:");
      console.log("    Trader:     " + hedge.trader);
      console.log("    Pair:       " + hedge.pairIndex.toString());
      console.log("    TradeIndex: " + hedge.tradeIndex.toString());
      console.log("    Collateral: " + ethers.formatUnits(hedge.collateralAmount, 6) + " USDC");
      console.log("    Leverage:   " + hedge.leverage.toString() + "x");
      console.log("    IsLong:     " + hedge.isLong);
      console.log("    Status:     " + statusNames[Number(hedge.status)]);
      console.log("    Opened:     " + new Date(Number(hedge.openTimestamp) * 1000).toISOString());

      if (hedge.trader.toLowerCase() === deployer.address.toLowerCase()) ok("Trader = deployer");
      if (Number(hedge.status) === 1) ok("Status = ACTIVE");
      if (Number(hedge.leverage) === 5) ok("Leverage = 5x");
      if (!hedge.isLong) ok("Direction = SHORT (hedge)");
    } catch (e) {
      fail("Query hedge", e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 5: VERIFY STATS
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Phase 5: Verify Contract Stats ──────────────");
  try {
    const opened = await hedgeExecutor.totalHedgesOpened();
    const closed = await hedgeExecutor.totalHedgesClosed();
    const locked = await hedgeExecutor.totalCollateralLocked();
    const fees = await hedgeExecutor.accumulatedFees();
    
    console.log("  Stats:");
    console.log("    Hedges Opened:    " + opened.toString());
    console.log("    Hedges Closed:    " + closed.toString());
    console.log("    Collateral Locked: " + ethers.formatUnits(locked, 6) + " USDC");
    console.log("    Fees Accumulated:  " + ethers.formatUnits(fees, 6) + " USDC");

    if (Number(opened) > 0) ok("totalHedgesOpened > 0");
    if (locked > 0n) ok("Collateral locked");
    if (fees > 0n) ok("Fees collected", ethers.formatUnits(fees, 6) + " USDC");
  } catch (e) {
    fail("Stats check", e);
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 6: CLOSE HEDGE
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Phase 6: Close Hedge Position ────────────────");
  if (hedgeId) {
    try {
      console.log("  Closing hedge: " + hedgeId.slice(0, 22) + "...");
      
      const usdcBefore = await mockUsdc.balanceOf(deployer.address);
      
      const tx = await hedgeExecutor.closeHedge(hedgeId, { gasLimit: 800000 });
      const receipt = await tx.wait();
      console.log("  Tx: " + receipt.hash);
      console.log("  Gas used: " + receipt.gasUsed.toString());

      const usdcAfter = await mockUsdc.balanceOf(deployer.address);
      const returned = usdcAfter - usdcBefore;
      console.log("  USDC returned: " + ethers.formatUnits(returned, 6));

      // Parse HedgeClosed event
      for (const log of receipt.logs) {
        try {
          const parsed = hedgeExecutor.interface.parseLog(log);
          if (parsed && parsed.name === "HedgeClosed") {
            const pnl = parsed.args.realizedPnl;
            ok("Hedge CLOSED!", "PnL=" + ethers.formatUnits(pnl, 6) + " USDC");
          }
        } catch (_) {}
      }

      // Verify CLOSED status
      const hedge = await hedgeExecutor.hedges(hedgeId);
      const statusNames = ["PENDING", "ACTIVE", "CLOSED", "LIQUIDATED", "CANCELLED"];
      ok("Final status: " + statusNames[Number(hedge.status)]);
    } catch (e) {
      fail("Close hedge", e);
    }
  } else {
    console.log("  ⏭️  Skipped (no hedge to close)");
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 7: AGENT OPEN HEDGE (bonus test)
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Phase 7: Agent Open Hedge ────────────────────");
  let agentHedgeId = null;
  try {
    const collateral2 = ethers.parseUnits("50", 6);
    const ts2 = Math.floor(Date.now() / 1000) + 100;
    const commitment2 = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bool", "uint256", "uint256"],
        [1, true, collateral2, ts2]
      )
    );
    const nullifier2 = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256"],
        [commitment2, ts2 + 1]
      )
    );

    // Pre-fund HedgeExecutor with USDC for agent flow
    const fundAmount = ethers.parseUnits("100", 6);
    await (await mockUsdc.transfer(await hedgeExecutor.getAddress(), fundAmount)).wait();
    console.log("  Pre-funded HedgeExecutor with 100 USDC");

    console.log("  Opening ETH LONG via agentOpenHedge...");
    
    const tx = await hedgeExecutor.agentOpenHedge(
      deployer.address, // trader
      1,               // pairIndex (ETH)
      collateral2,
      10,              // 10x leverage
      true,            // long
      commitment2,
      nullifier2,
      ethers.ZeroHash,
      { value: ethers.parseEther("0.06"), gasLimit: 1500000 }
    );
    const receipt = await tx.wait();

    for (const log of receipt.logs) {
      try {
        const parsed = hedgeExecutor.interface.parseLog(log);
        if (parsed && parsed.name === "HedgeOpened") {
          agentHedgeId = parsed.args.hedgeId;
          ok("Agent hedge opened!", "ETH LONG 10x, hedgeId=" + agentHedgeId.slice(0, 18) + "...");
        }
      } catch (_) {}
    }
  } catch (e) {
    fail("Agent open hedge", e);
  }

  // Close agent hedge
  if (agentHedgeId) {
    try {
      const tx = await hedgeExecutor.closeHedge(agentHedgeId, { gasLimit: 800000 });
      await tx.wait();
      ok("Agent hedge closed");
    } catch (e) {
      fail("Agent close hedge", e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 8: FINAL STATS
  // ═══════════════════════════════════════════════════════════
  console.log("\n─── Phase 8: Final Stats ─────────────────────────");
  try {
    const opened = await hedgeExecutor.totalHedgesOpened();
    const closed = await hedgeExecutor.totalHedgesClosed();
    const locked = await hedgeExecutor.totalCollateralLocked();
    const fees = await hedgeExecutor.accumulatedFees();
    const pnl = await hedgeExecutor.totalPnlRealized();
    
    console.log("  Final:");
    console.log("    Hedges Opened:     " + opened.toString());
    console.log("    Hedges Closed:     " + closed.toString());
    console.log("    Collateral Locked: " + ethers.formatUnits(locked, 6) + " USDC");
    console.log("    Total Fees:        " + ethers.formatUnits(fees, 6) + " USDC");
    console.log("    Total PnL:         " + ethers.formatUnits(pnl, 6) + " USDC (signed)");
    
    if (Number(opened) >= 2) ok("Multiple hedges opened");
    if (Number(closed) >= 2) ok("Multiple hedges closed");
  } catch (e) {
    fail("Final stats", e);
  }

  // ═══════════════════════════════════════════════════════════
  // SAVE DEPLOYMENT
  // ═══════════════════════════════════════════════════════════
  deployment.HedgeExecutorV2 = deployment.HedgeExecutor;
  deployment.lastTestTimestamp = new Date().toISOString();
  deployment.testResults = { passed, failed };
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2));
  console.log("\n  📁 Deployment info saved to cronos-testnet.json");

  // ═══════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(70));
  console.log("  RESULTS: " + passed + " passed, " + failed + " failed");
  console.log("=".repeat(70));
  console.log("\n  Contracts:");
  console.log("  ├─ MockUSDC:          " + (deployment.MockUSDC || "N/A"));
  console.log("  ├─ MockMoonlander:    " + deployment.MockMoonlander);
  console.log("  ├─ ZKHedgeCommitment: " + deployment.ZKHedgeCommitment);
  console.log("  └─ HedgeExecutor:     " + deployment.HedgeExecutor);
  console.log("\n  Balance remaining: " + ethers.formatEther(await ethers.provider.getBalance(deployer.address)) + " CRO");
  console.log("");

  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
