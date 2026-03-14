/**
 * Diagnose Arbitrum Withdraw Issue
 * Checks all conditions that could cause withdraw to fail
 */

require('dotenv').config({ path: '.env.local' });
const { ethers } = require('hardhat');

const CONFIG = {
  pool: '0xfd6B402b860aD57f1393E2b60E1D676b57e0E63B',
  usdc: '0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1',
};

const POOL_ABI = [
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinedAt, uint256 lastDepositAt, uint256 highWaterMark)',
  'function totalShares() view returns (uint256)',
  'function paused() view returns (bool)',
  'function circuitBreakerTripped() view returns (bool)',
  'function emergencyWithdrawEnabled() view returns (bool)',
  'function maxSingleWithdrawalBps() view returns (uint256)',
  'function dailyWithdrawalCapBps() view returns (uint256)',
  'function dailyWithdrawalTotal() view returns (uint256)',
  'function currentWithdrawalDay() view returns (uint256)',
  'function calculateTotalNAV() view returns (uint256)',
  'function VIRTUAL_ASSETS() view returns (uint256)',
  'function VIRTUAL_SHARES() view returns (uint256)',
  'function BPS_DENOMINATOR() view returns (uint256)',
  'function MIN_SHARES_FOR_WITHDRAWAL() view returns (uint256)',
  'function withdraw(uint256 shares) returns (uint256 amount)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('   ARBITRUM WITHDRAW DIAGNOSTIC');
  console.log('═'.repeat(60) + '\n');

  const [signer] = await ethers.getSigners();
  console.log('📍 Address:', signer.address);

  const pool = new ethers.Contract(CONFIG.pool, POOL_ABI, signer);
  const usdc = new ethers.Contract(CONFIG.usdc, ERC20_ABI, signer);

  // Gather all diagnostic data
  console.log('\n📊 Checking Pool State...\n');

  try {
    const paused = await pool.paused();
    console.log(`   Paused: ${paused}`);
    if (paused) console.log('   ❌ ISSUE: Contract is paused!');

    const circuitBreaker = await pool.circuitBreakerTripped();
    console.log(`   Circuit Breaker: ${circuitBreaker}`);
    if (circuitBreaker) console.log('   ❌ ISSUE: Circuit breaker is tripped!');

    const emergencyWithdraw = await pool.emergencyWithdrawEnabled();
    console.log(`   Emergency Withdraw: ${emergencyWithdraw}`);
  } catch (e) {
    console.log(`   ❌ Error getting basic state: ${e.message}`);
  }

  console.log('\n📊 Checking User State...\n');

  try {
    const member = await pool.members(signer.address);
    console.log(`   User Shares: ${ethers.formatUnits(member.shares, 18)}`);
    console.log(`   User Deposited: $${ethers.formatUnits(member.depositedUSD, 6)}`);
    console.log(`   User Withdrawn: $${ethers.formatUnits(member.withdrawnUSD, 6)}`);

    if (member.shares === 0n) {
      console.log('   ❌ ISSUE: User has no shares to withdraw!');
      return;
    }
  } catch (e) {
    console.log(`   ❌ Error getting member data: ${e.message}`);
  }

  console.log('\n📊 Checking Pool Constants...\n');

  try {
    const totalShares = await pool.totalShares();
    console.log(`   Total Shares: ${ethers.formatUnits(totalShares, 18)}`);

    const minShares = await pool.MIN_SHARES_FOR_WITHDRAWAL();
    console.log(`   Min Shares for Withdrawal: ${ethers.formatUnits(minShares, 18)}`);

    const maxSingleBps = await pool.maxSingleWithdrawalBps();
    console.log(`   Max Single Withdrawal: ${maxSingleBps} bps (${Number(maxSingleBps)/100}%)`);

    const dailyCapBps = await pool.dailyWithdrawalCapBps();
    console.log(`   Daily Cap: ${dailyCapBps} bps (${Number(dailyCapBps)/100}%)`);

    const dailyTotal = await pool.dailyWithdrawalTotal();
    console.log(`   Today's Withdrawals: $${ethers.formatUnits(dailyTotal, 6)}`);
  } catch (e) {
    console.log(`   ❌ Error getting constants: ${e.message}`);
  }

  console.log('\n📊 Checking NAV & Liquidity...\n');

  try {
    const nav = await pool.calculateTotalNAV();
    console.log(`   Total NAV: $${ethers.formatUnits(nav, 6)}`);
    
    if (nav === 0n) {
      console.log('   ❌ ISSUE: NAV is zero - check oracle/price feeds!');
    }

    const usdcBalance = await usdc.balanceOf(CONFIG.pool);
    console.log(`   Pool USDC Balance: $${ethers.formatUnits(usdcBalance, 6)}`);

    if (usdcBalance === 0n) {
      console.log('   ❌ ISSUE: Pool has no USDC - cannot process withdrawals!');
    }

  } catch (e) {
    console.log(`   ❌ Error getting NAV: ${e.message}`);
    console.log(`   This is likely the issue - NAV calculation is failing.`);
    console.log(`   Check: Oracle address, price feed IDs, stale threshold`);
  }

  // Try to simulate a small withdrawal
  console.log('\n📊 Simulating Withdrawal...\n');

  try {
    const member = await pool.members(signer.address);
    const testShares = member.shares / 10n; // Try withdrawing 10%

    if (testShares > 0n) {
      console.log(`   Attempting staticCall for ${ethers.formatUnits(testShares, 18)} shares...`);
      
      try {
        const result = await pool.withdraw.staticCall(testShares);
        console.log(`   ✅ Simulation SUCCESS! Would receive: $${ethers.formatUnits(result, 6)}`);
      } catch (e) {
        console.log(`   ❌ Simulation FAILED: ${e.message}`);
        
        // Try to decode the error
        if (e.data) {
          console.log(`   Error data: ${e.data}`);
        }
        if (e.reason) {
          console.log(`   Reason: ${e.reason}`);
        }
      }
    }
  } catch (e) {
    console.log(`   ❌ Could not simulate: ${e.message}`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('   DIAGNOSTIC COMPLETE');
  console.log('═'.repeat(60) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
