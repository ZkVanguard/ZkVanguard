/**
 * Test: Verify live Crypto.com prices sync to MockMoonlander on-chain
 */
import { ethers } from 'ethers';

const RPC = 'https://evm-t3.cronos.org';
const MOCK_MOONLANDER = '0x22E2F34a0637b0e959C2F10D2A0Ec7742B9956D7';
const MOCK_USDC = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';
const DEPLOYER_PK = '0x7af57dd2889cb16393ff945b87a8ce670aea2950179c425a572059017636b18d';

const MOONLANDER_ABI = [
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
  const moonlander = new ethers.Contract(MOCK_MOONLANDER, MOONLANDER_ABI, deployer);
  const usdc = new ethers.Contract(MOCK_USDC, USDC_ABI, deployer);

  console.log('=== BEFORE SYNC ===');
  for (const [idx, name] of Object.entries(PAIR_NAMES)) {
    const i = Number(idx);
    if (i > 2) continue;
    const price = await moonlander.mockPrices(i);
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
  console.log('\n🔄 Syncing to MockMoonlander on-chain...');
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits('5000', 'gwei');

  for (const [idx, price] of Object.entries(livePrices)) {
    const i = Number(idx);
    const scaled = BigInt(Math.round(price * 1e10));
    try {
      const tx = await moonlander.setMockPrice(i, scaled, { gasPrice });
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
    const price = await moonlander.mockPrices(i);
    console.log(`  ${name}: $${(Number(price) / 1e10).toFixed(4)}`);
  }

  // Check MockMoonlander USDC balance
  const balance = await usdc.balanceOf(MOCK_MOONLANDER);
  console.log(`\n💰 MockMoonlander USDC balance: ${ethers.formatUnits(balance, 6)}`);

  // Mint some extra USDC to ensure liquidity for testing
  const targetBalance = ethers.parseUnits('500000000', 6); // 500M USDC
  if (balance < targetBalance) {
    const deficit = targetBalance - balance;
    console.log(`  Minting ${ethers.formatUnits(deficit, 6)} USDC to MockMoonlander...`);
    const tx = await usdc.mint(MOCK_MOONLANDER, deficit, { gasPrice });
    await tx.wait();
    const newBal = await usdc.balanceOf(MOCK_MOONLANDER);
    console.log(`  ✅ New balance: ${ethers.formatUnits(newBal, 6)} USDC`);
  }

  console.log('\n✅ Price sync test complete!');
}

main().catch(console.error);
