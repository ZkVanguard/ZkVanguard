/**
 * Update Pyth prices on Cronos Testnet
 * 
 * This script pushes fresh prices from Hermes API to the on-chain Pyth Oracle.
 * Run this before testing the pool when prices become stale.
 */

const { ethers } = require("hardhat");

// Cronos Testnet Configuration
const CONFIG = {
  pythOracle: "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320",
  priceIds: {
    BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
    CRO: "0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71"
  }
};

// Pyth Hermes API - Pyth v2 update endpoint
const HERMES_API = "https://hermes.pyth.network/v2/updates/price/latest";

const PYTH_ABI = [
  "function updatePriceFeeds(bytes[] calldata updateData) external payable",
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
  "function getPriceUnsafe(bytes32 id) external view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))"
];

async function main() {
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     PYTH PRICE UPDATE - CRONOS TESTNET                        ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  const [signer] = await ethers.getSigners();
  console.log(`🔑 Account: ${signer.address}`);
  
  const balance = await ethers.provider.getBalance(signer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} CRO\n`);
  
  // Build price request - strip 0x prefix for API
  const priceIds = Object.values(CONFIG.priceIds);
  const queryString = priceIds.map(id => `ids[]=${id.startsWith('0x') ? id.slice(2) : id}`).join("&");
  const url = `${HERMES_API}?${queryString}`;
  
  console.log("📡 Fetching prices from Hermes API...");
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Hermes API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Log fetched prices
  console.log("\n   Current Prices:");
  for (const parsed of data.parsed) {
    const id = parsed.id;
    const price = parsed.price.price;
    const expo = parsed.price.expo;
    const assetName = Object.keys(CONFIG.priceIds).find(k => CONFIG.priceIds[k].slice(2) === id) || "Unknown";
    const humanPrice = Number(price) * Math.pow(10, expo);
    console.log(`   ${assetName}: $${humanPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  }
  
  // Convert to bytes
  const priceUpdateData = data.binary.data.map(d => "0x" + d);
  
  // Get Pyth contract
  const pyth = new ethers.Contract(CONFIG.pythOracle, PYTH_ABI, signer);
  
  // Get update fee
  let updateFee;
  try {
    updateFee = await pyth.getUpdateFee(priceUpdateData);
    console.log(`\n💰 Update fee: ${ethers.formatEther(updateFee)} CRO`);
  } catch (e) {
    // Fallback fee
    updateFee = ethers.parseEther("0.001");
    console.log(`\n💰 Using fallback fee: ${ethers.formatEther(updateFee)} CRO`);
  }
  
  // Submit update
  console.log("\n📤 Pushing prices on-chain...");
  
  const tx = await pyth.updatePriceFeeds(priceUpdateData, {
    value: updateFee,
    gasLimit: 500000
  });
  
  console.log(`   Transaction: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`   ✅ Prices updated! Gas used: ${receipt.gasUsed.toString()}`);
  
  // Verify prices
  console.log("\n📋 Verifying on-chain prices:");
  for (const [name, id] of Object.entries(CONFIG.priceIds)) {
    try {
      const priceData = await pyth.getPriceUnsafe(id);
      const humanPrice = Number(priceData.price) * Math.pow(10, Number(priceData.expo));
      console.log(`   ${name}: $${humanPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    } catch (e) {
      console.log(`   ${name}: ❌ Error reading price`);
    }
  }
  
  console.log("\n✅ Done!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
