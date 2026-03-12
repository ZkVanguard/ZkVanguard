/**
 * Deploy SimpleMockDEX for testing
 * Uses hardcoded prices instead of Pyth oracle
 */
const { ethers } = require("hardhat");
const fs = require("fs");

const CONFIG = {
  usdc: "0x28217DAddC55e3C4831b4A48A00Ce04880786967",
  communityPool: "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30",
  tokens: {
    BTC: { address: "0x851837c11DC08E127a1dF738A3a1AC9770c1D01e", decimals: 18, price: 100000 * 1e6 },
    ETH: { address: "0x8ef76152429665773f7646aF5b394295Ff3956E1", decimals: 18, price: 2500 * 1e6 },
    SUI: { address: "0x42117b8AC627F296c4095fB930A0DDcC38985429", decimals: 18, price: 35 * 1e5 },
    CRO: { address: "0xb56D096A12f5b809EB2799A8d9060CE87fE44665", decimals: 18, price: 1e5 }
  }
};

const POOL_ABI = [
  "function setDexRouter(address _router) external"
];

const MOCK_TOKEN_ABI = [
  "function setMinter(address minter, bool allowed) external"
];

async function main() {
  console.log("============================================================");
  console.log("   DEPLOYING SIMPLE MOCK DEX (Fixed Prices)");
  console.log("============================================================\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CRO\n");

  // Deploy SimpleMockDEX
  console.log("1. Deploying SimpleMockDEX...");
  const SimpleMockDEX = await ethers.getContractFactory("SimpleMockDEX");
  const dex = await SimpleMockDEX.deploy(CONFIG.usdc);
  await dex.waitForDeployment();
  const dexAddress = await dex.getAddress();
  console.log("   ✅ SimpleMockDEX:", dexAddress);

  // Configure assets in DEX
  console.log("\n2. Configuring assets in DEX...");
  const assets = ["BTC", "ETH", "SUI", "CRO"];
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const config = CONFIG.tokens[asset];
    const tx = await dex.configureAsset(i, config.address, config.decimals, config.price);
    await tx.wait();
    console.log(`   ✅ ${asset}[${i}]: $${(config.price / 1e6).toLocaleString()}`);
  }

  // Grant minter role to DEX for all mock tokens
  console.log("\n3. Granting minter role to DEX...");
  for (const asset of assets) {
    const tokenAddress = CONFIG.tokens[asset].address;
    const token = new ethers.Contract(tokenAddress, MOCK_TOKEN_ABI, deployer);
    try {
      const tx = await token.setMinter(dexAddress, true);
      await tx.wait();
      console.log(`   ✅ ${asset} can be minted by DEX`);
    } catch (e) {
      console.log(`   ⚠️ ${asset}: ${e.message.split('\n')[0]}`);
    }
  }

  // Update CommunityPool to use new DEX
  console.log("\n4. Updating CommunityPool DEX router...");
  const pool = new ethers.Contract(CONFIG.communityPool, POOL_ABI, deployer);
  const tx = await pool.setDexRouter(dexAddress);
  await tx.wait();
  console.log("   ✅ CommunityPool DEX router updated to:", dexAddress);

  // Save deployment
  const deployment = {
    network: "cronos-testnet",
    timestamp: new Date().toISOString(),
    simpleMockDEX: dexAddress,
    usdc: CONFIG.usdc,
    assets: CONFIG.tokens,
    communityPool: CONFIG.communityPool
  };
  
  fs.writeFileSync(
    "deployments/simple-mock-dex.json",
    JSON.stringify(deployment, null, 2)
  );

  console.log("\n============================================================");
  console.log("   DEPLOYMENT COMPLETE");
  console.log("============================================================");
  console.log("\nSimpleMockDEX:", dexAddress);
  console.log("Saved to: deployments/simple-mock-dex.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
