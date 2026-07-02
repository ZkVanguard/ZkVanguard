/**
 * Autonomous trader (polymarket-edge-trader) asset registry.
 *
 * These constants are contract-shaped by BlueFin's per-symbol MARKET_CONFIG:
 * every value here mirrors a real BlueFin invariant (step size, minimum
 * order quantity) that must be known before signing. Any drift between
 * this file and BluefinService.BLUEFIN_PAIRS causes silent order rejection
 * at the matching engine.
 *
 * Kept here (not in the cron route) so agent-side code can resolve the
 * trader's live asset universe without importing an app/api/** route
 * module.
 */

export type SupportedAsset = 'BTC' | 'ETH' | 'SUI' | 'SOL';

export const DEFAULT_TRADER_ASSETS: SupportedAsset[] = ['BTC', 'ETH', 'SUI', 'SOL'];

/**
 * Effective trader universe honouring the POLYMARKET_EDGE_ASSETS env
 * override. Read once per process; env vars don't change at runtime.
 */
function resolveTraderAssets(): SupportedAsset[] {
  const raw = (process.env.POLYMARKET_EDGE_ASSETS || '').trim();
  if (!raw) return DEFAULT_TRADER_ASSETS;
  const allowed = new Set(DEFAULT_TRADER_ASSETS);
  const parsed = raw
    .split(',')
    .map(s => s.trim().toUpperCase() as SupportedAsset)
    .filter(a => allowed.has(a));
  return parsed.length ? parsed : DEFAULT_TRADER_ASSETS;
}

export const SUPPORTED_ASSETS: SupportedAsset[] = resolveTraderAssets();

/** BlueFin per-asset minimum order quantity — see BluefinService BLUEFIN_PAIRS. */
export const ASSET_MIN_QTY: Record<SupportedAsset, number> = {
  BTC: 0.001,
  ETH: 0.01,
  SUI: 1,
  SOL: 0.1,
};

/** Step size — identical to minQty on BlueFin, kept as separate export for clarity at call sites. */
export const ASSET_STEP: Record<SupportedAsset, number> = ASSET_MIN_QTY;
