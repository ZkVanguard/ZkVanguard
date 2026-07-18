import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(__dirname, '..', '..', '.env.local') });
import { query } from '../../lib/db/postgres';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DEEP PROFIT ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('── 1. NAV TRAJECTORY (windowed) ──');
  const windows = ['1 hour', '6 hours', '24 hours', '48 hours', '7 days', '30 days'];
  for (const w of windows) {
    const r = await query<{ nav_start: string; nav_end: string; sp_now: string; snaps: string }>(
      `SELECT
         (SELECT total_nav::text FROM community_pool_nav_history
          WHERE chain='sui' AND timestamp >= NOW() - INTERVAL '${w}' ORDER BY timestamp ASC LIMIT 1) as nav_start,
         (SELECT total_nav::text FROM community_pool_nav_history
          WHERE chain='sui' ORDER BY timestamp DESC LIMIT 1) as nav_end,
         (SELECT share_price::text FROM community_pool_nav_history
          WHERE chain='sui' ORDER BY timestamp DESC LIMIT 1) as sp_now,
         (SELECT COUNT(*)::text FROM community_pool_nav_history
          WHERE chain='sui' AND timestamp >= NOW() - INTERVAL '${w}') as snaps`
    );
    if (!r[0]?.nav_start) { console.log(`  ${w.padEnd(8)}  (no data)`); continue; }
    const s = Number(r[0].nav_start), e = Number(r[0].nav_end);
    const delta = e - s;
    const dpct = s > 0 ? ((delta / s) * 100) : 0;
    console.log(`  ${w.padEnd(8)}  $${s.toFixed(2)} → $${e.toFixed(2)}  Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} (${dpct >= 0 ? '+' : ''}${dpct.toFixed(2)}%)  snaps=${r[0].snaps}`);
  }

  console.log('\n── 2. REALIZED PNL — LAST 30 DAYS (by asset+side) ──');
  const byAsset = await query<any>(
    `SELECT asset, side, COUNT(*)::text as n,
            ROUND(SUM(notional_value)::numeric, 2)::text as total_notional,
            ROUND(SUM(realized_pnl)::numeric, 2)::text as sum_pnl,
            ROUND(AVG(realized_pnl)::numeric, 3)::text as avg_pnl
     FROM hedges WHERE chain='sui' AND status='closed'
       AND created_at > NOW() - INTERVAL '30 days'
       AND notional_value >= 1 AND realized_pnl != 0
     GROUP BY asset, side ORDER BY SUM(realized_pnl)`
  );
  console.table(byAsset);

  console.log('\n── 3. HOLD DURATION vs OUTCOME (30d, real trades only) ──');
  const byDur = await query<any>(
    `SELECT bucket, n::text, wins::text, losses::text, sum_pnl::text, avg_pnl::text
     FROM (
       SELECT
         CASE
           WHEN duration_min < 5 THEN 'A: < 5 min'
           WHEN duration_min < 30 THEN 'B: 5-30 min'
           WHEN duration_min < 60 THEN 'C: 30-60 min'
           WHEN duration_min < 240 THEN 'D: 1-4 h'
           WHEN duration_min < 1440 THEN 'E: 4-24 h'
           ELSE 'F: > 1 day'
         END as bucket,
         COUNT(*) as n,
         COUNT(*) FILTER (WHERE realized_pnl > 0) as wins,
         COUNT(*) FILTER (WHERE realized_pnl < 0) as losses,
         ROUND(SUM(realized_pnl)::numeric, 2) as sum_pnl,
         ROUND(AVG(realized_pnl)::numeric, 3) as avg_pnl
       FROM (
         SELECT realized_pnl, EXTRACT(EPOCH FROM (closed_at - created_at))/60 as duration_min
         FROM hedges WHERE chain='sui' AND status='closed'
           AND created_at > NOW() - INTERVAL '30 days'
           AND notional_value >= 1 AND realized_pnl != 0
       ) t GROUP BY bucket
     ) x ORDER BY bucket`
  );
  console.table(byDur);

  console.log('\n── 4. ACTIVE POSITIONS ──');
  const active = await query<any>(
    `SELECT id::text, asset, side,
            ROUND(notional_value::numeric, 2)::text as notional,
            ROUND(entry_price::numeric, 4)::text as entry,
            ROUND(current_price::numeric, 4)::text as mark,
            ROUND(current_pnl::numeric, 2)::text as pnl,
            ROUND((EXTRACT(EPOCH FROM (NOW() - created_at))/86400)::numeric, 1)::text as age_days
     FROM hedges WHERE chain='sui' AND status='active'`
  );
  console.table(active);

  console.log('\n── 5. POLYMARKET-EDGE TRADER STATS (last 30d, notional $5-50) ──');
  const trader = await query<any>(
    `SELECT
        COUNT(*)::text as total_trades,
        COUNT(*) FILTER (WHERE realized_pnl > 0)::text as wins,
        COUNT(*) FILTER (WHERE realized_pnl < 0)::text as losses,
        COUNT(*) FILTER (WHERE realized_pnl = 0)::text as flat,
        ROUND(SUM(realized_pnl)::numeric, 2)::text as total_pnl,
        ROUND(SUM(notional_value)::numeric, 2)::text as total_notional,
        ROUND((SUM(realized_pnl) * 10000 / NULLIF(SUM(notional_value), 0))::numeric, 1)::text as edge_bps,
        ROUND((COUNT(*) FILTER (WHERE realized_pnl > 0)::float / NULLIF(COUNT(*), 0) * 100)::numeric, 1)::text as win_rate
     FROM hedges WHERE chain='sui' AND status='closed'
       AND created_at > NOW() - INTERVAL '30 days'
       AND notional_value BETWEEN 5 AND 50`
  );
  console.table(trader);

  console.log('\n── 6. RECENT TRADER SKIPS ──');
  const skips = await query<any>(
    `SELECT value::text as v FROM cron_state WHERE key = 'polymarket-edge:last-skip' LIMIT 1`
  );
  if (skips.length) {
    try {
      const p = JSON.parse(skips[0].v);
      console.log(`  action: ${p.action}`);
      console.log(`  reason: ${(p.reason || '').slice(0, 250)}`);
      console.log(`  at: ${p.at ? new Date(p.at).toISOString() : 'unknown'}`);
    } catch { console.log('  (parse error)'); }
  } else console.log('  (no skip entry)');

  console.log('\n── 7. DAILY NAV TREND (7d) ──');
  const daily = await query<any>(
    `SELECT date_trunc('day', timestamp)::date::text as day,
            ROUND(AVG(share_price)::numeric, 4)::text as avg_sp,
            ROUND(MIN(share_price)::numeric, 4)::text as min_sp,
            ROUND(MAX(share_price)::numeric, 4)::text as max_sp
     FROM community_pool_nav_history
     WHERE chain='sui' AND timestamp > NOW() - INTERVAL '7 days'
     GROUP BY day ORDER BY day DESC`
  );
  console.table(daily);

  process.exit(0);
}
main().catch(e => { console.error(e.message); console.error(e.stack); process.exit(1); });
