#!/usr/bin/env npx tsx
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  console.log('═══ SEED FROM PUBLIC SOURCES ═══\n');

  // Prime Polymarket 5-min signal cache (public endpoint, no auth)
  console.log('[1/2] Polymarket 5-min signal...');
  try {
    const { Polymarket5MinService } = await import('../lib/services/market-data/Polymarket5MinService');
    const sig = await Polymarket5MinService.getLatest5MinSignal();
    if (sig) {
      console.log('  signal:', {
        direction: (sig as any).direction,
        confidence: (sig as any).confidence,
        probability: (sig as any).probability ?? (sig as any).probabilityUp,
      });
    } else {
      console.log('  no signal returned');
    }
  } catch (e: any) {
    console.log('  SKIPPED:', e.message);
  }

  // Note: SUI on-chain reconciliation requires SUI mainnet env vars not in .env.local.
  // The reconcile cron (app/api/cron/sui-hedge-reconcile/route.ts) will backfill `hedges`
  // automatically on its next QStash tick, once Vercel env is updated to point at Aiven.
  console.log('\n[2/2] On-chain backfill is server-side:');
  console.log('  - sui-hedge-reconcile cron → repopulates `hedges` from chain');
  console.log('  - sui-community-pool cron → records NAV snapshots');
  console.log('  - polymarket-edge-trader cron → fills `cron_state`, signal outcomes');
  console.log('  All run automatically once Vercel DATABASE_URL points at Aiven.');

  console.log('\n✓ Done. Current row counts:');
  const { query } = await import('../lib/db/postgres');
  for (const t of ['hedges','community_pool_nav_history','community_pool_transactions','signal_outcomes','cron_state','agent_orchestrator_state','community_pool_state']) {
    try {
      const c = await query<{ n: string }>(`SELECT COUNT(*)::text n FROM ${t}`);
      console.log(`  ${t}: ${c[0]?.n ?? 0}`);
    } catch (e: any) {
      console.log(`  ${t}: ERR`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
