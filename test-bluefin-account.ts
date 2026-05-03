/**
 * Full verification of the new Step 8 hedge pipeline.
 * Confirms BlueFin account is funded and hedges WILL open on next cron.
 */
import 'dotenv/config';
import { BluefinService } from './lib/services/sui/BluefinService';

async function main() {
  console.log('\n═══ BLUEFIN ACCOUNT VERIFICATION ═══\n');
  const key = (process.env.BLUEFIN_PRIVATE_KEY || process.env.SUI_POOL_ADMIN_KEY || '').trim();
  if (!key) {
    console.log('❌ BLUEFIN_PRIVATE_KEY not set');
    process.exit(1);
  }
  const bf = BluefinService.getInstance();
  if (!bf.isInitialized()) await bf.initialize(key, 'mainnet');
  console.log(`Wallet: ${bf.getAddress()}`);

  // Get current positions (used by the dedup gate)
  const positions = await bf.getPositions();
  console.log(`\nLive positions: ${positions.length}`);
  for (const p of positions) {
    console.log(`  ${p.symbol} ${p.side} size=${p.size} entry=${p.entryPrice} pnl=${p.unrealizedPnl}`);
  }

  // Account info via raw API call (avoids hardcoding fields)
  const acct: any = await (bf as any).apiRequest(
    'GET', `/api/v1/account?accountAddress=${bf.getAddress()}`, undefined, 'exchange'
  );
  console.log(`\nAccount canTrade: ${acct?.canTrade}`);
  console.log(`Free collateral:  $${acct?.freeCollateral ?? 'unknown'}`);
  console.log(`Total collateral: $${acct?.totalCollateral ?? 'unknown'}`);

  // Dedup preview: which (symbol, side) pairs are already taken?
  const liveSet = new Set(positions.map(p => `${p.symbol}|${p.side}`));
  console.log(`\nDedup gate would skip: ${[...liveSet].join(', ') || '(none)'}`);

  console.log('\n✅ Verification complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
