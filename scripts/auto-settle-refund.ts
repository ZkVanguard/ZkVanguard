/**
 * Auto-settle + Auto-refund (self-contained)
 * 
 * 1. Reverse-swap wBTC → USDC via Bluefin 7k (enough for hedge + refund)
 * 2. Close remaining hedge on pool
 * 3. Refund depositor $29.24
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import {
  Config as BluefinConfig,
  getQuote as bluefinGetQuote,
  buildTx as bluefinBuildTx,
  isSuiTransaction,
} from '@bluefin-exchange/bluefin7k-aggregator-sdk';

const ADMIN_KEY = process.env.SUI_POOL_ADMIN_KEY || process.env.SUI_PRIVATE_KEY;
if (!ADMIN_KEY) { console.error('Set SUI_POOL_ADMIN_KEY env var'); process.exit(1); }
const DEPOSITOR = '0x880cfa491c497f5f3c8205ef43a9e1d4cd89169a20c708ab27676ec1fe7e8aac';
const PACKAGE_ID = '0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88';
const POOL_STATE_ID = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
const AGENT_CAP_ID = '0xdeecf4483ba7729f91c1a4349a5c6b9a5b776981726b1c0136e5cf788889d46d';

const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
// wBTC on SUI mainnet
const WBTC_TYPE = '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242e33f37d::btc::BTC';

const REFUND_AMOUNT = 29.24;
const HEDGE_AMOUNT = 0.36;
const BUFFER = 1.00;
const TARGET_USDC = REFUND_AMOUNT + HEDGE_AMOUNT + BUFFER;

const keypair = Ed25519Keypair.fromSecretKey(ADMIN_KEY);
const address = keypair.getPublicKey().toSuiAddress();
const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
BluefinConfig.setSuiClient(client as any);

console.log('=== AUTO-SETTLE + REFUND ===');
console.log('Admin:', address);
console.log('Target USDC:', TARGET_USDC);
console.log('');

// Step 1: Check state
const usdcBal = await client.getBalance({ owner: address, coinType: USDC_TYPE });
const currentUsdc = Number(usdcBal.totalBalance) / 1e6;
console.log('Current USDC:', currentUsdc.toFixed(6));

// Find wBTC coin type by scanning balances
const allBalances = await client.getAllBalances({ owner: address });
let wbtcType = null;
let wbtcRaw = 0;
for (const b of allBalances) {
  if (b.coinType.toLowerCase().includes('btc') || b.coinType.includes('27792d9f') || b.coinType.includes('af8cd5ed')) {
    wbtcType = b.coinType;
    wbtcRaw = Number(b.totalBalance);
    console.log('Found wBTC:', b.coinType);
    console.log('  Balance:', wbtcRaw / 1e8, 'wBTC');
    break;
  }
}

if (!wbtcType || wbtcRaw === 0) {
  console.log('All balances:');
  for (const b of allBalances) {
    console.log(' -', b.coinType, ':', b.totalBalance);
  }
  throw new Error('No wBTC found in admin wallet');
}

// Step 2: Swap wBTC → USDC
const shortfall = TARGET_USDC - currentUsdc;
if (shortfall > 0) {
  console.log('\n--- Swap wBTC → USDC ---');
  console.log('Shortfall:', shortfall.toFixed(4));

  // Get BTC price from market
  const priceResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
  const priceData = await priceResp.json();
  const btcPrice = priceData.bitcoin?.usd || 85000;
  console.log('BTC price: $' + btcPrice);

  // Calculate wBTC to swap (with 5% buffer for slippage)
  const wbtcNeeded = (shortfall * 1.05) / btcPrice;
  const wbtcRawToSwap = Math.floor(wbtcNeeded * 1e8);
  console.log('wBTC to swap:', wbtcNeeded.toFixed(8), '(~$' + (wbtcNeeded * btcPrice).toFixed(2) + ')');

  if (wbtcRawToSwap > wbtcRaw) {
    throw new Error(`Need ${wbtcNeeded} wBTC, but admin only has ${wbtcRaw / 1e8}`);
  }

  // Get Bluefin quote
  console.log('\nFetching Bluefin quote...');
  const quoteResponse = await bluefinGetQuote({
    tokenIn: wbtcType,
    tokenOut: USDC_TYPE,
    amountIn: wbtcRawToSwap.toString(),
  });

  if (!quoteResponse) {
    throw new Error('No Bluefin quote returned');
  }

  console.log('Quote:');
  console.log('  Amount in:', wbtcRawToSwap);
  console.log('  Expected out:', quoteResponse.returnAmount, '=', Number(quoteResponse.returnAmount) / 1e6, 'USDC');
  console.log('  Price impact:', quoteResponse.priceImpact);

  // Build + execute swap
  console.log('\nBuilding and executing swap...');
  const { tx } = await bluefinBuildTx({
    quoteResponse,
    accountAddress: address,
    slippage: 0.03, // 3% slippage
    commission: { partner: address, commissionBps: 0 },
  });

  if (!isSuiTransaction(tx)) {
    throw new Error('Unexpected BluefinX routing');
  }

  tx.setGasBudget(500_000_000);
  tx.setSender(address);

  const swapResult = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showEvents: true },
  });

  const ok = swapResult.effects?.status?.status === 'success';
  console.log(ok ? 'SWAP SUCCESS' : 'SWAP FAILED');
  console.log('TX:', swapResult.digest);
  if (!ok) {
    console.error('Error:', swapResult.effects?.status?.error);
    throw new Error('Swap failed');
  }
  await new Promise(r => setTimeout(r, 4000));
}

// Step 3: Close remaining hedge
console.log('\n--- Close remaining hedge ---');
const poolObj = await client.getObject({ id: POOL_STATE_ID, options: { showContent: true } });
const hedges = (poolObj.data?.content as any)?.fields?.hedge_state?.fields?.active_hedges || [];
console.log('Active hedges:', hedges.length);

for (const h of hedges) {
  const hf = h.fields || h;
  const hedgeId = hf.hedge_id;
  const collateral = Number(hf.collateral_usdc || 0);
  console.log(`Closing hedge $${(collateral / 1e6).toFixed(6)}`);

  const coins = await client.getCoins({ owner: address, coinType: USDC_TYPE });
  const total = coins.data.reduce((s, c) => s + Number(c.balance), 0);
  if (total < collateral) {
    console.log(`  SKIP: need ${collateral / 1e6}, have ${total / 1e6}`);
    continue;
  }

  const tx = new Transaction();
  let primary = tx.object(coins.data[0].coinObjectId);
  if (coins.data.length > 1) {
    const merge = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
    tx.mergeCoins(primary, merge);
  }
  const [returnCoin] = tx.splitCoins(primary, [collateral]);
  tx.moveCall({
    target: PACKAGE_ID + '::community_pool_usdc::close_hedge',
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(AGENT_CAP_ID),
      tx.object(POOL_STATE_ID),
      tx.pure.vector('u8', hedgeId),
      tx.pure.u64(0),
      tx.pure.bool(true),
      returnCoin,
      tx.object('0x6'),
    ],
  });
  tx.setGasBudget(50_000_000);

  const r = await client.signAndExecuteTransaction({ transaction: tx, signer: keypair, options: { showEffects: true } });
  const rok = r.effects?.status?.status === 'success';
  console.log(`  ${rok ? 'SUCCESS' : 'FAILED'}: ${r.digest}`);
  if (!rok) console.log('  Error:', r.effects?.status?.error);
  await new Promise(x => setTimeout(x, 2500));
}

// Step 4: Refund depositor
console.log('\n--- Refund depositor ---');
const finalBal = await client.getBalance({ owner: address, coinType: USDC_TYPE });
const finalUsdc = Number(finalBal.totalBalance) / 1e6;
console.log('Admin USDC:', finalUsdc.toFixed(6));

if (finalUsdc < REFUND_AMOUNT) {
  throw new Error(`Insufficient USDC for refund: have ${finalUsdc}, need ${REFUND_AMOUNT}`);
}

const refundRaw = Math.floor(REFUND_AMOUNT * 1e6);
const coins = await client.getCoins({ owner: address, coinType: USDC_TYPE });
const tx = new Transaction();
let primary = tx.object(coins.data[0].coinObjectId);
if (coins.data.length > 1) {
  const merge = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
  tx.mergeCoins(primary, merge);
}
const [refundCoin] = tx.splitCoins(primary, [refundRaw]);
tx.transferObjects([refundCoin], DEPOSITOR);
tx.setGasBudget(10_000_000);

const rr = await client.signAndExecuteTransaction({ transaction: tx, signer: keypair, options: { showEffects: true } });
const rrok = rr.effects?.status?.status === 'success';
console.log(rrok ? 'REFUND SUCCESS' : 'REFUND FAILED');
console.log('TX:', rr.digest);
if (!rrok) console.log('Error:', rr.effects?.status?.error);

// Final state
await new Promise(r => setTimeout(r, 3000));
const depBal = await client.getBalance({ owner: DEPOSITOR, coinType: USDC_TYPE });
console.log('\n=== FINAL STATE ===');
console.log('Depositor USDC:', (Number(depBal.totalBalance) / 1e6).toFixed(6));
const poolFinal = await client.getObject({ id: POOL_STATE_ID, options: { showContent: true } });
const pf = (poolFinal.data?.content as any)?.fields;
console.log('Pool balance:', (Number(pf?.balance || 0) / 1e6).toFixed(6));
console.log('Pool hedged:', (Number(pf?.hedge_state?.fields?.total_hedged_value || 0) / 1e6).toFixed(6));
console.log('Active hedges:', (pf?.hedge_state?.fields?.active_hedges || []).length);
console.log('Total NAV:', ((Number(pf?.balance || 0) + Number(pf?.hedge_state?.fields?.total_hedged_value || 0)) / 1e6).toFixed(6));
