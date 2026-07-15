/**
 * Alert Response Loop — turns Discord alerts into auto-remediation.
 *
 * ## Why
 *
 * Discord is a passive tap on the shoulder. Real autonomy needs a
 * closed loop: 3 KILL alerts in 60 min → auto-shrink spot. Profit-lock
 * pinned at 0% risk for > 24h → auto-unwind all spot to USDC. Phantom
 * hedge rate > 1% for > 1h → halt trader + auto-hedge.
 *
 * ## Cadence
 *
 * Runs every 15 min via QStash (create schedule via `curl` against the
 * v2 API — see CLAUDE.md). Cost: 1 DB read + 1 Discord post per tick
 * when no action; extra RPC only when a rule fires.
 *
 * ## Env gates
 *
 * All destructive responses are gated so the first days after deploy
 * are log-only. Operator watches Discord for what WOULD have fired
 * before flipping ALERT_RESPONSE_EXECUTE=1 to make it live.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/qstash';
import { tryClaimCronRun, setCronState } from '@/lib/db/cron-state';
import { logger } from '@/lib/utils/logger';
import { notifyDiscord, readAlertLog } from '@/lib/utils/discord-notify';
import { evaluateAutoResponse } from '@/lib/services/alerting/alert-response-loop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CRON_KEY = 'alert-response-loop';
const TICK_INTERVAL_MS = 60 * 1000; // debounce
const HEARTBEAT_KEY = `cron:lastRun:${CRON_KEY}`;

async function handle(request: NextRequest): Promise<NextResponse> {
  const auth = await verifyCronRequest(request, 'AlertResponseLoop');
  if (auth !== true) return auth;

  const now = Date.now();
  const claimed = await tryClaimCronRun(CRON_KEY, TICK_INTERVAL_MS, now);
  if (!claimed) {
    return NextResponse.json({ skipped: true, reason: 'tick claim debounce' });
  }
  await setCronState(HEARTBEAT_KEY, now).catch(() => {});

  try {
    const alertLog = await readAlertLog();

    // Phantom rate: query recent hedges for phantom marker.
    let phantomRatePctLastHour = 0;
    try {
      const { query } = await import('@/lib/db/postgres');
      const rows = await query<{ n: string; phantom: string }>(
        `SELECT COUNT(*)::text as n,
                SUM(CASE WHEN status='phantom' THEN 1 ELSE 0 END)::text as phantom
         FROM hedges WHERE created_at > NOW() - INTERVAL '1 hour'`
      );
      const total = Number(rows[0]?.n ?? 0);
      const phantoms = Number(rows[0]?.phantom ?? 0);
      phantomRatePctLastHour = total > 0 ? (phantoms / total) * 100 : 0;
    } catch { /* best-effort */ }

    // Profit-lock zero-tier tracking — reads the timestamp we mark in cron_state
    // whenever profit-lock hits 0%. Absent = not there.
    let profitLockZeroSinceMs: number | undefined;
    try {
      const { getCronState } = await import('@/lib/db/cron-state');
      profitLockZeroSinceMs = (await getCronState<number>('profit-lock:zero-since').catch(() => null)) ?? undefined;
    } catch { /* best-effort */ }

    const responses = await evaluateAutoResponse({
      alertLog,
      now,
      profitLockZeroSinceMs,
      phantomRatePctLastHour,
    });

    if (responses.length === 0) {
      return NextResponse.json({ success: true, responses: 0 });
    }

    const execute = (process.env.ALERT_RESPONSE_EXECUTE ?? '') === '1';
    logger.warn('[AlertResponseLoop] auto-response(s) fired', {
      execute, count: responses.length, responses,
    });

    for (const r of responses) {
      await notifyDiscord(
        `🤖 Auto-response: ${r.type} — ${r.reason} [${execute ? 'EXECUTING' : 'log-only'}]`,
        execute ? 'KILL' : 'WARN',
        r as unknown as Record<string, unknown>,
      ).catch(() => {});

      if (!execute) continue;

      // Execution paths — each behind its own env gate. Kept small so
      // rollout can enable one at a time.
      try {
        if (r.type === 'HALT_TRADER' && (process.env.ALERT_RESPONSE_EXECUTE_HALT ?? '') === '1') {
          await setCronState('polymarket-edge-trader:halt', now).catch(() => {});
        }
        if (r.type === 'HALT_AUTOHEDGE' && (process.env.ALERT_RESPONSE_EXECUTE_HALT ?? '') === '1') {
          await setCronState('sui-community-pool:autohedge:halt', {
            untilMs: now + 24 * 60 * 60 * 1000,
            reason: 'alert-response-loop halt',
          }).catch(() => {});
        }
        // SHRINK_SPOT / UNWIND_ALL_SPOT need PortfolioDriver execution
        // wiring; today they log only. Enable via PORTFOLIO_DRIVER_EXECUTE
        // once the driver's swap path is wired in sui-community-pool.
      } catch (execErr) {
        logger.warn('[AlertResponseLoop] execute failed for response', {
          type: r.type, error: execErr instanceof Error ? execErr.message : String(execErr),
        });
      }
    }

    return NextResponse.json({
      success: true,
      execute,
      responses: responses.length,
      types: responses.map(r => r.type),
    });
  } catch (e) {
    logger.error('[AlertResponseLoop] failed', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
