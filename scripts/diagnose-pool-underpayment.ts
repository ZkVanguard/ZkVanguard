#!/usr/bin/env npx tsx
/**
 * Read live SUI USDC pool state via mainnet RPC + compute the
 * withdrawal-underpayment delta.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

async function main() {
  const poolStateId = (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE
    || process.env.NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE || '').trim();
  if (!poolStateId) { console.error('Missing pool state id'); process.exit(1); }
  const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
  const client = new SuiClient({ url: (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim() });
  const obj = await client.getObject({ id: poolStateId, options: { showContent: true } });
  const fields = (obj.data?.content as any)?.fields;
  if (!fields) { console.error('No fields'); process.exit(1); }

  console.log('═══ POOL ON-CHAIN STATE ═══');
  console.log('  balance (USDC pool reserve, raw):', fields.balance);
  console.log('  total_shares:', fields.total_shares);
  console.log('  total_deposited:', fields.total_deposited);
  console.log('  total_withdrawn:', fields.total_withdrawn);
  console.log('  paused:', fields.paused);
  console.log('  circuit_breaker_tripped:', fields.circuit_breaker_tripped);

  const hedgeState = fields.hedge_state?.fields;
  console.log('\n═══ HEDGE STATE ═══');
  console.log('  total_hedged_value (raw):', hedgeState?.total_hedged_value);
  console.log('  daily_hedge_total:', hedgeState?.daily_hedge_total);
  console.log('  active_hedges count:', (hedgeState?.active_hedges || []).length);

  console.log('\n═══ MEMBERS TABLE ═══');
  const members = fields.members?.fields;
  console.log('  size:', members?.size ?? '(unknown)');

  // Convert to USDC (6 decimals)
  const balance = Number(fields.balance) / 1e6;
  const totalShares = Number(fields.total_shares) / 1e9; // shares typically use WAD=1e9
  const hedgedValue = Number(hedgeState?.total_hedged_value ?? 0) / 1e6;
  const totalNav = balance + hedgedValue;

  console.log('\n═══ HUMAN-READABLE ═══');
  console.log(`  On-chain USDC balance:    $${balance.toFixed(4)}`);
  console.log(`  Off-chain hedged value:   $${hedgedValue.toFixed(4)}`);
  console.log(`  get_total_nav():          $${totalNav.toFixed(4)}`);
  console.log(`  Total shares:             ${totalShares.toFixed(6)}`);

  if (totalShares > 0) {
    // Pricing models in the contract:
    //   calculate_assets_for_shares uses balance + VIRTUAL_ASSETS, not total_nav
    //   real NAV per share = total_nav / total_shares
    const VIRTUAL_ASSETS = 1; // typically tiny — check contract
    const VIRTUAL_SHARES = 1;
    const contractPxBalanceBased = (balance + VIRTUAL_ASSETS) / (totalShares + VIRTUAL_SHARES);
    const realPxIncludingHedge = totalNav / totalShares;
    const underpayPct = ((realPxIncludingHedge - contractPxBalanceBased) / realPxIncludingHedge) * 100;
    console.log(`\n  Share price the CONTRACT pays out at (balance-only):  $${contractPxBalanceBased.toFixed(6)}`);
    console.log(`  Share price the user EXPECTS (NAV-based):             $${realPxIncludingHedge.toFixed(6)}`);
    console.log(`  Underpayment per share: $${(realPxIncludingHedge - contractPxBalanceBased).toFixed(6)} (${underpayPct.toFixed(2)}%)`);

    // Example: a member withdrawing all of their share
    console.log(`\n  Example: a user holding 10% of pool (3.0 shares) withdrawing now`);
    console.log(`     Expected payout:  $${(3.0 * realPxIncludingHedge).toFixed(4)}`);
    console.log(`     Actual payout:    $${(3.0 * contractPxBalanceBased).toFixed(4)}`);
    console.log(`     SHORTFALL:        $${(3.0 * (realPxIncludingHedge - contractPxBalanceBased)).toFixed(4)}`);
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
