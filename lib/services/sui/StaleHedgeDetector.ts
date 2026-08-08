/**
 * StaleHedgeDetector — age + regime-change based force-close signal.
 *
 * ## Why
 *
 * The 32-day-old ETH SHORT survived every drift check because drift-close
 * compares direction against *current* signal only. When the world has
 * flipped 3-5 times since a position opened, "the current signal doesn't
 * contradict" is a weak defence — the position was opened for a stale
 * thesis and nothing has actively reaffirmed it.
 *
 * ## Rule
 *
 * A hedge is stale when EITHER:
 *   (a) age > STALE_AGE_DAYS (default 7)
 *       AND ≥ STALE_MIN_FLIPS signal flips for that asset since open (default 2)
 *       AND current signal for the asset contradicts the hedge side
 *   (b) age > STALE_MAX_AGE_DAYS (default 30) — regardless of alignment.
 *       An "aligned-today" 57-day hedge is still a stale thesis; the
 *       market has flipped many times since open and any current
 *       alignment is coincidence, not conviction.
 *
 * Stale hedges are force-closed and Discord WARN fires.
 */

export type Side = 'LONG' | 'SHORT';

export interface StaleHedgeInput {
  activeHedges: Array<{
    id: number | string;
    asset: string;
    side: Side;
    openedAt: Date;
    notionalUsd: number;
  }>;
  signalFlipsPerAsset: Record<string, number>;
  currentSignals: Record<string, { direction: 'UP' | 'DOWN'; confidence: number }>;
  now?: Date;
  staleAgeDays?: number;
  staleMinFlips?: number;
  /** Absolute age ceiling — any hedge older than this is stale regardless
   *  of current signal alignment. Defaults to STALE_HEDGE_MAX_AGE_DAYS (30). */
  staleMaxAgeDays?: number;
}

export interface StaleHedge {
  id: number | string;
  asset: string;
  side: Side;
  ageDays: number;
  flipsSinceOpen: number;
  reason: string;
}

const DEFAULT_STALE_AGE_DAYS = Number(process.env.STALE_HEDGE_AGE_DAYS) || 7;
const DEFAULT_STALE_MIN_FLIPS = Number(process.env.STALE_HEDGE_MIN_FLIPS) || 2;
const DEFAULT_STALE_MAX_AGE_DAYS = Number(process.env.STALE_HEDGE_MAX_AGE_DAYS) || 30;

function contradictsSide(side: Side, direction: 'UP' | 'DOWN'): boolean {
  return (side === 'LONG' && direction === 'DOWN') || (side === 'SHORT' && direction === 'UP');
}

export async function detectStaleHedges(input: StaleHedgeInput): Promise<StaleHedge[]> {
  const now = input.now ?? new Date();
  const ageThreshold = (input.staleAgeDays ?? DEFAULT_STALE_AGE_DAYS) * 24 * 3600 * 1000;
  const maxAgeThreshold = (input.staleMaxAgeDays ?? DEFAULT_STALE_MAX_AGE_DAYS) * 24 * 3600 * 1000;
  const minFlips = input.staleMinFlips ?? DEFAULT_STALE_MIN_FLIPS;

  const stale: StaleHedge[] = [];
  for (const h of input.activeHedges) {
    const ageMs = now.getTime() - h.openedAt.getTime();
    const ageDays = ageMs / (24 * 3600 * 1000);
    const flips = input.signalFlipsPerAsset[h.asset] ?? 0;
    const current = input.currentSignals[h.asset];

    // Rule (b): absolute max-age — coincidental alignment on a 57-day
    // hedge isn't conviction. Applies even when currentSignals lacks the
    // asset (unlike rule (a) which needs a signal to test contradiction).
    if (ageMs >= maxAgeThreshold) {
      stale.push({
        id: h.id,
        asset: h.asset,
        side: h.side,
        ageDays: Math.round(ageDays * 10) / 10,
        flipsSinceOpen: flips,
        reason: `stale: age ${ageDays.toFixed(1)}d exceeds max ${(maxAgeThreshold / 86_400_000)}d (thesis is coincidental at this age, close regardless of signal)`,
      });
      continue;
    }

    // Rule (a): contradicted-side + flip-count + age
    if (ageMs < ageThreshold) continue;
    if (flips < minFlips) continue;
    if (!current) continue;
    if (!contradictsSide(h.side, current.direction)) continue;

    stale.push({
      id: h.id,
      asset: h.asset,
      side: h.side,
      ageDays: Math.round(ageDays * 10) / 10,
      flipsSinceOpen: flips,
      reason: `stale: age ${ageDays.toFixed(1)}d, ${flips} signal flips since open, current signal ${current.direction} conf=${current.confidence}% contradicts ${h.side}`,
    });
  }
  return stale;
}
