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

  try {
    const bf = BluefinService.getInstance();
    const beforeFree = await bf.getBalance();
    const positions = await bf.getPositions();

    if (positions.length === 0) {
      return NextResponse.json({
        success: true,
        dryRun,
        beforeFree,
        afterFree: beforeFree,
        closed: 0,
        results: [],
        message: 'No open positions',
        durationMs: Date.now() - startTime,
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
