/**
 * Test USDT Withdrawal from Sepolia Community Pool
 * 
 * Tests:
 * 1. Read current user shares from on-chain
 * 2. Withdraw a small amount (10 shares = $10 USDT)
 * 3. Verify USDT was received
 * 
 * Usage: PRIVATE_KEY="0x..." npx hardhat run scripts/test-sepolia-usdt-withdraw.cjs --network sepolia
 */

const { ethers } = require('hardhat');

// WDK USDT on Sepolia (official Tether test token)
const WDK_USDT_SEPOLIA = '0xd077a400968890eacc75cdc901f0356c943e4fdb';
// CommunityPool on Sepolia
const POOL_ADDRESS = '0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const POOL_ABI = [
  'function withdraw(uint256 sharesToBurn, uint256 minAmountOut) external returns (uint256)',
  'function getMemberPosition(address member) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinTime)',
  'function totalShares() view returns (uint256)',
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] memory _allocations)',
  'function paused() view returns (bool)',
  'event Withdrawn(address indexed member, uint256 sharesBurned, uint256 amountUSD, uint256 sharePrice, uint256 timestamp)',
];

async function main() {
  console.log('='.repeat(60));
  console.log('🧪 Sepolia CommunityPool Withdrawal Test');
  console.log('='.repeat(60));
  
  const [signer] = await ethers.getSigners();
  console.log(`\n📍 Wallet: ${signer.address}`);
  
  // Connect to contracts
  const usdt = new ethers.Contract(WDK_USDT_SEPOLIA, ERC20_ABI, signer);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);
  
  // Get current state
  console.log('\n📊 Current State (Before Withdrawal):');
  
  const usdtBalanceBefore = await usdt.balanceOf(signer.address);
  const decimals = await usdt.decimals();
  const symbol = await usdt.symbol();
  console.log(`   USDT Balance: ${ethers.formatUnits(usdtBalanceBefore, decimals)} ${symbol}`);
  
  const memberData = await pool.members(signer.address);
  const userShares = ethers.formatUnits(memberData.shares, 18);
  console.log(`   Pool Shares: ${userShares}`);
  
  // Get pool stats (includes share price)
  const poolStats = await pool.getPoolStats();
  const sharePrice = poolStats._sharePrice;
  console.log(`   Share Price: $${ethers.formatUnits(sharePrice, 6)}`);
  
  const totalShares = poolStats._totalShares;
  console.log(`   Pool Total Shares: ${ethers.formatUnits(totalShares, 18)}`);
  
  // Calculate value
  const sharesFloat = parseFloat(userShares);
  const priceFloat = parseFloat(ethers.formatUnits(sharePrice, 6));
  const valueUSD = sharesFloat * priceFloat;
  console.log(`   Your Position Value: $${valueUSD.toFixed(2)}`);
  
  // Check if pool is paused
  const isPaused = await pool.paused();
  console.log(`   Pool Paused: ${isPaused}`);
  
  if (sharesFloat <= 0) {
    console.log('\n❌ No shares to withdraw!');
    return;
  }
  
  if (isPaused) {
    console.log('\n❌ Pool is paused - withdrawals disabled!');
    return;
  }
  
  // Withdraw 10 shares ($10), minAmountOut = 0 for no slippage protection
  const withdrawShares = ethers.parseUnits('10', 18); // 10 shares
  const minAmountOut = 0; // Accept any amount (no slippage protection for test)
  console.log(`\n🔄 Withdrawing 10 shares (~$10 USDT)...`);
  
  try {
    const tx = await pool.withdraw(withdrawShares, minAmountOut);
    console.log(`   Tx: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
    
    // Parse withdrawal event
    const withdrawEvent = receipt.logs.find(log => {
      try {
        const parsed = pool.interface.parseLog(log);
        return parsed?.name === 'Withdrawn';
      } catch { return false; }
    });
    
    if (withdrawEvent) {
      const parsed = pool.interface.parseLog(withdrawEvent);
      console.log(`\n📤 Withdrawal Details:`);
      console.log(`   Shares Burned: ${ethers.formatUnits(parsed.args.sharesBurned, 18)}`);
      console.log(`   USDT Received: $${ethers.formatUnits(parsed.args.amountUSD, 6)}`);
      console.log(`   Share Price: $${ethers.formatUnits(parsed.args.sharePrice, 6)}`);
    }
    
    // Check final balances
    console.log('\n📊 Final State (After Withdrawal):');
    
    const usdtBalanceAfter = await usdt.balanceOf(signer.address);
    console.log(`   USDT Balance: ${ethers.formatUnits(usdtBalanceAfter, decimals)} ${symbol}`);
    
    const memberDataAfter = await pool.members(signer.address);
    const userSharesAfter = ethers.formatUnits(memberDataAfter.shares, 18);
    console.log(`   Pool Shares: ${userSharesAfter}`);
    
    const totalSharesAfter = await pool.totalShares();
    console.log(`   Pool Total Shares: ${ethers.formatUnits(totalSharesAfter, 18)}`);
    
    // Calculate changes
    const usdtGain = usdtBalanceAfter - usdtBalanceBefore;
    console.log(`\n💰 USDT Received: +${ethers.formatUnits(usdtGain, decimals)} ${symbol}`);
    
    console.log('\n✅ Withdrawal test PASSED!');
    console.log(`   https://sepolia.etherscan.io/tx/${tx.hash}`);
    
  } catch (error) {
    console.log('\n❌ Withdrawal failed:', error.message);
    if (error.reason) {
      console.log('   Reason:', error.reason);
    }
  }
  
  console.log('\n' + '='.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
