/**
 * Pure position-sizing for the autonomous Polymarket-edge perp trader.
 *
 * Extracted from app/api/cron/polymarket-edge-trader/route.ts so the stake math
 * — Kelly-style compounding × the aggregator's size multiplier, capped by free
 * collateral and an absolute max, floored at the base stake — has a single
 * source of truth and a test net (test/unit/edge-sizing.test.ts). No I/O.
 *
 *   compoundMul = clamp(1 + cumPnL/baseStake, 1, 5)
 *   stake       = clamp_to_caps(baseStake × compoundMul × sizeMultiplier),
 *                 floored at baseStake
 */
export function computeEdgeStake(args: {
  baseStakeUsd: number;
  totalPnlUsd: number;
  sizeMultiplier: number;
  freeCollateral: number;
  stakePctOfFree: number;
  maxStakeUsd: number;
}): { compoundMul: number; stakeUsd: number } {
  const { baseStakeUsd, totalPnlUsd, sizeMultiplier, freeCollateral, stakePctOfFree, maxStakeUsd } = args;
  const compoundMul = Math.max(1, Math.min(5, 1 + totalPnlUsd / Math.max(1, baseStakeUsd)));
  const targetStake = Math.min(
    baseStakeUsd * compoundMul * sizeMultiplier,
    freeCollateral * stakePctOfFree,
    maxStakeUsd,
  );
  const stakeUsd = Math.max(baseStakeUsd, targetStake);
  return { compoundMul, stakeUsd };
}
