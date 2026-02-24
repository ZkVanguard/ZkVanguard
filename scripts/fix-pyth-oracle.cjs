/**
 * Update CommunityPool Pyth Oracle address
 * Fixes: Wrong oracle address (mainnet vs testnet)
 */

const { ethers } = require("hardhat");

// Correct Cronos TESTNET Pyth address
const CORRECT_PYTH_TESTNET = "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320";
const COMMUNITY_POOL_V2 = "0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B";

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   Fix CommunityPool Pyth Oracle Address");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const [signer] = await ethers.getSigners();
  console.log("Admin:", signer.address);

  // Get the pool contract
  const pool = await ethers.getContractAt("CommunityPool", COMMUNITY_POOL_V2);

  // Check current oracle
  const currentOracle = await pool.pythOracle();
  console.log("Current Oracle:", currentOracle);
  console.log("Correct Oracle:", CORRECT_PYTH_TESTNET);

  if (currentOracle.toLowerCase() === CORRECT_PYTH_TESTNET.toLowerCase()) {
    console.log("\n✅ Oracle is already correct!");
    return;
  }

  console.log("\n🔧 Updating Pyth Oracle address...");
  const tx = await pool.setPythOracle(CORRECT_PYTH_TESTNET);
  console.log("   Tx hash:", tx.hash);
  await tx.wait();
  console.log("✅ Oracle updated!");

  // Verify
  const newOracle = await pool.pythOracle();
  console.log("\n✅ Verified new oracle:", newOracle);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
