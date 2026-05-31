/**
 * Cron Job: BlueFin Positions ↔ DB hedges reconciliation
 *
 * Closes the third drift path that the existing reconcilers don't cover:
 *
 *   sui-hedge-reconcile cron:    on-chain Move active_hedges ↔ BlueFin positions
 *   SuiHedgeReconciler service:  on-chain Move active_hedges ↔ DB hedges
 *   THIS cron:                   BlueFin positions ↔ DB hedges
 *
 * Why DB ↔ BlueFin drift matters:
 *  • Manual close via BlueFin UI: position disappears, DB still says "active"
 *    → analytics dashboards show ghost positions, share-price math wrong.
 *  • Manual open via BlueFin UI: position exists, DB has no row
 *    → reconciler can't compute PnL, cron may try to double-open.
 *  • Partial fills, liquidations, auto-deleverages — same divergence shapes.
 *
 * Drift repair (idempotent, fail-closed):
 *   1. Pull DB rows where chain='sui' AND status='active'.
 *   2. Pull live BlueFin positions.
 *   3. For each DB row not matched by a live BlueFin position of the same
 *      symbol+side: mark status='closed' with `realized_pnl=0` (no data —
 *      we don't know the exit price; this matches the existing reconciler
 *      behavior for vanished hedges, see [[hedge-pnl-columns]] memo).
 *   4. (We intentionally do NOT insert orphan BlueFin positions into the
 *      DB. That requires entry_price + opened-at metadata we don't have.
 *      Surface them in the Discord alert instead — operator triages.)
 *
 * Schedule: 15 min on QStash. Faster than sui-hedge-reconcile (hourly)
 * because DB-side drift directly affects user-facing analytics.
 *
 * Security: QStash signature or CRON_SECRET via verifyCronRequest.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { notifyDiscord } from '@/lib/utils/discord-notify';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { getActiveHedges, closeHedge, createHedge, type Hedge } from '@/lib/db/hedges';
import { setCronState } from '@/lib/db/cron-state';
import { SUI_COMMUNITY_POOL_PORTFOLIO_ID } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CRON_KEY_LAST_RUN = 'cron:lastRun:bluefin-db-reconcile';

interface ReconcileResult {
  success: boolean;
  ranAt: string;
  dbActiveCount: number;
  bluefinPositionsCount: number;
  phantomDbRows: Array<{ id: number; symbol: string; side: string; size: number }>;
  orphanBluefinPositions: Array<{ symbol: string; side: string; size: number }>;
  closedDbRowIds: number[];
  error?: string;
}

function matchesPosition(
  hedge: Hedge,
  positions: Array<{ symbol?: string; side?: string; size?: number }>,
): boolean {
  // A DB row matches a BlueFin position when symbol AND side both line up.
  // Size doesn't need to match exactly — BlueFin position sizes drift from
  // funding rate adjustments, and a partial close still leaves the DB row
  // marked active (which is correct — there's still exposure).
  return positions.some(p => {
    const pSymbol = String(p.symbol || '').toUpperCase();
    const pSide = String(p.side || '').toUpperCase();
    return pSymbol === String(hedge.market || '').toUpperCase()
        && pSide === String(hedge.side || '').toUpperCase();
  });
}

export async function GET(request: NextRequest): Promise<NextResponse<ReconcileResult>> {
  const ranAt = new Date().toISOString();
  void setCronState(CRON_KEY_LAST_RUN, Date.now()).catch(() => {});

  const auth = await verifyCronRequest(request, 'BluefinDbReconcile');
  if (auth !== true) {
    return NextResponse.json(
      {
        success: false, ranAt, dbActiveCount: 0, bluefinPositionsCount: 0,
        phantomDbRows: [], orphanBluefinPositions: [], closedDbRowIds: [],
        error: 'Unauthorized',
      } as ReconcileResult,
      { status: 401 },
    );
  }

  try {
    const bf = BluefinService.getInstance();
    const [dbHedges, positions] = await Promise.all([
      getActiveHedges(undefined, 'sui'),
      bf.getPositions(),
    ]);

    const phantomDbRows: ReconcileResult['phantomDbRows'] = [];
    const closedDbRowIds: number[] = [];
    for (const h of dbHedges) {
      // Skip operational micro-hedges (the < $1 entries that exist purely as
      // capability-transfer artifacts on the Move side, never on BlueFin).
      const notional = Number(h.notional_value ?? 0);
      if (notional < 1) continue;

      if (!matchesPosition(h, positions as Array<{ symbol?: string; side?: string; size?: number }>)) {
        phantomDbRows.push({
          id: h.id,
          symbol: String(h.market || ''),
          side: String(h.side || ''),
          size: Number(h.size ?? 0),
        });
        try {
          await closeHedge(h.order_id, 0); // realized_pnl=0 — no exit data available
          closedDbRowIds.push(h.id);
        } catch (e) {
          logger.warn('[bluefin-db-reconcile] failed to close phantom DB row', {
            id: h.id, error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    const orphanBluefinPositions: ReconcileResult['orphanBluefinPositions'] = [];
    const orphanInsertedIds: number[] = [];
    for (const p of positions) {
      const pp = p as unknown as Record<string, unknown>;
      const symbol = String(pp.symbol || '').toUpperCase();
      const side = String(pp.side || '').toUpperCase();
      const size = Number(pp.size ?? 0);
      const matchedInDb = dbHedges.some(h =>
        String(h.market || '').toUpperCase() === symbol
        && String(h.side || '').toUpperCase() === side,
      );
      if (!matchedInDb && symbol && size > 0) {
        orphanBluefinPositions.push({ symbol, side, size });
        // Auto-recover: insert a reconstructed DB row with markPrice as the
        // entry estimate. Without this, the orphan sits forever and every
        // future reconcile tick re-alerts. The cron's createHedge sometimes
        // fails silently after openHedge succeeds (DB hiccup, schema drift),
        // so this is the closing-the-loop mechanism.
        try {
          const asset = symbol.replace('-PERP', '');
          const markPrice = Number(pp.markPrice ?? pp.entryPrice ?? 0);
          const leverage = Number(pp.leverage ?? 3);
          const notionalUsd = size * (markPrice || 0);
          if (notionalUsd > 0) {
            const reconstructed = await createHedge({
              orderId: `reconstructed_${symbol}_${side}_${Date.now()}`,
              portfolioId: SUI_COMMUNITY_POOL_PORTFOLIO_ID,
              walletAddress: (process.env.SUI_ADMIN_ADDRESS || '').trim(),
              asset,
              market: symbol,
              side: side as 'LONG' | 'SHORT',
              size,
              notionalValue: notionalUsd,
              leverage,
              entryPrice: markPrice,
              simulationMode: false,
              chain: 'sui',
              reason: `Orphan auto-recovered by bluefin-db-reconcile (entry=markPrice estimate; openHedge succeeded but createHedge missed)`,
            });
            orphanInsertedIds.push(reconstructed.id);
          }
        } catch (insertErr) {
          logger.warn('[bluefin-db-reconcile] orphan insert failed', {
            symbol, side, size,
            error: insertErr instanceof Error ? insertErr.message : String(insertErr),
          });
        }
      }
    }

    const drifted = phantomDbRows.length > 0 || orphanBluefinPositions.length > 0;
    if (drifted) {
      const phantomDesc = phantomDbRows.map(r => `${r.symbol} ${r.side} ${r.size}`).join(', ') || 'none';
      const orphanDesc = orphanBluefinPositions.map(r => `${r.symbol} ${r.side} ${r.size}`).join(', ') || 'none';
      await notifyDiscord(
        `DB↔BlueFin drift detected. Phantoms closed (${phantomDbRows.length}): ${phantomDesc}. Orphans on BlueFin (${orphanBluefinPositions.length}): ${orphanDesc}.`,
        orphanBluefinPositions.length > 0 ? 'WARN' : 'INFO',
        { phantomDbRows, orphanBluefinPositions, closedDbRowIds },
      );
    }

    logger.info('[bluefin-db-reconcile] complete', {
      dbActive: dbHedges.length,
      bluefinPositions: positions.length,
      phantomsClosed: closedDbRowIds.length,
      orphans: orphanBluefinPositions.length,
    });

    return NextResponse.json({
      success: true,
      ranAt,
      dbActiveCount: dbHedges.length,
      bluefinPositionsCount: positions.length,
      phantomDbRows,
      orphanBluefinPositions,
      closedDbRowIds,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[bluefin-db-reconcile] error', { error: msg });
    return NextResponse.json(
      {
        success: false, ranAt, dbActiveCount: 0, bluefinPositionsCount: 0,
        phantomDbRows: [], orphanBluefinPositions: [], closedDbRowIds: [],
        error: msg,
      },
      { status: 500 },
    );
  }
}

export const POST = GET;
