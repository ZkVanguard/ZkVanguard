/**
 * Pure NAV / share-price math for the SUI USDC pool.
 *
 * Extracted from SuiCommunityPoolService so the platform's most load-bearing
 * money computation has a test net (test/unit/pool-nav.test.ts). The COMPONENTS
 * (on-chain idle USDC, off-chain BlueFin collateral, admin assets) are gathered
 * with live I/O in the service; this module only combines and sanity-checks
 * them, so it is fully unit-testable without the DB or signing keys.
 */

/** Reject NAV above $10B — beyond this the on-chain u64 fee/cap math can wrap. */
export const MAX_REASONABLE_NAV_USDC = 10_000_000_000;
/** Reject share price above $1M — a sane pool starts at $1.00/share. */
export const MAX_REASONABLE_SHARE_PRICE = 1_000_000;

/** Total NAV = idle pool USDC + off-chain capital (BlueFin + admin) + BlueFin uPnL/margin. */
export function composeNavUsdc(
  balanceUsdc: number,
  offChainPoolCapital: number,
  bluefinValueUsdc: number,
): number {
  return balanceUsdc + offChainPoolCapital + bluefinValueUsdc;
}

/** Share price = NAV / shares; an empty pool is $1.00/share by convention. */
export function computeSharePrice(navUsdc: number, totalShares: number): number {
  return totalShares > 0 ? navUsdc / totalShares : 1.0;
}

/** Mainnet guard: reject impossible NAV / share price (oracle attack / overflow). */
export function isNavSane(navUsdc: number, sharePriceUsdc: number): boolean {
  return navUsdc <= MAX_REASONABLE_NAV_USDC && sharePriceUsdc <= MAX_REASONABLE_SHARE_PRICE;
}
