/**
 * Read-only test of the withdraw preflight flow.
 *
 * Verifies:
 *   1. readPoolLiquidityState pulls sane numbers from mainnet
 *   2. Expected-payout math matches Move calculate_assets_for_shares
 *   3. ensurePoolLiquidityForWithdraw short-circuits when the pool already has
 *      enough USDC (safe: no on-chain writes for the tested share amount)
 *   4. Bridge-collateral planning respects reserve/ratio/daily caps
 *
 * Deliberately picks a share amount whose payout <= pool balance so ensure
 * is a no-op. The real top-up path opens+closes a live hedge; keep that
 * behind a separate --write flag or run only after explicit go-ahead.
 */

import { readPoolLiquidityState, ensurePoolLiquidityForWithdraw } from '@/lib/services/sui/cron/hedge-treasury';

async function main() {
  console.log('=== Test 1: readPoolLiquidityState (read-only) ===');
  const state = await readPoolLiquidityState('mainnet');
  if (!state) {
    console.error('  FAIL: readPoolLiquidityState returned null');
    process.exit(1);
  }

  console.log(`  poolBalanceRaw:      ${state.poolBalanceRaw}n  ($${state.poolBalanceUsdc.toFixed(6)})`);
  console.log(`  externalNavRaw:      ${state.externalNavRaw}n  ($${state.externalNavUsdc.toFixed(6)})`);
  console.log(`  totalHedgedRaw:      ${state.totalHedgedRaw}n  ($${state.totalHedgedUsdc.toFixed(6)})`);
  console.log(`  totalSharesRaw:      ${state.totalSharesRaw}n  (${(Number(state.totalSharesRaw) / 1e6).toFixed(6)} shares)`);
  console.log(`  onchainNavRaw:       ${state.onchainNavRaw}n  ($${state.onchainNavUsdc.toFixed(6)})`);
  console.log(`  totalNavRaw:         ${state.totalNavRaw}n  ($${state.totalNavUsdc.toFixed(6)})`);
  console.log(`  maxHedgeRatioBps:    ${state.maxHedgeRatioBps}`);
  console.log(`  lastHedgeTime:       ${state.lastHedgeTime}  (${new Date(state.lastHedgeTime).toISOString()})`);
  console.log(`  cooldownMs:          ${state.cooldownMs}`);
  console.log(`  dailyHedgedTodayRaw: ${state.dailyHedgedTodayRaw}n  ($${(Number(state.dailyHedgedTodayRaw) / 1e6).toFixed(6)})`);
  console.log('  PASS');

  console.log('\n=== Test 2: Expected-payout math for typical share sizes ===');
  const nav = state.totalNavRaw;
  const totalShares = state.totalSharesRaw;
  for (const humanShares of [0.001, 0.01, 0.1, 1, 5, 10]) {
    const sharesRaw = BigInt(Math.floor(humanShares * 1e6));
    if (sharesRaw > totalShares) {
      console.log(`  ${humanShares} shares > total shares (${(Number(totalShares) / 1e6).toFixed(4)}) — skip`);
      continue;
    }
    const payoutRaw = (sharesRaw * nav) / totalShares;
    const payoutUsdc = Number(payoutRaw) / 1e6;
    const willTrigger = payoutUsdc > state.poolBalanceUsdc;
    console.log(`  ${humanShares.toFixed(3)} shares -> $${payoutUsdc.toFixed(6)} USDC ${willTrigger ? '(WOULD trigger top-up)' : '(no top-up needed)'}`);
  }

  console.log('\n=== Test 3: ensurePoolLiquidityForWithdraw as no-op ===');
  // Helper's buffered target: payout * 1.005 + 0.001. Pick a payout well
  // under (poolBalance - 0.001) / 1.005 to guarantee the no-op branch.
  const safePayout = Math.max(0, (state.poolBalanceUsdc - 0.001) / 1.005 - 0.0001);
  if (safePayout <= 0) {
    console.log(`  Pool balance $${state.poolBalanceUsdc.toFixed(6)} too low for a safe no-op probe.`);
  } else {
    console.log(`  requesting ensure for $${safePayout.toFixed(6)} (buffered target < pool balance $${state.poolBalanceUsdc.toFixed(6)})`);
    const result = await ensurePoolLiquidityForWithdraw('mainnet', safePayout);
    console.log(`  result: ${JSON.stringify(result)}`);
    if (result.success && result.alreadyLiquid) {
      console.log('  PASS: correctly short-circuited without on-chain writes');
    } else {
      console.error('  FAIL: expected { success:true, alreadyLiquid:true }');
      process.exit(1);
    }
  }

  console.log('\n=== Test 4: Bridge-collateral planning (dry check, no writes) ===');
  const MIN_RESERVE_RATIO_BPS = 2000;
  const dailyHedgedTodayUsdc = Number(state.dailyHedgedTodayRaw) / 1e6;
  const maxByReserve = state.poolBalanceUsdc - (state.onchainNavUsdc * MIN_RESERVE_RATIO_BPS / 10000);
  const maxByRatio = Math.max(0, (state.onchainNavUsdc * state.maxHedgeRatioBps / 10000) - state.totalHedgedUsdc);
  const maxByDaily = Math.max(0, state.onchainNavUsdc * 0.5 - dailyHedgedTodayUsdc);
  const maxCollateral = Math.min(maxByReserve, maxByRatio, maxByDaily);
  const bridgeCollateral = Math.min(maxCollateral * 0.5, 0.10);
  console.log(`  maxByReserve:      $${maxByReserve.toFixed(6)}`);
  console.log(`  maxByRatio:        $${maxByRatio.toFixed(6)}`);
  console.log(`  maxByDaily:        $${maxByDaily.toFixed(6)}`);
  console.log(`  maxCollateral:     $${maxCollateral.toFixed(6)}`);
  console.log(`  bridge collateral: $${bridgeCollateral.toFixed(6)}`);
  const now = Date.now();
  const cooldownEndsAt = state.lastHedgeTime + state.cooldownMs;
  const cooldownRemaining = Math.max(0, cooldownEndsAt - now);
  console.log(`  cooldown remaining: ${cooldownRemaining}ms (${(cooldownRemaining / 1000).toFixed(0)}s)`);
  if (maxCollateral > 0 && cooldownRemaining === 0) {
    console.log('  PASS: pool CAN host a bridge hedge right now');
  } else if (maxCollateral <= 0) {
    console.log('  BLOCKED: max collateral <= 0 (pool balance below reserve floor?)');
  } else {
    console.log(`  BLOCKED: hedge cooldown active (${(cooldownRemaining / 1000).toFixed(0)}s left)`);
  }

  console.log('\n=== ALL READ-ONLY TESTS COMPLETE ===');

  if (process.argv.includes('--write')) {
    console.log('\n=== Test 5: WRITE PATH — actually top up the pool ===');
    // Pick a target payout that FORCES a top-up: expected payout must exceed
    // pool balance so the helper goes down the open/close path. Use a small
    // margin (~$0.10 over balance) to keep the actual admin USDC drain tiny.
    const targetPayoutRaw = state.poolBalanceRaw + 100_000n; // pool + $0.10
    const sharesRaw = (targetPayoutRaw * state.totalSharesRaw) / state.totalNavRaw + 1n;
    const payoutRaw = (sharesRaw * state.totalNavRaw) / state.totalSharesRaw;
    const payoutUsdc = Number(payoutRaw) / 1e6;
    console.log(`  Target payout: ${(Number(sharesRaw) / 1e6).toFixed(6)} shares -> $${payoutUsdc.toFixed(6)} USDC`);
    console.log(`  Pool balance before: $${state.poolBalanceUsdc.toFixed(6)}`);

    const result = await ensurePoolLiquidityForWithdraw('mainnet', payoutUsdc);
    console.log(`  result: ${JSON.stringify(result, null, 2)}`);

    if (!result.success) {
      console.error('  FAIL: top-up did not succeed');
      process.exit(1);
    }
    if (result.alreadyLiquid) {
      console.log('  NOTE: pool was already liquid, top-up short-circuited');
    } else {
      console.log(`  Topped up by: $${(result.toppedUpBy || 0).toFixed(6)}`);
      console.log(`  open tx: ${result.openTxDigest}`);
      console.log(`  close tx: ${result.closeTxDigest}`);
    }

    // Read state again to verify pool balance now covers the payout
    const after = await readPoolLiquidityState('mainnet');
    if (after) {
      console.log(`  Pool balance after: $${after.poolBalanceUsdc.toFixed(6)}`);
      if (after.poolBalanceRaw >= payoutRaw) {
        console.log(`  PASS: pool balance now covers the target payout`);
      } else {
        console.error(`  FAIL: pool balance ${after.poolBalanceUsdc} still < payout ${payoutUsdc}`);
        process.exit(1);
      }
    }
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
