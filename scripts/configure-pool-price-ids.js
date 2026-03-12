/**
 * Configure CommunityPool with Pyth price IDs
 * Required for rebalance trades to work
 */
const hre = require("hardhat");

const POOL_ADDRESS = "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30";

const POOL_ABI = [
  "function setPriceId(uint8 assetIndex, bytes32 priceId) external",
  "function pythPriceIds(uint256) external view returns (bytes32)"
];

// Pyth price feed IDs (these are real Pyth feed IDs)
const PRICE_IDS = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
  CRO: "0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71"
};

async function main() {
  console.log("============================================================");
  console.log("   CONFIGURING PYTH PRICE IDS ON COMMUNITY POOL");
  console.log("============================================================\n");

  const [signer] = await hre.ethers.getSigners();
  console.log("Signer:", signer.address);

  const pool = new hre.ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);

  const assets = ["BTC", "ETH", "SUI", "CRO"];
  
  // Check current config
  console.log("Current Configuration:");
  for (let i = 0; i < assets.length; i++) {
    const current = await pool.pythPriceIds(i);
    console.log(`  ${assets[i]}[${i}]: ${current.slice(0,18)}...`);
  }
  console.log("");

  // Set price IDs
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const priceId = PRICE_IDS[asset];
    const current = await pool.pythPriceIds(i);
    
    if (current.toLowerCase() === priceId.toLowerCase()) {
      console.log(`✅ ${asset}[${i}] already configured`);
      continue;
    }
    
    console.log(`Setting ${asset}[${i}] price ID...`);
    const tx = await pool.setPriceId(i, priceId);
    await tx.wait();
    console.log(`✅ ${asset} configured: ${priceId.slice(0,18)}...`);
  }

  console.log("\n============================================================");
  console.log("   CONFIGURATION COMPLETE");
  console.log("============================================================");

  // Verify
  console.log("\nVerifying:");
  for (let i = 0; i < assets.length; i++) {
    const current = await pool.pythPriceIds(i);
    const expected = PRICE_IDS[assets[i]];
    const match = current.toLowerCase() === expected.toLowerCase();
    console.log(`  ${assets[i]}[${i}]: ${match ? '✅' : '❌'}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
