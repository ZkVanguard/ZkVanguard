/**
 * Fix staleness issues - refresh MockPyth prices and increase threshold
 */
const hre = require("hardhat");

const POOL_ADDRESS = "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30";
const MOCK_PYTH_ADDRESS = "0xF4e7F4567Da55eE60dF5193394268E1335d3BEA6";

const POOL_ABI = [
  "function priceStaleThreshold() external view returns (uint256)",
  "function setPriceStaleThreshold(uint256 threshold) external"
];

const MOCK_PYTH_ABI = [
  "function refreshPrices() external"
];

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("Signer:", signer.address);

  // Check and set staleness threshold
  const pool = new hre.ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);
  const currentThreshold = await pool.priceStaleThreshold();
  console.log("Current staleness threshold:", currentThreshold.toString(), "seconds");

  // Set to 1 day (86400 seconds)
  if (Number(currentThreshold) < 86400) {
    console.log("Setting threshold to 86400 seconds (1 day)...");
    const tx1 = await pool.setPriceStaleThreshold(86400);
    await tx1.wait();
    console.log("✅ Threshold updated");
  }

  // Refresh MockPyth prices
  console.log("\nRefreshing MockPyth prices...");
  const mockPyth = new hre.ethers.Contract(MOCK_PYTH_ADDRESS, MOCK_PYTH_ABI, signer);
  const tx2 = await mockPyth.refreshPrices();
  await tx2.wait();
  console.log("✅ MockPyth prices refreshed");

  // Verify
  const newThreshold = await pool.priceStaleThreshold();
  console.log("\nFinal staleness threshold:", newThreshold.toString(), "seconds");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
