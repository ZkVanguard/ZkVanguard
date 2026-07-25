/**
 * Fetch active pool hedges with live BlueFin overlay.
 *
 * Extracted from app/api/sui/community-pool/route.ts (was 200 LOC inline
 * in a 2100-LOC route file). Returns dashboard-shaped rows for every
 * active perp hedge on the pool, prioritizing venue truth over stale DB
 * columns.
 *
 * Overlay priority for currentPrice + currentPnl:
 *   1. BlueFin venue snapshot (markPrice + unrealizedPnl from matching
 *      engine, includes funding settlement)
 *   2. Live spot recompute — (entry - mark) × size × sign — when the
 *      venue position isn't matchable but we still have a fresh price
 *   3. DB column — last resort, logged as stale fallback
 *
 * DB's current_price / current_pnl columns are updated by a separate
 * cron and can drift for hours (observed 2026-06-21 ETH SHORT showing
 * +$2.95 implying ETH at $1319 — obviously stale). Always overlay.
 */
import { logger } from '@/lib/utils/logger';

export interface PoolHedge {
  id: number;
  market: string;
  side: 'LONG' | 'SHORT';
  size: number;
  notionalValue: number;
  leverage: number;
  entryPrice: number;
  currentPrice: number | null;
  currentPnl: number;
  openedAt: string;
  source: 'bluefin-perp' | 'on-chain-mirror';
}

