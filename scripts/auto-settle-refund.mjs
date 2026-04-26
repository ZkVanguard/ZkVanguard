/**
 * Auto-settle + Auto-refund Script
 * 
 * Does the full flow automatically:
 * 1. Reverse-swap wBTC → USDC (enough to cover remaining hedge + depositor refund)
 * 2. Close the last remaining hedge on the new pool ($0.36)
 * 3. Send $29.24 USDC to the depositor (0x880c)
 * 
 * Uses Bluefin 7k aggregator for the swap.
 */

async function main() {
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
  const { Transaction } = await import('@mysten/sui/transactions');
  const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

  const ADMIN_KEY = '***REDACTED_LEAKED_KEY_1***';
  const DEPOSITOR = '0x880cfa491c497f5f3c8205ef43a9e1d4cd89169a20c708ab27676ec1fe7e8aac';
  const PACKAGE_ID = '0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88';
  const POOL_STATE_ID = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
  const AGENT_CAP_ID = '0xdeecf4483ba7729f91c1a4349a5c6b9a5b776981726b1c0136e5cf788889d46d';
  const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

  const REFUND_AMOUNT = 29.24;       // USDC to refund depositor
  const HEDGE_TO_CLOSE = 0.36;       // USDC to close the last hedge
  const BUFFER = 0.50;                // Extra buffer for slippage/fees
  const TARGET_USDC = REFUND_AMOUNT + HEDGE_TO_CLOSE + BUFFER; // ~$30.10

  const keypair = Ed25519Keypair.fromSecretKey(ADMIN_KEY);
  const address = keypair.getPublicKey().toSuiAddress();
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });

  console.log('=== AUTO-SETTLE + REFUND ===');
  console.log('Admin:', address);
  console.log('Depositor:', DEPOSITOR);
  console.log('Target USDC:', TARGET_USDC);
  console.log('');

  // Step 1: Check current state
  const balance = await client.getBalance({ owner: address, coinType: USDC_TYPE });
  const currentUsdc = Number(balance.totalBalance) / 1e6;
  console.log('Current admin USDC:', currentUsdc.toFixed(6));

  const shortfall = TARGET_USDC - currentUsdc;
  console.log('Shortfall:', shortfall.toFixed(6));

  // Step 2: Reverse-swap wBTC → USDC using Bluefin
  if (shortfall > 0) {
    console.log('\n--- Step 2: Reverse-swap wBTC → USDC via Bluefin ---');
    
    // Use the existing BluefinAggregatorService
    // We need to set env vars so it picks up admin key
    process.env.SUI_POOL_ADMIN_KEY = ADMIN_KEY;
    process.env.SUI_NETWORK = 'mainnet';
    
    const { getBluefinAggregatorService } = await import('../lib/services/sui/BluefinAggregatorService.js').catch(() =>
      import('../lib/services/sui/BluefinAggregatorService.ts')
    );
    const aggregator = getBluefinAggregatorService('mainnet');

    // Fetch BTC price
    const btcPriceResp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    const btcPriceData = await btcPriceResp.json();
    const btcPrice = btcPriceData.bitcoin?.usd || 85000;
    console.log('BTC price:', btcPrice);

    // Amount of wBTC to swap (with 3% safety buffer for slippage/fees)
    const wbtcToSwap = (shortfall * 1.03) / btcPrice;
    console.log('wBTC to swap:', wbtcToSwap.toFixed(8), '(~$', (wbtcToSwap * btcPrice).toFixed(2), ')');

    // Get reverse quote
    const quote = await aggregator.getReverseSwapQuote('BTC', wbtcToSwap);
    console.log('Quote: wBTC → USDC');
    console.log('  Amount in:', quote.amountIn);
    console.log('  Expected USDC out:', Number(quote.expectedAmountOut) / 1e6);
    console.log('  Route:', quote.route);
    console.log('  Can swap on-chain:', quote.canSwapOnChain);

    if (!quote.canSwapOnChain) {
      console.error('ERROR: wBTC → USDC route not available on-chain');
      process.exit(1);
    }

    // Execute the swap
    console.log('\nExecuting swap...');
    const swapResult = await aggregator.executeSwap(quote, 0.02); // 2% slippage
    
    if (!swapResult.success) {
      console.error('Swap failed:', swapResult.error);
      process.exit(1);
    }
    
    console.log('Swap success!');
    console.log('  TX:', swapResult.txDigest);
    console.log('  USDC received:', Number(swapResult.amountOut || 0) / 1e6);
    
    // Wait for state
    await new Promise(r => setTimeout(r, 3000));
  }

  // Step 3: Check new admin USDC balance
  const newBalance = await client.getBalance({ owner: address, coinType: USDC_TYPE });
  const newUsdc = Number(newBalance.totalBalance) / 1e6;
  console.log('\n--- Step 3: Check balance ---');
  console.log('New admin USDC:', newUsdc.toFixed(6));

  if (newUsdc < REFUND_AMOUNT + HEDGE_TO_CLOSE) {
    console.error(`\nWARNING: Still insufficient. Need $${(REFUND_AMOUNT + HEDGE_TO_CLOSE).toFixed(2)} but have $${newUsdc.toFixed(6)}`);
    console.error('Proceeding with what we have — will prioritize depositor refund');
  }

  // Step 4: Close the remaining hedge on the pool
  console.log('\n--- Step 4: Close remaining hedge on pool ---');
  const poolObj = await client.getObject({ id: POOL_STATE_ID, options: { showContent: true } });
  const hedges = poolObj.data?.content?.fields?.hedge_state?.fields?.active_hedges || [];
  console.log('Active hedges:', hedges.length);

  if (hedges.length > 0 && newUsdc >= HEDGE_TO_CLOSE) {
    for (const h of hedges) {
      const hf = h.fields || h;
      const hedgeId = hf.hedge_id;
      const collateral = Number(hf.collateral_usdc || 0);
      console.log(`Closing hedge with $${(collateral / 1e6).toFixed(6)} collateral`);

      const coins = await client.getCoins({ owner: address, coinType: USDC_TYPE });
      const freshTotal = coins.data.reduce((s, c) => s + Number(c.balance), 0);
      if (freshTotal < collateral) {
        console.log(`  SKIP: insufficient USDC (${freshTotal / 1e6} < ${collateral / 1e6})`);
        continue;
      }

      const tx = new Transaction();
      let primaryCoin;
      if (coins.data.length === 1) {
        primaryCoin = tx.object(coins.data[0].coinObjectId);
      } else {
        primaryCoin = tx.object(coins.data[0].coinObjectId);
        const merge = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
        if (merge.length > 0) tx.mergeCoins(primaryCoin, merge);
      }
      const [returnCoin] = tx.splitCoins(primaryCoin, [collateral]);
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

      const closeResult = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
      });
      const ok = closeResult.effects?.status?.status === 'success';
      console.log(`  ${ok ? 'SUCCESS' : 'FAILED'}: ${closeResult.digest}`);
      if (!ok) console.log('  Error:', closeResult.effects?.status?.error);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Step 5: Refund depositor
  console.log('\n--- Step 5: Refund depositor ---');
  const finalBalance = await client.getBalance({ owner: address, coinType: USDC_TYPE });
  const finalUsdc = Number(finalBalance.totalBalance) / 1e6;
  console.log('Admin USDC after hedge close:', finalUsdc.toFixed(6));

  if (finalUsdc < REFUND_AMOUNT) {
    console.error(`ERROR: Insufficient for refund. Have $${finalUsdc.toFixed(6)}, need $${REFUND_AMOUNT}`);
    process.exit(1);
  }

  const refundRaw = Math.floor(REFUND_AMOUNT * 1e6);
  const coins = await client.getCoins({ owner: address, coinType: USDC_TYPE });
  const tx = new Transaction();
  let primaryCoin;
  if (coins.data.length === 1) {
    primaryCoin = tx.object(coins.data[0].coinObjectId);
  } else {
    primaryCoin = tx.object(coins.data[0].coinObjectId);
    const merge = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
    if (merge.length > 0) tx.mergeCoins(primaryCoin, merge);
  }
  const [refundCoin] = tx.splitCoins(primaryCoin, [refundRaw]);
  tx.transferObjects([refundCoin], DEPOSITOR);
  tx.setGasBudget(10_000_000);

  const refundResult = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });
  const refundOk = refundResult.effects?.status?.status === 'success';
  console.log(refundOk ? 'REFUND SUCCESS!' : 'REFUND FAILED');
  console.log('TX:', refundResult.digest);
  if (!refundOk) console.log('Error:', refundResult.effects?.status?.error);

  // Final state
  await new Promise(r => setTimeout(r, 3000));
  const depBal = await client.getBalance({ owner: DEPOSITOR, coinType: USDC_TYPE });
  console.log('\n=== FINAL STATE ===');
  console.log('Depositor USDC:', (Number(depBal.totalBalance) / 1e6).toFixed(6));
  const poolFinal = await client.getObject({ id: POOL_STATE_ID, options: { showContent: true } });
  const pf = poolFinal.data?.content?.fields;
  console.log('Pool balance:', (Number(pf?.balance || 0) / 1e6).toFixed(6));
  console.log('Pool hedged:', (Number(pf?.hedge_state?.fields?.total_hedged_value || 0) / 1e6).toFixed(6));
  console.log('Active hedges:', (pf?.hedge_state?.fields?.active_hedges || []).length);
}

main().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
