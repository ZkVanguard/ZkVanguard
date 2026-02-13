/**
 * Portfolio Transactions DB Layer
 * Caches on-chain deposit/withdraw/rebalance events.
 * Only scans new blocks since last synced block — incremental sync.
 */
import { query, queryOne } from './postgres';

export interface PortfolioTransaction {
  id: number;
  portfolio_id: number;
  tx_type: 'deposit' | 'withdraw' | 'rebalance';
  tx_hash: string;
  block_number: number;
  timestamp: number;
  token: string | null;
  token_symbol: string | null;
  amount: number | null;
  depositor: string | null;
  recipient: string | null;
  chain: string;
  chain_id: number;
  contract_address: string | null;
  wallet_address: string | null;
  created_at: Date;
}

/**
 * Get cached transactions for a portfolio, sorted by timestamp descending.
 */
export async function getCachedTransactions(portfolioId: number, walletAddress?: string): Promise<PortfolioTransaction[]> {
  try {
    if (walletAddress) {
      // Include wallet-specific ERC20 transfer transactions
      const sql = `
        SELECT * FROM portfolio_transactions 
        WHERE portfolio_id = $1 OR wallet_address = $2
        ORDER BY timestamp DESC
      `;
      return await query<PortfolioTransaction>(sql, [portfolioId, walletAddress.toLowerCase()]);
    } else {
      const sql = `
        SELECT * FROM portfolio_transactions 
        WHERE portfolio_id = $1 
        ORDER BY timestamp DESC
      `;
      return await query<PortfolioTransaction>(sql, [portfolioId]);
    }
  } catch {
    return [];
  }
}

/**
 * Get the highest block number we have cached for a portfolio/wallet.
 * This tells us where to start scanning from.
 */
export async function getLastCachedBlock(portfolioId: number, walletAddress?: string): Promise<number> {
  try {
    if (walletAddress) {
      const sql = `
        SELECT MAX(block_number) as max_block 
        FROM portfolio_transactions 
        WHERE portfolio_id = $1 OR wallet_address = $2
      `;
      const row = await queryOne<{ max_block: number | null }>(sql, [portfolioId, walletAddress.toLowerCase()]);
      return row?.max_block ?? 0;
    } else {
      const sql = `
        SELECT MAX(block_number) as max_block 
        FROM portfolio_transactions 
        WHERE portfolio_id = $1
      `;
      const row = await queryOne<{ max_block: number | null }>(sql, [portfolioId]);
      return row?.max_block ?? 0;
    }
  } catch {
    return 0;
  }
}

/**
 * Insert new transactions (ignores duplicates via UNIQUE constraint).
 */
export async function insertTransactions(txs: Array<{
  portfolioId: number;
  txType: 'deposit' | 'withdraw' | 'rebalance';
  txHash: string;
  blockNumber: number;
  timestamp: number;
  token?: string;
  tokenSymbol?: string;
  amount?: number;
  depositor?: string;
  recipient?: string;
  chain?: string;
  chainId?: number;
  contractAddress?: string;
  walletAddress?: string;
}>): Promise<number> {
  let inserted = 0;
  for (const tx of txs) {
    try {
      await query(`
        INSERT INTO portfolio_transactions 
          (portfolio_id, tx_type, tx_hash, block_number, timestamp, token, token_symbol, amount, depositor, recipient, chain, chain_id, contract_address, wallet_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (tx_hash, portfolio_id, tx_type) DO NOTHING
      `, [
        tx.portfolioId,
        tx.txType,
        tx.txHash,
        tx.blockNumber,
        tx.timestamp,
        tx.token || null,
        tx.tokenSymbol || null,
        tx.amount ?? null,
        tx.depositor || null,
        tx.recipient || null,
        tx.chain || 'cronos-testnet',
        tx.chainId || 338,
        tx.contractAddress || null,
        tx.walletAddress?.toLowerCase() || null,
      ]);
      inserted++;
    } catch {
      // Skip duplicate
    }
  }
  return inserted;
}

/**
 * Get/set sync metadata for incremental chain scanning.
 */
export async function getSyncBlock(syncKey: string): Promise<number> {
  try {
    const row = await queryOne<{ last_block: number }>('SELECT last_block FROM sync_metadata WHERE sync_key = $1', [syncKey]);
    return row?.last_block ?? 0;
  } catch {
    return 0;
  }
}

export async function setSyncBlock(syncKey: string, blockNumber: number): Promise<void> {
  try {
    await query(`
      INSERT INTO sync_metadata (sync_key, last_block, last_sync_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (sync_key) DO UPDATE SET
        last_block = EXCLUDED.last_block,
        last_sync_at = NOW()
    `, [syncKey, blockNumber]);
  } catch (err) {
    console.warn('setSyncBlock failed:', err instanceof Error ? err.message : err);
  }
}
