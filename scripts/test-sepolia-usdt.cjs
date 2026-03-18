/**
 * Test WDK USDT on Sepolia and deploy simple pool
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

const WDK_USDT_SEPOLIA = "0xd077a400968890eacc75cdc901f0356c943e4fdb";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   Testing WDK USDT on Sepolia");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Deployer:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("ETH Balance:", ethers.formatEther(balance), "ETH\n");

  // Check WDK USDT token
  console.log("Checking WDK USDT at:", WDK_USDT_SEPOLIA);
  
  const usdtAbi = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
  ];
  
  const usdt = new ethers.Contract(WDK_USDT_SEPOLIA, usdtAbi, deployer);
  
  try {
    const name = await usdt.name();
    const symbol = await usdt.symbol();
    const decimals = await usdt.decimals();
    const myBalance = await usdt.balanceOf(deployer.address);
    const totalSupply = await usdt.totalSupply();
    
    console.log("✅ WDK USDT Token Info:");
    console.log("   Name:", name);
    console.log("   Symbol:", symbol);
    console.log("   Decimals:", decimals);
    console.log("   Total Supply:", ethers.formatUnits(totalSupply, decimals));
    console.log("   Your Balance:", ethers.formatUnits(myBalance, decimals));
    console.log("");
    
    // Try to deploy a simple CommunityPool
    console.log("Deploying CommunityPool with WDK USDT...\n");
    
    const CommunityPool = await ethers.getContractFactory("CommunityPool");
    
    // Deploy without proxy first to test
    const assetTokens = [
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
    ];
    
    // Try with gas limit
    console.log("Attempting proxy deployment...");
    
    const communityPool = await upgrades.deployProxy(
      CommunityPool,
      [
        WDK_USDT_SEPOLIA,
        assetTokens,
        deployer.address, // treasury
        deployer.address, // admin
      ],
      {
        initializer: "initialize",
        kind: "uups",
        gasLimit: 5000000,
      }
    );

    await communityPool.waitForDeployment();
    
    const poolAddress = await communityPool.getAddress();
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(poolAddress);

    console.log("✅ CommunityPool deployed!");
    console.log("   Proxy:", poolAddress);
    console.log("   Implementation:", implementationAddress);
    
    // Save deployment
    const deployment = {
      network: "Sepolia Testnet",
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
      },
      deployer: deployer.address,
    };

    const deploymentPath = path.join(__dirname, "../deployments/community-pool-sepolia.json");
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
    console.log("📁 Saved to deployments/community-pool-sepolia.json");
    
    console.log("\n🔗 View on Etherscan:");
    console.log("   https://sepolia.etherscan.io/address/" + poolAddress);
    
  } catch (error) {
    console.error("Error:", error.message);
    if (error.data) {
      console.error("Error data:", error.data);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
