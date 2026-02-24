/**
 * Update Pyth prices on Cronos Mainnet
 * 
 * This script pushes fresh prices from Hermes API to the on-chain Pyth Oracle.
 * Run this before testing the pool or when prices become stale.
 * 
 * Usage: npx hardhat run scripts/update-pyth-prices-mainnet.cjs --network cronos-mainnet
 */

const { ethers } = require("hardhat");

// Cronos Mainnet Configuration
const CONFIG = {
  pythOracle: "0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B",
  priceIds: {
    BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
    CRO: "0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe"
  }
};

// Pyth Hermes API - use production endpoint
const HERMES_API = "https://hermes.pyth.network/v2/updates/price/latest";

const PYTH_ABI = [
  "function updatePriceFeeds(bytes[] calldata updateData) external payable",
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
  "function getPriceUnsafe(bytes32 id) external view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))"
];

async function main() {
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     PYTH PRICE UPDATE - CRONOS MAINNET                        ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  const [signer] = await ethers.getSigners();
  console.log(`🔑 Account: ${signer.address}`);
  
  const balance = await ethers.provider.getBalance(signer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} CRO\n`);
  
  // Verify network
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 25) {
    console.log("❌ ERROR: Not on Cronos Mainnet. Aborting.");
    process.exit(1);
  }
  
  // Build price request
  const priceIds = Object.values(CONFIG.priceIds);
  const queryString = priceIds.map(id => `ids[]=${id}`).join("&");
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
  console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
  
  // Verify prices on-chain
  console.log("\n🔍 Verifying on-chain prices...");
  
  for (const [name, id] of Object.entries(CONFIG.priceIds)) {
    try {
      const priceData = await pyth.getPriceUnsafe(id);
      const humanPrice = Number(priceData.price) * Math.pow(10, Number(priceData.expo));
      const publishTime = new Date(Number(priceData.publishTime) * 1000).toISOString();
      console.log(`   ${name}: $${humanPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} @ ${publishTime}`);
    } catch (e) {
      console.log(`   ${name}: ❌ Failed to verify`);
    }
  }
  
  console.log("\n✅ Price update complete!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
