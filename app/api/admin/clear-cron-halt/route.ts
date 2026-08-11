/**
 * Clear a `cron:haltUntil:<scope>` key immediately.
 *
 * Auth: Bearer CRON_SECRET (via verifyCronRequest).
 *
 * Ops tool for the peak-NAV deadlock recovery pattern: after a
 * drawdown-halt fires, root-cause fix (e.g. PR #55 rolling window) lands,
 * peak decays, but the existing halt-until timestamp keeps autohedge
 * paused until the natural midnight expiry. This endpoint bypasses that
 * wait so autohedge resumes on the very next cron tick.
 *
 *   POST /api/admin/clear-cron-halt
 *   Body: { "scope": "sui-community-pool:autohedge" }
 *   → deletes the `cron:haltUntil:${scope}` key
 *
 * Safe by design:
 *   • Only touches `cron:haltUntil:*` keys — no capital-moving mutations
 *   • The downstream cron re-evaluates its halt condition on next tick,
 *     so if the underlying drawdown/kill-switch reason is still valid the
 *     halt will just get re-set. Clearing it is idempotent + reversible.
 *   • Fails closed if `scope` is missing or doesn't match the expected shape.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/qstash';
import { deleteCronState, getCronStateOr } from '@/lib/db/cron-state';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// Whitelist of scopes that this endpoint may clear. Prevents typos +
// prevents this endpoint from being turned into a generic cron_state
// deletion tool. Extend as new halted crons appear.
const CLEARABLE_SCOPES = new Set([
  'sui-community-pool:autohedge',
  'sui-community-pool:rebalance',
  'polymarket-edge-trader',
  'bluefin-health',
]);

export async function POST(req: NextRequest) {
  const auth = await verifyCronRequest(req, 'admin/clear-cron-halt');
  if (auth !== true) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { scope?: string };
  const scope = String(body.scope || '').trim();

  if (!scope) {
    return NextResponse.json(
      { error: 'scope required (e.g. "sui-community-pool:autohedge")' },
      { status: 400 },
    );
  }
  if (!CLEARABLE_SCOPES.has(scope)) {
    return NextResponse.json(
      {
        error: `scope "${scope}" not in whitelist`,
        allowed: Array.from(CLEARABLE_SCOPES),
      },
      { status: 400 },
    );
  }

  const key = `cron:haltUntil:${scope}`;
  const before = await getCronStateOr<{ untilMs?: number; reason?: string } | number | null>(key, null);

  try {
    await deleteCronState(key);
  } catch (e) {
    logger.error('[clear-cron-halt] delete failed', { key, error: e });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  logger.warn('[clear-cron-halt] halt cleared', { key, before });
  return NextResponse.json({
    ok: true,
    key,
    cleared: before,
    note: 'downstream cron will re-evaluate on next tick; halt will re-set if underlying condition still trips',
  });
}
