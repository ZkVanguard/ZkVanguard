/**
 * Quick test: BlueFin Aggregator Service on testnet
 * Verifies the renamed service works correctly
 */
import { getBluefinAggregatorService } from '../lib/services/BluefinAggregatorService';

async function main() {
  console.log('=== BlueFin Aggregator Service: Testnet Test ===\n');
  
  const agg = getBluefinAggregatorService('testnet');
  console.log('✅ Service initialized (testnet)');
  console.log('   Network:', agg.getNetwork());
  console.log('   USDC type:', agg.getUsdcCoinType());
  
  // Test 1: SUI swap quote
  console.log('\n--- Test 1: USDC → SUI quote ($10) ---');
  try {
    const q = await agg.getSwapQuote('SUI', 10);
    console.log('   Asset:', q.asset);
    console.log('   Amount In:', q.amountIn);
    console.log('   Expected Out:', q.expectedAmountOut);
    console.log('   Route:', q.route);
    console.log('   On-chain:', q.canSwapOnChain);
    console.log('   Hedge via:', q.hedgeVia || 'n/a');
    console.log('   ✅ PASS');
  } catch (e: any) {
    console.error('   ❌ FAIL:', e.message);
  }

  // Test 2: BTC swap quote (hedged via perps on testnet)
  console.log('\n--- Test 2: USDC → BTC quote ($100) ---');
  try {
    const q = await agg.getSwapQuote('BTC', 100);
    console.log('   Asset:', q.asset);
    console.log('   Expected Out:', q.expectedAmountOut);
    console.log('   Route:', q.route);
    console.log('   On-chain:', q.canSwapOnChain);
    console.log('   Hedge via:', q.hedgeVia || 'n/a');
    console.log('   ✅ PASS');
  } catch (e: any) {
    console.error('   ❌ FAIL:', e.message);
  }

  // Test 3: ETH swap quote
  console.log('\n--- Test 3: USDC → ETH quote ($50) ---');
  try {
    const q = await agg.getSwapQuote('ETH', 50);
    console.log('   Expected Out:', q.expectedAmountOut);
    console.log('   Route:', q.route);
    console.log('   ✅ PASS');
  } catch (e: any) {
    console.error('   ❌ FAIL:', e.message);
  }

  // Test 4: CRO swap quote (always hedged)
  console.log('\n--- Test 4: USDC → CRO quote ($25) ---');
  try {
    const q = await agg.getSwapQuote('CRO', 25);
    console.log('   Expected Out:', q.expectedAmountOut);
    console.log('   Route:', q.route);
    console.log('   Hedge via:', q.hedgeVia || 'n/a');
    console.log('   ✅ PASS');
  } catch (e: any) {
    console.error('   ❌ FAIL:', e.message);
  }

  // Test 5: Plan rebalance 
  console.log('\n--- Test 5: Plan rebalance ($500, 30/25/25/20) ---');
  try {
    const plan = await agg.planRebalanceSwaps(500, { BTC: 30, ETH: 25, SUI: 25, CRO: 20 });
    console.log('   Total USDC:', plan.totalUsdcToSwap);
    console.log('   Swaps:', plan.swaps.length);
    for (const s of plan.swaps) {
      console.log(`     ${s.asset}: $${(Number(s.amountIn)/1e6).toFixed(2)} => ${s.expectedAmountOut} (${s.canSwapOnChain ? 'on-chain' : s.hedgeVia || 'virtual'})`);
    }
    console.log('   ✅ PASS');
  } catch (e: any) {
    console.error('   ❌ FAIL:', e.message);
  }

  // Test 6: Admin wallet check
  console.log('\n--- Test 6: Admin wallet check ---');
  try {
    const w = await agg.checkAdminWallet();
    console.log('   Configured:', w.configured);
    console.log('   Address:', w.address || 'n/a');
    console.log('   SUI balance:', w.suiBalance || '0');
    console.log('   Has gas:', w.hasGas);
    console.log('   ✅ PASS');
  } catch (e: any) {
    console.error('   ❌ FAIL:', e.message);
  }

  // Test 7: Reverse quote
  console.log('\n--- Test 7: SUI → USDC reverse quote (1 SUI) ---');
  try {
    const q = await agg.getReverseSwapQuote('SUI', 1);
    console.log('   Expected USDC out:', q.expectedAmountOut);
    console.log('   Route:', q.route);
    console.log('   ✅ PASS');
  } catch (e: any) {
    console.error('   ❌ FAIL:', e.message);
  }

  console.log('\n=== DONE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
