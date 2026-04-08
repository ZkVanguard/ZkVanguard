/**
 * WDK Swap & Hedge Test — Complete E2E
 * 
 * Tests:
 * 1. Sepolia RPC connectivity & wallet balance
 * 2. USDT token state
 * 3. Pyth oracle price update (fixes stale prices on testnet)
 * 4. Pool contract state (getPoolStats — requires fresh oracle)
 * 5. Asset tokens & balances
 * 6. Roles & permissions
 * 7. DEX quote functionality
 * 8. Execute a $1 test trade
 * 9. Cross-chain USDT balances
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ethers } from 'ethers';

const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.HEDERA_PRIVATE_KEY;
const RPC_URL = 'https://sepolia.drpc.org';

const POOL_ADDRESS = '0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086';
const USDT_ADDRESS = '0xd077a400968890eacc75cdc901f0356c943e4fdb';
const DEX_ADDRESS = '0x57e888f22c21D931b2deA19bb132a8d344F1F965';

const ASSET_NAMES = ['BTC', 'ETH', 'CRO', 'SUI'] as const;

const PYTH_PRICE_IDS = [
  'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC/USD
  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH/USD
  '23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe', // CRO/USD
  '23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744', // SUI/USD
];

const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function dexRouter() view returns (address)',
  'function depositToken() view returns (address)',
  'function assetTokens(uint256) view returns (address)',
  'function assetBalances(uint256) view returns (uint256)',
  'function executeRebalanceTrade(uint8 assetIndex, uint256 amount, bool isBuy, uint256 minAmountOut) external',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function REBALANCER_ROLE() view returns (bytes32)',
  'function MIN_RESERVE_RATIO_BPS() view returns (uint256)',
  'function pythOracle() view returns (address)',
  'function pythPriceIds(uint256) view returns (bytes32)',
  'function assetDecimals(uint256) view returns (uint8)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const DEX_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
];

const PYTH_ABI = [
  'function updatePriceFeeds(bytes[] calldata updateData) external payable',
  'function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)',
  'function getPriceUnsafe(bytes32 id) view returns (int64 price, uint64 conf, int32 expo, uint publishTime)',
];

let pass = 0, fail = 0;
function ok(label: string, detail?: string) { pass++; console.log(`  ✅ ${label}${detail ? ': ' + detail : ''}`); }
function err(label: string, detail: string) { fail++; console.log(`  ❌ ${label}: ${detail}`); }

async function main() {
  console.log('🔧 WDK Sepolia Pool — Swap & Hedge E2E Test');
  console.log('═'.repeat(60));

  if (!PRIVATE_KEY) {
    console.error('❌ No private key (TREASURY_PRIVATE_KEY / PRIVATE_KEY)');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);
  const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);

  console.log(`Wallet: ${wallet.address}`);
  console.log(`Pool:   ${POOL_ADDRESS}`);

  // ═══ 1. CONNECTIVITY ═══
  console.log('\n═══ 1. SEPOLIA CONNECTIVITY ═══');

  try {
    const network = await provider.getNetwork();
    ok('RPC connected', `chainId=${network.chainId}`);
  } catch (e: any) {
    err('RPC connection', e.message);
    process.exit(1);
  }

  const gasBalance = await provider.getBalance(wallet.address);
  if (gasBalance > 0n) {
    ok('Wallet gas', `${parseFloat(ethers.formatEther(gasBalance)).toFixed(4)} ETH`);
  } else {
    err('Wallet gas', '0 ETH — need Sepolia ETH');
  }

  // ═══ 2. USDT TOKEN ═══
  console.log('\n═══ 2. USDT TOKEN ═══');

  try {
    const sym = await usdt.symbol();
    ok('USDT token', sym);
  } catch (e: any) {
    err('USDT token', e.message?.slice(0, 100));
  }

  let poolUsdtBalance = 0n;
  try {
    poolUsdtBalance = await usdt.balanceOf(POOL_ADDRESS);
    ok('Pool USDT', `${ethers.formatUnits(poolUsdtBalance, 6)} USDT`);
  } catch (e: any) {
    err('Pool USDT', e.message?.slice(0, 100));
  }

  try {
    const bal = await usdt.balanceOf(wallet.address);
    ok('Wallet USDT', `${ethers.formatUnits(bal, 6)} USDT`);
  } catch (e: any) {
    err('Wallet USDT', e.message?.slice(0, 100));
  }

  // ═══ 3. PYTH ORACLE UPDATE ═══
  console.log('\n═══ 3. PYTH ORACLE UPDATE ═══');

  let pythOracleAddr = '';
  try {
    pythOracleAddr = await pool.pythOracle();
    ok('Pyth oracle', pythOracleAddr.slice(0, 12) + '...');
  } catch (e: any) {
    err('Pyth oracle', e.message?.slice(0, 100));
  }

  if (pythOracleAddr && pythOracleAddr !== ethers.ZeroAddress) {
    const pyth = new ethers.Contract(pythOracleAddr, PYTH_ABI, wallet);

    // Check staleness
    let anyStale = false;
    for (let i = 0; i < 4; i++) {
      try {
        const priceId = await pool.pythPriceIds(i);
        const pd = await pyth.getPriceUnsafe(priceId);
        const age = Math.floor(Date.now() / 1000) - Number(pd.publishTime);
        const stale = age > 86400;
        if (stale) anyStale = true;
        console.log(`  ${stale ? '⚠️  STALE' : '✓ Fresh'} ${ASSET_NAMES[i]}: $${(Number(pd.price) / 1e8).toFixed(2)} (${(age / 3600).toFixed(1)}h ago)`);
      } catch { /* price read failed */ }
    }

    if (anyStale) {
      console.log('  Pushing fresh prices from Pyth Hermes...');
    } else {
      console.log('  All prices fresh, updating anyway...');
    }

    try {
      const idsQuery = PYTH_PRICE_IDS.map(id => `ids[]=${id}`).join('&');
      const resp = await fetch(
        `https://hermes.pyth.network/v2/updates/price/latest?${idsQuery}`,
        { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) },
      );
      if (!resp.ok) throw new Error(`Hermes ${resp.status}`);
      const data = await resp.json();
      if (!data.binary?.data?.[0]) throw new Error('No binary data');

      const updateData = ['0x' + data.binary.data[0]];
      const fee = await pyth.getUpdateFee(updateData);
      const tx = await pyth.updatePriceFeeds(updateData, { value: fee });
      const receipt = await tx.wait();
      ok('Pyth prices updated on-chain', `tx=${receipt.hash.slice(0, 14)}... fee=${ethers.formatEther(fee)} ETH`);
    } catch (e: any) {
      err('Pyth price update', e.message?.slice(0, 150));
    }
  }

  // ═══ 4. POOL CONTRACT STATE ═══
  console.log('\n═══ 4. POOL STATE (after oracle update) ═══');

  let contractWorks = false;
  let dexRouterAddr = '';

  try {
    const stats = await pool.getPoolStats();
    const navUsd = Number(ethers.formatUnits(stats._totalNAV, 6));
    const sharePrice = Number(ethers.formatUnits(stats._sharePrice, 18));
    ok('getPoolStats()', `NAV=$${navUsd.toFixed(2)} sharePrice=${sharePrice.toFixed(6)} members=${stats._memberCount}`);
    contractWorks = true;

    const allocs = stats._allocations.map((a: bigint, i: number) =>
      `${ASSET_NAMES[i]}=${(Number(a) / 100).toFixed(0)}%`
    ).join(', ');
    console.log(`  Allocations: ${allocs}`);
  } catch (e: any) {
    err('getPoolStats()', e.message?.slice(0, 150));
  }

  try {
    dexRouterAddr = await pool.dexRouter();
    if (dexRouterAddr !== ethers.ZeroAddress) {
      ok('DEX router', dexRouterAddr.slice(0, 12) + '...');
    } else {
      err('DEX router', 'ZeroAddress');
    }
  } catch (e: any) {
    err('DEX router', e.message?.slice(0, 100));
  }

  // ═══ 5. ASSET TOKENS ═══
  console.log('\n═══ 5. ASSET TOKENS ═══');

  const assetAddresses: string[] = [];
  for (let i = 0; i < 4; i++) {
    try {
      const addr = await pool.assetTokens(i);
      assetAddresses.push(addr);
      if (addr !== ethers.ZeroAddress) {
        const token = new ethers.Contract(addr, ERC20_ABI, provider);
        const sym = await token.symbol();
        const dec = await pool.assetDecimals(i);
        const bal = await pool.assetBalances(i);
        ok(`${ASSET_NAMES[i]}`, `${sym} bal=${ethers.formatUnits(bal, dec)}`);
      } else {
        err(`${ASSET_NAMES[i]}`, 'not configured');
      }
    } catch (e: any) {
      assetAddresses.push(ethers.ZeroAddress);
      err(`${ASSET_NAMES[i]}`, e.message?.slice(0, 80));
    }
  }

  // ═══ 6. ROLES ═══
  console.log('\n═══ 6. PERMISSIONS ═══');

  let hasRole = false;
  try {
    const role = await pool.REBALANCER_ROLE();
    hasRole = await pool.hasRole(role, wallet.address);
    ok('REBALANCER_ROLE', hasRole ? 'granted' : 'MISSING');
    if (!hasRole) fail++; // Count as failure
  } catch (e: any) {
    err('REBALANCER_ROLE', e.message?.slice(0, 80));
  }

  // ═══ 7. DEX QUOTES ═══
  console.log('\n═══ 7. DEX QUOTES ═══');

  const dex = new ethers.Contract(dexRouterAddr || DEX_ADDRESS, DEX_ABI, provider);
  const testAmount = ethers.parseUnits('1', 6);

  for (let i = 0; i < 4; i++) {
    if (!assetAddresses[i] || assetAddresses[i] === ethers.ZeroAddress) continue;
    try {
      const amounts = await dex.getAmountsOut(testAmount, [USDT_ADDRESS, assetAddresses[i]]);
      const dec = await pool.assetDecimals(i);
      ok(`1 USDT → ${ASSET_NAMES[i]}`, `${ethers.formatUnits(amounts[1], dec)} ${ASSET_NAMES[i]}`);
    } catch (e: any) {
      err(`USDT→${ASSET_NAMES[i]}`, e.message?.slice(0, 80));
    }
  }

  // ═══ 8. TEST TRADE ═══
  console.log('\n═══ 8. TEST TRADE ($1 USDT → BTC) ═══');

  const canTrade = poolUsdtBalance >= ethers.parseUnits('1', 6) && contractWorks && hasRole && dexRouterAddr !== ethers.ZeroAddress;

  if (canTrade) {
    const signedPool = pool.connect(wallet) as ethers.Contract;
    try {
      const tx = await signedPool.executeRebalanceTrade(0, ethers.parseUnits('1', 6), true, 0n);
      const receipt = await tx.wait();
      ok('Trade executed', `tx=${receipt.hash.slice(0, 14)}...`);

      // Verify balance changed
      const newBal = await pool.assetBalances(0);
      console.log(`  BTC balance after trade: ${ethers.formatUnits(newBal, 8)}`);
    } catch (e: any) {
      err('Trade execution', e.message?.slice(0, 150));
    }
  } else {
    const reasons: string[] = [];
    if (poolUsdtBalance < ethers.parseUnits('1', 6)) reasons.push('pool USDT < $1');
    if (!contractWorks) reasons.push('getPoolStats failed');
    if (!hasRole) reasons.push('no REBALANCER_ROLE');
    if (dexRouterAddr === ethers.ZeroAddress || !dexRouterAddr) reasons.push('no DEX');
    console.log(`  ⏭️  Skip: ${reasons.join(', ')}`);
  }

  // ═══ 9. CROSS-CHAIN ═══
  console.log('\n═══ 9. CROSS-CHAIN USDT ═══');

  try {
    const cronosProvider = new ethers.JsonRpcProvider('https://evm.cronos.org');
    const cronosUsdt = new ethers.Contract('0x66e428c3f67a68878562e79A0234c1F83c208770', ERC20_ABI, cronosProvider);
    const bal = await cronosUsdt.balanceOf(wallet.address);
    ok('Cronos USDT', `${ethers.formatUnits(bal, 6)} USDT`);
  } catch (e: any) {
    err('Cronos USDT', e.message?.slice(0, 80));
  }

  // ═══ SUMMARY ═══
  console.log('\n═══ SUMMARY ═══');
  console.log(`  ✅ Passed: ${pass}`);
  console.log(`  ❌ Failed: ${fail}`);
  console.log(`  Total: ${pass + fail}`);
  console.log(fail === 0 ? '\n🟢 ALL TESTS PASSED' : `\n🟡 ${fail} issue(s) — check details above`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
