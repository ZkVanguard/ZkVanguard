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
  // On-chain fields (added by add-onchain-fields.sql migration)
  hedge_id_onchain: string | null;
  chain: string | null;
  chain_id: number | null;
  contract_address: string | null;
  commitment_hash: string | null;
  nullifier: string | null;
  proxy_wallet: string | null;
  on_chain: boolean | null;
  explorer_link: string | null;
  block_number: number | null;
  // DB-first optimization fields (added by db-first-optimization.sql migration)
  current_price: number | null;
  price_source: string | null;
  price_updated_at: Date | null;
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
  const data = `zk-binding:${walletAddress.toLowerCase()}:${hedgeId}:${secret || 'zkvanguard'}`;
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

export async function updateHedgeStatus(
  hedgeIdOrOrderId: string,
  status: 'active' | 'closed' | 'liquidated' | 'cancelled'
): Promise<void> {
  // Try to update by order_id first, then by hedge_id_onchain
  const sql = `
    UPDATE hedges 
    SET status = $1, 
        updated_at = CURRENT_TIMESTAMP,
        closed_at = CASE WHEN $1 IN ('closed', 'liquidated', 'cancelled') THEN CURRENT_TIMESTAMP ELSE closed_at END
    WHERE order_id = $2 OR hedge_id_onchain = $2
  `;
  await query(sql, [status, hedgeIdOrOrderId]);
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

/**
 * Get active on-chain hedge count directly from DB.
 * Eliminates the need to call getUserHedges() + hedges() on-chain just for a count.
 */
export async function getActiveOnChainHedgeCount(): Promise<number> {
  try {
    const sql = "SELECT COUNT(*) as count FROM hedges WHERE on_chain = true AND status = 'active'";
    const row = await queryOne<{ count: string }>(sql);
    return parseInt(row?.count || '0', 10);
  } catch {
    return 0;
  }
}

/**
 * Get ALL on-chain hedges from DB with full details.
 * This replaces the expensive multi-RPC-call flow in the onchain route.
 */
export async function getAllOnChainHedges(activeOnly = false): Promise<Hedge[]> {
  try {
    const statusFilter = activeOnly ? "AND status = 'active'" : '';
    const sql = `SELECT * FROM hedges WHERE on_chain = true ${statusFilter} ORDER BY created_at DESC`;
    return await query<Hedge>(sql);
  } catch {
    return [];
  }
}

/**
 * Update hedge with live price data and computed PnL.
 * Called during background sync to keep DB fresh.
 */
export async function updateHedgePrice(hedgeIdOnchain: string, currentPrice: number, source: string): Promise<void> {
  try {
    await query(`
      UPDATE hedges SET
        current_price = $1,
        price_source = $2,
        price_updated_at = NOW(),
        updated_at = NOW()
      WHERE hedge_id_onchain = $3 OR order_id = $3
    `, [currentPrice, source, hedgeIdOnchain]);
  } catch (err) {
    console.warn('updateHedgePrice failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Batch-update prices for multiple hedges (by asset symbol).
 * More efficient than updating one-by-one.
 */
export async function batchUpdateHedgePrices(priceMap: Record<string, { price: number; source: string }>): Promise<void> {
  try {
    for (const [asset, { price, source }] of Object.entries(priceMap)) {
      await query(`
        UPDATE hedges SET
          current_price = $1,
          price_source = $2,
          price_updated_at = NOW(),
          updated_at = NOW()
        WHERE UPPER(asset) = UPPER($3) AND on_chain = true AND status = 'active'
      `, [price, source, asset]);
    }
  } catch (err) {
    console.warn('batchUpdateHedgePrices failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Mark a hedge as closed in DB (called after on-chain close).
 */
export async function closeOnChainHedge(hedgeIdOnchain: string, realizedPnl: number, closeTxHash?: string): Promise<void> {
  try {
    await query(`
      UPDATE hedges SET
        status = 'closed',
        realized_pnl = $1,
        closed_at = NOW(),
        updated_at = NOW(),
        tx_hash = COALESCE($2, tx_hash)
      WHERE hedge_id_onchain = $3 OR order_id = $3
    `, [realizedPnl, closeTxHash || null, hedgeIdOnchain]);
  } catch (err) {
    console.warn('closeOnChainHedge failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Get on-chain hedge protocol stats directly from DB.
 * Replaces contract.getProtocolStats() RPC call.
 */
export async function getOnChainProtocolStats() {
  try {
    const sql = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'active') AS active_count,
        COUNT(*) FILTER (WHERE status IN ('closed', 'liquidated')) AS closed_count,
        COUNT(*) AS total_count,
        COALESCE(SUM(size) FILTER (WHERE status = 'active'), 0) AS collateral_locked,
        COALESCE(SUM(realized_pnl), 0) AS total_pnl,
        0 AS fees_collected
      FROM hedges
      WHERE on_chain = true
    `;
    return await queryOne<{
      active_count: string;
      closed_count: string;
      total_count: string;
      collateral_locked: string;
      total_pnl: string;
      fees_collected: string;
    }>(sql);
  } catch {
    return null;
  }
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
        asset = CASE WHEN EXCLUDED.asset IS NOT NULL AND EXCLUDED.asset != '' THEN EXCLUDED.asset ELSE hedges.asset END,
        market = CASE WHEN EXCLUDED.market IS NOT NULL AND EXCLUDED.market != '' THEN EXCLUDED.market ELSE hedges.market END,
        side = EXCLUDED.side,
        size = CASE WHEN EXCLUDED.size > 0 THEN EXCLUDED.size ELSE hedges.size END,
        notional_value = CASE WHEN EXCLUDED.notional_value > 0 THEN EXCLUDED.notional_value ELSE hedges.notional_value END,
        leverage = CASE WHEN EXCLUDED.leverage > 0 THEN EXCLUDED.leverage ELSE hedges.leverage END,
        entry_price = COALESCE(EXCLUDED.entry_price, hedges.entry_price),
        tx_hash = COALESCE(EXCLUDED.tx_hash, hedges.tx_hash),
        block_number = COALESCE(EXCLUDED.block_number, hedges.block_number),
        explorer_link = COALESCE(EXCLUDED.explorer_link, hedges.explorer_link),
        commitment_hash = COALESCE(EXCLUDED.commitment_hash, hedges.commitment_hash),
        nullifier = COALESCE(EXCLUDED.nullifier, hedges.nullifier),
        proxy_wallet = COALESCE(EXCLUDED.proxy_wallet, hedges.proxy_wallet),
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
 * Resync a hedge's key fields from actual on-chain data.
 * Fixes stale DB entries that were stored with incorrect values.
 * Only updates fields that have valid new values (never overwrites with 0/null).
 */
export async function resyncOnChainHedge(hedgeIdOnchain: string, data: {
  asset: string;
  side: 'LONG' | 'SHORT';
  collateral: number;
  leverage: number;
  entryPrice: number;
  status?: string;
  commitmentHash?: string;
  nullifier?: string;
}): Promise<void> {
  try {
    const notional = data.collateral * data.leverage;
    const sql = `
      UPDATE hedges SET
        asset = CASE WHEN $1 != '' AND $1 != 'UNKNOWN' THEN $1 ELSE asset END,
        market = CASE WHEN $1 != '' AND $1 != 'UNKNOWN' THEN $1 || '/USD' ELSE market END,
        side = $2,
        size = CASE WHEN $3 > 0 THEN $3 ELSE size END,
        notional_value = CASE WHEN $4 > 0 THEN $4 ELSE notional_value END,
        leverage = CASE WHEN $5 > 0 THEN $5 ELSE leverage END,
        entry_price = CASE WHEN $6 > 0 THEN $6 ELSE entry_price END,
        status = CASE WHEN $7 IS NOT NULL AND $7 != '' THEN $7 ELSE status END,
        commitment_hash = COALESCE($8, commitment_hash),
        nullifier = COALESCE($9, nullifier),
        updated_at = NOW()
      WHERE hedge_id_onchain = $10 OR order_id = $10
    `;
    await query(sql, [
      data.asset,
      data.side,
      data.collateral,
      notional,
      data.leverage,
      data.entryPrice,
      data.status || null,
      data.commitmentHash || null,
      data.nullifier || null,
      hedgeIdOnchain,
    ]);
  } catch (err) {
    console.warn('resyncOnChainHedge failed:', err instanceof Error ? err.message : err);
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
