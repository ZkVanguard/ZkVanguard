#!/usr/bin/env npx tsx
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  console.log('[init] Loading modules...');
  const { ensureAllTables, query } = await import('../lib/db/postgres');
  const { initUICacheTable } = await import('../lib/db/ui-cache');
  const { ensureSignalOutcomesTable } = await import('../lib/db/signal-outcomes');
  const { initCommunityPoolTables } = await import('../lib/db/community-pool');
  const { ensureHedgesTable } = await import('../lib/db/hedges');

  console.log('[init] community-pool tables...');
  await initCommunityPoolTables();
  console.log('[init] hedges table...');
  await ensureHedgesTable();
  console.log('[init] ui_cache...');
  await initUICacheTable();
  console.log('[init] signal_outcomes...');
  await ensureSignalOutcomesTable();

  // Trigger lazy creation for agent_orchestrator_state, cron_state, hedge_decision_locks,
  // auto_rebalance_* by exercising their public APIs once.
  console.log('[init] agent_orchestrator_state via saveAgentState...');
  const { saveAgentState } = await import('../lib/db/agent-state');
  await saveAgentState({});

  console.log('[init] cron_state via getCronState...');
  const cronState = await import('../lib/db/cron-state');
  if ((cronState as any).getCronState) await (cronState as any).getCronState('init:probe');
  else if ((cronState as any).setCronState) await (cronState as any).setCronState('init:probe', { ok: true });

  console.log('[init] hedge_decision_locks (raw)...');
  await query(`
    CREATE TABLE IF NOT EXISTS hedge_decision_locks (
      lock_key VARCHAR(255) PRIMARY KEY,
      locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_by VARCHAR(255),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  console.log('[init] auto_rebalance_* via storage import...');
  const ar = await import('../lib/storage/auto-rebalance-storage');
  // Touch any exported helper that exercises table creation
  const arAny = ar as any;
  for (const k of ['ensureTablesExist','initAutoRebalanceTables','getAutoRebalanceConfig','listAutoRebalanceConfigs']) {
    if (typeof arAny[k] === 'function') { try { await arAny[k]('init:probe'); console.log('  ', k, 'OK'); break; } catch(e:any){ console.log('  ', k, 'err:', e.message); } }
  }

  const tables = await query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1
  `);
  console.log('\n[init] Final tables (' + tables.length + '):');
  for (const t of tables) console.log('  -', t.table_name);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
