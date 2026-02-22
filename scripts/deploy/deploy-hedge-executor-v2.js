/**
 * Deploy HedgeExecutorV2 with 20% Performance Fee
 * 
 * For Cronos Mainnet deployment with Moonlander
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-hedge-executor-v2.js --network cronosMainnet
 */

const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   HedgeExecutorV2 Deployment - 20% Performance Fee");
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
      collateralToken: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59",
      // Moonlander Router - REPLACE WITH ACTUAL MAINNET ADDRESS
      moonlanderRouter: process.env.MOONLANDER_MAINNET_ROUTER || "0x0000000000000000000000000000000000000000",
      // ZKHedgeCommitment - will deploy or use existing
      zkCommitment: process.env.ZK_COMMITMENT_MAINNET || "0x0000000000000000000000000000000000000000",
      networkName: "Cronos Mainnet",
    };
  } else if (chainId === 338) {
    // Cronos Testnet
    console.log("🧪 Network: Cronos Testnet (Chain ID: 338)\n");
    config = {
      // DevUSDCe on Testnet
      collateralToken: "0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0",
      // MockMoonlander on Testnet
      moonlanderRouter: "0xAc232e53c71891B5FfA2Da55b7A6E20df8C9fD16",
      // ZKHedgeCommitment on Testnet
      zkCommitment: "0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8",
      networkName: "Cronos Testnet",
    };
  } else {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  console.log("Configuration:");
  console.log("  Collateral Token (USDC):", config.collateralToken);
  console.log("  Moonlander Router:", config.moonlanderRouter);
  console.log("  ZK Commitment:", config.zkCommitment);
  console.log("");

  // Validate addresses
  if (config.moonlanderRouter === "0x0000000000000000000000000000000000000000") {
    console.log("⚠️  WARNING: Moonlander Router is zero address!");
    console.log("   Set MOONLANDER_MAINNET_ROUTER env var before mainnet deployment.\n");
    
    if (chainId === 25) {
      throw new Error("Cannot deploy to mainnet with zero Moonlander address");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // DEPLOY HEDGE EXECUTOR V2
  // ═══════════════════════════════════════════════════════════════

  console.log("Deploying HedgeExecutorV2 (UUPS Upgradeable)...\n");

  const HedgeExecutorV2 = await ethers.getContractFactory("HedgeExecutorV2");
  
  const hedgeExecutor = await upgrades.deployProxy(
    HedgeExecutorV2,
    [
      config.collateralToken,
      config.moonlanderRouter,
      config.zkCommitment,
      deployer.address, // Admin
    ],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );

  await hedgeExecutor.waitForDeployment();
  const proxyAddress = await hedgeExecutor.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("✅ HedgeExecutorV2 deployed!");
  console.log("   Proxy:", proxyAddress);
  console.log("   Implementation:", implAddress);
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // VERIFY CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  const feeConfig = await hedgeExecutor.getFeeConfig();
  console.log("Fee Configuration:");
  console.log("  Execution Fee:", Number(feeConfig._executionFeeBps) / 100, "%");
  console.log("  Performance Fee:", Number(feeConfig._performanceFeeBps) / 100, "%");
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("Contract Addresses:");
  console.log("  HedgeExecutorV2 (Proxy):", proxyAddress);
  console.log("  Implementation:", implAddress);
  console.log("");

  console.log("Fee Structure:");
  console.log("  • Execution Fee: 0.1% on all hedges");
  console.log("  • Performance Fee: 20% on profitable hedges only");
  console.log("  • Users keep 80% of all profits");
  console.log("");

  console.log("Admin Functions:");
  console.log("  • withdrawFees(address) - Withdraw all accumulated fees");
  console.log("  • withdrawPerformanceFees(address) - Withdraw performance fees only");
  console.log("  • setPerformanceFeeRate(uint256) - Adjust performance fee (max 50%)");
  console.log("");

  console.log("Verification Command:");
  console.log(`  npx hardhat verify --network ${chainId === 25 ? 'cronosMainnet' : 'cronosTestnet'} ${implAddress}`);
  console.log("");

  // Save deployment info
  const deploymentInfo = {
    network: config.networkName,
    chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      hedgeExecutorV2Proxy: proxyAddress,
      hedgeExecutorV2Implementation: implAddress,
      collateralToken: config.collateralToken,
      moonlanderRouter: config.moonlanderRouter,
      zkCommitment: config.zkCommitment,
    },
    feeConfig: {
      executionFeeBps: Number(feeConfig._executionFeeBps),
      performanceFeeBps: Number(feeConfig._performanceFeeBps),
    },
  };

  const fs = require("fs");
  const filename = `deployments/hedge-executor-v2-${chainId === 25 ? 'mainnet' : 'testnet'}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log(`Deployment info saved to: ${filename}`);

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
