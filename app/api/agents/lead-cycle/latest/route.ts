/**
 * GET /api/agents/lead-cycle/latest
 *
 * Read-only surface for the most recent LeadAgent autonomous cycle.
 * The cycle runs every 30 min inlined at the tail of the sui-community-
 * pool cron — invokes Risk → Hedging consensus → Hedging → Settlement →
 * Reporting in sequence and persists the summary to cron_state under
 * `lead-cycle:last-decision`.
 *
 * Returns the persisted summary + a heartbeat-age check so consumers
 * can tell if the cycle is stale.
 */

import { NextResponse } from 'next/server';
import { getCronStateOr } from '@/lib/db/cron-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LeadCycleSnapshot {
  ts: number;
  success?: boolean;
  ranAt?: string;
  durationMs?: number;
  chain?: string;
  portfolioId?: number;
  riskScore?: number;
  riskLevel?: string;
  hedgeRecommendations?: number;
  needsRebalance?: boolean;
  settlementsProcessed?: number;
  zkProofs?: number;
  leadSummary?: string;
  error?: string;
}

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  const [snapshot, heartbeat] = await Promise.all([
    getCronStateOr<LeadCycleSnapshot | null>('lead-cycle:last-decision', null),
    getCronStateOr<number>('cron:lastRun:lead-cycle', 0),
  ]);

  if (!snapshot) {
    return NextResponse.json({
      success: false,
      reason: 'No LeadAgent cycle has run yet — wait for first sui-community-pool cron tick (≤30min)',
      heartbeatAgeMs: heartbeat ? now - heartbeat : null,
    });
  }

  const cycleAgeMs = now - snapshot.ts;
  const cycleAgeMin = Math.round(cycleAgeMs / 60_000);
  const isStale = cycleAgeMs > 60 * 60 * 1000;  // > 1h is stale

  return NextResponse.json({
    success: true,
    cycle: snapshot,
    freshness: {
      cycleAgeMs,
      cycleAgeMin,
      isStale,
      heartbeatAgeMs: heartbeat ? now - heartbeat : null,
    },
  });
}
