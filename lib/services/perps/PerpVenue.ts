/**
 * Common abstraction over perp venues (BlueFin, Hyperliquid, dYdX, CEX bridges).
 *
 * Scope: enough to make routing decisions and surface comparative liquidity
 * to operators. Full live-trading parity across venues is a multi-week
 * integration (each venue has its own signing scheme, margin model, funding
 * cadence) — out of scope for this skeleton.
 *
 * Today's implementers:
 *   BluefinService            (existing, read+write — signs via SUI wallet)
 *   HyperliquidService        (new, read-only — public REST)
 *
 * Future implementers:
 *   dYdXService               (Cosmos, separate wallet)
 *   CexBridgeService          (Binance/Bybit perps via bridged USDC)
 */

export interface PerpMarketSnapshot {
  symbol: string;            // canonical: BTC-PERP / ETH-PERP / SOL-PERP
  price: number;             // mark or last, USD
  openInterestUsd: number;   // total OI across the venue
  fundingRate: number;       // per 8h, decimal (0.0001 = 1bps)
  volume24hUsd?: number;     // optional — informational only
  venue: string;             // 'bluefin' | 'hyperliquid' | ...
}

export interface PerpVenue {
  /** Human-readable name for logs + Discord */
  readonly name: string;

  /** Fetch market snapshot for one symbol (best-effort; returns null on error). */
  getMarketSnapshot(symbol: string): Promise<PerpMarketSnapshot | null>;

  /** Whether this venue can execute trades right now (auth + connection). */
  canTrade(): Promise<boolean>;
}

/** Sub-interface for venues that can open positions. */
export interface PerpTradingResult {
  success: boolean;
  venue: string;
  orderId?: string;
  filledNotionalUsd?: number;
  fees?: number;
  error?: string;
}

export interface TradingPerpVenue extends PerpVenue {
  openPosition(params: {
    symbol: string;
    side: Side;
    notionalUsd: number;
    leverage: number;
    reason?: string;
  }): Promise<PerpTradingResult>;
}

export type Side = 'LONG' | 'SHORT';

/**
 * Canonical symbol normaliser. Venues use slightly different naming:
 *   BlueFin     BTC-PERP
 *   Hyperliquid BTC
 *   dYdX        BTC-USD
 * Internal code always uses the BlueFin form; venue clients translate.
 */
export function toCanonical(s: string): string {
  const u = s.toUpperCase();
  if (u.endsWith('-PERP')) return u;
  if (u.endsWith('-USD')) return `${u.slice(0, -4)}-PERP`;
  return `${u}-PERP`;
}

export function toBareAsset(s: string): string {
  const u = s.toUpperCase();
  return u.replace(/-PERP$|-USD$|PERP$/, '');
}
