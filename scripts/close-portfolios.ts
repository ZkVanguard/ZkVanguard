/**
 * Close unused portfolios by withdrawing all assets
 * 
 * Keeps only Portfolio #3 as the main $150M institutional portfolio
 */

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const RWA_MANAGER_ADDRESS = '0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189';
const WCRO_ADDRESS = '0x6a3173618859C7cd40fAF6921b5E9eB6A76f1fD4';
const MOCK_USDC_ADDRESS = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';

const RWA_MANAGER_ABI = [
  {
    inputs: [{ name: '_portfolioId', type: 'uint256' }, { name: '_asset', type: 'address' }, { name: '_amount', type: 'uint256' }],
    name: 'withdrawAsset',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: '_portfolioId', type: 'uint256' }, { name: '_asset', type: 'address' }],
    name: 'getAssetAllocation',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
];

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY not set');
  }

  const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org');
  const wallet = new ethers.Wallet(privateKey, provider);
  const rwaManager = new ethers.Contract(RWA_MANAGER_ADDRESS, RWA_MANAGER_ABI, wallet);

  console.log('🧹 Closing unused portfolios...');
  console.log(`   Wallet: ${wallet.address}`);

  // Portfolio #0 - Withdraw 11 WCRO (11 * 1e18 = 11000000000000000000)
  console.log('\n📦 Portfolio #0:');
  try {
    const wcroBalance = await rwaManager.getAssetAllocation(0, WCRO_ADDRESS);
    console.log(`   WCRO allocation: ${ethers.formatUnits(wcroBalance, 18)} WCRO`);
    
    if (wcroBalance > 0n) {
      console.log('   Withdrawing WCRO...');
      const tx0 = await rwaManager.withdrawAsset(0, WCRO_ADDRESS, wcroBalance);
      await tx0.wait();
      console.log(`   ✅ Withdrawn! TX: ${tx0.hash}`);
    } else {
      console.log('   ⏭️ No WCRO to withdraw');
    }
  } catch (e) {
    console.log(`   ❌ Error: ${e instanceof Error ? e.message : e}`);
  }

  // Portfolio #2 - Withdraw MockUSDC ($150M = 150000000 * 1e6)
  console.log('\n📦 Portfolio #2:');
  try {
    const mockUsdcBalance = await rwaManager.getAssetAllocation(2, MOCK_USDC_ADDRESS);
    console.log(`   MockUSDC allocation: ${ethers.formatUnits(mockUsdcBalance, 6)} MockUSDC`);
    
    if (mockUsdcBalance > 0n) {
      console.log('   Withdrawing MockUSDC...');
      const tx2 = await rwaManager.withdrawAsset(2, MOCK_USDC_ADDRESS, mockUsdcBalance);
      await tx2.wait();
      console.log(`   ✅ Withdrawn! TX: ${tx2.hash}`);
    } else {
      console.log('   ⏭️ No MockUSDC to withdraw');
    }
  } catch (e) {
    console.log(`   ❌ Error: ${e instanceof Error ? e.message : e}`);
  }

  // Verify Portfolio #3 still has funds
  console.log('\n📦 Portfolio #3 (KEEP):');
  try {
    const portfolio3Balance = await rwaManager.getAssetAllocation(3, MOCK_USDC_ADDRESS);
    console.log(`   MockUSDC: ${ethers.formatUnits(portfolio3Balance, 6)} MockUSDC`);
    console.log('   ✅ Main portfolio intact!');
  } catch (e) {
    console.log(`   ❌ Error: ${e instanceof Error ? e.message : e}`);
  }

  console.log('\n✅ Done! Portfolio #3 is now the only active $150M portfolio.');
}

main().catch(console.error);
