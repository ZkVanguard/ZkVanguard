/**
 * Complete setup for Arbitrum CommunityPool (proxy already deployed)
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const POOL = "0x9E5512b683d92290ccD20F483D20699658bcb9f3";
const USDC = "0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1";

// Pyth Price Feed IDs
const PYTH_BTC_USD = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const PYTH_ETH_USD = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const PYTH_SUI_USD = "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744";
const PYTH_ARB_USD = "0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5";

async function main() {
  console.log("\n=== Complete Arbitrum Pool Setup ===\n");
  
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  
  const pool = await ethers.getContractAt("CommunityPool", POOL);
  const usdc = await ethers.getContractAt("MockUSDC", USDC);
  
  // Set all price IDs
  console.log("Setting Pyth price feed IDs...");
  try {
    const tx = await pool.setAllPriceIds([PYTH_BTC_USD, PYTH_ETH_USD, PYTH_SUI_USD, PYTH_ARB_USD]);
    await tx.wait();
    console.log("✅ Price feed IDs set");
  } catch (e) {
    console.log("Price IDs may already be set:", e.message.slice(0, 80));
  }

  // Verify initialization
  console.log("\nVerifying pool state...");
  const name = await pool.name();
  const symbol = await pool.symbol();
  const depositToken = await pool.depositToken();
  const treasury = await pool.treasury();
  
  console.log("   Name:", name);
  console.log("   Symbol:", symbol);
  console.log("   Deposit Token:", depositToken);
  console.log("   Treasury:", treasury);

  // Mint test USDC if needed
  const usdcBal = await usdc.balanceOf(signer.address);
  console.log("\n   USDC Balance:", ethers.formatUnits(usdcBal, 6));
  
  if (usdcBal < 1000n * 10n**6n) {
    console.log("   Minting 10000 test USDC...");
    const mintTx = await usdc.mint(signer.address, 10000n * 10n**6n);
    await mintTx.wait();
    console.log("   ✅ Minted");
  }

  // Approve pool
  console.log("\nApproving pool...");
  let tx = await usdc.approve(POOL, ethers.MaxUint256);
  await tx.wait();
  console.log("✅ Approved");

  // Test deposit
  console.log("\nTesting deposit (100 USDC)...");
  tx = await pool.deposit(100n * 10n**6n, 0n);
  const depositReceipt = await tx.wait();
  console.log("✅ Deposit successful! Gas:", depositReceipt.gasUsed.toString());

  const shares = await pool.balanceOf(signer.address);
  console.log("   Shares received:", ethers.formatEther(shares));

  // Test withdraw
  console.log("\nTesting withdraw (50 shares)...");
  const withdrawShares = shares / 2n;
  tx = await pool.withdraw(withdrawShares, 0n);
  const withdrawReceipt = await tx.wait();
  console.log("✅ Withdraw successful! Gas:", withdrawReceipt.gasUsed.toString());

  const newShares = await pool.balanceOf(signer.address);
  const newUSDC = await usdc.balanceOf(signer.address);
  console.log("   Remaining shares:", ethers.formatEther(newShares));
  console.log("   USDC Balance:", ethers.formatUnits(newUSDC, 6));

  // Save updated deployment
  const deployment = {
    network: "Arbitrum Sepolia",
    chainId: 421614,
    deployedAt: new Date().toISOString(),
    deployer: signer.address,
    contracts: {
      CommunityPool: {
        proxy: POOL,
        implementation: await ethers.provider.getStorage(POOL, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc").then(r => "0x" + r.slice(26))
      },
      MockUSDC: USDC
    },
    configuration: {
      depositToken: USDC,
      pythOracle: "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF",
      priceIds: {
        BTC: PYTH_BTC_USD,
        ETH: PYTH_ETH_USD,
        SUI: PYTH_SUI_USD,
        ARB: PYTH_ARB_USD
      },
      treasury: signer.address,
      admin: signer.address
    },
    verified: {
      deposit: true,
      withdraw: true
    }
  };

  const deploymentPath = path.join(__dirname, "../deployments/community-pool-arbitrum-sepolia.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("\n✅ Deployment saved");

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   ARBITRUM SEPOLIA POOL VERIFIED");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   Pool:", POOL);
  console.log("   Deposit: ✅ WORKING");
  console.log("   Withdraw: ✅ WORKING");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
