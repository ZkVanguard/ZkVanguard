/**
 * Test Pool Deposit - Verify CommunityPool V2 with Pyth Oracle
 * 
 * Tests:
 * 1. Deposit USDC into the pool
 * 2. Verify shares received
 * 3. Check NAV calculation with Pyth pricing
 * 
 * Usage:
 *   npx hardhat run scripts/test-pool-deposit.cjs --network cronos-testnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Load deployment info
function loadDeployment(chainId) {
  const filename = `community-pool-v2-${chainId === 338 ? 'testnet' : 'mainnet'}.json`;
  const filepath = path.join(__dirname, "..", "deployments", filename);
  
  if (fs.existsSync(filepath)) {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  }
  
  // Fallback to current deployment
  return {
    contracts: {
      CommunityPool: {
        // Use new deployment or fallback to current
        proxy: process.env.COMMUNITY_POOL_ADDRESS || "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30",
      }
    },
    configuration: {
      depositToken: "0x28217DAddC55e3C4831b4A48A00Ce04880786967",
    }
  };
}

async function main() {
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   Test CommunityPool Deposit with Pyth Oracle");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const [tester] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  
  console.log("Tester:", tester.address);
  console.log("Network:", chainId === 338 ? "Cronos Testnet" : "Cronos Mainnet");
  
  // Load deployment
  const deployment = loadDeployment(chainId);
  const poolAddress = deployment.contracts.CommunityPool.proxy;
  const usdcAddress = deployment.configuration.depositToken;
  
  console.log("Pool:", poolAddress);
  console.log("USDC:", usdcAddress);
  console.log("\n");

  // Get contracts
  const pool = await ethers.getContractAt("CommunityPool", poolAddress);
  const usdc = await ethers.getContractAt("IERC20", usdcAddress);
  
  // Check balances
  const usdcBalance = await usdc.balanceOf(tester.address);
  console.log("Your USDC balance:", ethers.formatUnits(usdcBalance, 6), "USDC");
  
  if (usdcBalance < 10n * 10n**6n) {
    console.log("\n⚠️  Need at least 10 USDC to test deposit");
    console.log("   Mint some MockUSDC first or get from faucet");
    return;
  }

  // Test deposit amount: 10 USDC
  const depositAmount = 10n * 10n**6n; // 10 USDC
  
  // Check pool stats before
  console.log("\n📊 Pool Stats Before:");
  const statsBefore = await pool.getPoolStats();
  console.log("   Total NAV:", ethers.formatUnits(statsBefore._totalNAV, 6), "USDC");
  console.log("   Total Shares:", ethers.formatUnits(statsBefore._totalShares, 18));
  console.log("   Members:", statsBefore._memberCount.toString());

  // Check oracle health
  console.log("\n🔮 Oracle Health:");
  try {
    const health = await pool.checkOracleHealth();
    console.log("   Healthy:", health.healthy);
    console.log("   Configured:", health.configured.toString());
    console.log("   Working:", health.working.toString());
    console.log("   Fresh:", health.fresh.toString());
  } catch (e) {
    console.log("   ⚠️  Oracle health check failed:", e.message.slice(0, 50));
  }

  // Approve USDC
  console.log("\n💳 Approving USDC...");
  const approveTx = await usdc.approve(poolAddress, depositAmount);
  await approveTx.wait();
  console.log("✅ Approved", ethers.formatUnits(depositAmount, 6), "USDC");

  // Deposit
  console.log("\n📥 Depositing...");
  try {
    const depositTx = await pool.deposit(depositAmount, { gasLimit: 500000 });
    const receipt = await depositTx.wait();
    console.log("✅ Deposit successful! Gas used:", receipt.gasUsed.toString());
  } catch (e) {
    console.log("❌ Deposit failed:", e.message);
    return;
  }

  // Check pool stats after
  console.log("\n📊 Pool Stats After:");
  const statsAfter = await pool.getPoolStats();
  console.log("   Total NAV:", ethers.formatUnits(statsAfter._totalNAV, 6), "USDC");
  console.log("   Total Shares:", ethers.formatUnits(statsAfter._totalShares, 18));
  console.log("   Members:", statsAfter._memberCount.toString());
  
  // Calculate NAV
  console.log("\n💰 NAV Calculation:");
  const nav = await pool.calculateTotalNAV();
  console.log("   calculateTotalNAV():", ethers.formatUnits(nav, 6), "USDC");
  
  // Member position
  const position = await pool.getMemberPosition(tester.address);
  console.log("\n👤 Your Position:");
  console.log("   Shares:", ethers.formatUnits(position.shares, 18));
  console.log("   Value:", ethers.formatUnits(position.valueUSD, 6), "USDC");
  console.log("   Ownership:", (Number(position.percentage) / 100).toFixed(2) + "%");

  console.log("\n✅ Test complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  });
