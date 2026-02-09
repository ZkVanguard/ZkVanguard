/**
 * Price Cache DB Layer
 * Shared price cache eliminates duplicate Crypto.com API calls across 6+ routes.
 * Prices are written by a single refresh call and read by all consumers.
 */
import { query, queryOne } from './postgres';

export interface CachedPrice {
  symbol: string;
  price: number;
  change_24h: number;
  volume_24h: number;
  high_24h: number | null;
  low_24h: number | null;
  source: string;
  updated_at: Date;
}

/**
 * Get a single cached price. Returns null if stale (>maxAge ms).
 */
export async function getCachedPrice(symbol: string, maxAgeMs = 30_000): Promise<CachedPrice | null> {
  try {
    const sql = `
      SELECT * FROM price_cache 
      WHERE UPPER(symbol) = UPPER($1)
        AND updated_at > NOW() - INTERVAL '${Math.floor(maxAgeMs / 1000)} seconds'
    `;
    return await queryOne<CachedPrice>(sql, [symbol]);
  } catch {
    return null;
  }
}

/**
 * Batch-get cached prices. Returns only fresh entries.
 */
export async function getCachedPrices(symbols: string[], maxAgeMs = 30_000): Promise<Record<string, CachedPrice>> {
  if (symbols.length === 0) return {};
  try {
    const upperSymbols = symbols.map(s => s.toUpperCase());
    const sql = `
      SELECT * FROM price_cache 
      WHERE UPPER(symbol) = ANY($1)
        AND updated_at > NOW() - INTERVAL '${Math.floor(maxAgeMs / 1000)} seconds'
    `;
    const rows = await query<CachedPrice>(sql, [upperSymbols]);
    const map: Record<string, CachedPrice> = {};
    for (const row of rows) {
      map[row.symbol.toUpperCase()] = row;
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Upsert prices into the cache. Called by the price refresh loop.
 */
export async function upsertPrices(prices: Array<{
  symbol: string;
  price: number;
  change24h?: number;
  volume24h?: number;
  high24h?: number;
  low24h?: number;
  source?: string;
}>): Promise<void> {
  if (prices.length === 0) return;
  try {
    for (const p of prices) {
      await query(`
        INSERT INTO price_cache (symbol, price, change_24h, volume_24h, high_24h, low_24h, source, updated_at)
        VALUES (UPPER($1), $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (symbol) DO UPDATE SET
          price = EXCLUDED.price,
          change_24h = EXCLUDED.change_24h,
          volume_24h = EXCLUDED.volume_24h,
          high_24h = EXCLUDED.high_24h,
          low_24h = EXCLUDED.low_24h,
          source = EXCLUDED.source,
          updated_at = NOW()
      `, [
        p.symbol,
        p.price,
        p.change24h ?? 0,
        p.volume24h ?? 0,
        p.high24h ?? null,
        p.low24h ?? null,
        p.source ?? 'cryptocom-exchange',
      ]);
    }
  } catch (err) {
    console.warn('upsertPrices failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Get ALL cached prices (for routes that need the full set).
 */
export async function getAllCachedPrices(maxAgeMs = 30_000): Promise<CachedPrice[]> {
  try {
    const sql = `
      SELECT * FROM price_cache 
      WHERE updated_at > NOW() - INTERVAL '${Math.floor(maxAgeMs / 1000)} seconds'
    `;
    return await query<CachedPrice>(sql);
  } catch {
    return [];
  }
}
