#!/usr/bin/env node
/**
 * Verify whether Bluefin perp hedges are actually being placed.
 *
 * Three-way check:
 *   A. DB: count hedges with chain='sui' AND on_chain=false (those are Bluefin perp orders)
 *   B. Bluefin Exchange API: live positions + open orders
 *   C. Bluefin trade history (recent fills, if API supports it)
 */
// Dynamically import to avoid top-level instantiation failures
let bluefinService;

function ok(m){console.log(`  ✅ ${m}`);}
function info(m){console.log(`  ▸ ${m}`);}
function fail(m){console.log(`  ❌ ${m}`); process.exitCode=1;}

async function main() {
  console.log('=== Bluefin perp hedge reality check ===\n');

  // ---- A. DB: perp hedges (on_chain=false) ----
  console.log('[A] DB: SUI perp hedges (chain=sui, on_chain=false) ...');
  const { query } = await import('../lib/db/postgres.ts');
  const r = await query(
    `SELECT order_id, market, side, size, leverage, status, entry_price, realized_pnl,
            simulation_mode, created_at, closed_at, reason
       FROM hedges
      WHERE chain='sui' AND (on_chain=false OR on_chain IS NULL)
      ORDER BY COALESCE(closed_at, created_at) DESC
      LIMIT 10`,
    [],
  );
  const rows = r.rows || r;
  info(`rows: ${rows.length}`);
  let live = 0, simulated = 0, closed = 0;
  for (const row of rows) {
    const t = row.closed_at || row.created_at;
    const ageH = (Date.now() - new Date(t).getTime()) / 3600000;
    const tag = row.simulation_mode ? '[SIM]' : '[LIVE]';
    info(`  ${tag} ${row.status.padEnd(8)} ${row.market} ${row.side} sz=${row.size} lev=${row.leverage}x  age=${ageH.toFixed(1)}h  pnl=${row.realized_pnl ?? 0}  oid=${(row.order_id||'').slice(0,18)}…`);
    if (row.simulation_mode) simulated++; else live++;
    if (row.status !== 'active') closed++;
  }
  if (rows.length === 0) info('No perp hedge rows in DB');
  else info(`live=${live}  simulated=${simulated}  non-active=${closed}`);

  // ---- B. Bluefin live positions + open orders ----
  console.log('\n[B] Bluefin Exchange API (live) ...');
  try {
    const mod = await import('../lib/services/sui/BluefinService.ts');
    bluefinService = mod.bluefinService || mod.BluefinService?.getInstance();
  } catch (e) { fail(`Bluefin import failed: ${e.message}`); }
  const bf = bluefinService;
  let positions = [];
  let openOrders = [];
  try {
    positions = await bf.getPositions();
    ok(`getPositions() returned ${positions.length}`);
    for (const p of positions) {
      info(`  ${p.symbol} ${p.side} sz=${p.size} entry=${p.entryPrice} mark=${p.markPrice} pnl=${p.unrealizedPnl} margin=${p.margin}`);
    }
  } catch (e) { fail(`getPositions failed: ${e.message}`); }

  try {
    openOrders = await bf.getOpenOrders();
    ok(`getOpenOrders() returned ${openOrders.length}`);
    for (const o of openOrders) info(`  ${o.symbol} ${o.side} qty=${o.quantity} px=${o.price} status=${o.status} oid=${o.orderId.slice(0,18)}…`);
  } catch (e) { fail(`getOpenOrders failed: ${e.message}`); }

  // ---- C. Cross-reference live ↔ DB ----
  console.log('\n[C] Cross-reference live Bluefin ↔ DB (active rows) ...');
  const dbActive = rows.filter(r => r.status === 'active');
  info(`DB perp rows still 'active': ${dbActive.length}`);
  info(`Bluefin live positions:    ${positions.length}`);
  info(`Bluefin open orders:       ${openOrders.length}`);

  // Symbol-level match
  const bfSyms = new Set(positions.map(p => `${p.symbol}|${p.side}`));
  const dbSyms = new Set(dbActive.map(r => `${r.market}|${r.side}`));
  const dbOnly = [...dbSyms].filter(s => !bfSyms.has(s));
  const bfOnly = [...bfSyms].filter(s => !dbSyms.has(s));

  if (dbOnly.length === 0 && bfOnly.length === 0) {
    ok('DB ↔ Bluefin perp positions in sync');
  } else {
    if (dbOnly.length > 0) info(`DB-only (status=active in DB but no live position): ${dbOnly.join(', ')}  ← stale rows the cron should close`);
    if (bfOnly.length > 0) info(`Bluefin-only (live position with no DB row): ${bfOnly.join(', ')}  ← orphan exposure`);
  }

  // ---- D. Are perp orders actually being submitted? ----
  console.log('\n[D] Recent perp open attempts (last 7d) ...');
  const r2 = await query(
    `SELECT
       COUNT(*) FILTER (WHERE simulation_mode=false) AS live_attempts,
       COUNT(*) FILTER (WHERE simulation_mode=true)  AS sim_attempts,
       COUNT(*) FILTER (WHERE simulation_mode=false AND status='active') AS live_active,
       COUNT(*) FILTER (WHERE simulation_mode=false AND status='closed') AS live_closed,
       MAX(created_at) FILTER (WHERE simulation_mode=false) AS last_live_open
     FROM hedges
     WHERE chain='sui' AND (on_chain=false OR on_chain IS NULL)
       AND created_at > NOW() - INTERVAL '7 days'`,
    [],
  );
  const stats = (r2.rows || r2)[0];
  info(`live attempts: ${stats.live_attempts}`);
  info(`simulated:     ${stats.sim_attempts}`);
  info(`live active:   ${stats.live_active}`);
  info(`live closed:   ${stats.live_closed}`);
  info(`last live open: ${stats.last_live_open || 'never'}`);
  if (Number(stats.live_attempts) > 0) ok('Live perp orders ARE being placed');
  else if (Number(stats.sim_attempts) > 0) info('Only simulation hedges in DB — live orders not firing');
  else info('No perp hedge attempts in last 7 days');

  // ---- E. Recent skip reasons (why no perps) ----
  console.log('\n[E] Last 5 hedge attempts incl. errors ...');
  const r3 = await query(
    `SELECT order_id, market, side, status, simulation_mode, reason, created_at
       FROM hedges
      WHERE chain='sui' AND (on_chain=false OR on_chain IS NULL)
      ORDER BY created_at DESC
      LIMIT 5`,
    [],
  );
  for (const row of (r3.rows || r3)) {
    info(`  ${row.created_at.toISOString().slice(0,19)} ${row.market} ${row.side} status=${row.status} sim=${row.simulation_mode} reason="${(row.reason||'').slice(0,80)}"`);
  }

  console.log('\n=== Result ===');
  console.log(process.exitCode ? 'FAIL' : 'PASS');
}
main().catch(e => { console.error(e); process.exit(1); });
