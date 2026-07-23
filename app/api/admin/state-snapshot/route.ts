/**
 * Admin: State-machine snapshot.
 *
 * Single endpoint that dumps every halt, lock, directive, peak, dust-flag
 * and cron heartbeat from `cron_state`, plus the last N alert-log
 * entries. Turns "why is the pool doing / not doing X" from a manual
 * DB-query fishing trip into one curl.
 *
 * Root motivation: the 4-days-stuck profit-lock trap we cleared 2026-07-20
 * required manually querying 6 different keys, correlating them by
 * hand, and inferring "these three keys need clearing." That whole
 * investigation would've been a single request to this endpoint.
 *
 * Grouped by category so the operator can spot state-machine drift at a
 * glance:
 *   - halts     : keys that block a cron from executing (with age + human "expires in")
 *   - locks     : profit-lock zero-since, other timer-based locks
 *   - directives: alert-response overrides, cap directives
 *   - peaks     : NAV peaks, rebalance peaks
 *   - dust      : stale-dust-flag:* per hedge id
 *   - heartbeats: cron:lastRun:* per cron (with age)
 *   - trader    : polymarket-edge:* trader state
 *   - alerts    : last 10 KILL / ERROR / WARN entries from the ring buffer
 *
 * Auth: CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/qstash';
import { getCronStateByPrefix, getCronState } from '@/lib/db/cron-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface KeyValueAgeItem {
  key: string;
  value: unknown;
  ageMinutes?: number;
  expiresInMinutes?: number;
  active?: boolean;
}

function toItem(key: string, value: unknown, now: number): KeyValueAgeItem {
  const item: KeyValueAgeItem = { key, value };
  // Common shape 1: numeric timestamp
  if (typeof value === 'number' && value > 1e12) {
    item.ageMinutes = Math.round((now - value) / 60_000);
    if (value > now) item.expiresInMinutes = Math.round((value - now) / 60_000);
  }
  // Common shape 2: { expiresAtMs, capPct/reason } — alert-response directives
  if (value && typeof value === 'object' && 'expiresAtMs' in (value as Record<string, unknown>)) {
    const expiresAtMs = Number((value as Record<string, unknown>).expiresAtMs);
    if (Number.isFinite(expiresAtMs)) {
      item.expiresInMinutes = Math.round((expiresAtMs - now) / 60_000);
      item.active = expiresAtMs > now;
    }
  }
  return item;
}

export async function GET(req: NextRequest) {
  const auth = await verifyCronRequest(req, 'StateSnapshot');
  if (auth !== true) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const now = Date.now();
  try {
    const [halts, locks, directives, peaks, dustFlags, heartbeats, traderState, ringBuffer] = await Promise.all([
      getCronStateByPrefix('cron:haltUntil:'),
      getCronStateByPrefix('profit-lock:'),
      getCronStateByPrefix('alert-response:'),
      Promise.all([
        getCronStateByPrefix('poolNav:peak:'),
        getCronStateByPrefix('rebalance:peakValue:'),
      ]).then(([a, b]) => new Map([...a, ...b])),
      getCronStateByPrefix('stale-dust-flag:'),
      getCronStateByPrefix('cron:lastRun:'),
      getCronStateByPrefix('polymarket-edge:'),
      getCronState<Array<{ at: number; level: string; message: string }>>('alert-log:ring-buffer'),
    ]);

    const mapToItems = (m: Map<string, unknown>) =>
      [...m.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => toItem(k, v, now));

    const recentAlerts = (Array.isArray(ringBuffer) ? ringBuffer : [])
      .filter((e) => ['KILL', 'ERROR', 'WARN'].includes(e.level))
      .slice(-10)
      .map((e) => ({
        level: e.level,
        ageMinutes: Math.round((now - e.at) / 60_000),
        message: (e.message || '').slice(0, 200),
      }));

    const activeHalts = mapToItems(halts).filter((h) => h.expiresInMinutes && h.expiresInMinutes > 0);
    const activeDirectives = mapToItems(directives).filter((d) => d.active !== false);

    return NextResponse.json({
      ts: new Date(now).toISOString(),
      summary: {
        activeHalts: activeHalts.length,
        activeDirectives: activeDirectives.length,
        dustFlagsCount: dustFlags.size,
        recentAlertsCount: recentAlerts.length,
        oldestHeartbeatMinutes: Math.max(0, ...mapToItems(heartbeats).map((h) => h.ageMinutes ?? 0)),
      },
      halts: mapToItems(halts),
      locks: mapToItems(locks),
      directives: mapToItems(directives),
      peaks: mapToItems(peaks),
      dust: mapToItems(dustFlags),
      heartbeats: mapToItems(heartbeats),
      trader: mapToItems(traderState),
      recentAlerts,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
