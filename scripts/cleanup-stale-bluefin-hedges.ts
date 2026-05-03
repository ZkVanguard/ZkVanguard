import 'dotenv/config';
import { query } from '@/lib/db/postgres';
import { updateHedgeStatus } from '@/lib/db/hedges';
import { BluefinService } from '@/lib/services/sui/BluefinService';

async function main() {
  const bf = BluefinService.getInstance();
  await bf.initialize((process.env.BLUEFIN_PRIVATE_KEY || '').trim(), 'mainnet');
  const positions = await bf.getPositions();
  const liveSet = new Set(positions.map(p => `${p.symbol}|${(p.side || '').toUpperCase()}`));
  console.log('Live BlueFin positions:', [...liveSet]);

  const rows = await query<{ id: number; order_id: string; market: string; side: string; created_at: Date }>(
    `SELECT id, order_id, market, side, created_at FROM hedges
     WHERE chain='sui' AND status='active'
       AND (hedge_id_onchain IS NULL OR hedge_id_onchain='')
     ORDER BY created_at DESC`,
  );

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.market}|${(r.side || '').toUpperCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  let orphans = 0, dups = 0;
  for (const [key, group] of groups.entries()) {
    if (!liveSet.has(key)) {
      console.log(`[orphan] ${key}: closing ${group.length} rows`);
      for (const r of group) {
        await updateHedgeStatus(r.order_id, 'closed');
        orphans++;
      }
    } else if (group.length > 1) {
      const sorted = [...group].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      console.log(`[dup] ${key}: keep ${sorted[0].order_id}, close ${group.length - 1}`);
      for (let i = 1; i < sorted.length; i++) {
        await updateHedgeStatus(sorted[i].order_id, 'closed');
        dups++;
      }
    } else {
      console.log(`[ok]  ${key}: 1 row, matches live`);
    }
  }

  console.log(`\nDone. Closed ${orphans} orphan + ${dups} duplicate rows.`);

  const remaining = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM hedges WHERE chain='sui' AND status='active'`,
  );
  console.log(`Remaining active sui hedges: ${remaining[0].count}`);
}

main().catch(e => { console.error(e); process.exit(1); });
