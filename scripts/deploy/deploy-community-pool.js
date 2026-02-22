/**
 * Deploy CommunityPool - AI-Managed Community Investment Pool
 * 
 * For Cronos Mainnet/Testnet deployment
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-community-pool.js --network cronosTestnet
 *   npx hardhat run scripts/deploy/deploy-community-pool.js --network cronosMainnet
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   CommunityPool Deployment - AI-Managed Investment Pool");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CRO\n");

  // ═══════════════════════════════════════════════════════════════
  // NETWORK CONFIGURATION
  // ═══════════════════════════════════════════════════════════════
  
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  
  let config;
  
  if (chainId === 25) {
    // Cronos Mainnet
    console.log("🌐 Network: Cronos Mainnet (Chain ID: 25)\n");
    config = {
      // Real USDC on Cronos Mainnet
      depositToken: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59",
      // Real asset tokens on Cronos
      assetTokens: [
        "0x062E66477Faf219F25D27dCED647BF57C3107d52", // WBTC
        "0xe44Fd7fCb2b1581822D0c862B68222998a0c299a", // WETH
        "0x0000000000000000000000000000000000000000", // SUI (not on Cronos - placeholder)
        "0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23", // WCRO
      ],
      treasury: deployer.address,
      networkName: "Cronos Mainnet",
    };
  } else if (chainId === 338) {
    // Cronos Testnet
    console.log("🧪 Network: Cronos Testnet (Chain ID: 338)\n");
    
    // Load from existing deployment if available
    let existingDeployment;
    try {
      existingDeployment = require("../../deployments/cronos-testnet.json");
    } catch (e) {
      // Use fallback addresses
    }
    
    config = {
      // MockUSDC or DevUSDCe
      depositToken: existingDeployment?.MockUSDC || "0x28217daddC55e3C4831b4A48A00Ce04880786967",
      // Mock/test asset tokens (use zero address for assets not available)
      assetTokens: [
        "0x0000000000000000000000000000000000000000", // WBTC (mock)
        "0x0000000000000000000000000000000000000000", // WETH (mock)
        "0x0000000000000000000000000000000000000000", // SUI
        "0x0000000000000000000000000000000000000000", // WCRO
      ],
      treasury: deployer.address,
      networkName: "Cronos Testnet",
    };
  } else {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  // Ensure proper checksummed addresses
  config.depositToken = ethers.getAddress(config.depositToken);
  config.assetTokens = config.assetTokens.map(addr => ethers.getAddress(addr));

  console.log("Configuration:");
  console.log("  Deposit Token (USDC):", config.depositToken);
  console.log("  Treasury:", config.treasury);
  console.log("  Asset Tokens:");
  console.log("    BTC:", config.assetTokens[0]);
  console.log("    ETH:", config.assetTokens[1]);
  console.log("    SUI:", config.assetTokens[2]);
  console.log("    CRO:", config.assetTokens[3]);
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // DEPLOY COMMUNITY POOL
  // ═══════════════════════════════════════════════════════════════

  console.log("Deploying CommunityPool (UUPS Upgradeable)...\n");

  const CommunityPool = await ethers.getContractFactory("CommunityPool");
  
  const communityPool = await upgrades.deployProxy(
    CommunityPool,
    [
      config.depositToken,
      config.assetTokens,
      config.treasury,
      deployer.address,
    ],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );

  await communityPool.waitForDeployment();
  
  const poolAddress = await communityPool.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(poolAddress);

  console.log("✅ CommunityPool deployed!");
  console.log("   Proxy:", poolAddress);
  console.log("   Implementation:", implementationAddress);
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // VERIFY DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════

  console.log("Verifying deployment...\n");

  const stats = await communityPool.getPoolStats();
  console.log("Pool Stats:");
  console.log("  Total Shares:", stats._totalShares.toString());
  console.log("  Total NAV:", ethers.formatUnits(stats._totalNAV, 6), "USDC");
  console.log("  Member Count:", stats._memberCount.toString());
  console.log("  Share Price:", ethers.formatUnits(stats._sharePrice, 18));
  console.log("  Allocations: BTC", stats._allocations[0].toString(), "bps,",
              "ETH", stats._allocations[1].toString(), "bps,",
              "SUI", stats._allocations[2].toString(), "bps,",
              "CRO", stats._allocations[3].toString(), "bps");
  console.log("");

  // Verify roles
  const AGENT_ROLE = await communityPool.AGENT_ROLE();
  const REBALANCER_ROLE = await communityPool.REBALANCER_ROLE();
  
  const hasAgentRole = await communityPool.hasRole(AGENT_ROLE, deployer.address);
  const hasRebalancerRole = await communityPool.hasRole(REBALANCER_ROLE, deployer.address);
  
  console.log("Roles:");
  console.log("  Deployer has AGENT_ROLE:", hasAgentRole);
  console.log("  Deployer has REBALANCER_ROLE:", hasRebalancerRole);
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // SAVE DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════

  const deploymentFile = chainId === 25 
    ? "../../deployments/cronos-mainnet-community-pool.json"
    : "../../deployments/community-pool.json";
    
  const deploymentPath = path.join(__dirname, deploymentFile);
  
  const deployment = {
    network: config.networkName,
    chainId,
    timestamp: new Date().toISOString(),
    contracts: {
      CommunityPool: {
        proxy: poolAddress,
        implementation: implementationAddress,
      },
    },
    config: {
      depositToken: config.depositToken,
      assetTokens: config.assetTokens,
      treasury: config.treasury,
      managementFeeBps: 50,
      performanceFeeBps: 1000,
    },
    deployer: deployer.address,
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("📁 Deployment saved to:", deploymentFile);
  
  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("                    DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log("CommunityPool is now live!");
  console.log("");
  console.log("Features:");
  console.log("  • Share-based ownership (deposit USDC → receive shares)");
  console.log("  • Fair withdrawals (burn shares → receive NAV)");
  console.log("  • AI-driven allocation between BTC, ETH, SUI, CRO");
  console.log("  • Self-sustaining: 0.5% management + 10% performance fee");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Grant REBALANCER_ROLE to AI agent address");
  console.log("  2. Configure price oracle for accurate NAV");
  console.log("  3. Set up DEX router for rebalancing swaps");
  console.log("  4. Update frontend to use contract address:", poolAddress);
  console.log("");

  return { poolAddress, implementationAddress };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
