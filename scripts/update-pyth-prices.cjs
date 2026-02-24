/**
 * Update Pyth Oracle Prices
 * Pyth is a "pull oracle" - prices must be pushed on-chain before reading
 */

const { ethers } = require("hardhat");

// Pyth Price IDs for our assets
const PYTH_PRICE_IDS = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", 
  SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
  CRO: "0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe"
};

// Cronos TESTNET Pyth address (NOT mainnet!)
const PYTH_ORACLE_ADDRESS = "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320";

// Pyth Hermes API - free price update service
const HERMES_API = "https://hermes.pyth.network/v2/updates/price/latest";

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   Update Pyth Oracle Prices on Cronos Testnet");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const [signer] = await ethers.getSigners();
  console.log("Updater:", signer.address);
  
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "tCRO\n");

  // Fetch price updates from Hermes
  console.log("📡 Fetching price updates from Pyth Hermes API...");
  
  const priceIds = Object.values(PYTH_PRICE_IDS);
  const queryString = priceIds.map(id => `ids[]=${id}`).join("&");
  const url = `${HERMES_API}?${queryString}`;
  
  let priceUpdateData;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    // Hermes returns binary data as hex strings - we need to convert them properly
    // The data array contains the VAA (Verified Action Approval) data
    priceUpdateData = data.binary.data.map(d => "0x" + d);
    console.log("✅ Got", priceUpdateData.length, "price update VAAs\n");
    
    // Log the prices
    console.log("📊 Current Prices:");
    for (const parsed of data.parsed) {
      const id = parsed.id;
      const price = parsed.price.price;
      const expo = parsed.price.expo;
      const assetName = Object.keys(PYTH_PRICE_IDS).find(k => PYTH_PRICE_IDS[k].slice(2) === id) || "Unknown";
      const humanPrice = Number(price) * Math.pow(10, expo);
      console.log(`   ${assetName}: $${humanPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    }
    console.log("");
  } catch (error) {
    console.error("❌ Failed to fetch from Hermes:", error.message);
    console.log("\nTrying alternative: using mock price data for testnet...\n");
    // For testnet, we could use mock data, but Pyth requires valid signed data
    throw new Error("Cannot proceed without valid price data from Hermes API");
  }

  // Connect to Pyth oracle
  console.log("🔗 Connecting to Pyth Oracle...");
  // Use the proper Pyth ABI
  const pythAbi = [
    "function updatePriceFeeds(bytes[] calldata updateData) external payable",
    "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
    "function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))",
    "function getPrice(bytes32 id) external view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))"
  ];
  
  const pyth = new ethers.Contract(PYTH_ORACLE_ADDRESS, pythAbi, signer);
  
  // Get the update fee - needs to match the data format
  console.log("💰 Calculating update fee...");
  console.log("   VAA data samples:", priceUpdateData.map(d => d.slice(0, 30) + "...").join(", "));
  
  let updateFee;
  try {
    updateFee = await pyth.getUpdateFee(priceUpdateData);
    console.log("   Fee:", ethers.formatEther(updateFee), "CRO\n");
  } catch (error) {
    console.log("   ⚠️  getUpdateFee failed, using 0.001 CRO as fallback");
    updateFee = ethers.parseEther("0.001");
  }

  // Send the price update transaction
  console.log("📤 Sending price update transaction...");
  try {
    // Need to specify higher gas limit for Cronos (Cosmos-based chain)
    const tx = await pyth.updatePriceFeeds(priceUpdateData, { 
      value: updateFee,
      gasLimit: 500000 // Higher gas limit for VAA verification
    });
    console.log("   Tx hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Prices updated! Gas used:", receipt.gasUsed.toString());
  } catch (error) {
    console.error("❌ Update failed:", error.message);
    throw error;
  }

  // Verify the prices are now available
  console.log("\n🔍 Verifying prices are available...");
  for (const [asset, priceId] of Object.entries(PYTH_PRICE_IDS)) {
    try {
      const priceData = await pyth.getPriceNoOlderThan(priceId, 3600);
      const humanPrice = Number(priceData.price) * Math.pow(10, Number(priceData.expo));
      console.log(`   ✅ ${asset}: $${humanPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (age: ${Math.floor(Date.now()/1000 - Number(priceData.publishTime))}s)`);
    } catch (e) {
      console.log(`   ❌ ${asset}: Failed to read price`);
    }
  }

  console.log("\n✅ Done! Oracle prices are now updated.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
