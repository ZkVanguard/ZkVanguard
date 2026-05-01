#!/usr/bin/env node
/**
 * Verify:
 *   1. QStash schedules exist for the SUI cron and recent runs succeed
 *   2. DB hedges layer stays in sync with on-chain after each scheduled run
 *
 * Reads QSTASH_TOKEN, DATABASE_URL, SUI_MAINNET_RPC from env (.env.production).
 */
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const POOL_STATE_ID = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';

function ok(m) { console.log(`  ✅ ${m}`); }
function fail(m) { console.log(`  ❌ ${m}`); process.exitCode = 1; }
function info(m) { console.log(`  ▸ ${m}`); }

async function qstash(path, token) {
  const base = (process.env.QSTASH_URL || 'https://qstash.upstash.io').replace(/\/$/, '');
  const r = await fetch(`${base}/v2${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}

async function main() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) { fail('QSTASH_TOKEN missing'); return; }

  console.log('=== QStash + DB sync verification ===\n');

  // ---- 1. Schedules ----
  console.log('[1/4] Listing QStash schedules ...');
  const sched = await qstash('/schedules', token);
  if (sched.status !== 200) { fail(`schedules HTTP ${sched.status}: ${JSON.stringify(sched.body).slice(0,200)}`); return; }
  const schedules = Array.isArray(sched.body) ? sched.body : [];
  info(`total schedules: ${schedules.length}`);
  const suiSched = schedules.filter(s => (s.destination || '').includes('sui-community-pool'));
  if (suiSched.length === 0) fail('no schedule pointing at /api/cron/sui-community-pool');
  for (const s of suiSched) {
    info(`  id=${s.scheduleId}  cron='${s.cron}'  dest=${s.destination}`);
    info(`     created=${new Date(s.createdAt).toISOString()}  retries=${s.retries}  paused=${s.isPaused ?? false}`);
  }
  if (suiSched.length > 0) ok(`${suiSched.length} SUI cron schedule(s) registered`);

  // ---- 2. Recent message events ----
  console.log('\n[2/4] Recent QStash events (last 25) ...');
  const ev = await qstash('/events?count=25', token);
  if (ev.status !== 200) { info(`events HTTP ${ev.status}`); }
  else {
    const events = ev.body?.events || ev.body || [];
    const suiEvents = (Array.isArray(events) ? events : []).filter(e => (e.url || '').includes('sui-community-pool'));
    info(`SUI cron events in window: ${suiEvents.length}`);
    const byState = {};
    for (const e of suiEvents) byState[e.state] = (byState[e.state] || 0) + 1;
    for (const [k, v] of Object.entries(byState)) info(`  ${k}: ${v}`);
    const last = suiEvents[0];
    if (last) {
      info(`  most recent: state=${last.state} time=${new Date(last.time).toISOString()} status=${last.responseStatus ?? 'n/a'}`);
      if (last.error) info(`     error: ${String(last.error).slice(0,200)}`);
    }
    const delivered = suiEvents.filter(e => e.state === 'DELIVERED').length;
    if (delivered > 0) ok(`${delivered} successful deliveries observed`);
    else if (suiEvents.length > 0) fail('SUI events found but none DELIVERED');
    else info('No recent SUI events (schedule may not have fired yet)');
  }

  // ---- 3. On-chain vs DB drift ----
  console.log('\n[3/4] On-chain ↔ DB drift snapshot ...');
  const rpc = process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet');
  const sui = new SuiClient({ url: rpc });
  const obj = await sui.getObject({ id: POOL_STATE_ID, options: { showContent: true } });
  const onchainRaw = obj.data?.content?.fields?.hedge_state?.fields?.active_hedges || [];
  const onchain = onchainRaw.map(h => {
    const hf = h.fields || h;
    return {
      hex: Buffer.from(hf.hedge_id).toString('hex'),
      collateralUsdc: Number(hf.collateral_usdc) / 1e6,
    };
  });

  const dbMod = await import('../lib/db/hedges.ts');
  const dbActive = await dbMod.listActiveSuiOnchainHedges();

  const onchainIds = new Set(onchain.map(h => h.hex.toLowerCase()));
  const dbIds = new Set(dbActive.map(d => (d.hedgeIdOnchain || '').replace(/^0x/, '').toLowerCase()).filter(Boolean));

  info(`on-chain active: ${onchain.length}`);
  for (const h of onchain) info(`  ${h.hex.slice(0,16)}…  $${h.collateralUsdc.toFixed(6)}`);
  info(`DB active: ${dbActive.length}`);
  for (const d of dbActive) info(`  ${(d.hedgeIdOnchain || '').slice(0,18)}…  notional=$${d.notionalValue}`);

  const onchainOrphans = [...onchainIds].filter(id => !dbIds.has(id));
  const dbOrphans = [...dbIds].filter(id => !onchainIds.has(id));
  info(`drift: on-chain orphans=${onchainOrphans.length}  db orphans=${dbOrphans.length}`);
  if (onchainOrphans.length === 0 && dbOrphans.length === 0) ok('Layers in sync');
  else fail('DRIFT detected — Step 0.5 reconciliation should heal next cycle');

  // ---- 4. Recent DB hedge activity (proves cron is writing) ----
  console.log('\n[4/4] Recent SUI hedge writes from DB ...');
  const { query } = await import('../lib/db/postgres.ts').catch(async () => {
    return import('../lib/db/index.ts');
  });
  const r = await query(
    `SELECT order_id, hedge_id_onchain, status, realized_pnl, created_at, closed_at
       FROM hedges
      WHERE chain='sui' AND on_chain=true
      ORDER BY COALESCE(closed_at, created_at) DESC
      LIMIT 8`,
    [],
  );
  const rows = r.rows || r;
  info(`last ${rows.length} sui on-chain hedge rows:`);
  for (const row of rows) {
    const id = (row.hedge_id_onchain || '').slice(0,18);
    const t = (row.closed_at || row.created_at);
    info(`  ${row.status.padEnd(8)} ${id}…  pnl=${row.realized_pnl ?? '0'}  ${new Date(t).toISOString()}`);
  }
  if (rows.length > 0) {
    const newest = new Date(rows[0].closed_at || rows[0].created_at);
    const ageH = (Date.now() - newest.getTime()) / 3600000;
    info(`newest activity: ${ageH.toFixed(1)}h ago`);
    if (ageH < 24) ok(`Cron has written within last 24h (${ageH.toFixed(1)}h)`);
    else info('No SUI on-chain writes in last 24h — verify scheduler');
  }

  // ---- Decision-lock table snapshot ----
  console.log('\n[+] Decision lock table snapshot ...');
  try {
    const lr = await query(`SELECT COUNT(*) as n, COUNT(*) FILTER (WHERE expires_at > NOW()) as live FROM hedge_decision_locks`, []);
    const row = (lr.rows || lr)[0];
    info(`hedge_decision_locks: total=${row.n} live=${row.live}`);
    ok('decision lock table reachable');
  } catch (e) {
    info(`(table may not exist yet: ${e.message})`);
  }

  console.log('\n=== Result ===');
  console.log(process.exitCode ? 'FAIL' : 'PASS');
}

main().catch(e => { console.error(e); process.exit(1); });
