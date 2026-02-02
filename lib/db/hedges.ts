import { query, queryOne } from './postgres';

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
}

export interface CreateHedgeParams {
  orderId: string;
  portfolioId?: number;
  walletAddress?: string;
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
}

export async function createHedge(params: CreateHedgeParams): Promise<Hedge> {
  const sql = `
    INSERT INTO hedges (
      order_id, portfolio_id, wallet_address, asset, market, side, 
      size, notional_value, leverage, entry_price, liquidation_price,
      stop_loss, take_profit, simulation_mode, reason, prediction_market, tx_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING *
  `;

  const result = await queryOne<Hedge>(sql, [
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

export async function getHedgeByOrderId(orderId: string): Promise<Hedge | null> {
  const sql = 'SELECT * FROM hedges WHERE order_id = $1';
  return queryOne<Hedge>(sql, [orderId]);
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
  const sql = 'SELECT * FROM hedges WHERE wallet_address = $1 AND status = $2 ORDER BY created_at DESC';
  return query<Hedge>(sql, [walletAddress.toLowerCase(), 'active']);
}

export async function getAllHedgesByWallet(walletAddress: string, limit = 50): Promise<Hedge[]> {
  const sql = 'SELECT * FROM hedges WHERE wallet_address = $1 ORDER BY created_at DESC LIMIT $2';
  return query<Hedge>(sql, [walletAddress.toLowerCase(), limit]);
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
