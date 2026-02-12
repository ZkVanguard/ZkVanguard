/**
 * Create On-Chain Hedges for Portfolio #3
 * 
 * This script creates the actual on-chain hedges via MockMoonlander
 * for the $150M institutional portfolio.
 * 
 * Allocation:
 * - BTC: 35% ($52.5M) - SHORT
 * - ETH: 30% ($45M) - SHORT  
 * - CRO: 20% ($30M) - LONG
 * - SUI: 15% ($22.5M) - LONG
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Creating on-chain hedges with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CRO\n");

  // Load deployment info
  const deploymentPath = path.join(__dirname, "../deployments/cronos-testnet.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  
  const HEDGE_EXECUTOR = deployment.HedgeExecutor;
  const MOCK_USDC = "0x28217DAddC55e3C4831b4A48A00Ce04880786967";
  
  // Connect to contracts
  const hedgeExecutor = await ethers.getContractAt("HedgeExecutor", HEDGE_EXECUTOR);
  const mockUsdc = await ethers.getContractAt("MockUSDC", MOCK_USDC);
  
  console.log("HedgeExecutor:", HEDGE_EXECUTOR);
  console.log("MockUSDC:", MOCK_USDC);
  
  // Check balances
  const usdcBalance = await mockUsdc.balanceOf(deployer.address);
  const usdcDecimals = await mockUsdc.decimals();
  const balance = Number(usdcBalance) / Math.pow(10, Number(usdcDecimals));
  console.log(`\nMockUSDC Balance: ${balance.toLocaleString()} USDC`);
  
  // Portfolio #3 Hedges - scaled to testnet amounts (using 0.01% of notional)
  // Real: $52.5M BTC, $45M ETH, $30M CRO, $22.5M SUI
  // Testnet: $5,250 BTC, $4,500 ETH, $3,000 CRO, $2,250 SUI (scaled for testnet)
  
  const hedges = [
    {
      name: "BTC SHORT",
      pairIndex: 0, // BTC/USD
      collateral: "5250", // $5,250 (represents 35% of position)
      leverage: 10,
      isLong: false,
      portfolioId: 3
    },
    {
      name: "ETH SHORT", 
      pairIndex: 1, // ETH/USD
      collateral: "4500", // $4,500 (represents 30% of position)
      leverage: 10,
      isLong: false,
      portfolioId: 3
    },
    {
      name: "CRO LONG",
      pairIndex: 8, // CRO/USD
      collateral: "3000", // $3,000 (represents 20% of position)
      leverage: 5,
      isLong: true,
      portfolioId: 3
    },
    {
      name: "SUI LONG",
      pairIndex: 60, // SUI/USD (assuming index)
      collateral: "2250", // $2,250 (represents 15% of position)
      leverage: 5,
      isLong: true,
      portfolioId: 3
    }
  ];
  
  // Need at least 15,000 USDC for all hedges
  const totalRequired = hedges.reduce((sum, h) => sum + Number(h.collateral), 0);
  console.log(`Total collateral required: $${totalRequired.toLocaleString()}`);
  
  if (balance < totalRequired) {
    console.log(`\n⚠️  Insufficient balance. Minting ${totalRequired} USDC...`);
    try {
      const mintTx = await mockUsdc.mint(deployer.address, ethers.parseUnits(totalRequired.toString(), 6));
      await mintTx.wait();
      console.log("✅ Minted", totalRequired, "USDC");
    } catch (e) {
      console.log("❌ Mint failed:", e.message);
      console.log("Continuing with available balance...");
    }
  }
  
  // Approve HedgeExecutor
  console.log("\nApproving HedgeExecutor to spend USDC...");
  const approveTx = await mockUsdc.approve(HEDGE_EXECUTOR, ethers.MaxUint256);
  await approveTx.wait();
  console.log("✅ Approved");
  
  // Create hedges
  console.log("\n══════════════════════════════════════════════");
  console.log("  CREATING ON-CHAIN HEDGES FOR PORTFOLIO #3");
  console.log("══════════════════════════════════════════════\n");
  
  const results = [];
  
  for (const hedge of hedges) {
    console.log(`─── ${hedge.name} ───`);
    console.log(`  Collateral: $${hedge.collateral}`);
    console.log(`  Leverage: ${hedge.leverage}x`);
    console.log(`  Direction: ${hedge.isLong ? 'LONG' : 'SHORT'}`);
    
    try {
      const timestamp = Date.now();
      
      // Generate commitment hash
      const commitment = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "uint256", "uint256", "uint256", "bool", "uint256"],
          [
            deployer.address,
            hedge.pairIndex,
            ethers.parseUnits(hedge.collateral, 6),
            hedge.leverage,
            hedge.isLong,
            timestamp
          ]
        )
      );
      
      // Generate nullifier (unique per hedge)
      const nullifier = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "uint256", "string"],
          [commitment, timestamp, hedge.name]
        )
      );
      
      // Merkle root (empty for single hedge)
      const merkleRoot = ethers.keccak256(
        ethers.solidityPacked(["bytes32"], [commitment])
      );
      
      console.log(`  Commitment: ${commitment.slice(0, 20)}...`);
      console.log(`  Nullifier: ${nullifier.slice(0, 20)}...`);
      
      // Open hedge on-chain (requires 0.06 CRO oracle fee)
      const tx = await hedgeExecutor.openHedge(
        hedge.pairIndex,
        ethers.parseUnits(hedge.collateral, 6),
        hedge.leverage,
        hedge.isLong,
        commitment,
        nullifier,
        merkleRoot,
        { value: ethers.parseEther("0.06") }
      );
      
      const receipt = await tx.wait();
      console.log(`  Tx: ${receipt.hash}`);
      console.log(`  Gas: ${receipt.gasUsed.toString()}`);
      
      // Get hedge ID from event
      const event = receipt.logs.find(log => {
        try {
          const parsed = hedgeExecutor.interface.parseLog(log);
          return parsed.name === 'HedgeOpened';
        } catch {
          return false;
        }
      });
      
      let hedgeId = null;
      if (event) {
        const parsed = hedgeExecutor.interface.parseLog(event);
        hedgeId = parsed.args.hedgeId;
        console.log(`  HedgeId: ${hedgeId}`);
      }
      
      results.push({
        ...hedge,
        txHash: receipt.hash,
        hedgeId: hedgeId,
        status: 'SUCCESS',
        onChain: true
      });
      
      console.log(`  ✅ ${hedge.name} created on-chain!\n`);
      
    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}\n`);
      results.push({
        ...hedge,
        status: 'FAILED',
        error: error.message,
        onChain: false
      });
    }
  }
  
  // Summary
  console.log("══════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("══════════════════════════════════════════════");
  
  const successful = results.filter(r => r.status === 'SUCCESS');
  const failed = results.filter(r => r.status === 'FAILED');
  
  console.log(`\n✅ Successful: ${successful.length}`);
  successful.forEach(r => {
    console.log(`   - ${r.name}: ${r.hedgeId?.slice(0, 20)}...`);
  });
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}`);
    failed.forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
  }
  
  // Save results
  const outputPath = path.join(__dirname, "../deployments/portfolio-3-hedges.json");
  const output = {
    portfolioId: 3,
    createdAt: new Date().toISOString(),
    totalCollateral: totalRequired,
    hedges: results
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: deployments/portfolio-3-hedges.json`);
  
  // Final stats
  try {
    const totalOpened = await hedgeExecutor.totalHedgesOpened();
    const totalClosed = await hedgeExecutor.totalHedgesClosed();
    const collateralLocked = await hedgeExecutor.totalCollateralLocked();
    const fees = await hedgeExecutor.accumulatedFees();
    console.log("\nHedgeExecutor Stats:");
    console.log(`  Total Hedges Opened: ${totalOpened}`);
    console.log(`  Total Hedges Closed: ${totalClosed}`);
    console.log(`  Collateral Locked: ${ethers.formatUnits(collateralLocked, 6)} USDC`);
    console.log(`  Fees Accumulated: ${ethers.formatUnits(fees, 6)} USDC`);
  } catch (e) {
    console.log("Could not fetch stats:", e.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
