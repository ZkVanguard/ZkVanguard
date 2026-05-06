/**
 * Lightweight Discord webhook notifier.
 *
 * Reads `DISCORD_WEBHOOK_URL` from env. If the env var is not set the
 * function silently no-ops — making this safe to call from any code path
 * without breaking environments where Discord isn't configured.
 *
 * Failures are swallowed (logged at debug) — alerting must never break
 * the surrounding workflow.
 */

import { logger } from './logger';

export type NotifyLevel = 'INFO' | 'WARN' | 'ERROR' | 'TRADE' | 'KILL';

const LEVEL_PREFIX: Record<NotifyLevel, string> = {
  INFO: 'ℹ️',
  WARN: '⚠️',
  ERROR: '❌',
  TRADE: '💱',
  KILL: '🛑',
};

export async function notifyDiscord(
  message: string,
  level: NotifyLevel = 'INFO',
  context?: Record<string, unknown>,
): Promise<void> {
  const url = (process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (!url) return;

  const ctx = context && Object.keys(context).length
    ? '\n```\n' + JSON.stringify(context, null, 2).slice(0, 1500) + '\n```'
    : '';
  const content = `${LEVEL_PREFIX[level]} **[${level}]** ${message}${ctx}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.debug('[notifyDiscord] webhook returned non-2xx', { status: res.status });
    }
  } catch (e) {
    logger.debug('[notifyDiscord] post failed (non-fatal)', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
