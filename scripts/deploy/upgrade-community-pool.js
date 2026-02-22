/**
 * Upgrade CommunityPool - Lower MIN_FIRST_DEPOSIT to $100
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/upgrade-community-pool.js --network cronos-testnet
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

const deployment = require("../../deployments/community-pool.json");

const PROXY_ADDRESS = deployment.contracts.CommunityPool.proxy;

async function main() {
  const [signer] = await ethers.getSigners();
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   Upgrade CommunityPool - Lower MIN_FIRST_DEPOSIT to $100");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Signer:", signer.address);
  console.log("Proxy Address:", PROXY_ADDRESS);
  console.log("Old Implementation:", deployment.contracts.CommunityPool.implementation);
  console.log("");
  
  // Get the contract factory
  console.log("📦 Compiling new implementation...");
  const CommunityPool = await ethers.getContractFactory("CommunityPool");
  
  // Upgrade the proxy
  console.log("⬆️  Upgrading proxy to new implementation...");
  const upgraded = await upgrades.upgradeProxy(PROXY_ADDRESS, CommunityPool, {
    unsafeAllow: ['delegatecall'],
  });
  
  await upgraded.waitForDeployment();
  
  // Get new implementation address
  const newImplAddress = await upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  
  console.log("\n✅ Upgrade successful!");
  console.log("   New Implementation:", newImplAddress);
  
  // Verify the new MIN_FIRST_DEPOSIT
  const pool = await ethers.getContractAt("CommunityPool", PROXY_ADDRESS);
  const minFirstDeposit = await pool.MIN_FIRST_DEPOSIT();
  console.log("   MIN_FIRST_DEPOSIT:", ethers.formatUnits(minFirstDeposit, 6), "USDC");
  
  // Update deployment file
  const deploymentPath = path.join(__dirname, "../../deployments/community-pool.json");
  deployment.contracts.CommunityPool.implementation = newImplAddress;
  deployment.contracts.CommunityPool.previousImplementation = deployment.contracts.CommunityPool.implementation;
  deployment.lastUpgrade = new Date().toISOString();
  deployment.upgradeReason = "Lower MIN_FIRST_DEPOSIT from $1000 to $100";
  
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("\n📝 Updated deployment file");
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   Upgrade Complete!");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   First deposit minimum: $100 USDC (was $1000)");
  console.log("   Subsequent deposits: $10 USDC minimum");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
