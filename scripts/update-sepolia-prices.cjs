/**
 * Update Pyth prices on Sepolia for Community Pool
 */

const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.vercel.temp' });

// Pyth Sepolia address
const PYTH_SEPOLIA = '0xDd24F84d36BF92C65F92307595335bdFab5Bbd21';

// Price IDs from the pool (BTC, ETH, CRO, SUI)
const PRICE_IDS = [
  'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC
  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH
  '23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe', // CRO (fixed)
  '23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744', // SUI
];

// Pyth ABI
const PYTH_ABI = [
  'function updatePriceFeeds(bytes[] calldata updateData) payable',
  'function getUpdateFee(bytes[] calldata updateData) view returns (uint256)',
  'function getPriceNoOlderThan(bytes32 id, uint256 age) view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))',
];

async function main() {
  console.log('Updating Pyth prices on Sepolia...\n');

  const pk = (process.env.PRIVATE_KEY || '').trim();
  const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
  const wallet = new ethers.Wallet(pk, provider);
  const pyth = new ethers.Contract(PYTH_SEPOLIA, PYTH_ABI, wallet);

  // Fetch from Hermes v2 API
  const queryParams = PRICE_IDS.map(id => `ids%5B%5D=0x${id}`).join('&');
  const url = `https://hermes.pyth.network/v2/updates/price/latest?${queryParams}`;
  console.log('Fetching from Hermes...');
  console.log('URL:', url);
  
  const response = await fetch(url);
  const text = await response.text();
  console.log('Response status:', response.status);
  console.log('Response text preview:', text.slice(0, 200));
  
  let data;
  try {
    data = JSON.parse(text);
  } catch(e) {
    console.error('JSON parse failed:', e.message);
    process.exit(1);
  }
  
  if (!data.binary?.data?.length) {
    console.error('No price data:', JSON.stringify(data).slice(0, 200));
    process.exit(1);
  }

  console.log(`Got ${data.binary.data.length} price updates`);
  
  // Convert to update data format
  const updateData = data.binary.data.map(hex => '0x' + hex);
  
  // Get fee and submit
  const fee = await pyth.getUpdateFee(updateData);
  console.log(`Update fee: ${ethers.formatEther(fee)} ETH`);
  
  const tx = await pyth.updatePriceFeeds(updateData, { value: fee });
  console.log(`Tx: ${tx.hash}`);
  await tx.wait();
  
  console.log('\n✅ Prices updated!');
  
  // Verify
  const names = ['BTC', 'ETH', 'CRO', 'SUI'];
  for (let i = 0; i < PRICE_IDS.length; i++) {
    try {
      const price = await pyth.getPriceNoOlderThan('0x' + PRICE_IDS[i], 3600);
      const val = Number(price.price) * Math.pow(10, Number(price.expo));
      console.log(`${names[i]}: $${val.toFixed(2)}`);
    } catch (e) {
      console.log(`${names[i]}: Error`);
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
