/**
 * Cron Job: State Integrity Check
 *
 * fsck for cron_state — detects the class of drift where writers leave
 * stale directives / halts / dust flags in place after they should
 * have been cleared. State-snapshot (`/api/admin/state-snapshot`) shows
 * this drift; this cron ALERTS on it.
 *
 * Runs every hour. Reads:
 *   - `cron:haltUntil:*`     — should not be present after untilMs
 *   - `alert-response:*`     — should not be present after expiresAtMs
 *   - `poolNav:peak:*`       — should be in plausible range
 *   - `stale-dust-flag:*`    — should reference an active hedge id
 *
 * Any violation → WARN Discord with the specific key + why.
 *
 * Schedule: 1 hour on QStash.
 * Security: QStash signature or CRON_SECRET via verifyCronRequest.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { notifyDiscord } from '@/lib/utils/discord-notify';
import { getCronStateByPrefix, setCronState } from '@/lib/db/cron-state';
import { getActiveHedges } from '@/lib/db/hedges';
import { findIntegrityViolations } from '@/lib/services/state-integrity/checks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CRON_KEY_LAST_RUN = 'cron:lastRun:state-integrity';

export async function GET(request: NextRequest) {
  const ranAt = new Date().toISOString();
  void setCronState(CRON_KEY_LAST_RUN, Date.now()).catch(() => {});

  const auth = await verifyCronRequest(request, 'StateIntegrity');
  if (auth !== true) {
    return NextResponse.json({ success: false, ranAt, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [halts, directives, peaks, dustFlags, activeHedges] = await Promise.all([
      getCronStateByPrefix('cron:haltUntil:'),
      getCronStateByPrefix('alert-response:'),
      getCronStateByPrefix('poolNav:peak:'),
      getCronStateByPrefix('stale-dust-flag:'),
      getActiveHedges(undefined, 'sui').catch(() => []),
    ]);

    const activeIds = new Set<number | string>(activeHedges.map((h) => h.id));
    const entries = [
      ...[...halts.entries()].map(([key, value]) => ({ key, value })),
      ...[...directives.entries()].map(([key, value]) => ({ key, value })),
      ...[...peaks.entries()].map(([key, value]) => ({ key, value })),
      ...[...dustFlags.entries()].map(([key, value]) => ({ key, value })),
    ];

    const violations = findIntegrityViolations(entries, activeIds, Date.now());

    if (violations.length > 0) {
      const grouped: Record<string, number> = {};
      for (const v of violations) grouped[v.category] = (grouped[v.category] || 0) + 1;
      const groupSummary = Object.entries(grouped).map(([c, n]) => `${c}:${n}`).join(', ');
      const first = violations.slice(0, 3).map((v) => `${v.key} — ${v.detail}`).join(' | ');
      await notifyDiscord(
        `⚠️ State-integrity drift: ${violations.length} violation(s) [${groupSummary}]. First 3: ${first}`,
        'WARN', { violations },
      ).catch(() => {});
    }

    logger.info('[state-integrity] tick', {
      violations: violations.length,
      entriesChecked: entries.length,
      activeHedgesCount: activeHedges.length,
    });

    return NextResponse.json({
      success: true, ranAt,
      violations, entriesChecked: entries.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[state-integrity] error', { error: msg });
    return NextResponse.json({ success: false, ranAt, error: msg }, { status: 500 });
  }
}

export const POST = GET;
