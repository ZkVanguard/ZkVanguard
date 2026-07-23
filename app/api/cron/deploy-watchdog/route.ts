/**
 * Cron Job: Deploy Drift Watchdog
 *
 * Compares the running production commit (via /api/health/production
 * `build.commit`) against origin/main HEAD from GitHub. Alerts when they
 * diverge and the origin HEAD has been sitting undeployed for more than
 * DRIFT_GRACE_MS — catching silent Vercel deploy failures that push
 * status looks green through.
 *
 * Root incident: 2026-07-20 → 07-22, tsconfig types drift bailed two
 * prod deploys unnoticed for 2 days. Push status was green, GitHub
 * showed deploy events with "state: failure" nobody was watching.
 * Same-shape class as the HALT wire drift (0ca16f95), env-gate drift
 * (e6a80411), phantom-rate query drift (cf7f42b2) — code did nothing,
 * silently, and no cron told us.
 *
 * Alert logic:
 *   - Fetch /api/health/production → build.commit (8 chars)
 *   - Fetch api.github.com/.../branches/main → HEAD sha + commit date
 *   - If short SHAs differ AND HEAD is older than DRIFT_GRACE_MS:
 *       first drift tick             → WARN
 *       still drifted 60min later    → KILL
 *
 * Schedule: 30 min on QStash.
 * Security: QStash signature or CRON_SECRET via verifyCronRequest.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { notifyDiscord } from '@/lib/utils/discord-notify';
import { getCronStateOr, setCronState } from '@/lib/db/cron-state';
import { decideAlert, DRIFT_GRACE_MS } from '@/lib/services/deploy-watchdog/decide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CRON_KEY_LAST_RUN = 'cron:lastRun:deploy-watchdog';
const CRON_KEY_LAST_DRIFT_SHA = 'deploy-watchdog:last-drift-sha';
const CRON_KEY_LAST_ALERT = 'deploy-watchdog:last-alert-ms';

const PROD_URL = (process.env.PROD_URL || 'https://www.zkvanguard.xyz').replace(/\/$/, '');
const REPO = (process.env.DEPLOY_WATCHDOG_REPO || 'ZkVanguard/ZkVanguard').trim();

export async function GET(request: NextRequest) {
  const ranAt = new Date().toISOString();
  void setCronState(CRON_KEY_LAST_RUN, Date.now()).catch(() => {});

  const auth = await verifyCronRequest(request, 'DeployWatchdog');
  if (auth !== true) {
    return NextResponse.json({ success: false, ranAt, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [healthRes, ghRes] = await Promise.all([
      fetch(`${PROD_URL}/api/health/production`, {
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      }),
      fetch(`https://api.github.com/repos/${REPO}/branches/main`, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'zkvanguard-deploy-watchdog' },
        cache: 'no-store',
      }),
    ]);

    const health = (await healthRes.json()) as { build?: { commit?: string } };
    const gh = (await ghRes.json()) as {
      commit?: { sha?: string; commit?: { committer?: { date?: string } } };
    };

    const runningSha = String(health?.build?.commit || '').slice(0, 8);
    const originSha = String(gh?.commit?.sha || '').slice(0, 8);
    const originCommitDate = gh?.commit?.commit?.committer?.date;
    const originAgeMs = originCommitDate ? Date.now() - new Date(originCommitDate).getTime() : 0;

    if (!runningSha || !originSha) {
      logger.warn('[deploy-watchdog] could not read one side', { runningSha, originSha });
      return NextResponse.json({ success: false, ranAt, runningSha, originSha, error: 'missing sha' });
    }

    const now = Date.now();
    const prevDriftSha = await getCronStateOr<string | null>(CRON_KEY_LAST_DRIFT_SHA, null);
    const lastAlertMs = await getCronStateOr<number>(CRON_KEY_LAST_ALERT, 0);

    const decision = decideAlert({
      runningSha, originSha, originAgeMs, prevDriftSha, lastAlertMs, now,
    }, REPO);

    if (decision.alertLevel && decision.alertMsg) {
      await notifyDiscord(decision.alertMsg, decision.alertLevel, {
        runningSha, originSha, originAgeMinutes: Math.round(originAgeMs / 60_000),
      }).catch(() => {});
    }

    await Promise.all([
      setCronState(CRON_KEY_LAST_DRIFT_SHA, decision.nextDriftSha).catch(() => {}),
      setCronState(CRON_KEY_LAST_ALERT, decision.nextLastAlert).catch(() => {}),
    ]);

    logger.info('[deploy-watchdog] tick', {
      runningSha, originSha,
      drifted: runningSha !== originSha,
      isFreshPush: originAgeMs < DRIFT_GRACE_MS,
      originAgeMinutes: Math.round(originAgeMs / 60_000),
      alertLevel: decision.alertLevel,
    });

    return NextResponse.json({
      success: true, ranAt,
      runningSha, originSha,
      drifted: runningSha !== originSha,
      isFreshPush: originAgeMs < DRIFT_GRACE_MS,
      originAgeMinutes: Math.round(originAgeMs / 60_000),
      alertFired: decision.alertLevel != null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[deploy-watchdog] error', { error: msg });
    return NextResponse.json({ success: false, ranAt, error: msg }, { status: 500 });
  }
}

export const POST = GET;
