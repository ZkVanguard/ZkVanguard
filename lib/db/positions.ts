/**
 * Wallet Positions DB Layer
 * Caches wallet token balances and USD values.
 * Serves /api/positions instantly from DB; background refresh via RPC.
 */
import { query } from './postgres';

export interface CachedPosition {
  wallet_address: string;
  symbol: string;
  balance: string;
  balance_usd: number;
  price: number;
  change_24h: number;
  token_address: string | null;
  source: string;
  chain: string;
  updated_at: Date;
}

/**
 * Get cached positions for a wallet. Returns empty if stale.
 */
export async function getCachedPositions(walletAddress: string, maxAgeMs = 60_000): Promise<CachedPosition[]> {
  try {
    const sql = `
      SELECT * FROM wallet_positions 
      WHERE LOWER(wallet_address) = LOWER($1)
        AND updated_at > NOW() - INTERVAL '${Math.floor(maxAgeMs / 1000)} seconds'
      ORDER BY balance_usd DESC
    `;
    return await query<CachedPosition>(sql, [walletAddress]);
  } catch {
    return [];
  }
}

/**
 * Upsert wallet positions (called after RPC refresh).
 */
export async function upsertPositions(walletAddress: string, positions: Array<{
  symbol: string;
  balance: string;
  balanceUsd: number;
  price: number;
  change24h: number;
  tokenAddress?: string;
  source?: string;
  chain?: string;
}>): Promise<void> {
  if (positions.length === 0) return;
  try {
    for (const pos of positions) {
      await query(`
        INSERT INTO wallet_positions (wallet_address, symbol, balance, balance_usd, price, change_24h, token_address, source, chain, updated_at)
        VALUES (LOWER($1), UPPER($2), $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (wallet_address, symbol, chain) DO UPDATE SET
          balance = EXCLUDED.balance,
          balance_usd = EXCLUDED.balance_usd,
          price = EXCLUDED.price,
          change_24h = EXCLUDED.change_24h,
          token_address = EXCLUDED.token_address,
          source = EXCLUDED.source,
          updated_at = NOW()
      `, [
        walletAddress,
        pos.symbol,
        pos.balance,
        pos.balanceUsd,
        pos.price,
        pos.change24h,
        pos.tokenAddress || null,
        pos.source || 'rpc',
        pos.chain || 'cronos-testnet',
      ]);
    }
  } catch (err) {
    console.warn('upsertPositions failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Get total portfolio value from cached positions.
 */
export async function getCachedTotalValue(walletAddress: string): Promise<number> {
  try {
    const sql = `
      SELECT COALESCE(SUM(balance_usd), 0) as total 
      FROM wallet_positions 
      WHERE LOWER(wallet_address) = LOWER($1)
    `;
    const row = await query<{ total: number }>(sql, [walletAddress]);
    return row[0]?.total ?? 0;
  } catch {
    return 0;
  }
}
