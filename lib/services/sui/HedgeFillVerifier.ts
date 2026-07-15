/**
 * HedgeFillVerifier — post-open ground truth for BlueFin hedges.
 *
 * ## Why
 *
 * BlueFin returns an `orderHash` synchronously even when the matching
 * engine silently drops the order (see DEPLOY_RUNBOOK.md Appendix Y).
 * The historical damage: 200+ closed SUI hedges with $0 realized PnL
 * because the exchange never actually opened them. The pool ran its
 * entire ATH rally with zero real downside protection.
 *
 * ## What
 *
 * After every openHedge/closeHedge call, poll BlueFin.getPositions()
 * at t+2s and t+5s. If neither poll shows the expected size delta,
 * the order is phantom. Callers mark the DB row status='phantom' with
 * reason='no_fill_observed'.
 *
 * Aggregate phantom rate is exported for /api/health/production to
 * gate on: rate > 1% over last 24h → Discord KILL + halt auto-hedge.
 */
import { logger } from '@/lib/utils/logger';

export interface VerifyFillArgs {
  hedgeId: number | string;
  symbol: string;
  expectedSizeDelta: number;
  pollAtMs: number[]; // typically [2000, 5000]
  getPositions: () => Promise<Array<{ symbol: string; size: number }>>;
  toleranceBps?: number; // default 100 bps = 1%
  sleepFn?: (ms: number) => Promise<void>; // injectable for tests
}

export interface VerifyFillResult {
  phantom: boolean;
  reason: string;
  observedSize: number | null;
  expectedSize: number;
  pollsAttempted: number;
}

const DEFAULT_TOLERANCE_BPS = 100;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyFill(args: VerifyFillArgs): Promise<VerifyFillResult> {
  const tolerance = (args.toleranceBps ?? DEFAULT_TOLERANCE_BPS) / 10_000;
  const sleep = args.sleepFn ?? defaultSleep;
  const expected = Math.abs(args.expectedSizeDelta);
  const minAcceptable = expected * (1 - tolerance);

  let observedSize: number | null = null;
  let polls = 0;

  for (const delay of args.pollAtMs) {
    if (delay > 0) await sleep(delay);
    polls++;
    try {
      const positions = await args.getPositions();
      const match = positions.find((p) => p.symbol === args.symbol);
      if (match) {
        const size = Math.abs(Number(match.size ?? 0));
        observedSize = size;
        if (size >= minAcceptable) {
          return {
            phantom: false,
            reason: 'fill_observed',
            observedSize: size,
            expectedSize: expected,
            pollsAttempted: polls,
          };
        }
      }
    } catch (err) {
      logger.warn('[HedgeFillVerifier] getPositions poll failed', {
        hedgeId: args.hedgeId,
        symbol: args.symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    phantom: true,
    reason: observedSize === null ? 'no_fill_observed' : 'partial_fill_below_tolerance',
    observedSize,
    expectedSize: expected,
    pollsAttempted: polls,
  };
}

/** Compute phantom rate over recent hedge rows. */
export function computePhantomRate(rows: Array<{ status: string }>): { rate: number; phantoms: number; total: number } {
  const total = rows.length;
  if (total === 0) return { rate: 0, phantoms: 0, total: 0 };
  const phantoms = rows.filter((r) => r.status === 'phantom').length;
  return { rate: phantoms / total, phantoms, total };
}
