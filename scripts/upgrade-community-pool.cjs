/**
 * Upgrade CommunityPool with Auto-Hedge support
 * 
 * This script:
 * 1. Upgrades the CommunityPool proxy to the new implementation with auto-hedge
 * 2. Sets the HedgeExecutor address
 * 3. Configures initial auto-hedge settings
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Upgrading CommunityPool with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CRO\n");

  // Load deployment info
  const deploymentPath = path.join(__dirname, "../deployments/community-pool.json");
  const cronosDeployment = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/cronos-testnet.json"), "utf8"));
  const poolDeployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  
  const COMMUNITY_POOL_PROXY = poolDeployment.contracts.CommunityPool.proxy;
  const HEDGE_EXECUTOR = cronosDeployment.HedgeExecutor;
  
  console.log("CommunityPool proxy:", COMMUNITY_POOL_PROXY);
  console.log("HedgeExecutor:", HEDGE_EXECUTOR);
  console.log("");

  // Step 1: Upgrade the proxy
  console.log("Step 1: Upgrading CommunityPool implementation...");
  const CommunityPool = await ethers.getContractFactory("CommunityPool");
  
  try {
    const upgraded = await upgrades.upgradeProxy(COMMUNITY_POOL_PROXY, CommunityPool, {
      kind: 'uups',
      unsafeAllow: ['delegatecall'],
    });
    await upgraded.waitForDeployment();
    console.log("✅ CommunityPool upgraded successfully!");
    console.log("   Proxy address:", await upgraded.getAddress());
  } catch (upgradeError) {
    console.log("⚠️  Upgrade failed:", upgradeError.message);
    // Try force import
    console.log("   Attempting force import...");
    try {
      await upgrades.forceImport(COMMUNITY_POOL_PROXY, CommunityPool, { kind: 'uups' });
      const upgraded = await upgrades.upgradeProxy(COMMUNITY_POOL_PROXY, CommunityPool, {
        kind: 'uups',
        unsafeAllow: ['delegatecall'],
      });
      await upgraded.waitForDeployment();
      console.log("✅ CommunityPool upgraded with force import!");
    } catch (forceError) {
      console.log("❌ Force import also failed:", forceError.message);
      return;
    }
  }

  // Step 2: Configure HedgeExecutor
  console.log("\nStep 2: Setting HedgeExecutor...");
  const pool = await ethers.getContractAt("CommunityPool", COMMUNITY_POOL_PROXY);
  
  try {
    const currentHedgeExecutor = await pool.hedgeExecutor();
    console.log("Current HedgeExecutor:", currentHedgeExecutor);
    
    if (currentHedgeExecutor === ethers.ZeroAddress || currentHedgeExecutor.toLowerCase() !== HEDGE_EXECUTOR.toLowerCase()) {
      const tx = await pool.setHedgeExecutor(HEDGE_EXECUTOR);
      await tx.wait();
      console.log("✅ HedgeExecutor set to:", HEDGE_EXECUTOR);
    } else {
      console.log("   HedgeExecutor already set correctly");
    }
  } catch (e) {
    console.log("⚠️  Could not set HedgeExecutor:", e.message);
  }

  // Step 3: Configure auto-hedge settings
  console.log("\nStep 3: Configuring auto-hedge settings...");
  try {
    // Enable auto-hedge with conservative settings:
    // - 5% drawdown triggers hedge
    // - Max 25% of NAV can be hedged
    // - Default 3x leverage
    // - 30 minute cooldown between hedges
    const tx = await pool.setAutoHedgeConfig(
      true,   // enabled
      500,    // riskThresholdBps (5%)
      2500,   // maxHedgeRatioBps (25%)
      3,      // defaultLeverage
      1800    // cooldownSeconds (30 mins)
    );
    await tx.wait();
    console.log("✅ Auto-hedge config set:");
    console.log("   - Enabled: true");
    console.log("   - Risk Threshold: 5%");
    console.log("   - Max Hedge Ratio: 25%");
    console.log("   - Default Leverage: 3x");
    console.log("   - Cooldown: 30 minutes");
  } catch (e) {
    console.log("⚠️  Could not configure auto-hedge:", e.message);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("UPGRADE COMPLETE");
  console.log("=".repeat(60));
  console.log("CommunityPool Proxy:", COMMUNITY_POOL_PROXY);
  console.log("HedgeExecutor:", HEDGE_EXECUTOR);
  
  // Verify new functions exist
  try {
    const config = await pool.getAutoHedgeConfig();
    console.log("\nAuto-hedge config verified:");
    console.log("  enabled:", config[0]);
    console.log("  riskThresholdBps:", config[1].toString());
    console.log("  maxHedgeRatioBps:", config[2].toString());
    console.log("  defaultLeverage:", config[3].toString());
    console.log("  cooldownSeconds:", config[4].toString());
  } catch (e) {
    console.log("Could not verify config:", e.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
