
import { ethers } from 'ethers';

const RPC_URL = 'https://sepolia.drpc.org';
const USDT_ADDRESS = '0xd077a400968890eacc75cdc901f0356c943e4fdb'; // Sepolia USDT
const SAFE_ADDRESS = '0xFD898B4D00214faaA59D4eeDA068533e05280F65';

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

async function main() {
    console.log(`Checking USDT balance for Safe: ${SAFE_ADDRESS}...`);
    
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
        
        const balance = await usdt.balanceOf(SAFE_ADDRESS);
        const decimals = await usdt.decimals();
        const symbol = await usdt.symbol();
        
        const formatted = ethers.formatUnits(balance, decimals);
        
        console.log('----------------------------------------');
        console.log(`Balance: ${formatted} ${symbol}`);
        console.log('----------------------------------------');
        
        if (balance > 0n) {
            console.log('✅ Balance confirmed! You can now proceed with Gasless Deposit.');
        } else {
            console.log('⏳ Balance is still 0. Transaction might be pending or sent to wrong address.');
        }

    } catch (e: any) {
        console.error('Error checking balance:', e.message);
    }
}

main();
