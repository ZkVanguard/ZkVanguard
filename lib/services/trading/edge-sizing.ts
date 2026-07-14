/**
 * Pure position-sizing for the autonomous Polymarket-edge perp trader.
 *
 * Extracted from app/api/cron/polymarket-edge-trader/route.ts so the stake math
 * — Kelly-style compounding × the aggregator's size multiplier, capped by free
 * collateral and an absolute max, floored at the effective base stake — has
 * a single source of truth and a test net (test/unit/edge-sizing.test.ts).
 * No I/O.
 *
 *   effectiveBase = max(baseStakeUsd, freeCollateral × dynamicBasePct)
 *   compoundMul   = clamp(1 + cumPnL/effectiveBase, 1, 5)
 *   stake         = clamp_to_caps(effectiveBase × compoundMul × sizeMultiplier),
 *                   floored at effectiveBase
 *
 * The `effectiveBase` term is the AUTONOMOUS EXPONENTIAL GROWTH driver.
 * Historically stake was pinned at baseStakeUsd unless compoundMul kicked
 * in via positive cumPnL — meaning on a small NAV the trader never
 * scaled with free collateral. With dynamicBasePct > 0, stake grows
 * proportionally to free (up to freeCollateral × stakePctOfFree cap),
 * so every winning trade increases pool → increases stake → increases
 * per-trade EV → compound growth.
 *
 * Set dynamicBasePct = 0 for the legacy pinned-baseStake behaviour.
 */
export function computeEdgeStake(args: {
  baseStakeUsd: number;
  totalPnlUsd: number;
  sizeMultiplier: number;
  freeCollateral: number;
  stakePctOfFree: number;
  maxStakeUsd: number;
  dynamicBasePct?: number;
}): { compoundMul: number; stakeUsd: number } {
  const {
    baseStakeUsd,
    totalPnlUsd,
    sizeMultiplier,
    freeCollateral,
    stakePctOfFree,
    maxStakeUsd,
  } = args;
  const dynamicBasePct = args.dynamicBasePct ?? 0;
  const effectiveBase = Math.max(baseStakeUsd, freeCollateral * dynamicBasePct);
  const compoundMul = Math.max(1, Math.min(5, 1 + totalPnlUsd / Math.max(1, effectiveBase)));
  const targetStake = Math.min(
    effectiveBase * compoundMul * sizeMultiplier,
    freeCollateral * stakePctOfFree,
    maxStakeUsd,
  );
  const stakeUsd = Math.max(effectiveBase, targetStake);
  return { compoundMul, stakeUsd };
}
