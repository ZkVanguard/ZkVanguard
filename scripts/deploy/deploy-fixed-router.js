const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying fixed MockDEXRouter with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CRO");

  // Config
  const pythAddress = "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320";
  const usdcAddress = "0x28217DAddC55e3C4831b4A48A00Ce04880786967";
  const poolAddress = "0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B";
  
  // Existing token addresses
  const btcAddress = "0x851837c11DC08E127a1dF738A3a1AC9770c1D01e";
  const ethAddress = "0x8ef76152429665773f7646aF5b394295Ff3956E1";
  const suiAddress = "0x42117b8AC627F296c4095fB930A0DDcC38985429";
  const croAddress = "0xb56D096A12f5b809EB2799A8d9060CE87fE44665";

  // Pyth price feed IDs
  const priceIds = {
    BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
    CRO: "0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71"
  };

  console.log("\n1. Deploying new fixed MockDEXRouter...");
  const MockDEXRouter = await ethers.getContractFactory("MockDEXRouter");
  const router = await MockDEXRouter.deploy(pythAddress, usdcAddress);
  await router.waitForDeployment();
  console.log("   New Router:", router.target);

  // Configure assets
  console.log("\n2. Configuring asset tokens...");
  const tokens = [
    { name: "BTC", addr: btcAddress, priceId: priceIds.BTC, decimals: 8 },
    { name: "ETH", addr: ethAddress, priceId: priceIds.ETH, decimals: 18 },
    { name: "SUI", addr: suiAddress, priceId: priceIds.SUI, decimals: 9 },
    { name: "CRO", addr: croAddress, priceId: priceIds.CRO, decimals: 18 }
  ];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    console.log(`   Configuring ${t.name}...`);
    let tx = await router.configureAsset(i, t.addr, t.priceId, t.decimals);
    await tx.wait();
    
    // Grant minter role
    const token = await ethers.getContractAt("MockWrappedToken", t.addr);
    tx = await token.setMinter(router.target, true);
    await tx.wait();
    console.log(`   ✓ ${t.name} configured`);
  }

  // Fund router with USDC
  console.log("\n3. Funding router with USDC...");
  const usdc = await ethers.getContractAt("MockUSDC", usdcAddress);
  let tx = await usdc.mint(router.target, ethers.parseUnits("1000000", 6));
  await tx.wait();
  console.log("   ✓ 1M USDC funded to router");

  // Update CommunityPool to use new router
  console.log("\n4. Setting new router in CommunityPool...");
  const pool = await ethers.getContractAt("CommunityPool", poolAddress);
  tx = await pool.setDexRouter(router.target);
  await tx.wait();
  console.log("   ✓ DEX router updated in pool");

  // Verify with a test quote
  console.log("\n5. Testing swap quote...");
  const path = [usdcAddress, btcAddress];
  try {
    const amounts = await router.getAmountsOut(ethers.parseUnits("1000", 6), path);
    const btcOut = ethers.formatUnits(amounts[1], 8);
    const impliedPrice = 1000 / Number(btcOut);
    console.log(`   1000 USDC → ${btcOut} BTC`);
    console.log(`   Implied BTC price: $${impliedPrice.toFixed(2)}`);
  } catch(e) {
    console.log("   Quote failed (likely stale price):", e.message.slice(0, 60));
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("FIXED MOCKDEXROUTER DEPLOYED");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("New Router:", router.target);
  console.log("");
  console.log("Formula fix: Buy calculation now correct");
  console.log("  Old: totalDecimals = assetDec + expo + 6 (WRONG)");
  console.log("  New: totalDecimals = assetDec - 6 - expo (CORRECT)");
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch(console.error);
