/**
 * Diagnose Share Price Discrepancy
 * 
 * This script analyzes why share price is lower than expected
 * and provides recommendations for correction.
 */

const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

const RPC = 'https://evm-t3.cronos.org';
const POOL = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B';

const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function totalDeposited() view returns (uint256)',
  'function totalWithdrawn() view returns (uint256)',
  'function depositToken() view returns (address)',
  'function calculateTotalNAV() view returns (uint256)',
  'function memberList(uint256) view returns (address)',
  'function getMemberPosition(address) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinedAt, uint256 lastDepositAt, uint256 highWaterMark)',
];

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('     COMMUNITY POOL SHARE PRICE DIAGNOSTIC');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const provider = new ethers.JsonRpcProvider(RPC);
  const pool = new ethers.Contract(POOL, POOL_ABI, provider);

  // Get stats
  const [stats, deposited, withdrawn, usdcAddr, nav] = await Promise.all([
    pool.getPoolStats(),
    pool.totalDeposited(),
    pool.totalWithdrawn(),
    pool.depositToken(),
    pool.calculateTotalNAV(),
  ]);

  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, provider);
  const usdcBal = await usdc.balanceOf(POOL);

  const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
  const totalNAV = parseFloat(ethers.formatUnits(nav, 6));
  const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
  const memberCount = Number(stats._memberCount);
  const totalDep = parseFloat(ethers.formatUnits(deposited, 6));
  const totalWith = parseFloat(ethers.formatUnits(withdrawn, 6));
  const balance = parseFloat(ethers.formatUnits(usdcBal, 6));

  console.log('ON-CHAIN STATE:');
  console.log('─────────────────────────────────────────');
  console.log(`  Total Shares:     ${totalShares.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Total NAV:        $${totalNAV.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Share Price:      $${sharePrice.toFixed(4)}`);
  console.log(`  Members:          ${memberCount}`);
  console.log('');
  console.log('FINANCIAL FLOW:');
  console.log('─────────────────────────────────────────');
  console.log(`  Total Deposited:  $${totalDep.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Total Withdrawn:  $${totalWith.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Net Flow:         $${(totalDep - totalWith).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  USDC Balance:     $${balance.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log('');
  
  // Analysis
  console.log('ANALYSIS:');
  console.log('─────────────────────────────────────────');
  
  const avgIssuePrice = totalDep / totalShares;
  const expectedSharesAt1Dollar = totalDep;
  const excessShares = totalShares - expectedSharesAt1Dollar;
  const expectedNAV = totalShares; // If shares were $1 each
  const navShortfall = expectedNAV - totalNAV;
  
  console.log(`  Avg Share Issue Price:  $${avgIssuePrice.toFixed(4)}`);
  console.log(`  Expected Shares @ $1:   ${expectedSharesAt1Dollar.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Actual Shares:          ${totalShares.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Excess Shares Issued:   ${excessShares.toLocaleString('en-US', {minimumFractionDigits: 2})} (${((excessShares/expectedSharesAt1Dollar)*100).toFixed(1)}% more)`);
  console.log('');
  console.log(`  Expected NAV @ $1/share: $${expectedNAV.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Actual NAV:              $${totalNAV.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  NAV Shortfall:           $${navShortfall.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  
  console.log('\n');
  console.log('DIAGNOSIS:');
  console.log('─────────────────────────────────────────');
  
  if (avgIssuePrice < 0.95) {
    console.log('  ⚠️  ISSUE: Shares were issued at below-market price');
    console.log('');
    console.log('  LIKELY CAUSES:');
    console.log('  1. During V1→V2 migration, state was not properly synced');
    console.log('  2. Oracle prices failed during deposits, causing low NAV');
    console.log('  3. Initial state was set incorrectly on deployment');
    console.log('');
    console.log('  IMPACT:');
    console.log(`  - Early depositors received ${((1/avgIssuePrice - 1)*100).toFixed(1)}% more shares`);
    console.log(`  - Current share price reflects actual NAV/shares ratio`);
    console.log('');
    console.log('  RECOMMENDATIONS:');
    console.log('  1. Audit deposit tx logs to find where excess shares were issued');
    console.log('  2. Consider share adjustment if migration error is confirmed');
    console.log('  3. Ensure oracle prices are working for future deposits');
  } else {
    console.log('  ✅ Share issuance appears normal');
  }
  
  // Get member details
  console.log('\n');
  console.log('MEMBER BREAKDOWN:');
  console.log('─────────────────────────────────────────');
  
  for (let i = 0; i < memberCount; i++) {
    try {
      const memberAddr = await pool.memberList(i);
      const member = await pool.members(memberAddr);
      const shares = parseFloat(ethers.formatUnits(member.shares, 18));
      const dep = parseFloat(ethers.formatUnits(member.depositedUSD, 6));
      const with_ = parseFloat(ethers.formatUnits(member.withdrawnUSD, 6));
      const issuePrice = dep > 0 ? dep / shares : 0;
      
      console.log(`  ${i+1}. ${memberAddr.slice(0, 6)}...${memberAddr.slice(-4)}`);
      console.log(`     Deposited: $${dep.toFixed(2)} | Shares: ${shares.toFixed(2)} | Issue Price: $${issuePrice.toFixed(4)}`);
    } catch (e) {
      console.log(`  ${i+1}. Error fetching member: ${e.message}`);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
