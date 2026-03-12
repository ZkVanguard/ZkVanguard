/**
 * Configure MockDEXRouter with asset tokens and price feeds
 * Required for swaps to work with proper price calculation
 */
const hre = require("hardhat");

// MockDEXRouter ABI (configureAsset)
const MOCK_DEX_ABI = [
  "function configureAsset(uint8 assetIndex, address token, bytes32 priceId, uint8 tokenDecimals) external",
  "function assetTokens(uint8) external view returns (address)",
  "function pythPriceIds(uint8) external view returns (bytes32)",
  "function owner() external view returns (address)"
];

// Addresses from deployments
const MOCK_DEX = "0xaf1e47949eF0fb7E04c5c258C99BAE4660Bcc3d9";

const ASSETS = [
  {
    index: 0,
    name: "BTC",
    token: "0x851837c11DC08E127a1dF738A3a1AC9770c1D01e",
    priceId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    decimals: 18
  },
  {
    index: 1,
    name: "ETH",
    token: "0x8ef76152429665773f7646aF5b394295Ff3956E1",
    priceId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    decimals: 18
  },
  {
    index: 2,
    name: "SUI",
    token: "0x42117b8AC627F296c4095fB930A0DDcC38985429",
    priceId: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
    decimals: 18
  },
  {
    index: 3,
    name: "CRO",
    token: "0xb56D096A12f5b809EB2799A8d9060CE87fE44665",
    priceId: "0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71",
    decimals: 18
  }
];

async function main() {
  console.log("============================================================");
  console.log("   CONFIGURING MOCK DEX ROUTER");
  console.log("============================================================\n");

  const [signer] = await hre.ethers.getSigners();
  console.log("Signer:", signer.address);

  const mockDex = new hre.ethers.Contract(MOCK_DEX, MOCK_DEX_ABI, signer);

  // Check ownership
  const owner = await mockDex.owner();
  console.log("MockDEX Owner:", owner);
  
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error("❌ Signer is not the owner of MockDEXRouter");
    process.exit(1);
  }
  console.log("✅ Signer is owner\n");

  // Check current config
  console.log("Current Configuration:");
  for (const asset of ASSETS) {
    const currentToken = await mockDex.assetTokens(asset.index);
    const currentPriceId = await mockDex.pythPriceIds(asset.index);
    console.log(`  ${asset.name}[${asset.index}]: token=${currentToken.slice(0,10)}..., priceId=${currentPriceId.slice(0,10)}...`);
  }
  console.log("");

  // Configure each asset
  for (const asset of ASSETS) {
    console.log(`Configuring ${asset.name} (index ${asset.index})...`);
    
    const currentToken = await mockDex.assetTokens(asset.index);
    if (currentToken.toLowerCase() === asset.token.toLowerCase()) {
      console.log(`  ✅ ${asset.name} already configured`);
      continue;
    }
    
    const tx = await mockDex.configureAsset(
      asset.index,
      asset.token,
      asset.priceId,
      asset.decimals
    );
    console.log(`  TX: ${tx.hash}`);
    await tx.wait();
    console.log(`  ✅ ${asset.name} configured`);
  }

  console.log("\n============================================================");
  console.log("   CONFIGURATION COMPLETE");
  console.log("============================================================");

  // Verify
  console.log("\nVerifying Configuration:");
  for (const asset of ASSETS) {
    const token = await mockDex.assetTokens(asset.index);
    const priceId = await mockDex.pythPriceIds(asset.index);
    const tokenMatch = token.toLowerCase() === asset.token.toLowerCase();
    const priceIdMatch = priceId.toLowerCase() === asset.priceId.toLowerCase();
    
    console.log(`  ${asset.name}[${asset.index}]: token=${tokenMatch ? '✅' : '❌'} priceId=${priceIdMatch ? '✅' : '❌'}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
