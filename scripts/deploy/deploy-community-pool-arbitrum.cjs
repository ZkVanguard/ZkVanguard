/**
 * Deploy CommunityPool to Arbitrum - AI-Managed Community Investment Pool
 * 
 * This script deploys the CommunityPool contract to Arbitrum (Sepolia testnet or One mainnet):
 * - UUPS Upgradeable proxy pattern
 * - Pyth Network oracle for real-time pricing
 * - Support for BTC, ETH, ARB allocations
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-community-pool-arbitrum.cjs --network arbitrum-sepolia
 *   npx hardhat run scripts/deploy/deploy-community-pool-arbitrum.cjs --network arbitrum-one
 * 
 * Prerequisites:
 *   - Set PRIVATE_KEY in .env.local
 *   - Ensure deployer has enough ETH for gas
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════════
// PYTH ORACLE ADDRESSES
// ═══════════════════════════════════════════════════════════════

const PYTH_ADDRESSES = {
  421614: "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF", // Arbitrum Sepolia
  42161: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C",  // Arbitrum One
};

// Pyth Price IDs (Universal across all chains)
// Source: https://pyth.network/developers/price-feed-ids
const PYTH_PRICE_IDS = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
  ARB: "0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5", // ARB instead of CRO
};

// Network configurations
const NETWORK_CONFIG = {
  // Arbitrum Sepolia (Chain ID: 421614)
  421614: {
    name: "Arbitrum Sepolia",
    // Will deploy MockUSDC if needed
    depositToken: null, // Set dynamically
    assetTokens: [
      "0x0000000000000000000000000000000000000000", // BTC (tracked via Pyth)
      "0x0000000000000000000000000000000000000000", // ETH (tracked via Pyth)  
      "0x0000000000000000000000000000000000000000", // SUI (tracked via Pyth)
      "0x0000000000000000000000000000000000000000", // ARB (tracked via Pyth)
    ],
    priceStaleThreshold: 3600, // 1 hour (testnet can have stale prices)
  },
  // Arbitrum One Mainnet (Chain ID: 42161)
  42161: {
    name: "Arbitrum One",
    depositToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Native USDC on Arbitrum
    assetTokens: [
      "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", // WBTC on Arbitrum
      "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH on Arbitrum
      "0x0000000000000000000000000000000000000000", // SUI (not on Arbitrum)
      "0x912CE59144191C1204E64559FE8253a0e49E6548", // ARB token
    ],
    priceStaleThreshold: 300, // 5 minutes for mainnet
  },
};

async function deployMockUSDC(deployer) {
  console.log("📦 Deploying MockUSDC for testnet...");
  
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  
  const address = await mockUSDC.getAddress();
  console.log("✅ MockUSDC deployed at:", address);
  
  // The MockUSDC already mints 1M to deployer in constructor
  console.log("✅ 1,000,000 USDC auto-minted to deployer");
  
  return address;
}

async function main() {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║   COMMUNITY POOL DEPLOYMENT - ARBITRUM                            ║");
  console.log("║   AI-Managed Investment Pool with Pyth Oracle Integration         ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝");
  console.log("\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  
  console.log("📋 Deployer Info:");
  console.log("   Address:", deployer.address);
  console.log("   Balance:", ethers.formatEther(balance), "ETH");
  console.log("\n");

  // Get network config
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const config = NETWORK_CONFIG[chainId];
  
  if (!config) {
    throw new Error(`Unsupported network! Chain ID: ${chainId}. Supported: 421614 (Arbitrum Sepolia), 42161 (Arbitrum One)`);
  }
  
  const pythOracle = PYTH_ADDRESSES[chainId];
  
  console.log("🌐 Network:", config.name, `(Chain ID: ${chainId})`);
  console.log("   Pyth Oracle:", pythOracle);
  console.log("\n");

  // ═══════════════════════════════════════════════════════════════
  // STEP 0: Deploy MockUSDC if on testnet
  // ═══════════════════════════════════════════════════════════════

  let depositTokenAddress = config.depositToken;
  
  if (chainId === 421614 && !depositTokenAddress) {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("   STEP 0: Deploy MockUSDC (Testnet Only)");
    console.log("═══════════════════════════════════════════════════════════════\n");
    
    depositTokenAddress = await deployMockUSDC(deployer);
    console.log("\n");
  }
  
  console.log("   Deposit Token (USDC):", depositTokenAddress);
  console.log("\n");

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Deploy CommunityPool Contract
  // ═══════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   STEP 1: Deploy CommunityPool (UUPS Proxy)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const CommunityPool = await ethers.getContractFactory("CommunityPool");
  
  console.log("Deploying proxy... (this may take a minute on Arbitrum)");
  const pool = await upgrades.deployProxy(
    CommunityPool,
    [
      depositTokenAddress,
      config.assetTokens,
      deployer.address, // treasury
      deployer.address, // admin
    ],
    {
      initializer: "initialize",
      kind: "uups",
      timeout: 300000, // 5 minutes timeout for Arbitrum
    }
  );

  await pool.waitForDeployment();
  
  const proxyAddress = await pool.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  
  console.log("✅ CommunityPool Deployed!");
  console.log("   Proxy Address:", proxyAddress);
  console.log("   Implementation:", implAddress);
  console.log("\n");

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Configure Pyth Oracle
  // ═══════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   STEP 2: Configure Pyth Oracle");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Set Pyth Oracle address
  console.log("Setting Pyth Oracle address...");
  const tx1 = await pool.setPythOracle(pythOracle, { gasLimit: 200000 });
  await tx1.wait();
  console.log("✅ Pyth Oracle set to:", pythOracle);

  // Set all price IDs
  console.log("\nSetting Pyth Price IDs...");
  const priceIds = [
    PYTH_PRICE_IDS.BTC,
    PYTH_PRICE_IDS.ETH,
    PYTH_PRICE_IDS.SUI,
    PYTH_PRICE_IDS.ARB, // ARB instead of CRO for Arbitrum
  ];
  
  console.log("   [0] BTC:", PYTH_PRICE_IDS.BTC.slice(0, 20) + "...");
  console.log("   [1] ETH:", PYTH_PRICE_IDS.ETH.slice(0, 20) + "...");
  console.log("   [2] SUI:", PYTH_PRICE_IDS.SUI.slice(0, 20) + "...");
  console.log("   [3] ARB:", PYTH_PRICE_IDS.ARB.slice(0, 20) + "...");
  
  const tx2 = await pool.setAllPriceIds(priceIds, { gasLimit: 300000 });
  await tx2.wait();
  console.log("✅ All price IDs configured");

  // Set price stale threshold
  console.log("\nSetting price stale threshold...");
  const tx3 = await pool.setPriceStaleThreshold(config.priceStaleThreshold, { gasLimit: 100000 });
  await tx3.wait();
  console.log("✅ Stale threshold:", config.priceStaleThreshold, "seconds");
  console.log("\n");

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Verify Configuration
  // ═══════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   STEP 3: Verify Configuration");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Check oracle health
  try {
    const health = await pool.checkOracleHealth();
    console.log("Oracle Health Check:");
    console.log("   Overall Healthy:", health.healthy);
    console.log("   Assets Configured:", health.configured.map(b => b ? "✅" : "❌").join(", "));
    console.log("   Oracles Working:", health.working.map(b => b ? "✅" : "❌").join(", "));
    console.log("   Prices Fresh:", health.fresh.map(b => b ? "✅" : "❌").join(", "));
  } catch (e) {
    console.log("⚠️  Oracle health check skipped (may need price feed update first)");
    console.log("   This is normal - Pyth requires price updates to be pushed");
  }

  // Get pool stats
  try {
    const stats = await pool.getPoolStats();
    console.log("\nPool Stats:");
    console.log("   Total Shares:", ethers.formatUnits(stats._totalShares, 18));
    console.log("   Total NAV:", ethers.formatUnits(stats._totalNAV, 6), "USDC");
    console.log("   Members:", stats._memberCount.toString());
    console.log("   Allocations:", stats._allocations.map(a => a.toString() + " bps").join(", "));
  } catch (e) {
    console.log("\n⚠️  Pool stats check skipped");
  }

  // Verify roles
  const AGENT_ROLE = await pool.AGENT_ROLE();
  const REBALANCER_ROLE = await pool.REBALANCER_ROLE();
  
  console.log("\nRoles Granted:");
  console.log("   Admin:", await pool.hasRole(await pool.DEFAULT_ADMIN_ROLE(), deployer.address) ? "✅" : "❌");
  console.log("   Agent:", await pool.hasRole(AGENT_ROLE, deployer.address) ? "✅" : "❌");
  console.log("   Rebalancer:", await pool.hasRole(REBALANCER_ROLE, deployer.address) ? "✅" : "❌");
  console.log("\n");

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Save Deployment Info
  // ═══════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   STEP 4: Save Deployment Info");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const deploymentInfo = {
    network: config.name,
    chainId: chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      CommunityPool: {
        proxy: proxyAddress,
        implementation: implAddress,
      },
      MockUSDC: chainId === 421614 ? depositTokenAddress : undefined,
    },
    configuration: {
      depositToken: depositTokenAddress,
      pythOracle: pythOracle,
      priceIds: {
        BTC: PYTH_PRICE_IDS.BTC,
        ETH: PYTH_PRICE_IDS.ETH,
        SUI: PYTH_PRICE_IDS.SUI,
        ARB: PYTH_PRICE_IDS.ARB,
      },
      priceStaleThreshold: config.priceStaleThreshold,
      treasury: deployer.address,
      admin: deployer.address,
    },
  };

  // Save to deployments folder
  const deploymentsDir = path.join(__dirname, "..", "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const filename = `community-pool-${chainId === 421614 ? 'arbitrum-sepolia' : 'arbitrum-one'}.json`;
  const filepath = path.join(deploymentsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  console.log("✅ Deployment info saved to:", filepath);

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║   DEPLOYMENT COMPLETE!                                            ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝");
  console.log("\n");
  console.log("📋 Contract Addresses:");
  console.log("   CommunityPool (Proxy):", proxyAddress);
  console.log("   Implementation:", implAddress);
  if (chainId === 421614) {
    console.log("   MockUSDC:", depositTokenAddress);
  }
  console.log("\n");
  console.log("🔗 Explorer Links:");
  if (chainId === 421614) {
    console.log("   Pool: https://sepolia.arbiscan.io/address/" + proxyAddress);
  } else {
    console.log("   Pool: https://arbiscan.io/address/" + proxyAddress);
  }
  console.log("\n");
  console.log("🔧 Next Steps:");
  console.log("   1. Update COMMUNITY_POOL_ADDRESS in frontend config");
  console.log("");
  console.log("   2. Grant AGENT_ROLE to your hedging backend:");
  console.log(`      await pool.grantRole(AGENT_ROLE, "<backend-address>");`);
  console.log("");
  console.log("   3. Test with a small deposit");
  console.log("\n");
  
  return {
    proxy: proxyAddress,
    implementation: implAddress,
    mockUSDC: chainId === 421614 ? depositTokenAddress : undefined,
  };
}

main()
  .then((addresses) => {
    console.log("Deployment successful!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
