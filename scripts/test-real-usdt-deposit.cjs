/**
 * Real Cronos Testnet USDT Deposit Test
 * 
 * Complete end-to-end test for:
 * 1. Check wallet TCRO balance (gas)
 * 2. Check MockUSDT balance
 * 3. Deposit MockUSDT to Community Pool
 * 4. Verify shares received
 * 5. Check pool NAV updated
 * 
 * Usage:
 *   npx hardhat run scripts/test-real-usdt-deposit.cjs --network cronos-testnet
 * 
 * Requirements:
 *   - PRIVATE_KEY in .env.local
 *   - TCRO for gas (get from https://cronos.org/faucet)
 *   - MockUSDT (0x28217DAddC55e3C4831b4A48A00Ce04880786967)
 */

const { ethers } = require("hardhat");

// Contract addresses on Cronos Testnet (338)
const ADDRESSES = {
  communityPool: "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30", // Proxy
  mockUSDT: "0x28217DAddC55e3C4831b4A48A00Ce04880786967", // MockUSDT (6 decimals)
  devUSDC: "0xc01efAAF7C5c61BEBFAEB358E1161b537b8bC0E0", // DevUSDC (alternative)
};

// ABIs
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function mint(address to, uint256 amount) returns (bool)", // MockUSDT has mint function
];

const POOL_ABI = [
  "function deposit(uint256 amountUSD) external returns (uint256)",
  "function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)",
  "function getMemberPosition(address member) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)",
  "function calculateTotalNAV() view returns (uint256)",
  "function depositToken() view returns (address)",
  "function totalShares() view returns (uint256)",
  "function getMemberCount() view returns (uint256)",
  "event Deposited(address indexed member, uint256 amountUSD, uint256 sharesReceived, uint256 sharePrice, uint256 timestamp)",
];

