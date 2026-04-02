/**
 * Test: Verify live Crypto.com prices sync to PerpetualDEX on-chain
 */
import { ethers } from 'ethers';

const RPC = 'https://evm-t3.cronos.org';
const PERPETUAL_DEX = '0x22E2F34a0637b0e959C2F10D2A0Ec7742B9956D7';
const USDC_ADDRESS = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';
const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY;
if (!DEPLOYER_PK) {
  throw new Error('DEPLOYER_PRIVATE_KEY environment variable is required. Never hardcode private keys.');
}

const DEX_ABI = [
  'function setMockPrice(uint256 pairIndex, uint256 price) external',
  'function mockPrices(uint256) view returns (uint256)',
  'function owner() view returns (address)',
];

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function mint(address to, uint256 amount) external',
];

const PAIR_NAMES: Record<number, string> = { 0: 'BTC', 1: 'ETH', 2: 'CRO', 3: 'ATOM', 4: 'DOGE', 5: 'SOL' };
const CDC_TICKERS: Record<number, string> = { 0: 'BTC_USDT', 1: 'ETH_USDT', 2: 'CRO_USDT' };

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
  const perpetualDex = new ethers.Contract(PERPETUAL_DEX, DEX_ABI, deployer);
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, deployer);

  console.log('=== BEFORE SYNC ===');
  for (const [idx, name] of Object.entries(PAIR_NAMES)) {
    const i = Number(idx);
    if (i > 2) continue;
    const price = await perpetualDex.mockPrices(i);
    console.log(`  ${name}: $${(Number(price) / 1e10).toFixed(4)}`);
  }

  // Fetch live prices from Crypto.com
  console.log('\n📡 Fetching live Crypto.com prices...');
  const resp = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers');
  const data = await resp.json();
  const tickers = data.result?.data || [];

  const livePrices: Record<number, number> = {};
  for (const t of tickers) {
    for (const [idx, ticker] of Object.entries(CDC_TICKERS)) {
      if (t.i === ticker) {
        livePrices[Number(idx)] = parseFloat(t.a);
      }
    }
  }

  console.log('Live prices:');
  for (const [idx, price] of Object.entries(livePrices)) {
    console.log(`  ${PAIR_NAMES[Number(idx)]}: $${price}`);
  }

  // Sync each price on-chain
  console.log('\n🔄 Syncing to PerpetualDEX on-chain...');
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits('5000', 'gwei');

  for (const [idx, price] of Object.entries(livePrices)) {
    const i = Number(idx);
    const scaled = BigInt(Math.round(price * 1e10));
    try {
      const tx = await perpetualDex.setMockPrice(i, scaled, { gasPrice });
      await tx.wait();
      console.log(`  ✅ ${PAIR_NAMES[i]}: set to $${price} (scaled: ${scaled})`);
    } catch (err: any) {
      console.log(`  ❌ ${PAIR_NAMES[i]}: ${err.message?.slice(0, 100)}`);
    }
  }

  // Verify
  console.log('\n=== AFTER SYNC ===');
  for (const [idx, name] of Object.entries(PAIR_NAMES)) {
    const i = Number(idx);
    if (i > 2) continue;
    const price = await perpetualDex.mockPrices(i);
    console.log(`  ${name}: $${(Number(price) / 1e10).toFixed(4)}`);
  }

  // Check PerpetualDEX USDC balance
  const balance = await usdc.balanceOf(PERPETUAL_DEX);
  console.log(`\n💰 PerpetualDEX USDC balance: ${ethers.formatUnits(balance, 6)}`);

  // Mint some extra USDC to ensure liquidity for testing
  const targetBalance = ethers.parseUnits('500000000', 6); // 500M USDC
  if (balance < targetBalance) {
    const deficit = targetBalance - balance;
    console.log(`  Minting ${ethers.formatUnits(deficit, 6)} USDC to PerpetualDEX...`);
    const tx = await usdc.mint(PERPETUAL_DEX, deficit, { gasPrice });
    await tx.wait();
    const newBal = await usdc.balanceOf(PERPETUAL_DEX);
    console.log(`  ✅ New balance: ${ethers.formatUnits(newBal, 6)} USDC`);
  }

  console.log('\n✅ Price sync test complete!');
}

main().catch(console.error);
