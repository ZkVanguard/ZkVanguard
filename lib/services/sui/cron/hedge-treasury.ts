/**
 * SUI Community Pool — Hedge Treasury (BARREL RE-EXPORT).
 *
 * The 1538-LOC monolith split into 5 focused modules on 2026-07-19:
 *   - pool-transfer.ts     — returnUsdcToPool + transferUsdcFromPoolToAdmin
 *                            (+ owns HEDGE_MIN_OPEN_USDC constant)
 *   - hedge-lifecycle.ts   — getActiveHedges + settleActiveHedges
 *   - admin-swaps.ts       — replenishAdminUsdc + sellAssetForUsdc +
 *                            getAdminUsdcBalance + getAdminAssetValuesUsd +
 *                            getAdminNonUsdcUsdValue
 *   - pool-liquidity.ts    — readPoolLiquidityState + ensurePoolLiquidityForWithdraw
 *   - nav-oracle.ts        — attestExternalNav + aiDrivenResetDailyHedge
 *
 * This file remains as a re-export barrel so every prior caller keeps
 * working (`import { X } from '@/lib/services/sui/cron/hedge-treasury'`).
 * New code should prefer importing directly from the specific module.
 */
export { HEDGE_MIN_OPEN_USDC, returnUsdcToPool, transferUsdcFromPoolToAdmin } from '@/lib/services/sui/cron/pool-transfer';
export { getActiveHedges, settleActiveHedges } from '@/lib/services/sui/cron/hedge-lifecycle';
export {
  replenishAdminUsdc,
  sellAssetForUsdc,
  getAdminUsdcBalance,
  getAdminAssetValuesUsd,
  getAdminNonUsdcUsdValue,
} from '@/lib/services/sui/cron/admin-swaps';
export { readPoolLiquidityState, ensurePoolLiquidityForWithdraw } from '@/lib/services/sui/cron/pool-liquidity';
export { attestExternalNav, aiDrivenResetDailyHedge } from '@/lib/services/sui/cron/nav-oracle';
