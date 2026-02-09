import { query, queryOne } from './postgres';
import crypto from 'crypto';

export interface Hedge {
  id: number;
  order_id: string;
  portfolio_id: number | null;
  wallet_address: string | null;
  asset: string;
  market: string;
  side: 'LONG' | 'SHORT';
  size: number;
  notional_value: number;
  leverage: number;
  entry_price: number | null;
  liquidation_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  status: 'active' | 'closed' | 'liquidated' | 'cancelled';
  simulation_mode: boolean;
  reason: string | null;
  prediction_market: string | null;
  current_pnl: number;
  realized_pnl: number;
  funding_paid: number;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  tx_hash: string | null;
  // ZK proof fields
  zk_proof_hash: string | null;
  wallet_binding_hash: string | null;
  owner_commitment: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CreateHedgeParams {
  orderId: string;
  portfolioId?: number;
  walletAddress?: string; // Owner wallet (receives funds on withdrawal)
  proxyWallet?: string; // Proxy wallet for execution (optional, for privacy)
  asset: string;
  market: string;
  side: 'LONG' | 'SHORT';
  size: number;
  notionalValue: number;
  leverage: number;
  entryPrice?: number;
  liquidationPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  simulationMode: boolean;
  reason?: string;
  predictionMarket?: string;
  txHash?: string;
  // ZK proof fields for privacy
  zkProofHash?: string;
  walletBindingHash?: string;
  ownerCommitment?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Generate a deterministic wallet binding hash for ZK ownership verification
 * This hash cryptographically binds a hedge to a wallet without revealing the wallet address
 */
export function generateWalletBindingHash(walletAddress: string, hedgeId: string, secret?: string): string {
  const data = `zk-binding:${walletAddress.toLowerCase()}:${hedgeId}:${secret || 'chronos-vanguard'}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate an owner commitment for ZK proof verification
 * This allows proving ownership without revealing the actual wallet address
 */
export function generateOwnerCommitment(walletAddress: string, timestamp: number): string {
  const data = `owner-commitment:${walletAddress.toLowerCase()}:${timestamp}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Verify if a wallet owns a hedge via ZK binding
 * Returns true if the computed binding matches the stored binding
 */
export function verifyZKOwnership(walletAddress: string, hedgeId: string, storedBinding: string, secret?: string): boolean {
  const computedBinding = generateWalletBindingHash(walletAddress, hedgeId, secret);
  return computedBinding === storedBinding;
}

export async function createHedge(params: CreateHedgeParams): Promise<Hedge> {
  // Generate ZK binding hash using OWNER wallet (not proxy)
  // This ensures funds always return to owner even when using proxy
  const walletBindingHash = params.walletAddress 
    ? params.walletBindingHash || generateWalletBindingHash(params.walletAddress, params.orderId)
    : null;
  
  // Generate owner commitment for ZK verification
  const ownerCommitment = params.walletAddress
    ? params.ownerCommitment || generateOwnerCommitment(params.walletAddress, Date.now())
    : null;

  // Build metadata including proxy wallet info if provided
  const metadata = {
    ...params.metadata,
    // Store proxy wallet separately if used (for privacy)
    proxyWallet: params.proxyWallet || null,
    ownerWallet: params.walletAddress || null,
    useProxyWallet: !!params.proxyWallet,
    // Withdrawal always goes to owner wallet
    withdrawalDestination: params.walletAddress || null,
  };

  try {
    // Try with ZK columns (if migration has been run)
    const sql = `
      INSERT INTO hedges (
        order_id, portfolio_id, wallet_address, asset, market, side, 
        size, notional_value, leverage, entry_price, liquidation_price,
        stop_loss, take_profit, simulation_mode, reason, prediction_market, tx_hash,
        zk_proof_hash, wallet_binding_hash, owner_commitment, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `;

    const result = await queryOne<Hedge>(sql, [
      params.orderId,
      params.portfolioId || null,
      params.walletAddress || null, // Always store OWNER wallet as wallet_address
      params.asset,
      params.market,
      params.side,
      params.size,
      params.notionalValue,
      params.leverage,
      params.entryPrice || null,
      params.liquidationPrice || null,
      params.stopLoss || null,
      params.takeProfit || null,
      params.simulationMode,
      params.reason || null,
      params.predictionMarket || null,
      params.txHash || null,
      params.zkProofHash || null,
      walletBindingHash,
      ownerCommitment,
      JSON.stringify(metadata),
    ]);

    if (!result) {
      throw new Error('Failed to create hedge');
    }

    return result;
  } catch (error) {
    // Fallback without ZK columns (migration not yet run)
    console.warn('ZK columns may not exist, falling back to simple insert:', error);
    const simpleSql = `
      INSERT INTO hedges (
        order_id, portfolio_id, wallet_address, asset, market, side, 
        size, notional_value, leverage, entry_price, liquidation_price,
        stop_loss, take_profit, simulation_mode, reason, prediction_market, tx_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `;

    const result = await queryOne<Hedge>(simpleSql, [
      params.orderId,
      params.portfolioId || null,
      params.walletAddress || null,
      params.asset,
      params.market,
      params.side,
      params.size,
      params.notionalValue,
      params.leverage,
      params.entryPrice || null,
      params.liquidationPrice || null,
      params.stopLoss || null,
      params.takeProfit || null,
      params.simulationMode,
      params.reason || null,
      params.predictionMarket || null,
      params.txHash || null,
    ]);

    if (!result) {
      throw new Error('Failed to create hedge');
    }

    return result;
  }
}

export async function getHedgeByOrderId(orderId: string): Promise<Hedge | null> {
  const sql = 'SELECT * FROM hedges WHERE order_id = $1';
  return queryOne<Hedge>(sql, [orderId]);
}

// Alias for getHedgeByOrderId for consistency
export async function getHedgeById(hedgeId: string): Promise<Hedge | null> {
  return getHedgeByOrderId(hedgeId);
}

export async function getHedgeByZkProofHash(proofHash: string): Promise<Hedge | null> {
  // Check both zk_proof_hash and tx_hash (legacy column where proof was stored)
  const sql = 'SELECT * FROM hedges WHERE zk_proof_hash = $1 OR tx_hash = $1';
  return queryOne<Hedge>(sql, [proofHash]);
}

export async function getActiveHedges(portfolioId?: number): Promise<Hedge[]> {
  if (portfolioId) {
    const sql = 'SELECT * FROM hedges WHERE portfolio_id = $1 AND status = $2 ORDER BY created_at DESC';
    return query<Hedge>(sql, [portfolioId, 'active']);
  }
  
  const sql = 'SELECT * FROM hedges WHERE status = $1 ORDER BY created_at DESC';
  return query<Hedge>(sql, ['active']);
}

export async function getActiveHedgesByWallet(walletAddress: string): Promise<Hedge[]> {
  // Simple wallet address match - case insensitive
  const sql = `
    SELECT * FROM hedges 
    WHERE status = $1 
    AND LOWER(wallet_address) = LOWER($2)
    ORDER BY created_at DESC
  `;
  return query<Hedge>(sql, ['active', walletAddress]);
}

/**
 * Get hedges that the wallet can prove ownership of via ZK binding
 * This supports proxy wallets - the hedge may have a different wallet_address
 * but the owner can prove they control it via ZK proof
 */
export async function getActiveHedgesByZKOwnership(walletAddress: string): Promise<Hedge[]> {
  try {
    // Get all active hedges with wallet bindings
    const sql = `
      SELECT * FROM hedges 
      WHERE status = $1 
      AND wallet_binding_hash IS NOT NULL
      ORDER BY created_at DESC
    `;
    const allHedges = await query<Hedge>(sql, ['active']);
    
    // Filter to hedges this wallet can prove ownership of
    return allHedges.filter(hedge => {
      if (!hedge.wallet_binding_hash) return false;
      // Verify ZK ownership
      return verifyZKOwnership(walletAddress, hedge.order_id, hedge.wallet_binding_hash);
    });
  } catch (error) {
    // ZK columns may not exist yet
    console.warn('ZK ownership query failed, columns may not exist:', error);
    return [];
  }
}

/**
 * Get hedges owned by wallet - checks both direct ownership AND ZK binding
 * This is the recommended method for fetching a user's hedges as it supports:
 * - Direct wallet address matching
 * - ZK proof-based ownership verification (for proxy wallets)
 */
export async function getOwnedHedges(walletAddress: string, activeOnly = true): Promise<Hedge[]> {
  const statusFilter = activeOnly ? "AND status = 'active'" : '';
  
  try {
    // First try with ZK binding support (if columns exist)
    const sql = `
      SELECT * FROM hedges 
      WHERE (
        LOWER(wallet_address) = LOWER($1)
        OR wallet_binding_hash IS NOT NULL
      )
      ${statusFilter}
      ORDER BY created_at DESC
    `;
    
    const hedges = await query<Hedge>(sql, [walletAddress]);
    
    // Filter: include if wallet matches OR if ZK binding proves ownership
    return hedges.filter(hedge => {
      // Direct wallet match
      if (hedge.wallet_address?.toLowerCase() === walletAddress.toLowerCase()) {
        return true;
      }
      // ZK binding match (for proxy wallets)
      if (hedge.wallet_binding_hash) {
        return verifyZKOwnership(walletAddress, hedge.order_id, hedge.wallet_binding_hash);
      }
      return false;
    });
  } catch (error) {
    // Fallback if ZK columns don't exist yet (migration not run)
    console.warn('ZK columns may not exist, falling back to simple wallet query:', error);
    const simpleSql = `
      SELECT * FROM hedges 
      WHERE LOWER(wallet_address) = LOWER($1)
      ${statusFilter}
      ORDER BY created_at DESC
    `;
    return query<Hedge>(simpleSql, [walletAddress]);
  }
}

export async function getAllHedgesByWallet(walletAddress: string, limit = 50): Promise<Hedge[]> {
  const sql = 'SELECT * FROM hedges WHERE LOWER(wallet_address) = LOWER($1) ORDER BY created_at DESC LIMIT $2';
  return query<Hedge>(sql, [walletAddress, limit]);
}

export async function getAllHedges(portfolioId?: number, limit = 50): Promise<Hedge[]> {
  if (portfolioId) {
    const sql = 'SELECT * FROM hedges WHERE portfolio_id = $1 ORDER BY created_at DESC LIMIT $2';
    return query<Hedge>(sql, [portfolioId, limit]);
  }
  
  const sql = 'SELECT * FROM hedges ORDER BY created_at DESC LIMIT $1';
  return query<Hedge>(sql, [limit]);
}

export async function updateHedgePnL(orderId: string, currentPnl: number): Promise<void> {
  const sql = 'UPDATE hedges SET current_pnl = $1, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2';
  await query(sql, [currentPnl, orderId]);
}

export async function closeHedge(
  orderId: string, 
  realizedPnl: number, 
  status: 'closed' | 'liquidated' = 'closed'
): Promise<void> {
  const sql = `
    UPDATE hedges 
    SET status = $1, realized_pnl = $2, closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
    WHERE order_id = $3
  `;
  await query(sql, [status, realizedPnl, orderId]);
}

export async function getHedgeStats() {
  const sql = `
    SELECT 
      COUNT(*) as total_hedges,
      COUNT(CASE WHEN status = 'active' THEN 1 END) as active_hedges,
      SUM(CASE WHEN status = 'active' THEN notional_value ELSE 0 END) as total_active_notional,
      SUM(current_pnl) as total_current_pnl,
      SUM(realized_pnl) as total_realized_pnl,
      COUNT(CASE WHEN simulation_mode = true THEN 1 END) as simulated_hedges,
      COUNT(CASE WHEN simulation_mode = false THEN 1 END) as real_hedges
    FROM hedges
  `;
  
  return queryOne(sql);
}

/**
 * Delete all active simulation hedges
 * Used to clear old test data
 */
export async function clearSimulationHedges(): Promise<number> {
  const sql = `
    DELETE FROM hedges 
    WHERE simulation_mode = true AND status = 'active'
    RETURNING order_id
  `;
  const result = await query(sql);
  return result.length;
}

/**
 * Delete all hedges (use with caution)
 */
export async function clearAllHedges(): Promise<number> {
  const sql = 'DELETE FROM hedges RETURNING order_id';
  const result = await query(sql);
  return result.length;
}

// ─── On-Chain Hedge DB Functions ─────────────────────────────────────────────
// These enable DB-first lookup for tx hashes, eliminating slow event log scanning.
// On-chain hedge data is stored at creation time and queried instantly.

export interface OnChainHedgeParams {
  hedgeIdOnchain: string;       // bytes32 from HedgeExecutor
  txHash: string;               // Transaction hash
  trader: string;               // On-chain trader address
  asset: string;
  side: 'LONG' | 'SHORT';
  collateral: number;
  leverage: number;
  entryPrice?: number;
  chain?: string;
  chainId?: number;
  contractAddress?: string;
  commitmentHash?: string;
  nullifier?: string;
  proxyWallet?: string;
  blockNumber?: number;
  explorerLink?: string;
  walletAddress?: string;       // Real owner wallet (for ZK-private hedges)
  metadata?: Record<string, unknown>;
}

/**
 * Upsert an on-chain hedge into the DB.
 * Called at creation time (from open-onchain-gasless route) so the tx hash
 * is immediately available — no event log scanning needed.
 */
export async function upsertOnChainHedge(params: OnChainHedgeParams): Promise<Hedge | null> {
  try {
    const orderId = params.hedgeIdOnchain; // Use on-chain hedgeId as order_id
    const explorerLink = params.explorerLink || `https://explorer.cronos.org/testnet/tx/${params.txHash}`;

    const sql = `
      INSERT INTO hedges (
        order_id, wallet_address, asset, market, side,
        size, notional_value, leverage, entry_price,
        simulation_mode, tx_hash, on_chain, chain, chain_id,
        contract_address, hedge_id_onchain, commitment_hash,
        nullifier, proxy_wallet, block_number, explorer_link,
        metadata, status
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        false, $10, true, $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19,
        $20, 'active'
      )
      ON CONFLICT (order_id) DO UPDATE SET
        tx_hash = COALESCE(EXCLUDED.tx_hash, hedges.tx_hash),
        block_number = COALESCE(EXCLUDED.block_number, hedges.block_number),
        explorer_link = COALESCE(EXCLUDED.explorer_link, hedges.explorer_link),
        on_chain = true,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    return await queryOne<Hedge>(sql, [
      orderId,
      params.walletAddress || params.trader,
      params.asset,
      `${params.asset}/USD`,
      params.side,
      params.collateral,
      params.collateral * params.leverage,
      params.leverage,
      params.entryPrice || null,
      params.txHash,
      params.chain || 'cronos-testnet',
      params.chainId || 338,
      params.contractAddress || '0x090b6221137690EbB37667E4644287487CE462B9',
      params.hedgeIdOnchain,
      params.commitmentHash || null,
      params.nullifier || null,
      params.proxyWallet || null,
      params.blockNumber || null,
      explorerLink,
      JSON.stringify(params.metadata || {}),
    ]);
  } catch (error) {
    // If on-chain columns don't exist yet, log and return null (non-fatal)
    console.warn('upsertOnChainHedge failed (migration may not be run yet):', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Get an on-chain hedge by its bytes32 hedgeId.
 * Returns instantly from DB instead of scanning event logs.
 */
export async function getOnChainHedgeByHedgeId(hedgeIdOnchain: string): Promise<Hedge | null> {
  try {
    const sql = 'SELECT * FROM hedges WHERE hedge_id_onchain = $1 OR order_id = $1';
    return await queryOne<Hedge>(sql, [hedgeIdOnchain]);
  } catch {
    return null;
  }
}

/**
 * Batch-fetch tx hashes for multiple on-chain hedgeIds from DB.
 * Returns a map of hedgeId → txHash. Much faster than event log scanning.
 */
export async function getTxHashesFromDb(hedgeIds: string[]): Promise<Record<string, string>> {
  if (hedgeIds.length === 0) return {};

  try {
    // Use ANY() for batch lookup
    const sql = `
      SELECT hedge_id_onchain, tx_hash 
      FROM hedges 
      WHERE hedge_id_onchain = ANY($1) 
        AND tx_hash IS NOT NULL
    `;
    const rows = await query<{ hedge_id_onchain: string; tx_hash: string }>(sql, [hedgeIds]);

    const map: Record<string, string> = {};
    for (const row of rows) {
      if (row.hedge_id_onchain && row.tx_hash) {
        map[row.hedge_id_onchain] = row.tx_hash;
      }
    }
    return map;
  } catch {
    // If columns don't exist, return empty (non-fatal)
    return {};
  }
}

/**
 * Bulk-save tx hashes discovered from event log scanning.
 * Called as a background cache-fill for hedges not yet in DB.
 */
export async function cacheTxHashes(entries: Array<{ hedgeId: string; txHash: string; blockNumber?: number }>): Promise<void> {
  if (entries.length === 0) return;

  try {
    for (const { hedgeId, txHash, blockNumber } of entries) {
      const explorerLink = `https://explorer.cronos.org/testnet/tx/${txHash}`;
      await query(`
        INSERT INTO hedges (order_id, hedge_id_onchain, tx_hash, block_number, explorer_link, on_chain, simulation_mode, asset, market, side, size, notional_value, leverage, status)
        VALUES ($1, $2, $3, $4, $5, true, false, 'UNKNOWN', 'UNKNOWN', 'LONG', 0, 0, 1, 'active')
        ON CONFLICT (order_id) DO UPDATE SET
          tx_hash = COALESCE(EXCLUDED.tx_hash, hedges.tx_hash),
          block_number = COALESCE(EXCLUDED.block_number, hedges.block_number),
          explorer_link = COALESCE(EXCLUDED.explorer_link, hedges.explorer_link),
          hedge_id_onchain = COALESCE(EXCLUDED.hedge_id_onchain, hedges.hedge_id_onchain),
          on_chain = true,
          updated_at = CURRENT_TIMESTAMP
      `, [hedgeId, hedgeId, txHash, blockNumber || null, explorerLink]);
    }
  } catch (error) {
    console.warn('cacheTxHashes failed:', error instanceof Error ? error.message : error);
  }
}
