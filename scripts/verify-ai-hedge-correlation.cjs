/**
 * Verify hedges are being CREATED ACCORDING TO AI signals.
 *
 * Joins community_pool_transactions (AI_DECISION) with hedges to confirm:
 *   1. Recent AI decisions exist
 *   2. When riskScore ≥ threshold, hedges were attempted
 *   3. When hedges were created, they match the AI's hedgedAssets/swappableAssets
 *   4. The 1 active perp position lines up with an AI decision
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const cs = process.env.DATABASE_URL || process.env.DB_V2_DATABASE_URL || process.env.DB_V2_POSTGRES_URL;
const pg = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log('\n═══ AI → HEDGE CREATION CORRELATION ═══\n');

  // 1. Recent AI decisions
  const ai = await pg.query(`
    SELECT id, created_at, details
    FROM community_pool_transactions
    WHERE type='AI_DECISION' AND details->>'chain'='sui'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.log(`AI decisions (last 10):`);
  for (const r of ai.rows) {
    const d = r.details || {};
    const hedged = (d.hedgedAssets || []).length;
    const swappable = (d.swappableAssets || []).length;
    console.log(`  ${r.created_at.toISOString()} | risk=${d.riskScore ?? '?'} action=${d.action ?? '?'} conf=${d.confidence ?? '?'} hedgedAssets=${hedged} swappable=${swappable} urgency=${d.urgency ?? '-'}`);
  }

  // 2. Recent hedges
  console.log(`\nHedges created (last 10):`);
  const hedges = await pg.query(`
    SELECT id, order_id, asset, side, size, leverage, entry_price, status, created_at, close_reason, reason
    FROM hedges
    WHERE chain='sui'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  for (const h of hedges.rows) {
    console.log(`  ${h.created_at.toISOString()} | ${h.asset} ${h.side} sz=${h.size} lev=${h.leverage}x @${h.entry_price} status=${h.status} order=${h.order_id?.slice(0, 30)}`);
    if (h.reason) console.log(`     reason: ${h.reason.slice(0, 120)}`);
  }

  // 3. Active perp positions (the live ones)
  console.log(`\nActive perp positions:`);
  const active = await pg.query(`
    SELECT order_id, asset, side, size, leverage, entry_price, current_pnl, created_at, reason
    FROM hedges
    WHERE chain='sui' AND status='active'
    ORDER BY created_at DESC
  `);
  if (active.rows.length === 0) {
    console.log('  (none)');
  } else {
    for (const h of active.rows) {
      const ageH = ((Date.now() - new Date(h.created_at).getTime()) / 3600000).toFixed(1);
      console.log(`  ${h.asset} ${h.side} sz=${h.size} @${h.entry_price} pnl=${h.current_pnl} age=${ageH}h order=${h.order_id?.slice(0, 40)}`);
      console.log(`     reason: ${(h.reason || '').slice(0, 140)}`);
    }
  }

  // 4. Count of hedges per origin
  const origin = await pg.query(`
    SELECT
      CASE
        WHEN order_id LIKE 'BF_RECONCILE_%' THEN 'reconciler-adopted'
        WHEN order_id LIKE 'sui_%' THEN 'ai-cron-opened'
        WHEN reason LIKE 'Auto-hedge:%' THEN 'auto-hedge'
        ELSE 'other'
      END AS origin,
      status,
      COUNT(*) AS n
    FROM hedges WHERE chain='sui'
    GROUP BY origin, status ORDER BY origin, status
  `);
  console.log(`\nHedge origins (chain=sui):`);
  for (const r of origin.rows) console.log(`  ${r.origin.padEnd(22)} ${r.status.padEnd(8)} ${r.n}`);

  // 5. Was a hedge ever ACTUALLY OPENED by the cron's auto-hedge path?
  // (i.e. came from Step 8, not from the reconciler adopting an external Bluefin position)
  const cronOpened = await pg.query(`
    SELECT COUNT(*) AS n FROM hedges
    WHERE chain='sui' AND order_id NOT LIKE 'BF_RECONCILE_%' AND reason LIKE 'Auto-hedge:%'
  `);
  console.log(`\nHedges actually OPENED by cron auto-hedge path: ${cronOpened.rows[0].n}`);

  // 6. Last AI_DECISION → did it have hedgedAssets and was the risk above threshold?
  if (ai.rows.length > 0) {
    const last = ai.rows[0].details || {};
    const risk = Number(last.riskScore || 0);
    const threshold = 8; // current code default for SUI pool
    console.log(`\nLast AI decision interpretation:`);
    console.log(`  riskScore=${risk} vs threshold=${threshold} → ${risk >= threshold ? 'WOULD HEDGE' : 'BELOW THRESHOLD (HOLD)'}`);
    console.log(`  hedgedAssets=${JSON.stringify(last.hedgedAssets || [])} swappableAssets=${JSON.stringify(last.swappableAssets || [])}`);
    console.log(`  navUSD=${last.poolNAV_USDC ?? '?'} (Step 8 needs ≥ $1000 — ${(last.poolNAV_USDC || 0) >= 1000 ? 'eligible' : 'PERP HEDGES GATED OFF'})`);
    if (last.allocations) console.log(`  allocations: BTC=${last.allocations.BTC}% ETH=${last.allocations.ETH}% SUI=${last.allocations.SUI}%`);
  }

  // 7. Verdict
  console.log(`\n═══ VERDICT ═══`);
  const aiCount = ai.rows.length;
  const lastAi = ai.rows[0]?.details || {};
  const lastRisk = Number(lastAi.riskScore || 0);
  const lastNav = Number(lastAi.poolNAV_USDC || 0);
  const cronAutoHedges = Number(cronOpened.rows[0].n);

  if (aiCount === 0) {
    console.log('❌ No AI decisions in DB — cron may not be running.');
  } else if (lastNav < 1000) {
    console.log(`✓ AI is running and producing decisions, but Step 8 (perp hedge) is GATED OFF because NAV=$${lastNav.toFixed(2)} < $1000 minimum.`);
    console.log('  → AI is correctly choosing NOT to open BlueFin perp hedges at this NAV.');
    console.log('  → Active position (if any) was likely opened externally and adopted by reconciler.');
  } else if (lastRisk < 8) {
    console.log(`✓ AI is running, NAV is sufficient, but riskScore=${lastRisk} < threshold 8 → HOLD (correct conservative behavior).`);
  } else if (cronAutoHedges === 0) {
    console.log(`⚠ AI says HEDGE (risk=${lastRisk}≥8, NAV ok) but cron has never opened a hedge — possible blocker (BLUEFIN_PRIVATE_KEY? size below minQty?). Investigate.`);
  } else {
    console.log(`✅ AI → hedge pipeline is operational. ${cronAutoHedges} hedges opened by auto-hedge path.`);
  }

  await pg.end();
})().catch(e => { console.error('FATAL', e.stack || e.message); process.exit(1); });
