/**
 * Verifies the small-pool relief on the polymarket-edge-trader free-
 * collateral gate.
 *
 * Original bug: hard-coded MIN_FREE_COLLATERAL_USD=15 with BASE_STAKE=5
 * blocked a $50-NAV pool with ~$13 free BlueFin collateral. Trader
 * silently no-oped every 5 minutes even though the actual stake it
 * would place was $5.
 *
 * The gate is now:
 *   effectiveMin = min(MIN_FREE_COLLATERAL_USD, BASE_STAKE_USD * 2)
 *
 * Meaning: "we need at least 2 stakes worth of free collateral, capped
 * at the operator's absolute floor". This lets small pools trade while
 * preserving large-pool safety.
 */

// Pure math extract from app/api/cron/polymarket-edge-trader/route.ts.
// Not imported directly because the route module has heavy side-effects
// (env parsing, cron state, etc.). This mirrors the exact formula and
// is intentionally trivially small.
function effectiveMinFree(
  minFreeCollateralUsd: number,
  baseStakeUsd: number,
): number {
  return Math.min(minFreeCollateralUsd, baseStakeUsd * 2);
}

describe('polymarket-edge-trader effective min-free collateral gate', () => {
  it('reproduces the observed prod bug at default env', () => {
    // The default config that was in production
    const configured = 15;
    const baseStake = 5;
    // A $50 pool with ~$29 BlueFin collateral, ~$16 locked on hedge id 190
    // → ~$13 free
    const free = 13;

    // Under the OLD gate the trader would refuse
    const oldGate = free < configured;
    expect(oldGate).toBe(true); // BLOCKED under old logic

    // Under the NEW gate the trader can trade
    const effective = effectiveMinFree(configured, baseStake);
    expect(effective).toBe(10);
    expect(free < effective).toBe(false); // ALLOWED
  });

  it('preserves operator setting on large pools where MIN < 2×stake', () => {
    // Big-pool operator running with a small BASE_STAKE (fine, they
    // want small individual trades) but a defensive MIN_FREE floor of $10
    const effective = effectiveMinFree(10, 20);
    // BASE_STAKE_USD * 2 = 40 exceeds MIN = 10 → operator's floor wins
    expect(effective).toBe(10);
  });

  it('respects operator loose setting (MIN below 2×stake) on small pools', () => {
    // Operator explicitly set MIN_FREE to 5 for aggressive small-pool trading
    const effective = effectiveMinFree(5, 5);
    // BASE_STAKE_USD * 2 = 10 exceeds MIN = 5 → operator floor still wins
    expect(effective).toBe(5);
  });

  it('applies relief when configured MIN is above 2× stake (the original bug)', () => {
    // Any configuration where the absolute floor is higher than 2×stake
    // gets relaxed. This is the whole point of the fix.
    expect(effectiveMinFree(15, 5)).toBe(10);
    expect(effectiveMinFree(50, 10)).toBe(20);
    expect(effectiveMinFree(100, 25)).toBe(50);
  });

  it('handles zero stake defensively (rare mis-config)', () => {
    // BASE_STAKE_USD=0 would collapse the gate to 0 — undesirable, but the
    // higher-level trader logic rejects zero stakes on its own path. Verify
    // the math doesn't panic.
    expect(effectiveMinFree(15, 0)).toBe(0);
    expect(Number.isFinite(effectiveMinFree(15, 0))).toBe(true);
  });
});
