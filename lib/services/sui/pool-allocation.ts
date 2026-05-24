/**
 * Pure SUI pool allocation composition, extracted from SuiCommunityPoolService.
 *
 *  - parseTargetAllocation: on-chain AI target (basis points → %), used as the
 *    fallback when the pool is empty / NAV ≈ 0.
 *  - computeLiveAllocation: real economic exposure as % of NAV (BTC/ETH/SUI by
 *    market value + a USDC bucket of idle pool/admin/BlueFin capital).
 *
 * No I/O — locked by test/unit/pool-allocation.test.ts.
 */
import type { SuiPoolAllocation } from '@/lib/types/sui-pool-types';

/** On-chain `current_allocation` bps fields → percentage target (defaults: BTC/ETH 30%, SUI/CRO 20%). */
export function parseTargetAllocation(alloc: Record<string, unknown> | undefined): SuiPoolAllocation {
  const a = alloc || {};
  return {
    BTC: Number(a.btc_bps || 3000) / 100,
    ETH: Number(a.eth_bps || 3000) / 100,
    SUI: Number(a.sui_bps || 2000) / 100,
    CRO: Number(a.cro_bps || 2000) / 100,
  };
}

/**
 * Live composition as % of NAV. Falls back to the AI target when NAV ≈ 0
 * (empty / pre-deposit pool). USDC bucket = USD-denominated capital not yet
 * rotated into a basket asset.
 */
export function computeLiveAllocation(args: {
  assetUsdValue: Record<string, number>;
  usdcBucket: number;
  totalNavUsdc: number;
  target: SuiPoolAllocation;
}): SuiPoolAllocation {
  const { assetUsdValue, usdcBucket, totalNavUsdc, target } = args;
  if (totalNavUsdc <= 0.01) return target;
  const pct = (v: number) => Math.round(((v || 0) / totalNavUsdc) * 10000) / 100;
  return {
    BTC: pct(assetUsdValue.BTC),
    ETH: pct(assetUsdValue.ETH),
    SUI: pct(assetUsdValue.SUI),
    CRO: 0,
    USDC: pct(usdcBucket),
  };
}
