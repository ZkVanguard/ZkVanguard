/**
 * Small pure helpers shared across the polymarket-edge-trader handlers.
 *
 * Extracted from route.ts on 2026-08-10. Nothing side-effectful except
 * recordSkip (which writes cron_state for operator diagnostics).
 */
import { setCronState } from '@/lib/db/cron-state';
import type { BluefinPosition } from '@/lib/services/sui/BluefinService';
import type { AggregatedPrediction } from '@/lib/services/market-data/PredictionAggregatorService';
import { KEY_LAST_SKIP } from './config';

export function quantize(qty: number, step: number): number {
  return Math.floor(qty / step) * step;
}

export function findActivePosition(
  positions: BluefinPosition[],
  symbol: string,
): BluefinPosition | undefined {
  return positions.find((p) => p.symbol === symbol && Number(p.size) > 0);
}

/** Map an aggregator recommendation to a hedge side. WAIT → null. */
export function recommendationToSide(
  rec: AggregatedPrediction['recommendation'],
): 'LONG' | 'SHORT' | null {
  if (rec.includes('SHORT')) return 'SHORT';
  if (rec.includes('LONG')) return 'LONG';
  return null;
}

export function isActionable(rec: AggregatedPrediction['recommendation']): boolean {
  return rec.startsWith('HEDGE_') || rec.startsWith('STRONG_');
}

export function utcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Records why the current tick did not open a trade. Gives operators a
 * single lookup ("why is the trader idle?") without grepping serverless
 * logs across many invocations. Non-critical — never fails the tick.
 */
export async function recordSkip(action: string, reason: string): Promise<void> {
  try {
    await setCronState(KEY_LAST_SKIP, {
      at: Date.now(),
      action,
      reason,
    });
  } catch {
    /* non-critical — don't fail the tick because we couldn't record a diagnostic */
  }
}
