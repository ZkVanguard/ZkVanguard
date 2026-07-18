import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(__dirname, '..', '..', '.env.local') });
import { query } from '../../lib/db/postgres';

const INTERVAL_MS = 5 * 60_000;
const state = {
  lastNav: null as number | null,
  lastSharePrice: null as number | null,
  peakSharePrice: null as number | null,
  activeIds: new Set<number>(),
  lastRealizedTs: 0,
  startedAt: Date.now(),
};

function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function fmtΔ(n: number) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`; }
function fmtPct(n: number) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }

async function tick() {
  try {
    const nav = await query<{ total_nav: string; share_price: string; timestamp: string }>(
      `SELECT total_nav::text, share_price::text, timestamp::text
       FROM community_pool_nav_history WHERE chain='sui'
       ORDER BY timestamp DESC LIMIT 1`
    );
    if (!nav[0]) { console.log(`[${ts()}] no NAV snapshots`); return; }
    const curNav = Number(nav[0].total_nav);
    const curSp = Number(nav[0].share_price);
    const snapAge = Math.floor((Date.now() - new Date(nav[0].timestamp).getTime()) / 60_000);

    let navΔ = '';
    if (state.lastNav !== null) {
      const d = curNav - state.lastNav;
      const dp = state.lastNav > 0 ? (d / state.lastNav) * 100 : 0;
      navΔ = ` Δ${fmtΔ(d)} (${fmtPct(dp)})`;
      if (Math.abs(dp) >= 2) {
        console.log(`  ⚠️  SHARP MOVE: ${fmtPct(dp)} in one tick`);
      }
    }

    let spΔ = '';
    if (state.lastSharePrice !== null) {
      const d = curSp - state.lastSharePrice;
      const dp = state.lastSharePrice > 0 ? (d / state.lastSharePrice) * 100 : 0;
      spΔ = ` sp=${curSp.toFixed(4)} ${fmtPct(dp)}`;
    } else spΔ = ` sp=${curSp.toFixed(4)}`;

    if (state.peakSharePrice === null || curSp > state.peakSharePrice) {
      if (state.peakSharePrice !== null && curSp > state.peakSharePrice * 1.005) {
        console.log(`  🚀 NEW PEAK share price: ${curSp.toFixed(4)} (was ${state.peakSharePrice.toFixed(4)})`);
      }
      state.peakSharePrice = curSp;
    }

    console.log(`[${ts()}] NAV=$${curNav.toFixed(2)}${navΔ}${spΔ} snap ${snapAge}m ago`);

    const active = await query<any>(
      `SELECT id, asset, side, notional_value::text as notional,
              current_pnl::text as pnl,
              EXTRACT(EPOCH FROM (NOW() - created_at))/86400 as age_days
       FROM hedges WHERE chain='sui' AND status='active'`
    );
    const seen = new Set<number>();
    for (const p of active) {
      seen.add(Number(p.id));
      const notional = Number(p.notional);
      const pnl = Number(p.pnl);
      if (!state.activeIds.has(Number(p.id))) {
        console.log(`  🆕 NEW active: ${p.asset} ${p.side} $${notional.toFixed(2)} notional (id ${p.id})`);
      }
      if (notional < 1 && Number(p.age_days) > 7) {
        console.log(`  · dust: id=${p.id} ${p.asset} ${p.side} $${notional.toFixed(2)} pnl=${fmtΔ(pnl)} age=${Number(p.age_days).toFixed(1)}d`);
      } else {
        console.log(`  · id=${p.id} ${p.asset} ${p.side} $${notional.toFixed(2)} pnl=${fmtΔ(pnl)} age=${Number(p.age_days).toFixed(1)}d`);
      }
    }
    for (const id of state.activeIds) {
      if (!seen.has(id)) {
        const closed = await query<any>(
          `SELECT asset, side, notional_value::text as notional,
                  realized_pnl::text as rpnl, current_pnl::text as cpnl,
                  closed_at::text as closed_at
           FROM hedges WHERE id=$1`, [id]
        );
        if (closed[0]) {
          const rpnl = Number(closed[0].rpnl);
          const cpnl = Number(closed[0].cpnl);
          const eff = rpnl !== 0 ? rpnl : cpnl;
          const emoji = eff > 0 ? '💰' : eff < 0 ? '📉' : '⚪';
          console.log(`  ${emoji} CLOSED: id=${id} ${closed[0].asset} ${closed[0].side} $${Number(closed[0].notional).toFixed(2)} → realized=${fmtΔ(rpnl)} (final=${fmtΔ(eff)})`);
          if (rpnl > 0.10) console.log(`     ✅ FIRST WIN of session — realized>+$0.10`);
        }
      }
    }
    state.activeIds = seen;

    const recentWins = await query<any>(
      `SELECT id, asset, side, realized_pnl::text as rpnl, closed_at::text
       FROM hedges WHERE chain='sui' AND status='closed'
         AND closed_at > NOW() - INTERVAL '10 minutes'
         AND realized_pnl > 0.10
       ORDER BY closed_at DESC LIMIT 5`
    );
    for (const w of recentWins) {
      const wt = new Date(w.closed_at).getTime();
      if (wt > state.lastRealizedTs) {
        console.log(`  💰 REALIZED WIN: id=${w.id} ${w.asset} ${w.side} +$${Number(w.rpnl).toFixed(2)}`);
        state.lastRealizedTs = wt;
      }
    }

    const skip = await query<any>(
      `SELECT value::text as v FROM cron_state WHERE key='polymarket-edge:last-skip'
         AND updated_at > NOW() - INTERVAL '10 minutes' LIMIT 1`
    );
    if (skip[0]) {
      try {
        const p = JSON.parse(skip[0].v);
        if (p.action !== 'skip-asset-too-small-nav' && p.action !== 'skip-cooldown') {
          console.log(`  · trader skip: ${p.action}`);
        }
      } catch {}
    }

    const health = await query<any>(
      `SELECT key, value::text as v FROM cron_state WHERE key LIKE 'cron:lastRun:%'
         AND updated_at > NOW() - INTERVAL '30 minutes'`
    );
    if (health.length < 5) {
      console.log(`  ⚠️  only ${health.length} cron heartbeats in last 30min`);
    }

    state.lastNav = curNav;
    state.lastSharePrice = curSp;
  } catch (e: any) {
    console.error(`[${ts()}] tick error: ${e.message}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PROFIT MONITOR — persistent watch');
  console.log(`  interval: ${INTERVAL_MS/1000}s  started: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Alerts on: new active, position close, realized win >+$0.10,');
  console.log('           sharp NAV move ±2%, new share-price peak +0.5%,');
  console.log('           uncommon trader skips, cron heartbeat degradation.');
  console.log('');
  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch(e => { console.error(e); process.exit(1); });
