const { ethers } = require("hardhat");

async function main() {
  const POOL_ADDRESS = "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30";
  const pool = await ethers.getContractAt("CommunityPool", POOL_ADDRESS);
  
  console.log("\n=== COMMUNITY POOL HISTORY ANALYSIS ===\n");
  
  // Get deployment block - scan last 2000 blocks (Cronos limit)
  const currentBlock = await ethers.provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 1999);
  
  console.log(`Scanning from block ${fromBlock} to ${currentBlock} (last 2000 blocks)...\n`);
  
  // Check Deposit events
  const depositFilter = pool.filters.Deposited();
  const deposits = await pool.queryFilter(depositFilter, fromBlock, currentBlock);
  console.log(`📥 Deposits: ${deposits.length}`);
  let totalDeposited = BigInt(0);
  for (const d of deposits) {
    totalDeposited += d.args.amount;
    console.log(`   Block ${d.blockNumber}: ${ethers.formatUnits(d.args.amount, 6)} USDC -> ${ethers.formatUnits(d.args.shares, 18)} shares`);
  }
  console.log(`   TOTAL DEPOSITED: ${ethers.formatUnits(totalDeposited, 6)} USDC\n`);
  
  // Check Withdrawal events
  const withdrawFilter = pool.filters.Withdrawn();
  const withdrawals = await pool.queryFilter(withdrawFilter, fromBlock, currentBlock);
  console.log(`📤 Withdrawals: ${withdrawals.length}`);
  let totalWithdrawn = BigInt(0);
  for (const w of withdrawals) {
    totalWithdrawn += w.args.amount;
    console.log(`   Block ${w.blockNumber}: ${ethers.formatUnits(w.args.shares, 18)} shares -> ${ethers.formatUnits(w.args.amount, 6)} USDC`);
    if (w.args.fee && w.args.fee > 0) {
      console.log(`      Fee: ${ethers.formatUnits(w.args.fee, 6)} USDC`);
    }
  }
  console.log(`   TOTAL WITHDRAWN: ${ethers.formatUnits(totalWithdrawn, 6)} USDC\n`);
  
  // Check Hedge/Rebalance events
  const hedgeFilter = pool.filters.HedgeExecuted?.();
  if (hedgeFilter) {
    const hedges = await pool.queryFilter(hedgeFilter, fromBlock, currentBlock);
    console.log(`🔄 Hedge Executions: ${hedges.length}`);
    for (const h of hedges) {
      console.log(`   Block ${h.blockNumber}:`, h.args);
    }
  }
  
  // Check fees collected
  const feeFilter = pool.filters.PerformanceFeeCollected?.();
  if (feeFilter) {
    const fees = await pool.queryFilter(feeFilter, fromBlock, currentBlock);
    console.log(`💰 Performance Fees: ${fees.length}`);
    for (const f of fees) {
      console.log(`   Block ${f.blockNumber}: ${ethers.formatUnits(f.args.amount, 6)} USDC`);
    }
  }
  
  // Summary
  console.log("\n=== ANALYSIS ===");
  console.log(`Net flow: ${ethers.formatUnits(totalDeposited - totalWithdrawn, 6)} USDC`);
  
  const stats = await pool.getPoolStats();
  const expectedNAV = totalDeposited - totalWithdrawn;
  const actualNAV = stats._totalNAV;
  const diff = expectedNAV - actualNAV;
  
  console.log(`Expected NAV (deposits - withdrawals): ${ethers.formatUnits(expectedNAV, 6)} USDC`);
  console.log(`Actual NAV: ${ethers.formatUnits(actualNAV, 6)} USDC`);
  console.log(`Difference (fees/losses): ${ethers.formatUnits(diff, 6)} USDC`);
  
  // Check if AI agent is configured
  console.log("\n=== AI AGENT STATUS ===");
  try {
    const aiAgent = await pool.aiAgent();
    const dexRouter = await pool.dexRouter();
    console.log(`AI Agent: ${aiAgent}`);
    console.log(`DEX Router: ${dexRouter}`);
    
    if (aiAgent === "0x0000000000000000000000000000000000000000") {
      console.log("⚠️  WARNING: No AI agent is configured - auto-management is DISABLED!");
    }
    if (dexRouter === "0x0000000000000000000000000000000000000000") {
      console.log("⚠️  WARNING: No DEX router configured - swaps are IMPOSSIBLE!");
    }
  } catch (e) {
    console.log("Could not check AI agent status:", e.message);
  }
}

main().catch(console.error);
