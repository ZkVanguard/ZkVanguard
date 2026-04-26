/**
 * Swap ALL assets → USDC, then refund depositor.
 * Uses Bluefin 7k aggregator.
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

const ADMIN_KEY = '***REDACTED_LEAKED_KEY_1***';
const DEPOSITOR = '0x880cfa491c497f5f3c8205ef43a9e1d4cd89169a20c708ab27676ec1fe7e8aac';
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const WETH_TYPE = '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN';
const WBTC_TYPE = '0x27792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242e33f37d::coin::COIN';
const SUI_TYPE = '0x2::sui::SUI';
const REFUND_AMOUNT = 29.24;
const SUI_GAS_RESERVE = 1.5; // Keep 1.5 SUI for gas

const keypair = Ed25519Keypair.fromSecretKey(ADMIN_KEY);
const address = keypair.getPublicKey().toSuiAddress();
const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
BluefinConfig.setSuiClient(client as any);

// Min slippage — abort if DEX output is less than X% of market value
const MIN_OUTPUT_RATIO = 0.60; // Accept up to 40% slippage/fees (these are tiny amounts on thin pools)

async function swapToUsdc(fromType: string, fromDecimals: number, amount: number, symbol: string, marketPriceUsd: number): Promise<number> {
  const amountRaw = Math.floor(amount * Math.pow(10, fromDecimals));
  const expectedMarketUsd = amount * marketPriceUsd;
  console.log(`\n--- Swap ${amount.toFixed(fromDecimals)} ${symbol} → USDC ---`);
  console.log(`  Market value: $${expectedMarketUsd.toFixed(4)}`);

  const quote = await bluefinGetQuote({
    tokenIn: fromType,
    tokenOut: USDC_TYPE,
    amountIn: amountRaw.toString(),
  });

  if (!quote) {
    console.log('  ERROR: No Bluefin quote returned');
    return 0;
  }

  // returnAmount from Bluefin SDK is already in decimal USDC (not raw)
  const expectedUsdc = Number(quote.returnAmount);
  const ratio = expectedMarketUsd > 0 ? expectedUsdc / expectedMarketUsd : 0;
  console.log(`  Quote returnAmount raw: ${quote.returnAmount}`);
  console.log(`  Expected USDC: $${expectedUsdc.toFixed(6)} (${(ratio * 100).toFixed(1)}% of market value)`);

  if (ratio < MIN_OUTPUT_RATIO) {
    console.log(`  ABORT: Output ${(ratio * 100).toFixed(1)}% < ${(MIN_OUTPUT_RATIO * 100)}% minimum`);
    return 0;
  }

  if (expectedUsdc < 0.10) {
    console.log('  SKIP: Output too small (< $0.10)');
    return 0;
  }

  const { tx } = await bluefinBuildTx({
    quoteResponse: quote,
    accountAddress: address,
    slippage: 0.05, // 5% slippage tolerance
    commission: { partner: address, commissionBps: 0 },
  });

  if (!isSuiTransaction(tx)) {
    console.log('  ERROR: BluefinX routing not supported');
    return 0;
  }

  tx.setGasBudget(500_000_000);
  tx.setSender(address);

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  const ok = result.effects?.status?.status === 'success';
  console.log(`  ${ok ? 'SUCCESS' : 'FAILED'}: ${result.digest}`);
  if (!ok) {
    console.log('  Error:', result.effects?.status?.error);
    return 0;
  }
  await new Promise(r => setTimeout(r, 3500));
  return expectedUsdc;
}

async function main() {
  console.log('=== BATCH SWAP + REFUND ===');
  console.log('Admin:', address);

  // Get all balances
  const allBal = await client.getAllBalances({ owner: address });
  const balMap: Record<string, number> = {};
  for (const b of allBal) balMap[b.coinType] = Number(b.totalBalance);

  const currentUsdc = (balMap[USDC_TYPE] || 0) / 1e6;
  const wethAmount = (balMap[WETH_TYPE] || 0) / 1e8;
  const wbtcAmount = (balMap[WBTC_TYPE] || 0) / 1e8;
  const suiAmount = (balMap[SUI_TYPE] || 0) / 1e9;

  console.log('\n=== CURRENT HOLDINGS ===');
  console.log('USDC:', currentUsdc.toFixed(6));
  console.log('WETH:', wethAmount.toFixed(8));
  console.log('WBTC:', wbtcAmount.toFixed(8));
  console.log('SUI: ', suiAmount.toFixed(4));

  let totalUsdcAcquired = currentUsdc;

  // Fetch live market prices
  const priceResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,sui&vs_currencies=usd');
  const priceData = await priceResp.json();
  const btcPrice = priceData.bitcoin?.usd || 74000;
  const ethPrice = priceData.ethereum?.usd || 2000;
  const suiPrice = priceData.sui?.usd || 3.5;
  console.log(`\nPrices: BTC=$${btcPrice}, ETH=$${ethPrice}, SUI=$${suiPrice}`);

  // Swap WETH → USDC (all of it)
  if (wethAmount > 0) {
    const got = await swapToUsdc(WETH_TYPE, 8, wethAmount, 'WETH', ethPrice);
    totalUsdcAcquired += got;
  }

  // Swap WBTC → USDC (all of it)
  if (wbtcAmount > 0) {
    const got = await swapToUsdc(WBTC_TYPE, 8, wbtcAmount, 'WBTC', btcPrice);
    totalUsdcAcquired += got;
  }

  // Check if we still need more (keep 1.5 SUI for gas)
  const remainingNeeded = REFUND_AMOUNT - totalUsdcAcquired + 0.50; // +0.50 buffer
  if (remainingNeeded > 0) {
    const swappableSui = Math.max(0, suiAmount - SUI_GAS_RESERVE);
    if (swappableSui > 0.1) {
      // Only swap enough SUI to cover shortfall
      const suiToSwap = Math.min(swappableSui, (remainingNeeded * 1.05) / suiPrice);
      console.log(`\nNeed $${remainingNeeded.toFixed(2)} more — swapping ${suiToSwap.toFixed(4)} SUI`);
      const got = await swapToUsdc(SUI_TYPE, 9, suiToSwap, 'SUI', suiPrice);
      totalUsdcAcquired += got;
    }
  }

  // Refund depositor
  console.log('\n=== REFUND DEPOSITOR ===');
  const finalBal = await client.getBalance({ owner: address, coinType: USDC_TYPE });
  const finalUsdc = Number(finalBal.totalBalance) / 1e6;
  console.log('Admin USDC:', finalUsdc.toFixed(6));

  if (finalUsdc < 1.0) {
    console.log('ERROR: Not enough USDC to refund');
    return;
  }

  // Refund what we can (full $29.24 or whatever's available)
  const refundAmount = Math.min(REFUND_AMOUNT, finalUsdc - 0.10); // leave $0.10 buffer
  const refundRaw = Math.floor(refundAmount * 1e6);

  console.log('Refunding:', refundAmount.toFixed(6), 'USDC');
  console.log('To:', DEPOSITOR);

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

  const r = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });
  const ok = r.effects?.status?.status === 'success';
  console.log(ok ? 'REFUND SUCCESS!' : 'REFUND FAILED');
  console.log('TX:', r.digest);
  if (!ok) console.log('Error:', r.effects?.status?.error);

  // Final state
  await new Promise(r => setTimeout(r, 3000));
  const depBal = await client.getBalance({ owner: DEPOSITOR, coinType: USDC_TYPE });
  const adminAfter = await client.getBalance({ owner: address, coinType: USDC_TYPE });
  console.log('\n=== FINAL ===');
  console.log('Depositor USDC:', (Number(depBal.totalBalance) / 1e6).toFixed(6));
  console.log('Admin USDC:', (Number(adminAfter.totalBalance) / 1e6).toFixed(6));
  
  const refundedSoFar = refundAmount;
  const stillOwed = Math.max(0, REFUND_AMOUNT - refundedSoFar);
  if (stillOwed > 0) {
    console.log(`\nStill owed: $${stillOwed.toFixed(2)}`);
  } else {
    console.log('\nDEPOSITOR FULLY REFUNDED ✓');
  }
}

main().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
