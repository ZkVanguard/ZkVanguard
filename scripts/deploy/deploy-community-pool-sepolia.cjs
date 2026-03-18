/**
 * Deploy CommunityPool to Sepolia Testnet
 * 
 * Uses official Tether WDK USDT mock for ERC-4337 testing:
 * - USDT Contract: 0xd077a400968890eacc75cdc901f0356c943e4fdb
 * - Pimlico Faucet: https://dashboard.pimlico.io/test-erc20-faucet
 * - Candide Faucet: https://dashboard.candide.dev/faucet
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-community-pool-sepolia.cjs --network sepolia
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

// WDK Official USDT Mock on Sepolia
const WDK_USDT_SEPOLIA = "0xd077a400968890eacc75cdc901f0356c943e4fdb";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   CommunityPool Deployment - Sepolia Testnet (WDK USDT)");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Deployer:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH\n");

  if (balance < ethers.parseEther("0.01")) {
    console.log("⚠️  Low ETH balance! Get Sepolia ETH from:");
    console.log("   - https://www.alchemy.com/faucets/ethereum-sepolia");
    console.log("   - https://sepoliafaucet.com/");
    return;
  }

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  
  if (chainId !== 11155111) {
    throw new Error(`Expected Sepolia (11155111), got chain ID: ${chainId}`);
  }
  
  console.log("🧪 Network: Ethereum Sepolia (Chain ID: 11155111)\n");

  const config = {
    // WDK USDT mock on Sepolia
    depositToken: WDK_USDT_SEPOLIA,
    // Placeholder asset tokens (zero address = not deployed)
    assetTokens: [
      "0x0000000000000000000000000000000000000000", // BTC
      "0x0000000000000000000000000000000000000000", // ETH
      "0x0000000000000000000000000000000000000000", // SUI
      "0x0000000000000000000000000000000000000000", // Other
    ],
    treasury: deployer.address,
    networkName: "Sepolia Testnet",
  };

  console.log("Configuration:");
  console.log("  Deposit Token (WDK USDT):", config.depositToken);
  console.log("  Treasury:", config.treasury);
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
      deployer.address, // admin
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
  console.log("  Total NAV:", ethers.formatUnits(stats._totalNAV, 6), "USD");
  console.log("  Member Count:", stats._memberCount.toString());
  console.log("  Share Price:", ethers.formatUnits(stats._sharePrice, 6));
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // SAVE DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════

  const deploymentPath = path.join(__dirname, "../../deployments/community-pool-sepolia.json");
  
  const deployment = {
    network: config.networkName,
    chainId: 11155111,
    timestamp: new Date().toISOString(),
    contracts: {
      CommunityPool: {
        proxy: poolAddress,
        implementation: implementationAddress,
      },
    },
    tokens: {
      USDT: WDK_USDT_SEPOLIA,
      faucets: {
        pimlico: "https://dashboard.pimlico.io/test-erc20-faucet",
        candide: "https://dashboard.candide.dev/faucet",
      },
    },
    aa: {
      entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      pimlico: {
        bundlerUrl: "https://public.pimlico.io/v2/11155111/rpc",
        paymasterUrl: "https://public.pimlico.io/v2/11155111/rpc",
        paymasterAddress: "0x777777777777AeC03fd955926DbF81597e66834C",
      },
      candide: {
        bundlerUrl: "https://api.candide.dev/public/v3/11155111",
        paymasterUrl: "https://api.candide.dev/public/v3/11155111",
        paymasterAddress: "0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba",
      },
    },
    config: {
      depositToken: config.depositToken,
      assetTokens: config.assetTokens,
      treasury: config.treasury,
    },
    deployer: deployer.address,
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("📁 Deployment saved to: deployments/community-pool-sepolia.json");
  
  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("                    DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log("CommunityPool is now live on Sepolia!");
  console.log("");
  console.log("📍 Contract Addresses:");
  console.log("   Pool Proxy:", poolAddress);
  console.log("   WDK USDT:", WDK_USDT_SEPOLIA);
  console.log("");
  console.log("🔗 Get Test USDT:");
  console.log("   Pimlico: https://dashboard.pimlico.io/test-erc20-faucet");
  console.log("   Candide: https://dashboard.candide.dev/faucet");
  console.log("");
  console.log("🔗 View on Etherscan:");
  console.log("   https://sepolia.etherscan.io/address/" + poolAddress);
  console.log("");

  return { poolAddress, implementationAddress };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