async function main() {
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("   🧪 REAL CRONOS TESTNET USDT DEPOSIT TEST");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("");

  // Get signer
  const [signer] = await ethers.getSigners();
  if (!signer) {
    console.log("❌ No signer found. Set PRIVATE_KEY in .env.local");
    console.log("\n📋 To get testnet funds:");
    console.log("   1. TCRO Faucet: https://cronos.org/faucet");
    console.log("   2. Enter your address and request testnet CRO");
    return;
  }

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  
  console.log("📍 Network: Cronos Testnet (Chain ID:", chainId + ")");
  console.log("👛 Wallet:", signer.address);
  console.log("");

  // Check native balance (TCRO for gas)
  const tcroBalance = await ethers.provider.getBalance(signer.address);
  const tcroFormatted = ethers.formatEther(tcroBalance);
  console.log("⛽ TCRO Balance:", tcroFormatted, "TCRO");
  
  if (tcroBalance < ethers.parseEther("0.1")) {
    console.log("\n⚠️  Low TCRO balance! Need gas for transactions.");
    console.log("   Get free testnet CRO from: https://cronos.org/faucet");
    console.log("   Your address:", signer.address);
    return;
  }

  // Get contract instances
  const mockUSDT = new ethers.Contract(ADDRESSES.mockUSDT, ERC20_ABI, signer);
  const pool = new ethers.Contract(ADDRESSES.communityPool, POOL_ABI, signer);

  // Check MockUSDT balance
  const usdtDecimals = await mockUSDT.decimals();
  const usdtSymbol = await mockUSDT.symbol();
  const usdtBalance = await mockUSDT.balanceOf(signer.address);
  const usdtFormatted = ethers.formatUnits(usdtBalance, usdtDecimals);
  
  console.log(`💵 ${usdtSymbol} Balance:`, usdtFormatted, usdtSymbol);
  console.log("   Contract:", ADDRESSES.mockUSDT);
  console.log("");

  // Check pool stats
  console.log("📊 COMMUNITY POOL STATUS");
  console.log("─────────────────────────");
  
  try {
    const stats = await pool.getPoolStats();
    console.log("   Total NAV:", ethers.formatUnits(stats._totalNAV, 6), "USD");
    console.log("   Total Shares:", ethers.formatUnits(stats._totalShares, 18));
    console.log("   Share Price:", ethers.formatUnits(stats._sharePrice, 6), "USD");
    console.log("   Members:", stats._memberCount.toString());
    console.log("   Pool Address:", ADDRESSES.communityPool);
    
    // Check existing position
    const position = await pool.getMemberPosition(signer.address);
    console.log("");
    console.log("👤 YOUR CURRENT POSITION");
    console.log("─────────────────────────");
    console.log("   Shares:", ethers.formatUnits(position.shares, 18));
    console.log("   Value:", ethers.formatUnits(position.valueUSD, 6), "USD");
    console.log("   Ownership:", (Number(position.percentage) / 100).toFixed(4) + "%");
  } catch (e) {
    console.log("   ⚠️ Could not fetch pool stats:", e.message?.slice(0, 60));
  }

  // If no USDT balance, try to mint (MockUSDT allows minting)
  const depositAmount = ethers.parseUnits("100", usdtDecimals); // 100 USDT
  
  if (usdtBalance < depositAmount) {
    console.log("");
    console.log("📥 MINTING TEST USDT");
    console.log("─────────────────────────");
    console.log("   Current balance too low, attempting to mint 1000 USDT...");
    
    try {
      const mintAmount = ethers.parseUnits("1000", usdtDecimals);
      const mintTx = await mockUSDT.mint(signer.address, mintAmount);
      console.log("   Mint tx:", mintTx.hash);
      await mintTx.wait();
      console.log("   ✅ Minted 1000", usdtSymbol);
      
      const newBalance = await mockUSDT.balanceOf(signer.address);
      console.log("   New balance:", ethers.formatUnits(newBalance, usdtDecimals), usdtSymbol);
    } catch (e) {
      console.log("   ❌ Mint failed (might need to use faucet):", e.message?.slice(0, 60));
      console.log("");
      console.log("   Alternative: Use Cronos Testnet faucet or swap TCRO for DevUSDC");
      return;
    }
  }

  // Approve pool to spend USDT
  console.log("");
  console.log("💳 APPROVING USDT SPEND");
  console.log("─────────────────────────");
  
  const currentAllowance = await mockUSDT.allowance(signer.address, ADDRESSES.communityPool);
  console.log("   Current allowance:", ethers.formatUnits(currentAllowance, usdtDecimals), usdtSymbol);
  
  if (currentAllowance < depositAmount) {
    console.log("   Approving", ethers.formatUnits(depositAmount, usdtDecimals), usdtSymbol + "...");
    const approveTx = await mockUSDT.approve(ADDRESSES.communityPool, depositAmount);
    console.log("   Approve tx:", approveTx.hash);
    await approveTx.wait();
    console.log("   ✅ Approval confirmed");
  } else {
    console.log("   ✅ Already approved");
  }

  // Execute deposit
  console.log("");
  console.log("🏦 DEPOSITING TO COMMUNITY POOL");
  console.log("─────────────────────────────────");
  console.log("   Amount:", ethers.formatUnits(depositAmount, usdtDecimals), usdtSymbol);
  
  try {
    // Get stats before
    const statsBefore = await pool.getPoolStats();
    const positionBefore = await pool.getMemberPosition(signer.address);
    
    // Execute deposit
    const depositTx = await pool.deposit(depositAmount, { gasLimit: 500000 });
    console.log("   Deposit tx:", depositTx.hash);
    console.log("   ⏳ Waiting for confirmation...");
    
    const receipt = await depositTx.wait();
    console.log("   ✅ DEPOSIT CONFIRMED!");
    console.log("   Block:", receipt.blockNumber);
    console.log("   Gas used:", receipt.gasUsed.toString());
    
    // Parse deposit event
    const depositEvent = receipt.logs.find(log => {
      try {
        const parsed = pool.interface.parseLog(log);
        return parsed?.name === "Deposited";
      } catch {
        return false;
      }
    });
    
    if (depositEvent) {
      const parsed = pool.interface.parseLog(depositEvent);
      console.log("");
      console.log("📋 DEPOSIT DETAILS");
      console.log("─────────────────────────");
      console.log("   Depositor:", parsed.args.member);
      console.log("   Amount:", ethers.formatUnits(parsed.args.amountUSD, 6), "USD");
      console.log("   Shares Received:", ethers.formatUnits(parsed.args.sharesReceived, 18));
      console.log("   Share Price:", ethers.formatUnits(parsed.args.sharePrice, 6), "USD");
    }
    
    // Get stats after
    const statsAfter = await pool.getPoolStats();
    const positionAfter = await pool.getMemberPosition(signer.address);
    
    console.log("");
    console.log("📊 POOL AFTER DEPOSIT");
    console.log("─────────────────────────");
    console.log("   Total NAV:", ethers.formatUnits(statsAfter._totalNAV, 6), "USD");
    console.log("   NAV Change:", ethers.formatUnits(statsAfter._totalNAV - statsBefore._totalNAV, 6), "USD");
    console.log("   Total Shares:", ethers.formatUnits(statsAfter._totalShares, 18));
    console.log("   Members:", statsAfter._memberCount.toString());
    
    console.log("");
    console.log("👤 YOUR NEW POSITION");
    console.log("─────────────────────────");
    console.log("   Shares:", ethers.formatUnits(positionAfter.shares, 18));
    console.log("   Shares Added:", ethers.formatUnits(positionAfter.shares - positionBefore.shares, 18));
    console.log("   Value:", ethers.formatUnits(positionAfter.valueUSD, 6), "USD");
    console.log("   Ownership:", (Number(positionAfter.percentage) / 100).toFixed(4) + "%");
    
    // Verify on explorer
    console.log("");
    console.log("🔍 VERIFY ON EXPLORER");
    console.log("─────────────────────────");
    console.log(`   https://explorer.cronos.org/testnet/tx/${depositTx.hash}`);
    
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════════");
    console.log("   ✅ DEPOSIT TEST SUCCESSFUL!");
    console.log("═══════════════════════════════════════════════════════════════════");
    
  } catch (e) {
    console.log("   ❌ Deposit failed:", e.message);
    if (e.data) {
      console.log("   Error data:", e.data);
    }
    throw e;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  });
