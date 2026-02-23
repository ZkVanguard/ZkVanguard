/**
 * Configure Pyth Oracle for CommunityPool
 * 
 * Sets up Pyth Network price feeds for BTC, ETH, CRO, SUI
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/configure-pyth.js --network cronos-testnet
 */

const { ethers } = require("hardhat");

// Contract addresses
const COMMUNITY_POOL_ADDRESS = "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30";

// Pyth Network addresses
// Cronos Testnet: https://docs.pyth.network/price-feeds/contract-addresses/evm
const PYTH_ORACLE_ADDRESS = "0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B"; // Same for mainnet/testnet

// Pyth Price IDs (Universal across all chains)
// Source: https://pyth.network/developers/price-feed-ids
const PRICE_IDS = {
  // BTC/USD
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  // ETH/USD
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  // CRO/USD (Note: May not be available on testnet - will use fallback)
  CRO: "0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe",
  // SUI/USD
  SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║      Configure Pyth Oracle for CommunityPool                  ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  console.log("📋 Configuration:");
  console.log("   Admin:", deployer.address);
  console.log("   Pool:", COMMUNITY_POOL_ADDRESS);
  console.log("   Pyth Oracle:", PYTH_ORACLE_ADDRESS);
  
  // Get pool contract
  const pool = await ethers.getContractAt("CommunityPool", COMMUNITY_POOL_ADDRESS);
  
  // Check current state
  const currentOracle = await pool.pythOracle();
  console.log("\n📊 Current State:");
  console.log("   Current Pyth Oracle:", currentOracle);
  
  // Step 1: Set Pyth Oracle address
  if (currentOracle === ethers.ZeroAddress) {
    console.log("\n🔧 Step 1: Setting Pyth Oracle address...");
    const tx1 = await pool.setPythOracle(PYTH_ORACLE_ADDRESS, { gasLimit: 100000 });
    await tx1.wait();
    console.log("   ✅ Pyth Oracle set to:", PYTH_ORACLE_ADDRESS);
  } else {
    console.log("\n✅ Pyth Oracle already configured:", currentOracle);
  }
  
  // Step 2: Set all price IDs
  console.log("\n🔧 Step 2: Setting Price IDs...");
  
  const priceIds = [
    PRICE_IDS.BTC,
    PRICE_IDS.ETH,
    PRICE_IDS.CRO,
    PRICE_IDS.SUI,
  ];
  
  console.log("   BTC:", PRICE_IDS.BTC);
  console.log("   ETH:", PRICE_IDS.ETH);
  console.log("   CRO:", PRICE_IDS.CRO);
  console.log("   SUI:", PRICE_IDS.SUI);
  
  const tx2 = await pool.setAllPriceIds(priceIds, { gasLimit: 200000 });
  await tx2.wait();
  console.log("   ✅ All price IDs configured");
  
  // Step 3: Verify configuration
  console.log("\n📊 Verifying Configuration...");
  
  const assets = ["BTC", "ETH", "CRO", "SUI"];
  for (let i = 0; i < 4; i++) {
    const storedId = await pool.pythPriceIds(i);
    const expected = priceIds[i];
    const match = storedId.toLowerCase() === expected.toLowerCase();
    console.log(`   ${assets[i]}: ${match ? '✅' : '❌'} ${storedId.slice(0, 20)}...`);
  }
  
  // Step 4: Test oracle health
  console.log("\n🏥 Testing Oracle Health...");
  try {
    const health = await pool.checkOracleHealth();
    console.log("   Overall healthy:", health.healthy);
    for (let i = 0; i < 4; i++) {
      const status = health.configured[i] ? 
        (health.working[i] ? (health.fresh[i] ? '✅ Working' : '⚠️ Stale') : '❌ Error') : 
        '⭕ Not configured';
      console.log(`   ${assets[i]}: ${status}`);
    }
  } catch (e) {
    console.log("   ⚠️ Health check not available:", e.message);
  }
  
  // Step 5: Test getting a price
  console.log("\n💰 Testing Price Fetch...");
  try {
    const btcPrice = await pool.getAssetPrice(0); // BTC
    console.log("   BTC Price:", ethers.formatUnits(btcPrice, 6), "USD");
  } catch (e) {
    console.log("   ⚠️ Price fetch failed (may need fresh update):", e.reason || e.message);
  }
  
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║      Pyth Oracle Configuration Complete!                      ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  console.log("📝 Notes:");
  console.log("   - Prices are read for FREE from Pyth");
  console.log("   - Price updates cost ~0.06 CRO per feed");
  console.log("   - Stale prices (>1 hour old) may revert");
  console.log("   - Use updatePriceFeeds() for fresh data if needed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
