/**
 * Update CommunityPool Treasury to ZKProxyVault
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/set-treasury-zkvault.js --network cronos-testnet
 */

const { ethers } = require("hardhat");

const communityPoolDeployment = require("../../deployments/community-pool.json");
const zkVaultDeployment = require("../../deployments/zk-proxy-vault.json");

const POOL_ADDRESS = communityPoolDeployment.contracts.CommunityPool.proxy;
const ZK_VAULT_ADDRESS = zkVaultDeployment.contracts.ZKProxyVault.proxy;

async function main() {
  const [signer] = await ethers.getSigners();
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   Update CommunityPool Treasury to ZKProxyVault");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Signer:", signer.address);
  console.log("CommunityPool:", POOL_ADDRESS);
  console.log("ZKProxyVault:", ZK_VAULT_ADDRESS);
  console.log("");
  
  const pool = await ethers.getContractAt("CommunityPool", POOL_ADDRESS, signer);
  
  // Check current treasury
  const currentTreasury = await pool.treasury();
  console.log("Current Treasury:", currentTreasury);
  
  if (currentTreasury.toLowerCase() === ZK_VAULT_ADDRESS.toLowerCase()) {
    console.log("\n✅ Treasury already set to ZKProxyVault!");
    return;
  }
  
  // Update treasury
  console.log("\n📝 Setting treasury to ZKProxyVault...");
  const tx = await pool.setTreasury(ZK_VAULT_ADDRESS);
  console.log("TX:", tx.hash);
  await tx.wait();
  
  // Verify
  const newTreasury = await pool.treasury();
  console.log("\n✅ Treasury updated successfully!");
  console.log("New Treasury:", newTreasury);
  
  // Benefits
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   ZKProxyVault Benefits:");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   • 24-hour time-lock on large withdrawals (>10 ETH)");
  console.log("   • ZK-STARK verification for all transfers");
  console.log("   • Guardian can cancel suspicious transactions");
  console.log("   • Emergency pause functionality");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
