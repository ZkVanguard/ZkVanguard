/**
 * Deploy CommunityPool V2 to Cronos Mainnet
 * 
 * Prerequisites:
 * 1. Set PRIVATE_KEY in .env (deployer must have CRO for gas)
 * 2. Ensure USDC address is correct for mainnet
 * 3. Review Pyth Oracle configuration
 * 
 * Usage: npx hardhat run scripts/deploy/deploy-community-pool-mainnet.cjs --network cronos-mainnet
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Cronos Mainnet Configuration
const CONFIG = {
  // Pyth Oracle - Cronos Mainnet
  pythOracle: "0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B",
  
  // Price Feed IDs (same across all chains)
  priceIds: {
    BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
    CRO: "0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe"
  },
  
  // Price stale threshold (seconds) - 1 hour
  priceStaleThreshold: 3600,
  
  // USDC on Cronos Mainnet
  // NOTE: Verify this address before mainnet deployment!
  usdc: "0xc21223249CA28397B4B6541dffaEcc539BfF0c59", // Circle USDC on Cronos
  
  // Pool configuration
  pool: {
    name: "Chronos Vanguard Pool",
    managementFeeBps: 50,    // 0.5%
    performanceFeeBps: 1000, // 10%
    minDeposit: 10 * 1e6,    // 10 USDC minimum
    maxCapacity: 10_000_000 * 1e6, // 10M USDC max
    depositPaused: false,
    withdrawPaused: false
  }
};

async function main() {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     COMMUNITYPOOL V2 MAINNET DEPLOYMENT                       ║");
  console.log("║     Cronos Mainnet with Pyth Oracle Integration               ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");
  
  const [deployer] = await ethers.getSigners();
  console.log(`\n🔑 Deployer: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 CRO Balance: ${ethers.formatEther(balance)} CRO`);
  
  if (balance < ethers.parseEther("10")) {
    console.log("⚠️  WARNING: Low CRO balance. Recommend at least 10 CRO for deployment + operations.");
  }
  
  // Verify network
  const network = await ethers.provider.getNetwork();
  console.log(`📡 Network: ${network.name} (Chain ID: ${network.chainId})`);
  
  if (Number(network.chainId) !== 25) {
    console.log("❌ ERROR: Not on Cronos Mainnet (Chain ID 25). Aborting.");
    process.exit(1);
  }
  
  // Verify Pyth Oracle exists
  console.log("\n📊 Verifying Pyth Oracle...");
  const pythCode = await ethers.provider.getCode(CONFIG.pythOracle);
  if (pythCode === "0x") {
    console.log("❌ ERROR: Pyth Oracle contract not found at address. Aborting.");
    process.exit(1);
  }
  console.log(`   ✅ Pyth Oracle verified at ${CONFIG.pythOracle}`);
  
  // Verify USDC exists
  console.log("\n💵 Verifying USDC...");
  const usdcCode = await ethers.provider.getCode(CONFIG.usdc);
  if (usdcCode === "0x") {
    console.log("❌ ERROR: USDC contract not found at address. Aborting.");
    process.exit(1);
  }
  console.log(`   ✅ USDC verified at ${CONFIG.usdc}`);
  
  // Deploy implementation and proxy
  console.log("\n🚀 Deploying CommunityPool V2...");
  
  const CommunityPool = await ethers.getContractFactory("CommunityPool");
  
  const initArgs = [
    deployer.address,        // admin
    deployer.address,        // treasury
    CONFIG.usdc,             // USDC token
    CONFIG.pool.name,        // pool name
    CONFIG.pool.managementFeeBps,
    CONFIG.pool.performanceFeeBps,
    CONFIG.pool.minDeposit,
    CONFIG.pool.maxCapacity
  ];
  
  const pool = await upgrades.deployProxy(CommunityPool, initArgs, {
    initializer: "initialize",
    kind: "uups"
  });
  
  await pool.waitForDeployment();
  const proxyAddress = await pool.getAddress();
  console.log(`   ✅ Proxy deployed: ${proxyAddress}`);
  
  // Get implementation address
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`   ✅ Implementation: ${implAddress}`);
  
  // Configure Pyth Oracle
  console.log("\n🔧 Configuring Pyth Oracle...");
  
  // Set Pyth Oracle
  const tx1 = await pool.setPythOracle(CONFIG.pythOracle, { gasLimit: 100000 });
  await tx1.wait();
  console.log(`   ✅ Pyth Oracle set: ${CONFIG.pythOracle}`);
  
  // Set price feed IDs
  const tx2 = await pool.setPriceFeedIds(
    Object.values(CONFIG.priceIds),
    { gasLimit: 200000 }
  );
  await tx2.wait();
  console.log("   ✅ Price feed IDs configured (BTC, ETH, SUI, CRO)");
  
  // Set stale threshold
  const tx3 = await pool.setPriceStaleThreshold(CONFIG.priceStaleThreshold, { gasLimit: 100000 });
  await tx3.wait();
  console.log(`   ✅ Stale threshold: ${CONFIG.priceStaleThreshold} seconds`);
  
  // Verify configuration
  console.log("\n🔍 Verifying deployment...");
  
  const pythOracleSet = await pool.pythOracle();
  const staleThreshold = await pool.priceStaleThreshold();
  const treasury = await pool.treasury();
  const mgmtFee = await pool.managementFeeBps();
  const perfFee = await pool.performanceFeeBps();
  
  console.log(`   Pyth Oracle: ${pythOracleSet}`);
  console.log(`   Stale Threshold: ${staleThreshold}s`);
  console.log(`   Treasury: ${treasury}`);
  console.log(`   Management Fee: ${Number(mgmtFee) / 100}%`);
  console.log(`   Performance Fee: ${Number(perfFee) / 100}%`);
  
  // Save deployment info
  const deployment = {
    network: "cronos-mainnet",
    chainId: 25,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    proxy: proxyAddress,
    implementation: implAddress,
    usdc: CONFIG.usdc,
    pythOracle: CONFIG.pythOracle,
    priceIds: CONFIG.priceIds,
    priceStaleThreshold: CONFIG.priceStaleThreshold,
    config: CONFIG.pool
  };
  
  const deploymentPath = path.join(__dirname, "..", "..", "deployments", "community-pool-mainnet.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`\n📁 Deployment saved to: ${deploymentPath}`);
  
  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`
  CommunityPool V2 Mainnet:
  - Proxy:          ${proxyAddress}
  - Implementation: ${implAddress}
  - USDC:           ${CONFIG.usdc}
  - Pyth Oracle:    ${CONFIG.pythOracle}
  
  Next Steps:
  1. Verify contract on Cronoscan
  2. Push initial Pyth prices using update-pyth-prices.cjs
  3. Test with small deposit
  4. Update treasury address if different from deployer
  `);
  
  console.log("\n⚠️  IMPORTANT: Before accepting deposits:");
  console.log("   - Verify all addresses are correct");
  console.log("   - Push Pyth prices and verify oracle health");
  console.log("   - Test deposit/withdraw with small amount");
  console.log("   - Set production treasury address");
  console.log("   - Consider initial deposit lockup period\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
