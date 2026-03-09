const { ethers } = require("hardhat");

async function main() {
  const pythAddress = "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320";
  
  const pythABI = [
    "function getPriceNoOlderThan(bytes32 id, uint256 age) view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))",
    "function getPrice(bytes32 id) view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))",
    "function getPriceUnsafe(bytes32 id) view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))"
  ];
  
  const pyth = new ethers.Contract(pythAddress, pythABI, ethers.provider);
  
  const btcPriceId = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
  const ethPriceId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  
  console.log("\n=== PYTH ORACLE DEBUG ===\n");
  console.log("Current block timestamp:", Math.floor(Date.now()/1000));
  
  console.log("\n=== BTC Price (getPriceUnsafe) ===");
  try {
    const btcPrice = await pyth.getPriceUnsafe(btcPriceId);
    console.log("Price:", btcPrice.price.toString());
    console.log("Expo:", btcPrice.expo);
    console.log("Conf:", btcPrice.conf.toString());
    console.log("Publish Time:", btcPrice.publishTime.toString());
    const publishDate = new Date(Number(btcPrice.publishTime) * 1000);
    console.log("Published:", publishDate.toISOString());
    const staleness = Math.floor(Date.now()/1000) - Number(btcPrice.publishTime);
    console.log("Staleness:", staleness, "seconds");
    
    // Calculate human-readable price
    const priceNum = Number(btcPrice.price) * Math.pow(10, Number(btcPrice.expo));
    console.log("Price USD:", priceNum.toFixed(2));
  } catch(e) {
    console.log("Error:", e.message.slice(0, 200));
  }
  
  console.log("\n=== ETH Price (getPriceUnsafe) ===");
  try {
    const ethPrice = await pyth.getPriceUnsafe(ethPriceId);
    console.log("Price:", ethPrice.price.toString());
    console.log("Expo:", ethPrice.expo);
    const priceNum = Number(ethPrice.price) * Math.pow(10, Number(ethPrice.expo));
    console.log("Price USD:", priceNum.toFixed(2));
    const staleness = Math.floor(Date.now()/1000) - Number(ethPrice.publishTime);
    console.log("Staleness:", staleness, "seconds");
  } catch(e) {
    console.log("Error:", e.message.slice(0, 200));
  }
  
  console.log("\n=== BTC Price (5 min freshness) ===");
  try {
    const btcPrice = await pyth.getPriceNoOlderThan(btcPriceId, 300);
    console.log("Price:", btcPrice.price.toString());
  } catch(e) {
    console.log("Error (likely stale):", e.message.slice(0, 100));
  }
}

main().catch(console.error);
