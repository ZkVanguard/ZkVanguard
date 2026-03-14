/**
 * Deploy fresh CommunityPool on Arbitrum Sepolia with proper initialization
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Arbitrum Sepolia addresses
const PYTH_ORACLE = "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF";

// Pyth Price Feed IDs (universal across all chains)
const PYTH_BTC_USD = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const PYTH_ETH_USD = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const PYTH_SUI_USD = "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744";
const PYTH_ARB_USD = "0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5";

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   Deploy Fresh CommunityPool on Arbitrum Sepolia");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Load existing deployment to get MockUSDC
  const deploymentPath = path.join(__dirname, "../deployments/community-pool-arbitrum-sepolia.json");
  let existingDeployment = {};
  if (fs.existsSync(deploymentPath)) {
    existingDeployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    console.log("Found existing deployment");
  }

  // Use existing MockUSDC or deploy new one
  let mockUSDC;
  if (existingDeployment.contracts?.MockUSDC) {
    console.log("Using existing MockUSDC:", existingDeployment.contracts.MockUSDC);
    mockUSDC = await ethers.getContractAt("MockUSDC", existingDeployment.contracts.MockUSDC);
  } else {
    console.log("Deploying new MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    console.log("MockUSDC deployed:", await mockUSDC.getAddress());
  }

  const usdcAddress = await mockUSDC.getAddress();

  // Deploy CommunityPool with proper initialization
  console.log("\nDeploying CommunityPool proxy...");
  const CommunityPool = await ethers.getContractFactory("CommunityPool");
  
  // Asset tokens array (use zero addresses for testnet - we'll use Pyth for pricing)
  const assetTokens = [
    ethers.ZeroAddress, // BTC (no wrapped BTC on testnet)
    ethers.ZeroAddress, // ETH
    ethers.ZeroAddress, // SUI
    ethers.ZeroAddress  // ARB
  ];
  
  const pool = await upgrades.deployProxy(
    CommunityPool,
    [
      usdcAddress,           // depositToken
      assetTokens,           // asset tokens array
      deployer.address,      // treasury  
      deployer.address       // admin
    ],
    {
      kind: 'uups',
      initializer: 'initialize',
      unsafeAllow: ['delegatecall'],
    }
  );
  
  await pool.waitForDeployment();
  const proxyAddress = await pool.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  
  console.log("✅ CommunityPool deployed!");
  console.log("   Proxy:", proxyAddress);
  console.log("   Implementation:", implAddress);

  // Configure Pyth Oracle
  console.log("\nConfiguring Pyth Oracle...");
  let tx = await pool.setPythOracle(PYTH_ORACLE);
  await tx.wait();
  console.log("✅ Pyth Oracle set:", PYTH_ORACLE);

  // Configure price feed IDs (use setAllPriceIds for efficiency)
  console.log("\nSetting Pyth price feed IDs...");
  tx = await pool.setAllPriceIds([PYTH_BTC_USD, PYTH_ETH_USD, PYTH_SUI_USD, PYTH_ARB_USD]);
  await tx.wait();
  console.log("✅ Price feed IDs configured");

  // Verify initialization
  console.log("\nVerifying initialization...");
  const name = await pool.name();
  const symbol = await pool.symbol();
  const depositToken = await pool.depositToken();
  const treasury = await pool.treasury();
  
  console.log("   Name:", name);
  console.log("   Symbol:", symbol);
  console.log("   Deposit Token:", depositToken);
  console.log("   Treasury:", treasury);

  // Mint test USDC
  console.log("\nMinting test USDC...");
  tx = await mockUSDC.mint(deployer.address, 10000n * 10n**6n);
  await tx.wait();
  const bal = await mockUSDC.balanceOf(deployer.address);
  console.log("✅ USDC Balance:", ethers.formatUnits(bal, 6));

  // Test deposit
  console.log("\nTesting deposit (100 USDC)...");
  tx = await mockUSDC.approve(proxyAddress, ethers.MaxUint256);
  await tx.wait();
  
  tx = await pool.deposit(100n * 10n**6n, 0n);
  const receipt = await tx.wait();
  console.log("✅ Deposit successful! Gas:", receipt.gasUsed.toString());

  const shares = await pool.balanceOf(deployer.address);
  console.log("   Shares received:", ethers.formatEther(shares));

  // Test withdraw
  console.log("\nTesting withdraw (50 shares)...");
  const withdrawShares = shares / 2n;
  tx = await pool.withdraw(withdrawShares, 0n); // withdraw(shares, minOut)
  const withdrawReceipt = await tx.wait();
  console.log("✅ Withdraw successful! Gas:", withdrawReceipt.gasUsed.toString());

  const newShares = await pool.balanceOf(deployer.address);
  const newUSDC = await mockUSDC.balanceOf(deployer.address);
  console.log("   Remaining shares:", ethers.formatEther(newShares));
  console.log("   USDC Balance:", ethers.formatUnits(newUSDC, 6));

  // Save deployment
  const deployment = {
    network: "Arbitrum Sepolia",
    chainId: 421614,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      CommunityPool: {
        proxy: proxyAddress,
        implementation: implAddress
      },
      MockUSDC: usdcAddress
    },
    configuration: {
      depositToken: usdcAddress,
      pythOracle: PYTH_ORACLE,
      priceIds: {
        BTC: PYTH_BTC_USD,
        ETH: PYTH_ETH_USD,
        SUI: PYTH_SUI_USD,
        ARB: PYTH_ARB_USD
      },
      treasury: deployer.address,
      admin: deployer.address
    },
    verified: {
      deposit: true,
      withdraw: true
    }
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("\n✅ Deployment saved to:", deploymentPath);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   ARBITRUM SEPOLIA DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   Pool Proxy:", proxyAddress);
  console.log("   MockUSDC:", usdcAddress);
  console.log("   Deposit: ✅ WORKING");
  console.log("   Withdraw: ✅ WORKING");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
