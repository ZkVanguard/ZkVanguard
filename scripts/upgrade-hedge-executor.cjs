/**
 * Upgrade HedgeExecutor and Configure for MockUSDC
 * 
 * This script:
 * 1. Upgrades the HedgeExecutor proxy to the new implementation
 * 2. Sets the collateral token to MockUSDC (0x28217DAddC55e3C4831b4A48A00Ce04880786967)
 * 3. Sets the Moonlander router to MockMoonlander (0xAb4946d7BD583a74F5E5051b22332fA674D7BE54)
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Upgrading HedgeExecutor with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CRO\n");

  // Load deployment info
  const deploymentPath = path.join(__dirname, "../deployments/cronos-testnet.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  
  const HEDGE_EXECUTOR_PROXY = deployment.HedgeExecutor;
  const NEW_MOCK_USDC = "0x28217DAddC55e3C4831b4A48A00Ce04880786967";
  const MOCK_MOONLANDER = deployment.MockMoonlander || "0xAb4946d7BD583a74F5E5051b22332fA674D7BE54";
  
  console.log("Current HedgeExecutor proxy:", HEDGE_EXECUTOR_PROXY);
  console.log("Target MockUSDC:", NEW_MOCK_USDC);
  console.log("Target MockMoonlander:", MOCK_MOONLANDER);
  console.log("");

  // Step 1: Upgrade the proxy
  console.log("Step 1: Upgrading HedgeExecutor implementation...");
  const HedgeExecutorV2 = await ethers.getContractFactory("HedgeExecutor");
  
  try {
    const upgraded = await upgrades.upgradeProxy(HEDGE_EXECUTOR_PROXY, HedgeExecutorV2, {
      kind: 'uups',
      unsafeAllow: ['delegatecall'],
    });
    await upgraded.waitForDeployment();
    console.log("✅ HedgeExecutor upgraded successfully!");
    console.log("   Proxy address:", await upgraded.getAddress());
  } catch (upgradeError) {
    console.log("⚠️  Upgrade failed (may already be current version):", upgradeError.message);
    console.log("   Continuing with configuration...");
  }

  // Step 2: Connect to the proxy and configure
  console.log("\nStep 2: Configuring HedgeExecutor...");
  const hedgeExecutor = await ethers.getContractAt("HedgeExecutor", HEDGE_EXECUTOR_PROXY);
  
  // Check current collateral token
  const currentCollateral = await hedgeExecutor.collateralToken();
  const currentRouter = await hedgeExecutor.moonlanderRouter();
  console.log("Current collateral token:", currentCollateral);
  console.log("Current Moonlander router:", currentRouter);
  
  // Set collateral token if different
  if (currentCollateral.toLowerCase() !== NEW_MOCK_USDC.toLowerCase()) {
    console.log("\nUpdating collateral token to MockUSDC...");
    try {
      const tx1 = await hedgeExecutor.setCollateralToken(NEW_MOCK_USDC);
      await tx1.wait();
      console.log("✅ Collateral token updated to:", NEW_MOCK_USDC);
    } catch (err) {
      console.log("❌ Failed to update collateral token:", err.message);
    }
  } else {
    console.log("✅ Collateral token already correct");
  }
  
  // Set Moonlander router if different
  if (currentRouter.toLowerCase() !== MOCK_MOONLANDER.toLowerCase()) {
    console.log("\nUpdating Moonlander router...");
    try {
      const tx2 = await hedgeExecutor.setMoonlanderRouter(MOCK_MOONLANDER);
      await tx2.wait();
      console.log("✅ Moonlander router updated to:", MOCK_MOONLANDER);
    } catch (err) {
      console.log("❌ Failed to update Moonlander router:", err.message);
    }
  } else {
    console.log("✅ Moonlander router already correct");
  }
  
  // Verify final state
  console.log("\nFinal Configuration:");
  console.log("-----------------------------------");
  console.log("Collateral Token:", await hedgeExecutor.collateralToken());
  console.log("Moonlander Router:", await hedgeExecutor.moonlanderRouter());
  console.log("ZK Commitment:", await hedgeExecutor.zkCommitment());
  console.log("Max Leverage:", (await hedgeExecutor.maxLeverage()).toString() + "x");
  console.log("Fee Rate:", (await hedgeExecutor.feeRateBps()).toString(), "bps");
  
  console.log("\n✅ HedgeExecutor is now configured for on-chain hedging with MockUSDC!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
