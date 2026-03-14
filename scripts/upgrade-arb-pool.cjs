/**
 * Upgrade CommunityPool on Arbitrum Sepolia
 */

const { ethers, upgrades } = require("hardhat");

const PROXY = "0xfd6B402b860aD57f1393E2b60E1D676b57e0E63B";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Upgrading CommunityPool with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");
  console.log("Target proxy:", PROXY);
  
  const CommunityPool = await ethers.getContractFactory("CommunityPool");
  
  console.log("\nAttempting force import...");
  try {
    await upgrades.forceImport(PROXY, CommunityPool, { kind: 'uups' });
    console.log("✅ Force imported");
  } catch (e) {
    console.log("⚠️  Force import error (may be already imported):", e.message.slice(0, 100));
  }
  
  console.log("\nUpgrading proxy...");
  const upgraded = await upgrades.upgradeProxy(PROXY, CommunityPool, {
    kind: 'uups',
    unsafeAllow: ['delegatecall'],
  });
  await upgraded.waitForDeployment();
  
  const newImpl = await upgrades.erc1967.getImplementationAddress(PROXY);
  console.log("\n✅ CommunityPool upgraded successfully!");
  console.log("   Proxy:", PROXY);
  console.log("   New implementation:", newImpl);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
