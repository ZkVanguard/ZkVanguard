/**
 * Update Pyth prices on Cronos Testnet using correct Hermes API
 * And set pool to use real Pyth oracle
 */
const { ethers } = require("hardhat");

// Cronos Testnet Configuration
const CONFIG = {
  pythOracle: "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320",
  communityPool: "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30",
  priceIds: [
    "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", // BTC
    "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", // ETH
    "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744", // SUI
    "0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe"  // CRO
  ]
};

const PYTH_ABI = [
  "function updatePriceFeeds(bytes[] calldata updateData) external payable",
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
  "function getPriceUnsafe(bytes32 id) external view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))"
];

const POOL_ABI = [
  "function setPythOracle(address _pythOracle) external",
  "function pythOracle() external view returns (address)"
];

async function main() {
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     PYTH PRICE UPDATE - CRONOS TESTNET (Real Pyth)            ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  const [signer] = await ethers.getSigners();
  console.log(`🔑 Account: ${signer.address}`);
  
  const balance = await ethers.provider.getBalance(signer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} CRO\n`);

  // Step 1: Set pool to use real Pyth oracle
  console.log("1. Setting CommunityPool to use real Pyth oracle...");
  const pool = new ethers.Contract(CONFIG.communityPool, POOL_ABI, signer);
  const currentPyth = await pool.pythOracle();
  console.log("   Current Pyth:", currentPyth);
  
  if (currentPyth.toLowerCase() !== CONFIG.pythOracle.toLowerCase()) {
    const tx = await pool.setPythOracle(CONFIG.pythOracle);
    await tx.wait();
    console.log("   ✅ Updated to:", CONFIG.pythOracle);
  } else {
    console.log("   ✅ Already using real Pyth");
  }

  // Step 2: Fetch prices from Hermes
  console.log("\n2. Fetching prices from Hermes API...");
  
  // Build URL - Hermes expects ids[]=xxx format without URL encoding the brackets
  const idsQuery = CONFIG.priceIds.map(id => `ids[]=${id}`).join("&");
  const url = `https://hermes.pyth.network/v2/updates/price/latest?${idsQuery}`;
  
  console.log("   DEBUG: URL =", url);
  console.log("   Fetching prices for BTC, ETH, SUI, CRO...");
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Hermes API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Log fetched prices
  console.log("\n   Current Prices:");
  const assetNames = ["BTC", "ETH", "SUI", "CRO"];
  for (let i = 0; i < data.parsed.length; i++) {
    const parsed = data.parsed[i];
    const price = parsed.price.price;
    const expo = parsed.price.expo;
    const humanPrice = Number(price) * Math.pow(10, expo);
    console.log(`   ${assetNames[i]}: $${humanPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  }
  
  // Convert to bytes
  const priceUpdateData = data.binary.data.map(d => "0x" + d);
  console.log(`\n   Got ${priceUpdateData.length} price updates`);
  
  // Step 3: Push prices on-chain
  console.log("\n3. Pushing prices on-chain...");
  const pyth = new ethers.Contract(CONFIG.pythOracle, PYTH_ABI, signer);
  
  // Get update fee
  let updateFee;
  try {
    updateFee = await pyth.getUpdateFee(priceUpdateData);
    console.log(`   Update fee: ${ethers.formatEther(updateFee)} CRO`);
  } catch (e) {
    updateFee = ethers.parseEther("0.01");
    console.log(`   Using fallback fee: ${ethers.formatEther(updateFee)} CRO`);
  }
  
  // Submit update
  const tx = await pyth.updatePriceFeeds(priceUpdateData, {
    value: updateFee,
    gasLimit: 1000000
  });
  
  console.log(`   TX: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`   ✅ Prices updated! Gas: ${receipt.gasUsed.toString()}`);
  
  // Step 4: Verify prices
  console.log("\n4. Verifying on-chain prices:");
  for (let i = 0; i < CONFIG.priceIds.length; i++) {
    const id = "0x" + CONFIG.priceIds[i];
    try {
      const priceData = await pyth.getPriceUnsafe(id);
      const humanPrice = Number(priceData.price) * Math.pow(10, Number(priceData.expo));
      const age = Date.now() / 1000 - Number(priceData.publishTime);
      console.log(`   ${assetNames[i]}: $${humanPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${age.toFixed(0)}s old)`);
    } catch (e) {
      console.log(`   ${assetNames[i]}: ❌ Error - ${e.message.split('\n')[0]}`);
    }
  }
  
  console.log("\n✅ Done! Pool is using real Pyth with fresh prices.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