export async function fetchActivePoolHedges(): Promise<PoolHedge[]> {
  // Lazy imports keep the cold-start fast for routes that never hit this.
  const { query } = await import('@/lib/db/postgres');
  try {
    const rows = await query<{
      id: number; market: string; side: string;
      size: string | number; notional_value: string | number;
      leverage: string | number; entry_price: string | number | null;
      current_price: string | number | null; current_pnl: string | number;
      created_at: Date; hedge_id_onchain: string | null;
    }>(
      `SELECT id, market, side, size, notional_value, leverage, entry_price,
              current_price, current_pnl, created_at, hedge_id_onchain
         FROM hedges
        WHERE chain = 'sui'
          AND status = 'active'
          AND market LIKE '%-PERP'
        ORDER BY notional_value DESC
        LIMIT 20`,
    );

    const baseRows = rows.map((r) => ({
      id: r.id,
      market: String(r.market || ''),
      side: (String(r.side || '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG') as 'LONG' | 'SHORT',
      size: Number(r.size),
      notionalValue: Number(r.notional_value),
      leverage: Number(r.leverage),
      entryPrice: r.entry_price == null ? 0 : Number(r.entry_price),
      // DB columns are FALLBACK only — see live overlay below.
      dbCurrentPrice: r.current_price == null ? null : Number(r.current_price),
      dbCurrentPnl: Number(r.current_pnl ?? 0),
      openedAt: (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)),
      source: (r.hedge_id_onchain ? 'on-chain-mirror' : 'bluefin-perp') as 'on-chain-mirror' | 'bluefin-perp',
    }));

    // ── LIVE OVERLAY ────────────────────────────────────────────────────
    let venuePositions: Array<{
      symbol?: unknown; side?: unknown;
      markPrice?: unknown; unrealizedPnl?: unknown;
      entryPrice?: unknown; size?: unknown; leverage?: unknown;
    }> = [];
    try {
      const { safeBluefinSnapshot } = await import('@/lib/services/sui/bluefin-read-safe');
      const network: 'mainnet' | 'testnet' =
        (process.env.SUI_NETWORK as 'mainnet' | 'testnet') === 'testnet' ? 'testnet' : 'mainnet';
      const snap = await safeBluefinSnapshot({
        network,
        onChainHasExposure: baseRows.length > 0,
      });
      venuePositions = snap.positions as typeof venuePositions;
    } catch (snapErr) {
      logger.debug('[pool-hedges] BlueFin snapshot unavailable for hedge overlay', {
        error: snapErr instanceof Error ? snapErr.message : String(snapErr),
      });
    }

    // (symbol, side) → venue position lookup. Pull every field the API
    // surfaces so a stale DB row can't ship wrong entry price
    // (observed 2026-06-21: DB entry $1664 vs venue truth $2016).
    const venueLookup = new Map<string, {
      markPrice: number; uPnL: number;
      entryPrice: number; size: number; leverage: number;
    }>();
    for (const p of venuePositions) {
      const symbol = String(p.symbol || '').toUpperCase();
      const side = String(p.side || '').toUpperCase();
      if (!symbol) continue;
      const markPrice = Number(p.markPrice ?? 0) || 0;
      const uPnL = Number(p.unrealizedPnl ?? 0) || 0;
      const entryPrice = Number(p.entryPrice ?? 0) || 0;
      const size = Number(p.size ?? 0) || 0;
      const leverage = Number(p.leverage ?? 0) || 0;
      if (markPrice > 0) {
        venueLookup.set(`${symbol}|${side}`, { markPrice, uPnL, entryPrice, size, leverage });
      }
    }

    // Cache spot prices once per request so each hedge doesn't re-fetch.
    const spotPriceCache: Record<string, number> = {};
    const getSpotPrice = async (asset: string): Promise<number> => {
      const key = asset.toUpperCase();
      if (spotPriceCache[key] !== undefined) return spotPriceCache[key];
      try {
        const { getMarketDataService } = await import(
          '@/lib/services/market-data/RealMarketDataService'
        );
        const md = getMarketDataService();
        const p = await md.getTokenPrice(key).catch(() => ({ price: 0 }));
        const price = Number(p.price) || 0;
        spotPriceCache[key] = price;
        return price;
      } catch {
        spotPriceCache[key] = 0;
        return 0;
      }
    };

    const overlaid: PoolHedge[] = [];
    for (const r of baseRows) {
      const baseSymbol = r.market.replace(/-PERP$/i, '').toUpperCase();
      const venue = venueLookup.get(`${r.market.toUpperCase()}|${r.side}`)
        ?? venueLookup.get(`${baseSymbol}-PERP|${r.side}`);

      let currentPrice: number | null = null;
      let currentPnl: number;
      let pnlSource: 'venue' | 'spot' | 'db' = 'db';
      let effectiveEntry = r.entryPrice;
      let effectiveSize = r.size;
      let effectiveLeverage = r.leverage;
      let effectiveNotional = r.notionalValue;
      const spot = (r.entryPrice > 0 && r.size > 0) ? await getSpotPrice(baseSymbol) : 0;

      if (venue && venue.markPrice > 0) {
        // Source 1: venue truth for uPnL (includes funding settlement),
        // spot for freshness of displayed mark.
        currentPrice = spot > 0 ? spot : venue.markPrice;
        if (spot > 0 && spot !== venue.markPrice) {
          const sign = r.side === 'SHORT' ? 1 : -1;
          const spotDelta = (venue.markPrice - spot) * (venue.size > 0 ? venue.size : r.size) * sign;
          currentPnl = venue.uPnL + spotDelta;
          pnlSource = 'venue';
        } else {
          currentPnl = venue.uPnL;
          pnlSource = 'venue';
        }
        if (venue.entryPrice > 0) effectiveEntry = venue.entryPrice;
        if (venue.size > 0) effectiveSize = venue.size;
        if (venue.leverage > 0) effectiveLeverage = venue.leverage;
        if (effectiveSize > 0 && currentPrice > 0) {
          effectiveNotional = effectiveSize * currentPrice;
        }
      } else if (r.entryPrice > 0 && r.size > 0 && spot > 0) {
        // Source 2: pure spot recompute (no venue data)
        currentPrice = spot;
        const sign = r.side === 'SHORT' ? 1 : -1;
        currentPnl = r.size * (r.entryPrice - spot) * sign;
        effectiveNotional = r.size * spot;
        pnlSource = 'spot';
      } else {
        currentPrice = r.dbCurrentPrice;
        currentPnl = r.dbCurrentPnl;
      }

      if (pnlSource === 'db') {
        logger.warn('[pool-hedges] hedge PnL falling back to stale DB row', {
          market: r.market, side: r.side, dbPnl: r.dbCurrentPnl,
        });
      }

      overlaid.push({
        id: r.id,
        market: r.market,
        side: r.side,
        size: effectiveSize,
        notionalValue: Number(effectiveNotional.toFixed(4)),
        leverage: effectiveLeverage,
        entryPrice: effectiveEntry,
        currentPrice,
        currentPnl: Number(currentPnl.toFixed(4)),
        openedAt: r.openedAt,
        source: r.source,
      });
    }
    return overlaid;
  } catch (err) {
    logger.warn('[pool-hedges] fetchActivePoolHedges failed', { error: err });
    return [];
  }
}
