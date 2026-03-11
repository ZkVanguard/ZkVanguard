/**
 * Recapitalize Community Pool
 * 
 * Adds USDC directly to the pool contract WITHOUT minting new shares.
 * This restores the share price to $1.00 by increasing NAV.
 * 
 * Usage: node scripts/utils/recapitalize-pool.cjs [--execute]
 */

const { ethers } = require('ethers');
require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local', override: true });

const RPC = 'https://evm-t3.cronos.org';
const POOL_ADDRESS = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B';
const USDC_ADDRESS = '0x28217DAddC55e3C4831b4A48A00Ce04880786967'; // MockUSDC on Cronos Testnet

const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function totalShares() view returns (uint256)',
  'function calculateTotalNAV() view returns (uint256)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('     COMMUNITY POOL RECAPITALIZATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check for private key (try multiple env vars)
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY;
  
  const provider = new ethers.JsonRpcProvider(RPC);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);
  const usdcRead = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
  
  // Get current state first (doesn't need wallet)
  const [stats, totalShares, nav, decimals, symbol] = await Promise.all([
    pool.getPoolStats(),
    pool.totalShares(),
    pool.calculateTotalNAV(),
    usdcRead.decimals(),
    usdcRead.symbol(),
  ]);

  const sharesNum = parseFloat(ethers.formatUnits(totalShares, 18));
  const navNum = parseFloat(ethers.formatUnits(nav, decimals));
  const currentSharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
  
  // Calculate required amount
  const targetNav = sharesNum; // $1 per share
  const shortfall = targetNav - navNum;
  const shortfallRaw = ethers.parseUnits(shortfall.toFixed(6), decimals);

  console.log('CURRENT STATE:');
  console.log('─────────────────────────────────────────');
  console.log(`  Total Shares:      ${sharesNum.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Current NAV:       $${navNum.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  Share Price:       $${currentSharePrice.toFixed(4)}`);
  console.log('');

  console.log('RECAPITALIZATION NEEDED:');
  console.log('─────────────────────────────────────────');
  console.log(`  Target NAV:        $${targetNav.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  ${symbol} to Add:       $${shortfall.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log('');

  if (shortfall <= 0) {
    console.log('✅ No recapitalization needed! Share price is at or above $1.00');
    process.exit(0);
  }

  console.log('AFTER RECAPITALIZATION:');
  console.log('─────────────────────────────────────────');
  console.log(`  New NAV:           $${targetNav.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log(`  New Share Price:   $1.0000`);
  console.log('');

  if (!privateKey) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  MANUAL TRANSFER REQUIRED');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log(`  Transfer $${shortfall.toFixed(2)} USDC directly to the pool contract:`);
    console.log('');
    console.log(`  Pool Address: ${POOL_ADDRESS}`);
    console.log(`  USDC Address: ${USDC_ADDRESS}`);
    console.log(`  Amount:       ${shortfall.toFixed(6)} USDC`);
    console.log('');
    console.log('  You can do this via:');
    console.log('  1. MetaMask: Send USDC to the pool address');
    console.log('  2. Cronoscan: Write contract -> transfer(pool, amount)');
    console.log('  3. Set DEPLOYER_PRIVATE_KEY in .env.local and run with --execute');
    console.log('');
    process.exit(0);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
  const walletBalance = await usdc.balanceOf(wallet.address);
  const walletBalNum = parseFloat(ethers.formatUnits(walletBalance, decimals));

  console.log(`Wallet: ${wallet.address}`);
  console.log(`Your ${symbol} Balance: $${walletBalNum.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
  console.log('');

  if (walletBalNum < shortfall) {
    console.log(`❌ Insufficient balance. You have $${walletBalNum.toFixed(2)}, need $${shortfall.toFixed(2)}`);
    console.log(`   Need additional: $${(shortfall - walletBalNum).toFixed(2)} ${symbol}`);
    process.exit(1);
  }

  if (!execute) {
    console.log('⚠️  DRY RUN - No changes made');
    console.log(`   To execute, run: node scripts/utils/recapitalize-pool.cjs --execute`);
    console.log('');
    process.exit(0);
  }

  // Execute transfer
  console.log('EXECUTING TRANSFER...');
  console.log('─────────────────────────────────────────');
  
  try {
    const tx = await usdc.transfer(POOL_ADDRESS, shortfallRaw);
    console.log(`  Tx Hash: ${tx.hash}`);
    console.log('  Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log(`  ✅ Confirmed in block ${receipt.blockNumber}`);
    console.log('');

    // Verify new state
    const newNav = await pool.calculateTotalNAV();
    const newStats = await pool.getPoolStats();
    const newNavNum = parseFloat(ethers.formatUnits(newNav, decimals));
    const newSharePrice = parseFloat(ethers.formatUnits(newStats._sharePrice, 6));

    console.log('NEW STATE:');
    console.log('─────────────────────────────────────────');
    console.log(`  New NAV:           $${newNavNum.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    console.log(`  New Share Price:   $${newSharePrice.toFixed(4)}`);
    console.log('');
    console.log('✅ Recapitalization complete!');
    
  } catch (error) {
    console.log(`❌ Transfer failed: ${error.message}`);
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
