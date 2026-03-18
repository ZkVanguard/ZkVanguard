/**
 * Real Sepolia Testnet USDT Deposit Test
 * 
 * Uses official Tether WDK USDT mock for ERC-4337 testing
 * 
 * Get test USDT:
 *   - Pimlico: https://dashboard.pimlico.io/test-erc20-faucet
 *   - Candide: https://dashboard.candide.dev/faucet
 * 
 * Usage:
 *   npx hardhat run scripts/test-sepolia-usdt-deposit.cjs --network sepolia
 */

const { ethers } = require("hardhat");

// WDK USDT on Sepolia
const WDK_USDT = "0xd077a400968890eacc75cdc901f0356c943e4fdb";
const COMMUNITY_POOL = "0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const POOL_ABI = [
  "function deposit(uint256 amountUSD) external returns (uint256)",
  "function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)",
  "function getMemberPosition(address member) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)",
  "function depositToken() view returns (address)",
  "event Deposited(address indexed member, uint256 amountUSD, uint256 sharesReceived, uint256 sharePrice, uint256 timestamp)",
];

async function main() {
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("   🧪 REAL SEPOLIA TESTNET WDK USDT DEPOSIT TEST");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("");

  const [signer] = await ethers.getSigners();
  if (!signer) {
    console.log("❌ No signer found. Set PRIVATE_KEY in .env.local");
    return;
  }

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  
  console.log("📍 Network: Sepolia Testnet (Chain ID:", chainId + ")");
  console.log("👛 Wallet:", signer.address);
  console.log("");

  // Check ETH balance
  const ethBalance = await ethers.provider.getBalance(signer.address);
  const ethFormatted = ethers.formatEther(ethBalance);
  console.log("⛽ ETH Balance:", ethFormatted, "ETH");
  
  if (ethBalance < ethers.parseEther("0.001")) {
    console.log("\n⚠️  Low ETH balance! Need gas for transactions.");
    console.log("   Get Sepolia ETH from: https://sepoliafaucet.com/");
    return;
  }

  // Check WDK USDT balance
  const usdt = new ethers.Contract(WDK_USDT, ERC20_ABI, signer);
  const decimals = Number(await usdt.decimals());
  const symbol = await usdt.symbol();
  const name = await usdt.name();
  const usdtBalance = await usdt.balanceOf(signer.address);
  
  console.log("💵 WDK USDT Balance:", ethers.formatUnits(usdtBalance, decimals), symbol);
  console.log("   Name:", name);
  console.log("   Contract:", WDK_USDT);
  console.log("");

  if (usdtBalance === 0n) {
    console.log("❌ No WDK USDT balance!");
    console.log("\n📋 Get test USDT from:");
    console.log("   Pimlico: https://dashboard.pimlico.io/test-erc20-faucet");
    console.log("   Candide: https://dashboard.candide.dev/faucet");
    return;
  }

  // Check pool status
  const pool = new ethers.Contract(COMMUNITY_POOL, POOL_ABI, signer);
  const stats = await pool.getPoolStats();
  const depositToken = await pool.depositToken();
  
  console.log("📊 COMMUNITY POOL STATUS");
  console.log("─────────────────────────");
  console.log("   Total NAV:", ethers.formatUnits(stats._totalNAV, 6), "USD");
  console.log("   Total Shares:", ethers.formatUnits(stats._totalShares, 18));
  console.log("   Share Price:", ethers.formatUnits(stats._sharePrice, 6), "USD");
  console.log("   Members:", stats._memberCount.toString());
  console.log("   Deposit Token:", depositToken);
  console.log("   Pool Address:", COMMUNITY_POOL);
  console.log("");

  // Check current position
  try {
    const position = await pool.getMemberPosition(signer.address);
    console.log("👤 YOUR CURRENT POSITION");
    console.log("─────────────────────────");
    console.log("   Shares:", ethers.formatUnits(position.shares, 18));
    console.log("   Value:", ethers.formatUnits(position.valueUSD, 6), "USD");
    console.log("   Ownership:", (Number(position.percentage) / 100).toFixed(4) + "%");
    console.log("");
  } catch (e) {
    console.log("👤 No existing position\n");
  }

  // First deposit requires $100 minimum (inflation attack prevention)
  // Subsequent deposits only require $10
  const isFirstDeposit = stats._totalShares === 0n;
  const minDeposit = isFirstDeposit ? 100 : 10;
  
  const depositAmount = ethers.parseUnits(minDeposit.toString(), decimals);
  
  if (usdtBalance < depositAmount) {
    console.log("⚠️  Insufficient USDT for", minDeposit, "USDT deposit");
    console.log("   Have:", ethers.formatUnits(usdtBalance, decimals), symbol);
    console.log("   Need:", minDeposit + ".0", symbol);
    if (isFirstDeposit) {
      console.log("   Note: First deposit requires $100 minimum (inflation attack prevention)");
    }
    return;
  }

  // Approve USDT spend (USDT requires reset to 0 before changing allowance)
  console.log("💳 APPROVING USDT SPEND");
  console.log("─────────────────────────");
  
  const allowance = await usdt.allowance(signer.address, COMMUNITY_POOL);
  console.log("   Current allowance:", ethers.formatUnits(allowance, decimals), symbol);
  
  if (allowance < depositAmount) {
    // Some tokens (like USDT) require resetting to 0 first
    if (allowance > 0n) {
      console.log("   Resetting allowance to 0 first...");
      const resetTx = await usdt.approve(COMMUNITY_POOL, 0);
      await resetTx.wait();
    }
    
    // Approve max for convenience
    const maxApproval = ethers.MaxUint256;
    console.log("   Approving unlimited", symbol + "...");
    const approveTx = await usdt.approve(COMMUNITY_POOL, maxApproval);
    console.log("   Approve tx:", approveTx.hash);
    await approveTx.wait();
    console.log("   ✅ Approval confirmed");
  } else {
    console.log("   ✅ Already approved");
  }
  console.log("");

  // Deposit to pool
  console.log("🏦 DEPOSITING TO COMMUNITY POOL");
  console.log("─────────────────────────────────");
  console.log("   Amount:", minDeposit + ".0", symbol);
  if (isFirstDeposit) {
    console.log("   Note: First deposit (requires $100 minimum)");
  }
  
  const depositTx = await pool.deposit(depositAmount);
  console.log("   Deposit tx:", depositTx.hash);
  console.log("   ⏳ Waiting for confirmation...");
  
  const receipt = await depositTx.wait();
  console.log("   ✅ DEPOSIT CONFIRMED!");
  console.log("   Block:", receipt.blockNumber);
  console.log("   Gas used:", receipt.gasUsed.toString());
  console.log("");

  // Parse deposit event
  const depositEvent = receipt.logs
    .map(log => {
      try {
        return pool.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(event => event?.name === "Deposited");

  if (depositEvent) {
    console.log("📋 DEPOSIT DETAILS");
    console.log("─────────────────────────");
    console.log("   Depositor:", depositEvent.args.member);
    console.log("   Amount:", ethers.formatUnits(depositEvent.args.amountUSD, 6), "USD");
    console.log("   Shares Received:", ethers.formatUnits(depositEvent.args.sharesReceived, 18));
    console.log("   Share Price:", ethers.formatUnits(depositEvent.args.sharePrice, 6), "USD");
    console.log("");
  }

  // Check new stats
  const newStats = await pool.getPoolStats();
  console.log("📊 POOL AFTER DEPOSIT");
  console.log("─────────────────────────");
  console.log("   Total NAV:", ethers.formatUnits(newStats._totalNAV, 6), "USD");
  console.log("   NAV Change:", ethers.formatUnits(newStats._totalNAV - stats._totalNAV, 6), "USD");
  console.log("   Total Shares:", ethers.formatUnits(newStats._totalShares, 18));
  console.log("   Members:", newStats._memberCount.toString());
  console.log("");

  // Check new position
  const newPosition = await pool.getMemberPosition(signer.address);
  console.log("👤 YOUR NEW POSITION");
  console.log("─────────────────────────");
  console.log("   Shares:", ethers.formatUnits(newPosition.shares, 18));
  console.log("   Value:", ethers.formatUnits(newPosition.valueUSD, 6), "USD");
  console.log("   Ownership:", (Number(newPosition.percentage) / 100).toFixed(4) + "%");
  console.log("");

  console.log("🔍 VERIFY ON EXPLORER");
  console.log("─────────────────────────");
  console.log("   https://sepolia.etherscan.io/tx/" + depositTx.hash);
  
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("   ✅ SEPOLIA WDK USDT DEPOSIT TEST SUCCESSFUL!");
  console.log("═══════════════════════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
