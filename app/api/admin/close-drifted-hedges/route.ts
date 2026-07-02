/**
 * Admin: force-close every drifted hedge NOW.
 *
 * Bypasses the cron cadence. Runs the same drift-check as
 * position-drift-monitor but with immediate execution. Use when a signal
 * flip has left positions bleeding and you can't wait for the next
 * bluefin-health tick.
 *
 * Auth: CRON_SECRET via Bearer header.
 *   GET  → dry run: list which positions would close + reasons
 *   POST → actually close them
 *
 * Result:
 * {
 *   checked: number,           // active real hedges considered
 *   drifted: number,           // guard-rejected count
 *   closed: number,            // actually closed count
 *   skipped: number,           // rate-limited or too-small
 *   errors: number,
 *   actions: [{ symbol, side, notionalUsd, action, reason, orderId?, realizedPnlUsd? }]
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { BluefinService } from '@/lib/services/sui/BluefinService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: NextRequest, dryRun: boolean) {
  const auth = await verifyCronRequest(req, 'CloseDriftedHedges');
  if (auth !== true) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const bf = BluefinService.getInstance();

    if (dryRun) {
      // Enumerate without executing — call checkBeforeTrade for each active hedge
      const { query } = await import('@/lib/db/postgres');
      const rows = await query<{
        market: string; side: string; notional_value: string;
        order_id: string | null; hedge_id_onchain: string | null;
      }>(
        `SELECT market, side, notional_value, order_id, hedge_id_onchain
           FROM hedges
          WHERE chain = 'sui' AND status = 'active' AND COALESCE(notional_value, 0) >= 1
            AND market LIKE '%-PERP'`,
      );
      const { checkBeforeTrade } = await import('@/lib/services/agents/agent-trade-guard');
      const dryPlan = [];
      for (const r of rows) {
        const asset = r.market.replace(/-PERP$/i, '').toUpperCase();
        const side = (r.side || '').toUpperCase() as 'LONG' | 'SHORT';
        const notionalUsd = Number(r.notional_value);
        const decision = await checkBeforeTrade({
          chain: 'sui', asset, intendedSide: side, notionalUsd,
          agentSource: 'admin-drift-dry-run',
        });
        dryPlan.push({
          symbol: r.market, side, notionalUsd,
          wouldClose: !decision.approved && (decision.stage === 'agent-directive' || decision.stage === 'risk-gate'),
          agentSide: decision.agentSide,
          agentConfidence: decision.agentConfidence,
          stage: decision.stage,
          reason: decision.reason,
        });
      }
      return NextResponse.json({
        success: true, dryRun: true,
        activeHedgeCount: rows.length,
        plan: dryPlan,
      });
    }

    // Actual execution
    const { checkAndCloseDrifts } = await import('@/lib/services/agents/position-drift-monitor');
    const result = await checkAndCloseDrifts('sui', bf);

    logger.info('[Admin] Force drift-close complete', result);
    return NextResponse.json({
      success: true, dryRun: false, ...result,
    });
  } catch (e) {
    logger.error('[Admin] Force drift-close failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({
      success: false, error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req, true);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req, false);
}
