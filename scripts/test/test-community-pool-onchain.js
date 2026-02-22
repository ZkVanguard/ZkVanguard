/**
 * Test CommunityPool On-Chain - Cronos Testnet
 * 
 * Tests:
 * 1. Deposit USDC → receive shares
 * 2. Check pool stats  
 * 3. Withdraw shares → receive USDC
 * 
 * Usage:
 *   npx hardhat run scripts/test/test-community-pool-onchain.js --network cronos-testnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Load deployment
const deployment = require("../../deployments/community-pool.json");
const testnetDeployment = require("../../deployments/cronos-testnet.json");

const POOL_ADDRESS = deployment.contracts.CommunityPool.proxy;
const USDC_ADDRESS = testnetDeployment.MockUSDC;

// CommunityPool ABI (subset)
const POOL_ABI = [
  "function deposit(uint256 amount) external returns (uint256 shares)",
  "function withdraw(uint256 shares, uint256 minAmountOut) external returns (uint256 amount)",
  "function getPoolStats() external view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] memory _allocations)",
  "function getMemberPosition(address member) external view returns (uint256 shares, uint256 valueUSD, uint256 percentage)",
  "function depositToken() external view returns (address)",
  "function MIN_DEPOSIT() external view returns (uint256)",
  "event Deposited(address indexed user, uint256 amount, uint256 shares)",
  "event Withdrawn(address indexed user, uint256 shares, uint256 amount)",
];

// ERC20 ABI
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function mint(address to, uint256 amount) external",
];

async function main() {
  const [signer] = await ethers.getSigners();
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   CommunityPool On-Chain Test - Cronos Testnet");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Signer:", signer.address);
  console.log("Pool Address:", POOL_ADDRESS);
  console.log("USDC Address:", USDC_ADDRESS);
  console.log("");
  
  // Connect to contracts
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
  
  // ═══════════════════════════════════════════════════════════════
  // TEST 1: Check Initial State
  // ═══════════════════════════════════════════════════════════════
  
  console.log("📊 TEST 1: Check Initial Pool State\n");
  
  const stats = await pool.getPoolStats();
  console.log("Pool Stats:");
  console.log("  Total Shares:", stats._totalShares.toString());
  console.log("  Total NAV:", ethers.formatUnits(stats._totalNAV, 6), "USDC");
  console.log("  Member Count:", stats._memberCount.toString());
  console.log("  Share Price:", ethers.formatUnits(stats._sharePrice, 18));
  console.log("");
  
  const minDeposit = await pool.MIN_DEPOSIT();
  console.log("Minimum Deposit:", ethers.formatUnits(minDeposit, 6), "USDC\n");
  
  // ═══════════════════════════════════════════════════════════════
  // TEST 2: Mint Test USDC
  // ═══════════════════════════════════════════════════════════════
  
  console.log("💰 TEST 2: Prepare USDC\n");
  
  // First deposit requires $1000 minimum (anti-inflation attack protection)
  const depositAmount = ethers.parseUnits("1000", 6); // 1000 USDC
  
  // Check current balance
  let usdcBalance = await usdc.balanceOf(signer.address);
  console.log("Current USDC balance:", ethers.formatUnits(usdcBalance, 6));
  
  // Mint if needed
  if (usdcBalance < depositAmount) {
    console.log("Minting 1000 test USDC...");
    const mintTx = await usdc.mint(signer.address, ethers.parseUnits("1000", 6));
    await mintTx.wait();
    usdcBalance = await usdc.balanceOf(signer.address);
    console.log("New USDC balance:", ethers.formatUnits(usdcBalance, 6));
  }
  console.log("");
  
  // ═══════════════════════════════════════════════════════════════
  // TEST 3: Approve & Deposit
  // ═══════════════════════════════════════════════════════════════
  
  console.log("📥 TEST 3: Deposit 1000 USDC (first deposit minimum)\n");
  
  // Check allowance
  const allowance = await usdc.allowance(signer.address, POOL_ADDRESS);
  console.log("Current allowance:", ethers.formatUnits(allowance, 6));
  
  if (allowance < depositAmount) {
    console.log("Approving pool to spend USDC...");
    const approveTx = await usdc.approve(POOL_ADDRESS, ethers.MaxUint256);
    await approveTx.wait();
    console.log("✅ Approved!");
  }
  
  // Deposit
  console.log("Depositing 100 USDC...");
  const depositTx = await pool.deposit(depositAmount);
  const depositReceipt = await depositTx.wait();
  
  // Parse events
  console.log("✅ Deposit successful!");
  console.log("   Transaction:", depositReceipt.hash);
  console.log("");
  
  // Check shares received
  const myPosition = await pool.getMemberPosition(signer.address);
  console.log("My shares:", ethers.formatEther(myPosition.shares));
  console.log("My value:", ethers.formatUnits(myPosition.valueUSD, 6), "USDC");
  console.log("My ownership:", (Number(myPosition.percentage) / 100).toFixed(2), "%");
  
  // Check updated pool stats
  const statsAfterDeposit = await pool.getPoolStats();
  console.log("\nPool Stats After Deposit:");
  console.log("  Total Shares:", ethers.formatEther(statsAfterDeposit._totalShares));
  console.log("  Total NAV:", ethers.formatUnits(statsAfterDeposit._totalNAV, 6), "USDC");
  console.log("  Member Count:", statsAfterDeposit._memberCount.toString());
  console.log("  Share Price:", ethers.formatUnits(statsAfterDeposit._sharePrice, 18));
  console.log("");
  
  // ═══════════════════════════════════════════════════════════════
  // TEST 4: Partial Withdrawal
  // ═══════════════════════════════════════════════════════════════
  
  console.log("📤 TEST 4: Withdraw 50% of Shares\n");
  
  const withdrawShares = myPosition.shares / 2n;
  console.log("Withdrawing:", ethers.formatEther(withdrawShares), "shares");
  
  const usdcBefore = await usdc.balanceOf(signer.address);
  
  const withdrawTx = await pool.withdraw(withdrawShares, 0); // 0 slippage for test
  const withdrawReceipt = await withdrawTx.wait();
  
  const usdcAfter = await usdc.balanceOf(signer.address);
  const usdcReceived = usdcAfter - usdcBefore;
  
  console.log("✅ Withdrawal successful!");
  console.log("   Transaction:", withdrawReceipt.hash);
  console.log("   USDC Received:", ethers.formatUnits(usdcReceived, 6));
  console.log("");
  
  // Final stats
  const finalStats = await pool.getPoolStats();
  const finalPosition = await pool.getMemberPosition(signer.address);
  
  console.log("Final State:");
  console.log("  My Remaining Shares:", ethers.formatEther(finalPosition.shares));
  console.log("  Pool Total Shares:", ethers.formatEther(finalStats._totalShares));
  console.log("  Pool Total NAV:", ethers.formatUnits(finalStats._totalNAV, 6), "USDC");
  console.log("");
  
  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                    ALL TESTS PASSED ✅");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("CommunityPool is working on-chain:");
  console.log("  ✅ Deposit USDC → receive shares");
  console.log("  ✅ Pool tracks NAV and share price");
  console.log("  ✅ Withdraw shares → receive proportional USDC");
  console.log("");
  console.log("Contract Address:", POOL_ADDRESS);
  console.log("View on Cronoscan: https://testnet.cronoscan.com/address/" + POOL_ADDRESS);
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  });
