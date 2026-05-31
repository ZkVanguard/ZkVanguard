/**
 * Per-symbol perp-hedgeability clamp.
 *
 * BlueFin enforces per-symbol minQty: BTC-PERP 0.001 (~$73 notional),
 * ETH-PERP 0.01 (~$30), SUI-PERP 1 (~$4). When NAV × allocation% can't
 * clear an asset's minQty at the tier-capped leverage, the perp leg of
 * that asset is unhedgeable on the current cycle — opening only the
 * spot leg leaves the pool naked-long that asset even when the AI
 * sentiment is BEARISH and the cron tries to short.
 *
 * Fix: before swap + hedge, zero the allocation for unhedgeable assets
 * and redistribute their share proportionally to the hedgeable ones.
 * Two effects:
 *   1. Step 7 (rebalance swaps) doesn't acquire spot exposure we can't
 *      neutralize.
 *   2. Step 8 (auto-hedge) only fires for assets that will actually fill.
 *
 * Pure function — no I/O. Returns the adjusted allocations + a report of
 * which assets were dropped + why.
 */
export interface PerpSpec {
  minQuantity: number;
  stepSize: number;
}

export interface ClampInput {
  navUsd: number;
  allocations: Record<string, number>; // asset → pct (sums to 100)
  prices: Record<string, number>;       // asset → USD price
  hedgeRatio: number;                   // 0.5 (large) or 1.0 (tiny)
  leverage: number;                     // tier-capped (5 for tiny, 3 for small, etc)
  perpSpecs: Record<string, PerpSpec>;  // asset → { minQuantity, stepSize }
}

export interface ClampOutput {
  allocations: Record<string, number>;
  dropped: Array<{
    asset: string;
    originalPct: number;
    notionalNeeded: number;
    notionalAvailable: number;
    reason: string;
  }>;
  redistributed: boolean;
}

/**
 * Returns true iff a perp position of (NAV × alloc% × ratio) can be
 * opened on BlueFin for this asset at the given leverage.
 *
 * The check mirrors the cron's actual sizing math:
 *   hedgeValueUSD = NAV × alloc% × ratio   ← documented notional
 *   sizeBase      = (hedgeValueUSD × leverage) / price
 *   snappedSize   = floor(sizeBase / step) × step
 *   hedgeable iff snappedSize >= minQuantity
 *
 * `leverage` multiplies the notional in the sizing math (line 1690 of
 * sui-community-pool/route.ts). At tiny-tier 5x, a $14 hedgeValueUSD
 * BTC alloc produces $70 effective notional / $73k = 0.000958 BTC,
 * which floors to 0 step (step 0.001) → unhedgeable.
 */
export function isHedgeable(
  navUsd: number,
  allocationPct: number,
  hedgeRatio: number,
  leverage: number,
  price: number,
  spec: PerpSpec,
): { ok: boolean; sizeBase: number; snappedSize: number; notional: number } {
  if (allocationPct <= 0 || price <= 0) return { ok: false, sizeBase: 0, snappedSize: 0, notional: 0 };
  const hedgeValueUSD = navUsd * (allocationPct / 100) * hedgeRatio;
  const effectiveValue = hedgeValueUSD * leverage;
  const sizeBase = effectiveValue / price;
  const snappedSize = Math.floor(sizeBase / spec.stepSize) * spec.stepSize;
  const notional = snappedSize * price;
  return { ok: snappedSize >= spec.minQuantity, sizeBase, snappedSize, notional };
}

/**
 * Clamp allocations to assets that can clear BlueFin's minQty at this
 * NAV + leverage. Dropped-asset shares are redistributed proportionally
 * to the surviving assets, preserving the 100% total.
 *
 * Edge cases:
 *   - If NO asset is hedgeable, returns the original allocations
 *     unchanged with redistributed=false. Caller decides whether to
 *     skip the entire cycle or fall back to all-USDC.
 *   - If exactly one asset is hedgeable, it gets the full 100% alloc.
 *   - If an asset's price is missing (price = 0), it's treated as
 *     unhedgeable and dropped (defensive — price feed glitch shouldn't
 *     authorise unhedged exposure).
 */
export function clampAllocationsToHedgeable(input: ClampInput): ClampOutput {
  const { navUsd, allocations, prices, hedgeRatio, leverage, perpSpecs } = input;
  const assets = Object.keys(allocations);

  const dropped: ClampOutput['dropped'] = [];
  const survivors: string[] = [];
  let droppedPctSum = 0;
  let survivorPctSum = 0;

  for (const asset of assets) {
    const pct = Number(allocations[asset] || 0);
    if (pct <= 0) continue; // already zero — don't list as dropped
    const spec = perpSpecs[asset];
    const price = Number(prices[asset] || 0);
    if (!spec) {
      // Unknown symbol — keep allocation; caller's responsibility.
      survivors.push(asset);
      survivorPctSum += pct;
      continue;
    }
    const check = isHedgeable(navUsd, pct, hedgeRatio, leverage, price, spec);
    if (check.ok) {
      survivors.push(asset);
      survivorPctSum += pct;
    } else {
      dropped.push({
        asset,
        originalPct: pct,
        notionalNeeded: spec.minQuantity * price,
        notionalAvailable: navUsd * (pct / 100) * hedgeRatio * leverage,
        reason: price <= 0
          ? `no price for ${asset}`
          : `NAV $${navUsd.toFixed(2)} × ${pct}% × ratio ${hedgeRatio} × ${leverage}x lev = ${check.snappedSize} ${asset} < minQty ${spec.minQuantity}`,
      });
      droppedPctSum += pct;
    }
  }

  if (dropped.length === 0) {
    return { allocations: { ...allocations }, dropped: [], redistributed: false };
  }

  // No survivor — return originals; caller falls back.
  if (survivors.length === 0 || survivorPctSum <= 0) {
    return { allocations: { ...allocations }, dropped, redistributed: false };
  }

  // Redistribute droppedPctSum proportionally across survivors.
  const adjusted: Record<string, number> = {};
  for (const asset of assets) adjusted[asset] = 0;
  let allocatedSoFar = 0;
  for (let i = 0; i < survivors.length; i++) {
    const s = survivors[i];
    const isLast = i === survivors.length - 1;
    const originalSurvPct = Number(allocations[s] || 0);
    const share = isLast
      ? 100 - allocatedSoFar          // absorb rounding remainder in last asset
      : Math.round(((originalSurvPct / survivorPctSum) * 100 + Number.EPSILON) * 100) / 100;
    adjusted[s] = share;
    allocatedSoFar += share;
  }

  return { allocations: adjusted, dropped, redistributed: true };
}
