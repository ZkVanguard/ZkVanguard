/**
 * Deploy CommunityPool V2 - AI-Managed Community Investment Pool with Pyth Oracle
 * 
 * This script deploys a NEW CommunityPool contract with full Pyth integration:
 * - UUPS Upgradeable proxy pattern
 * - Pyth Network oracle for real-time pricing
 * - Support for BTC, ETH, SUI, CRO allocations
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-community-pool-v2.cjs --network cronos-testnet
 * 
 * After deployment, update the contract address in:
 *   - app/api/community-pool/route.ts
 *   - components/dashboard/CommunityPool.tsx
 *   - deployments/community-pool.json
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

// Pyth Network address for Cronos TESTNET
// Mainnet: 0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B
// Testnet: 0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320
const PYTH_ORACLE = "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320";

// Pyth Price IDs (Universal across all chains)
// Source: https://pyth.network/developers/price-feed-ids
const PYTH_PRICE_IDS = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
  CRO: "0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe",
};

// Network configurations
const NETWORK_CONFIG = {
  // Cronos Testnet (Chain ID: 338)
  338: {
    name: "Cronos Testnet",
    depositToken: "0x28217DAddC55e3C4831b4A48A00Ce04880786967", // MockUSDC
    // Asset tokens (using zero address as we track balances internally with Pyth pricing)
    assetTokens: [
      "0x0000000000000000000000000000000000000000", // BTC (tracked via Pyth)
      "0x0000000000000000000000000000000000000000", // ETH (tracked via Pyth)  
      "0x0000000000000000000000000000000000000000", // SUI (tracked via Pyth)
      "0x0000000000000000000000000000000000000000", // CRO (tracked via Pyth)
    ],
    priceStaleThreshold: 3600, // 1 hour (testnet can have stale prices)
  },
  // Cronos Mainnet (Chain ID: 25)
  25: {
    name: "Cronos Mainnet",
    depositToken: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59", // Real USDC
    assetTokens: [
      "0x062E66477Faf219F25D27dCED647BF57C3107d52", // WBTC
      "0xe44Fd7fCb2b1581822D0c862B68222998a0c299a", // WETH
      "0x0000000000000000000000000000000000000000", // SUI (not on Cronos)
      "0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23", // WCRO
    ],
    priceStaleThreshold: 300, // 5 minutes for mainnet
  },
};

async function main() {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║   COMMUNITY POOL V2 DEPLOYMENT                                    ║");
  console.log("║   AI-Managed Investment Pool with Pyth Oracle Integration         ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝");
  console.log("\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  
  console.log("📋 Deployer Info:");
  console.log("   Address:", deployer.address);
  console.log("   Balance:", ethers.formatEther(balance), "CRO");
  console.log("\n");

  // Get network config
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const config = NETWORK_CONFIG[chainId];
  
  if (!config) {
    throw new Error(`Unsupported network! Chain ID: ${chainId}`);
  }
  
  console.log("🌐 Network:", config.name, `(Chain ID: ${chainId})`);
  console.log("   Deposit Token (USDC):", config.depositToken);
  console.log("   Pyth Oracle:", PYTH_ORACLE);
  console.log("\n");

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Deploy CommunityPool Contract
  // ═══════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   STEP 1: Deploy CommunityPool (UUPS Proxy)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const CommunityPool = await ethers.getContractFactory("CommunityPool");
  
  console.log("Deploying proxy...");
  const pool = await upgrades.deployProxy(
    CommunityPool,
    [
      config.depositToken,
      config.assetTokens,
      deployer.address, // treasury
      deployer.address, // admin
    ],
    {
      initializer: "initialize",
      kind: "uups",
      timeout: 120000, // 2 minutes timeout
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
  const tx1 = await pool.setPythOracle(PYTH_ORACLE, { gasLimit: 100000 });
  await tx1.wait();
  console.log("✅ Pyth Oracle set to:", PYTH_ORACLE);

  // Set all price IDs
  console.log("\nSetting Pyth Price IDs...");
  const priceIds = [
    PYTH_PRICE_IDS.BTC,
    PYTH_PRICE_IDS.ETH,
    PYTH_PRICE_IDS.SUI,
    PYTH_PRICE_IDS.CRO,
  ];
  
  console.log("   [0] BTC:", PYTH_PRICE_IDS.BTC.slice(0, 20) + "...");
  console.log("   [1] ETH:", PYTH_PRICE_IDS.ETH.slice(0, 20) + "...");
  console.log("   [2] SUI:", PYTH_PRICE_IDS.SUI.slice(0, 20) + "...");
  console.log("   [3] CRO:", PYTH_PRICE_IDS.CRO.slice(0, 20) + "...");
  
  const tx2 = await pool.setAllPriceIds(priceIds, { gasLimit: 200000 });
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
  }

  // Get pool stats
  const stats = await pool.getPoolStats();
  console.log("\nPool Stats:");
  console.log("   Total Shares:", ethers.formatUnits(stats._totalShares, 18));
  console.log("   Total NAV:", ethers.formatUnits(stats._totalNAV, 6), "USDC");
  console.log("   Members:", stats._memberCount.toString());
  console.log("   Allocations:", stats._allocations.map(a => a.toString() + " bps").join(", "));

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
    },
    configuration: {
      depositToken: config.depositToken,
      pythOracle: PYTH_ORACLE,
      priceIds: PYTH_PRICE_IDS,
      priceStaleThreshold: config.priceStaleThreshold,
      treasury: deployer.address,
      admin: deployer.address,
    },
    previousContract: "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30", // For reference
  };

  // Save to deployments folder
  const deploymentsDir = path.join(__dirname, "..", "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const filename = `community-pool-v2-${chainId === 338 ? 'testnet' : 'mainnet'}.json`;
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
  console.log("\n");
  console.log("🔧 Next Steps:");
  console.log("   1. Update COMMUNITY_POOL_ADDRESS in:");
  console.log("      - app/api/community-pool/route.ts");
  console.log("      - components/dashboard/CommunityPool.tsx");
  console.log("");
  console.log("   2. Migrate user deposits from old contract if needed");
  console.log("");
  console.log("   3. Grant AGENT_ROLE to your hedging backend:");
  console.log(`      await pool.grantRole(AGENT_ROLE, "<backend-address>");`);
  console.log("");
  console.log("   4. Test with a small deposit to verify Pyth pricing:");
  console.log(`      npx hardhat run scripts/test-pool-deposit.cjs --network ${chainId === 338 ? 'cronos-testnet' : 'cronos-mainnet'}`);
  console.log("\n");
  
  return {
    proxy: proxyAddress,
    implementation: implAddress,
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
