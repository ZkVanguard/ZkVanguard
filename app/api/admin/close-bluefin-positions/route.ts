/**
 * One-shot admin: close ALL open BlueFin positions via reduceOnly orders.
 *
 * Use when the auto-hedge cron has left positions on BlueFin that the
 * operator wants to flatten (e.g. an over-sized hedge from a stale AI
 * signal, or a directional bet you no longer want exposure to). Frees
 * the margin so it can be redeployed.
 *
 * Uses BluefinService.closeHedge (raw API + same signing path the cron
 * uses for openHedge) — avoids the BluefinClient SDK init issue we saw
 * in serverless (FAILED_TO_INITIALIZE_CLIENT).
 *
 * Auth: CRON_SECRET via Bearer header.
 *   GET  -> dry run: list positions only
 *   POST -> close every open position
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { notifyDiscord } from '@/lib/utils/discord-notify';
import { BluefinService } from '@/lib/services/sui/BluefinService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: NextRequest, dryRun: boolean) {
  const startTime = Date.now();
  const auth = await verifyCronRequest(req, 'CloseBluefinPositions');
  if (auth !== true) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Optional ?symbol=SUI-PERP filter — close one specific position
  // instead of flattening everything. Case-insensitive match against
  // the venue's symbol field. When unset, all positions get closed
  // (legacy behavior preserved).
  const symbolFilter = (new URL(req.url).searchParams.get('symbol') || '').trim().toUpperCase();

  // DEPLOY_MARKER_2026_07_02_a — force Vercel to rebuild this route.
  // Optional ?mode=drifted — close only positions the AgentTradeGuard would
  // now reject re-opening (signal-flipped misalignments). Delegates to the
  // same position-drift-monitor the crons use. Folded into this route so
  // we don't add a new serverless function slot (Vercel Hobby 12-cap).
  const mode = (new URL(req.url).searchParams.get('mode') || '').trim().toLowerCase();
  // Optional ?mode=dust — report protocol-locked positions below BlueFin's
  // minQty. GET returns the dust classification for every active position;
  // POST additionally records to Discord. No close attempted (unclearable).
  if (mode === 'dust') {
    try {
      const bf = BluefinService.getInstance();
      const { computeDustReport, formatDustReport } = await import('@/lib/services/sui/dust-manager');
      const report = await computeDustReport(bf);
      if (!dryRun && report.dustPositions > 0) {
        await notifyDiscord(formatDustReport(report), 'WARN', { report });
      }
      return NextResponse.json({
        success: true, dryRun, mode: 'dust',
        report,
        summary: formatDustReport(report),
        durationMs: Date.now() - startTime,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({
        success: false, mode: 'dust', error: msg,
        durationMs: Date.now() - startTime,
      }, { status: 500 });
    }
  }

  if (mode === 'drifted') {
    try {
      const bf = BluefinService.getInstance();
      if (dryRun) {
        // Dry-run: enumerate what checkBeforeTrade would decide per active hedge
        const { query } = await import('@/lib/db/postgres');
        const rows = await query<{
          market: string; side: string; notional_value: string;
        }>(
          `SELECT market, side, notional_value FROM hedges
            WHERE chain='sui' AND status='active' AND COALESCE(notional_value,0) >= 1
              AND market LIKE '%-PERP'`,
        );
        const { checkBeforeTrade } = await import('@/lib/services/agents/agent-trade-guard');
        const plan = [];
        for (const r of rows) {
          const asset = r.market.replace(/-PERP$/i, '').toUpperCase();
          const side = (r.side || '').toUpperCase() as 'LONG' | 'SHORT';
          const notionalUsd = Number(r.notional_value);
          const decision = await checkBeforeTrade({
            chain: 'sui', asset, intendedSide: side, notionalUsd,
            agentSource: 'admin-drift-dry-run',
          });
          plan.push({
            symbol: r.market, side, notionalUsd,
            wouldClose: !decision.approved && (decision.stage === 'agent-directive' || decision.stage === 'risk-gate'),
            agentSide: decision.agentSide,
            agentConfidence: decision.agentConfidence,
            stage: decision.stage,
            reason: decision.reason,
          });
        }
        return NextResponse.json({
          success: true, dryRun: true, mode: 'drifted',
          activeHedgeCount: rows.length,
          plan,
          durationMs: Date.now() - startTime,
        });
      }
      const { checkAndCloseDrifts } = await import('@/lib/services/agents/position-drift-monitor');
      const result = await checkAndCloseDrifts('sui', bf);
      logger.info('[close-bluefin-positions?mode=drifted] complete', result);
      return NextResponse.json({
        success: true, dryRun: false, mode: 'drifted',
        ...result,
        durationMs: Date.now() - startTime,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[close-bluefin-positions?mode=drifted] failed', { error: msg });
      return NextResponse.json({
        success: false, mode: 'drifted', error: msg,
        durationMs: Date.now() - startTime,
      }, { status: 500 });
    }
  }

  try {
    const bf = BluefinService.getInstance();
    const beforeFree = await bf.getBalance();
    const allPositions = await bf.getPositions();
    const positions = symbolFilter
      ? allPositions.filter(p => String((p as unknown as Record<string, unknown>).symbol || '').toUpperCase() === symbolFilter)
      : allPositions;

    if (positions.length === 0) {
      return NextResponse.json({
        success: true,
        dryRun,
        beforeFree,
        afterFree: beforeFree,
        closed: 0,
        results: [],
        message: symbolFilter
          ? `No open positions matching symbol=${symbolFilter} (total open: ${allPositions.length})`
          : 'No open positions',
        durationMs: Date.now() - startTime,
        symbolFilter: symbolFilter || undefined,
      });
    }

    const positionsSummary = positions.map(p => {
      const pp = p as unknown as Record<string, unknown>;
      return {
        symbol: String(pp.symbol || '?'),
        side: String(pp.side || '?'),
        size: Number(pp.size ?? pp.quantity ?? 0),
        notional: Number(pp.notional ?? pp.notionalValue ?? 0),
        unrealizedPnl: Number(pp.unrealizedProfit ?? pp.pnl ?? 0),
      };
    });

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        beforeFree,
        positionsCount: positions.length,
        positions: positionsSummary,
        durationMs: Date.now() - startTime,
      });
    }

    const results: Array<{
      symbol: string;
      success: boolean;
      orderId?: string;
      error?: string;
      preCloseSize?: number;
      postCloseSize?: number;
      rawResponse?: unknown;
    }> = [];
    for (const p of positions) {
      const symbol = String((p as unknown as Record<string, unknown>).symbol || '');
      if (!symbol) continue;
      try {
        const res = await bf.closeHedge({ symbol });
        results.push({
          symbol,
          success: !!res.success,
          orderId: res.orderId,
          error: res.success ? undefined : res.error,
          preCloseSize: res.preCloseSize,
          postCloseSize: res.postCloseSize,
          rawResponse: res.success ? undefined : res.rawResponse,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ symbol, success: false, error: msg });
      }
    }

    const afterFree = await bf.getBalance();
    const closedCount = results.filter(r => r.success).length;
    const freedCollateral = afterFree - beforeFree;

    if (closedCount > 0) {
      await notifyDiscord(
        `Closed ${closedCount}/${results.length} BlueFin position(s). Freed $${freedCollateral.toFixed(2)} margin ($${beforeFree.toFixed(2)} → $${afterFree.toFixed(2)}).`,
        'WARN',
        { results, positions: positionsSummary, beforeFree, afterFree, freedCollateral },
      );
    }

    logger.info('[close-bluefin-positions] complete', {
      closedCount, total: results.length, beforeFree, afterFree, freedCollateral,
    });

    return NextResponse.json({
      success: closedCount === results.length,
      dryRun: false,
      beforeFree,
      afterFree,
      freedCollateral,
      closed: closedCount,
      attempted: results.length,
      positions: positionsSummary,
      results,
      durationMs: Date.now() - startTime,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (typeof e === 'string' ? e : JSON.stringify(e));
    const stack = e instanceof Error ? e.stack?.split('\n').slice(0, 6).join('\n') : undefined;
    logger.error('[close-bluefin-positions] error', { message: msg, stack });
    return NextResponse.json({
      success: false,
      error: msg,
      stack,
      durationMs: Date.now() - startTime,
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return handle(req, false); }
export async function GET(req: NextRequest) { return handle(req, true); }
