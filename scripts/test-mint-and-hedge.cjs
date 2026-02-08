/**
 * Mint MockUSDC + Create BTC/ETH/CRO Hedges
 * 
 * Usage:
 *   npx hardhat run scripts/test-mint-and-hedge.cjs --network cronos-testnet
 */
const { ethers } = require("hardhat");

const HEDGE_EXECUTOR = "0x090b6221137690EbB37667E4644287487CE462B9";
const MOCK_USDC = "0x28217DAddC55e3C4831b4A48A00Ce04880786967";
const ORACLE_FEE = ethers.parseEther("0.06"); // 0.06 tCRO

const MOCK_USDC_ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const HEDGE_EXECUTOR_ABI = [
  "function openHedge(uint256 pairIndex, uint256 collateralAmount, uint256 leverage, bool isLong, bytes32 commitmentHash, bytes32 nullifier, bytes32 merkleRoot) payable returns (bytes32 hedgeId)",
  "function getHedge(bytes32 hedgeId) view returns (tuple(bytes32 hedgeId, address trader, uint256 pairIndex, uint256 collateralAmount, uint256 leverage, bool isLong, uint256 openTimestamp, uint256 closeTimestamp, bool isActive, bytes32 commitmentHash, bytes32 nullifier))",
  "function getStats() view returns (uint256 totalOpened, uint256 totalClosed, uint256 totalActive, uint256 totalCollateralLocked)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\n" + "=".repeat(60));
  console.log("  MINT MockUSDC + CREATE BTC/ETH/CRO HEDGES");
  console.log("  Wallet:", deployer.address);
  console.log("=".repeat(60));

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("  CRO Balance:", ethers.formatEther(balance), "tCRO");

  const usdc = new ethers.Contract(MOCK_USDC, MOCK_USDC_ABI, deployer);
  const hedge = new ethers.Contract(HEDGE_EXECUTOR, HEDGE_EXECUTOR_ABI, deployer);

  // ── Check current stats ──
  const statsBefore = await hedge.getStats();
  console.log("\n── Before ──");
  console.log("  On-chain hedges:", statsBefore[0].toString(), "opened,", statsBefore[2].toString(), "active");
  console.log("  MockUSDC balance:", ethers.formatUnits(await usdc.balanceOf(deployer.address), 6), "USDC");

  // ── Step 1: Mint 500,000 MockUSDC ──
  console.log("\n── Step 1: Mint 500,000 MockUSDC ──");
  const mintAmount = ethers.parseUnits("500000", 6); // 500K USDC
  const mintTx = await usdc.mint(deployer.address, mintAmount);
  await mintTx.wait();
  const usdcBal = await usdc.balanceOf(deployer.address);
  console.log("  ✅ Minted! Balance:", ethers.formatUnits(usdcBal, 6), "USDC");

  // ── Step 2: Approve HedgeExecutor ──
  console.log("\n── Step 2: Approve HedgeExecutor for 500K USDC ──");
  const approveTx = await usdc.approve(HEDGE_EXECUTOR, mintAmount);
  await approveTx.wait();
  const allowance = await usdc.allowance(deployer.address, HEDGE_EXECUTOR);
  console.log("  ✅ Approved! Allowance:", ethers.formatUnits(allowance, 6), "USDC");

  // ── Helper: generate ZK params ──
  function zkParams(label) {
    const ts = BigInt(Date.now());
    const commitment = ethers.keccak256(
      ethers.solidityPacked(
        ["address", "uint256", "string"],
        [deployer.address, ts, label]
      )
    );
    const nullifier = ethers.keccak256(
      ethers.solidityPacked(["bytes32", "uint256"], [commitment, ts + 1n])
    );
    const merkleRoot = ethers.keccak256(
      ethers.solidityPacked(["bytes32", "bytes32"], [commitment, nullifier])
    );
    return { commitment, nullifier, merkleRoot };
  }

  // ── Step 3: Create BTC SHORT Hedge ──
  console.log("\n── Step 3: Create BTC SHORT Hedge (50,000 USDC × 10x) ──");
  {
    const collateral = ethers.parseUnits("50000", 6); // 50K USDC
    const zk = zkParams("BTC-SHORT-50K");
    const tx = await hedge.openHedge(
      0,          // pairIndex: BTC
      collateral, // 50,000 USDC
      10,         // 10x leverage → $500K notional
      false,      // isLong = false → SHORT
      zk.commitment, zk.nullifier, zk.merkleRoot,
      { value: ORACLE_FEE, gasLimit: 2000000 }
    );
    const receipt = await tx.wait();
    // Get hedgeId from logs
    const hedgeId = receipt.logs[receipt.logs.length - 1]?.topics?.[1] || "unknown";
    console.log("  ✅ BTC SHORT created!");
    console.log("     Tx:", tx.hash);
    console.log("     HedgeId:", hedgeId);
    console.log("     Notional: $500,000 (50K × 10x)");
  }

  // Small delay to avoid nonce issues
  await new Promise(r => setTimeout(r, 3000));

  // ── Step 4: Create ETH LONG Hedge ──
  console.log("\n── Step 4: Create ETH LONG Hedge (100,000 USDC × 5x) ──");
  {
    const collateral = ethers.parseUnits("100000", 6); // 100K USDC
    const zk = zkParams("ETH-LONG-100K");
    const tx = await hedge.openHedge(
      1,          // pairIndex: ETH
      collateral, // 100,000 USDC
      5,          // 5x leverage → $500K notional
      true,       // isLong = true → LONG
      zk.commitment, zk.nullifier, zk.merkleRoot,
      { value: ORACLE_FEE, gasLimit: 2000000 }
    );
    const receipt = await tx.wait();
    const hedgeId = receipt.logs[receipt.logs.length - 1]?.topics?.[1] || "unknown";
    console.log("  ✅ ETH LONG created!");
    console.log("     Tx:", tx.hash);
    console.log("     HedgeId:", hedgeId);
    console.log("     Notional: $500,000 (100K × 5x)");
  }

  await new Promise(r => setTimeout(r, 3000));

  // ── Step 5: Create CRO LONG Hedge ──
  console.log("\n── Step 5: Create CRO LONG Hedge (25,000 USDC × 20x) ──");
  {
    const collateral = ethers.parseUnits("25000", 6); // 25K USDC
    const zk = zkParams("CRO-LONG-25K");
    const tx = await hedge.openHedge(
      2,          // pairIndex: CRO
      collateral, // 25,000 USDC
      20,         // 20x leverage → $500K notional
      true,       // isLong = true → LONG
      zk.commitment, zk.nullifier, zk.merkleRoot,
      { value: ORACLE_FEE, gasLimit: 2000000 }
    );
    const receipt = await tx.wait();
    const hedgeId = receipt.logs[receipt.logs.length - 1]?.topics?.[1] || "unknown";
    console.log("  ✅ CRO LONG created!");
    console.log("     Tx:", tx.hash);
    console.log("     HedgeId:", hedgeId);
    console.log("     Notional: $500,000 (25K × 20x)");
  }

  // ── Final Stats ──
  console.log("\n── Final Stats ──");
  const statsAfter = await hedge.getStats();
  const finalBal = await usdc.balanceOf(deployer.address);
  console.log("  Total opened:", statsAfter[0].toString());
  console.log("  Total closed:", statsAfter[1].toString());
  console.log("  Total active:", statsAfter[2].toString());
  console.log("  Total collateral locked:", ethers.formatUnits(statsAfter[3], 6), "USDC");
  console.log("  Remaining USDC balance:", ethers.formatUnits(finalBal, 6), "USDC");
  console.log("  CRO balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "tCRO");

  console.log("\n" + "=".repeat(60));
  console.log("  ✅ ALL 3 HEDGES CREATED SUCCESSFULLY");
  console.log("  BTC SHORT: 50K USDC × 10x = $500K notional");
  console.log("  ETH LONG:  100K USDC × 5x = $500K notional");
  console.log("  CRO LONG:  25K USDC × 20x = $500K notional");
  console.log("  Total collateral used: 175,000 USDC");
  console.log("=".repeat(60) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error:", err.message || err);
    process.exit(1);
  });
