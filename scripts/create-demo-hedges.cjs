/**
 * Create diversified hedge positions on-chain for UI demo
 * 
 * Creates 5 hedge positions across different pairs:
 * 1. BTC SHORT 5x  - Core portfolio hedge
 * 2. ETH SHORT 3x  - DeFi exposure hedge  
 * 3. CRO LONG 10x  - Ecosystem momentum play
 * 4. SOL SHORT 4x  - Alt correlation hedge
 * 5. ATOM LONG 2x  - Cosmos ecosystem bet
 *
 * Usage:
 *   npx hardhat run scripts/create-demo-hedges.cjs --network cronos-testnet
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = path.join(__dirname, "../deployments/cronos-testnet.json");

// Hedge configurations
const HEDGE_CONFIGS = [
  {
    name: "BTC Portfolio Hedge",
    pairIndex: 0,   // BTC
    collateral: "500",
    leverage: 5,
    isLong: false,   // SHORT - hedging BTC exposure
    reason: "Core portfolio hedge against BTC downside risk"
  },
  {
    name: "ETH DeFi Hedge",
    pairIndex: 1,   // ETH
    collateral: "300",
    leverage: 3,
    isLong: false,   // SHORT - hedging ETH/DeFi exposure
    reason: "DeFi exposure hedge - protecting staked ETH positions"
  },
  {
    name: "CRO Ecosystem Long",
    pairIndex: 2,   // CRO
    collateral: "200",
    leverage: 10,
    isLong: true,    // LONG - bullish on CRO ecosystem
    reason: "Ecosystem momentum play - CDC chain adoption thesis"
  },
  {
    name: "SOL Correlation Hedge",
    pairIndex: 5,   // SOL
    collateral: "250",
    leverage: 4,
    isLong: false,   // SHORT
    reason: "Alt correlation hedge - high beta downside protection"
  },
  {
    name: "ATOM Cosmos Bet",
    pairIndex: 3,   // ATOM
    collateral: "150",
    leverage: 2,
    isLong: true,    // LONG
    reason: "IBC ecosystem growth play - interchain security thesis"
  }
];

async function main() {
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf-8"));
  const [deployer] = await ethers.getSigners();
  
  console.log("\n" + "=".repeat(70));
  console.log("  CREATE DEMO HEDGES ON-CHAIN");
  console.log("  HedgeExecutor: " + deployment.HedgeExecutor);
  console.log("  Deployer: " + deployer.address);
  console.log("=".repeat(70));

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("  CRO Balance: " + ethers.formatEther(balance) + " CRO\n");

  const hedgeExecutor = await ethers.getContractAt("HedgeExecutor", deployment.HedgeExecutor);
  const mockUsdc = await ethers.getContractAt("MockUSDC", deployment.MockUSDC);

  // Check USDC balance and mint if needed
  const usdcBal = await mockUsdc.balanceOf(deployer.address);
  console.log("  USDC Balance: " + ethers.formatUnits(usdcBal, 6));
  
  const totalNeeded = HEDGE_CONFIGS.reduce((sum, h) => sum + Number(h.collateral), 0);
  if (Number(ethers.formatUnits(usdcBal, 6)) < totalNeeded) {
    console.log("  Minting " + (totalNeeded * 2) + " USDC...");
    const mintTx = await mockUsdc.mint(deployer.address, ethers.parseUnits(String(totalNeeded * 2), 6));
    await mintTx.wait();
    console.log("  ✅ Minted");
  }

  // Approve HedgeExecutor
  const allowance = await mockUsdc.allowance(deployer.address, deployment.HedgeExecutor);
  if (allowance < ethers.parseUnits(String(totalNeeded), 6)) {
    const approveTx = await mockUsdc.approve(deployment.HedgeExecutor, ethers.MaxUint256);
    await approveTx.wait();
    console.log("  ✅ Approved HedgeExecutor for USDC");
  }

  // Create hedges
  const createdHedges = [];
  
  for (let i = 0; i < HEDGE_CONFIGS.length; i++) {
    const config = HEDGE_CONFIGS[i];
    console.log("\n─── Hedge " + (i + 1) + "/" + HEDGE_CONFIGS.length + ": " + config.name + " ──────");
    
    const collateralAmount = ethers.parseUnits(config.collateral, 6);
    const pairNames = ["BTC", "ETH", "CRO", "ATOM", "DOGE", "SOL"];
    const timestamp = Math.floor(Date.now() / 1000) + i * 100;
    
    // Unique commitment and nullifier per hedge
    const commitmentHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bool", "uint256", "uint256", "uint256"],
        [config.pairIndex, config.isLong, collateralAmount, timestamp, i]
      )
    );
    const nullifier = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256", "uint256"],
        [commitmentHash, timestamp + 1, i + 1000]
      )
    );
    
    console.log("  " + pairNames[config.pairIndex] + " " + (config.isLong ? "LONG" : "SHORT") + 
                " | " + config.collateral + " USDC | " + config.leverage + "x");
    
    try {
      const tx = await hedgeExecutor.openHedge(
        config.pairIndex,
        collateralAmount,
        config.leverage,
        config.isLong,
        commitmentHash,
        nullifier,
        ethers.ZeroHash,
        { value: ethers.parseEther("0.06"), gasLimit: 1500000 }
      );
      
      const receipt = await tx.wait();
      
      // Parse HedgeOpened event
      let hedgeId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = hedgeExecutor.interface.parseLog(log);
          if (parsed && parsed.name === "HedgeOpened") {
            hedgeId = parsed.args.hedgeId;
          }
        } catch (_) {}
      }
      
      console.log("  ✅ Created | Tx: " + receipt.hash.slice(0, 22) + "...");
      console.log("     HedgeId: " + (hedgeId || "parsed-from-event").toString().slice(0, 22) + "...");
      console.log("     Gas: " + receipt.gasUsed.toString());
      
      createdHedges.push({
        hedgeId: hedgeId ? hedgeId.toString() : null,
        name: config.name,
        pair: pairNames[config.pairIndex],
        side: config.isLong ? "LONG" : "SHORT",
        collateral: config.collateral,
        leverage: config.leverage,
        txHash: receipt.hash,
        reason: config.reason
      });
    } catch (e) {
      console.log("  ❌ Failed: " + (e.reason || e.message || "").slice(0, 120));
    }
  }

  // Get final stats
  console.log("\n" + "=".repeat(70));
  console.log("  SUMMARY");
  console.log("=".repeat(70));
  
  const stats = await hedgeExecutor.getProtocolStats();
  console.log("  Total Hedges Opened:   " + stats[0].toString());
  console.log("  Total Hedges Closed:   " + stats[1].toString());
  console.log("  Collateral Locked:     " + ethers.formatUnits(stats[2], 6) + " USDC");
  console.log("  Total PnL:             " + ethers.formatUnits(stats[3], 6) + " USDC");
  console.log("  Fees Collected:        " + ethers.formatUnits(stats[4], 6) + " USDC\n");

  // Get user hedges
  const userHedges = await hedgeExecutor.getUserHedges(deployer.address);
  console.log("  User hedge count: " + userHedges.length);
  
  for (let i = 0; i < userHedges.length; i++) {
    const h = await hedgeExecutor.hedges(userHedges[i]);
    const pairNames = ["BTC", "ETH", "CRO", "ATOM", "DOGE", "SOL"];
    const statusNames = ["PENDING", "ACTIVE", "CLOSED", "LIQUIDATED", "CANCELLED"];
    console.log("  [" + (i + 1) + "] " + pairNames[Number(h.pairIndex)] + " " + 
                (h.isLong ? "LONG" : "SHORT") + " " + h.leverage.toString() + "x | " +
                ethers.formatUnits(h.collateralAmount, 6) + " USDC | " + statusNames[Number(h.status)]);
  }

  // Save created hedges to deployment file
  deployment.demoHedges = createdHedges;
  deployment.lastDemoTimestamp = new Date().toISOString();
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2));
  
  const remainingCro = await ethers.provider.getBalance(deployer.address);
  console.log("\n  CRO remaining: " + ethers.formatEther(remainingCro));
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
