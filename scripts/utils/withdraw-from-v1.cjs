/**
 * Withdraw from V1 CommunityPool and optionally deposit to V2
 * 
 * Usage: node scripts/utils/withdraw-from-v1.cjs [--deposit-to-v2]
 */

const { ethers } = require('ethers');
require('dotenv').config();

const V1_POOL = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const V2_POOL = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B';
const USDC = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';
const RPC = 'https://evm-t3.cronos.org';

const POOL_ABI = [
  'function getMemberPosition(address) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)',
  'function withdraw(uint256 shares) external',
  'function deposit(uint256 amount) external',
  'function getPoolStats() view returns (uint256, uint256, uint256, uint256, uint256[4])',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

async function main() {
  const depositToV2 = process.argv.includes('--deposit-to-v2');
  
  const privateKey = process.env.PRIVATE_KEY || process.env.SERVER_PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: Set PRIVATE_KEY or SERVER_PRIVATE_KEY in .env');
    process.exit(1);
  }
  
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  console.log('\n========================================');
  console.log('  V1 Pool Withdrawal Tool');
  console.log('========================================');
  console.log('Wallet:', wallet.address);
  
  const v1 = new ethers.Contract(V1_POOL, POOL_ABI, wallet);
  const v2 = new ethers.Contract(V2_POOL, POOL_ABI, wallet);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet);
  
  // Check V1 position
  console.log('\n--- V1 Pool Position ---');
  const pos = await v1.getMemberPosition(wallet.address);
  const shares = pos.shares;
  const value = ethers.formatUnits(pos.valueUSD, 6);
  
  console.log('Shares:', ethers.formatUnits(shares, 18));
  console.log('Value:', value, 'USDC');
  
  if (shares === 0n) {
    console.log('\nNo shares in V1 pool. Nothing to withdraw.');
    process.exit(0);
  }
  
  // Withdraw from V1
  console.log('\n--- Withdrawing from V1 ---');
  const tx1 = await v1.withdraw(shares);
  console.log('TX:', tx1.hash);
  await tx1.wait();
  console.log('Withdrawal complete!');
  
  // Check USDC balance
  const usdcBalance = await usdc.balanceOf(wallet.address);
  console.log('USDC Balance:', ethers.formatUnits(usdcBalance, 6));
  
  if (depositToV2 && usdcBalance > 0n) {
    console.log('\n--- Depositing to V2 ---');
    
    // Approve V2 pool
    const allowance = await usdc.allowance(wallet.address, V2_POOL);
    if (allowance < usdcBalance) {
      console.log('Approving USDC...');
      const approveTx = await usdc.approve(V2_POOL, ethers.MaxUint256);
      await approveTx.wait();
      console.log('Approved!');
    }
    
    // Deposit to V2
    const tx2 = await v2.deposit(usdcBalance);
    console.log('TX:', tx2.hash);
    await tx2.wait();
    console.log('Deposit complete!');
    
    // Check V2 position
    const v2Pos = await v2.getMemberPosition(wallet.address);
    console.log('\n--- V2 Pool Position ---');
    console.log('Shares:', ethers.formatUnits(v2Pos.shares, 18));
    console.log('Value:', ethers.formatUnits(v2Pos.valueUSD, 6), 'USDC');
  }
  
  console.log('\n========================================');
  console.log('  Done!');
  console.log('========================================\n');
}

main().catch(console.error);
