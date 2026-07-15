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
 * A hedge is stale when:
 *   - age > STALE_AGE_DAYS (default 7)
 *   - AND ≥ STALE_MIN_FLIPS signal flips for that asset since open (default 2)
 *   - AND current signal for the asset contradicts the hedge side
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

function contradictsSide(side: Side, direction: 'UP' | 'DOWN'): boolean {
  return (side === 'LONG' && direction === 'DOWN') || (side === 'SHORT' && direction === 'UP');
}

export async function detectStaleHedges(input: StaleHedgeInput): Promise<StaleHedge[]> {
  const now = input.now ?? new Date();
  const ageThreshold = (input.staleAgeDays ?? DEFAULT_STALE_AGE_DAYS) * 24 * 3600 * 1000;
  const minFlips = input.staleMinFlips ?? DEFAULT_STALE_MIN_FLIPS;

  const stale: StaleHedge[] = [];
  for (const h of input.activeHedges) {
    const ageMs = now.getTime() - h.openedAt.getTime();
    const ageDays = ageMs / (24 * 3600 * 1000);
    if (ageMs < ageThreshold) continue;

    const flips = input.signalFlipsPerAsset[h.asset] ?? 0;
    if (flips < minFlips) continue;

    const current = input.currentSignals[h.asset];
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
