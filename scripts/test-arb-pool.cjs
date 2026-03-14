/**
 * Test CommunityPool Deposit & Withdraw on Arbitrum Sepolia
 */

const { ethers } = require("hardhat");

const POOL_ADDRESS = "0xfd6B402b860aD57f1393E2b60E1D676b57e0E63B";
const USDC_ADDRESS = "0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1";

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   Test CommunityPool on Arbitrum Sepolia");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const [tester] = await ethers.getSigners();
  console.log("Tester:", tester.address);
  console.log("Pool:", POOL_ADDRESS);
  
  const pool = await ethers.getContractAt("CommunityPool", POOL_ADDRESS);
  const usdc = await ethers.getContractAt("MockUSDC", USDC_ADDRESS);
  
  // Check if contract is working
  try {
    const depositToken = await pool.depositToken();
    console.log("Deposit Token:", depositToken);
  } catch (e) {
    console.log("⚠️  Contract interaction failed:", e.message.slice(0, 100));
    return;
  }
  
  // Use IERC20 interface directly for share balance
  const poolAsERC20 = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", POOL_ADDRESS);
  const shareBalance = await poolAsERC20.balanceOf(tester.address);
  const usdcBalance = await usdc.balanceOf(tester.address);
  
  console.log("\n📊 Current Balances:");
  console.log("   USDC:", ethers.formatUnits(usdcBalance, 6));
  console.log("   Pool Shares:", ethers.formatEther(shareBalance));
  
  const totalSupply = await poolAsERC20.totalSupply();
  let totalDeposited = 0n;
  try {
    totalDeposited = await pool.totalDeposited();
  } catch (e) {
    console.log("   (totalDeposited not available on this version)");
  }
  
  console.log("\n📊 Pool Stats:");
  console.log("   Total Supply:", ethers.formatEther(totalSupply), "shares");
  console.log("   Total Deposited:", ethers.formatUnits(totalDeposited, 6), "USDC");
  
  // Test withdrawal if we have shares
  if (shareBalance > 0n) {
    console.log("\n🔄 Testing Withdrawal...");
    
    const withdrawShares = shareBalance / 2n; // Withdraw half
    console.log("   Withdrawing:", ethers.formatEther(withdrawShares), "shares");
    
    try {
      const tx = await pool.withdraw(withdrawShares, 0n); // 0 minOut for test
      console.log("   TX:", tx.hash);
      const receipt = await tx.wait();
      console.log("   Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED");
      console.log("   Gas Used:", receipt.gasUsed.toString());
      
      const newShareBalance = await poolAsERC20.balanceOf(tester.address);
      const newUsdcBalance = await usdc.balanceOf(tester.address);
      console.log("\n📊 After Withdrawal:");
      console.log("   USDC:", ethers.formatUnits(newUsdcBalance, 6));
      console.log("   Pool Shares:", ethers.formatEther(newShareBalance));
      
    } catch (error) {
      console.log("   ❌ Withdrawal Error:", error.message.slice(0, 200));
    }
  } else {
    console.log("\n⚠️  No shares to withdraw. Testing deposit first...");
    
    // Mint some test USDC if balance is low
    if (usdcBalance < 100n * 10n**6n) {
      console.log("   Minting 1000 test USDC...");
      try {
        const mintTx = await usdc.mint(tester.address, 1000n * 10n**6n);
        await mintTx.wait();
        console.log("   ✅ Minted");
      } catch (e) {
        console.log("   ⚠️  Mint failed (may need admin role)");
      }
    }
    
    // Deposit 100 USDC
    const depositAmount = 100n * 10n**6n;
    const balance = await usdc.balanceOf(tester.address);
    
    if (balance >= depositAmount) {
      console.log("\n💰 Depositing 100 USDC...");
      
      // Approve
      const approveTx = await usdc.approve(POOL_ADDRESS, depositAmount);
      await approveTx.wait();
      console.log("   ✅ Approved");
      
      // Deposit
      try {
        const depositTx = await pool.deposit(depositAmount, 0n); // minShares = 0 for test
        console.log("   TX:", depositTx.hash);
        const receipt = await depositTx.wait();
        console.log("   Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED");
        
        const newShares = await poolAsERC20.balanceOf(tester.address);
        console.log("   Shares received:", ethers.formatEther(newShares));
        
      } catch (error) {
        console.log("   ❌ Deposit Error:", error.message.slice(0, 200));
      }
    } else {
      console.log("   ❌ Insufficient USDC balance for deposit");
    }
  }
  
  console.log("\n═══════════════════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
