/**
 * hedges table schema + shared types.
 *
 * Extracted from lib/db/hedges.ts (which was 1333 LOC and covered
 * perps + on-chain + schema in one file). Callers keep importing from
 * hedges.ts — this module is an implementation detail of that split.
 */
import { query } from './postgres';
import { logger } from '@/lib/utils/logger';

// ── Close-path PnL invariant (documented in CLAUDE.md) ────────────────────
// Every close writer MUST mirror realized_pnl into current_pnl.
// Analytics that sum current_pnl (dashboards, drawdown checks, regret
// tracker) rely on SUM(current_pnl) == SUM(realized_pnl) for closed rows.
// After f46b5289 the invariant became load-bearing; if you add a 6th close
// path anywhere, copy this pattern:
//   SET status = 'closed',
//       realized_pnl = <NEW>,      -- either absolute (SDK path) or
//       current_pnl  = <NEW>,      -- COALESCE + delta (reconciler path)
//       closed_at = CURRENT_TIMESTAMP,
//       updated_at = CURRENT_TIMESTAMP
// Silently breaking current_pnl means the regret tracker and profit-lock
// guard read stale price-watch snapshots as if they were realized outcomes.

let hedgesTableReady = false;

/**
 * Ensure hedges table + all migration columns exist (idempotent).
 * Safe to call on every request — no-ops after first success.
 */
export async function ensureHedgesTable(): Promise<void> {
  if (hedgesTableReady) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS hedges (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) UNIQUE NOT NULL,
        portfolio_id INTEGER,
        wallet_address VARCHAR(255),
        asset VARCHAR(20) NOT NULL,
        market VARCHAR(50) NOT NULL,
        side VARCHAR(10) NOT NULL CHECK (side IN ('LONG', 'SHORT')),
        size DECIMAL(18, 8) NOT NULL,
        notional_value DECIMAL(18, 2) NOT NULL,
        leverage INTEGER NOT NULL,
        entry_price DECIMAL(18, 2),
        liquidation_price DECIMAL(18, 2),
        stop_loss DECIMAL(18, 2),
        take_profit DECIMAL(18, 2),
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'liquidated', 'cancelled')),
        simulation_mode BOOLEAN NOT NULL DEFAULT true,
        reason TEXT,
        prediction_market TEXT,
        current_pnl DECIMAL(18, 2) DEFAULT 0,
        realized_pnl DECIMAL(18, 2) DEFAULT 0,
        funding_paid DECIMAL(18, 2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP WITH TIME ZONE,
        tx_hash VARCHAR(66)
      )
    `);
    // Migration columns (idempotent ADD COLUMN IF NOT EXISTS)
    // NOTE: Production DB was created with different column names (direction/amount instead of side/size)
    // and is missing several columns the code expects. These migrations ensure all required columns exist.
    await query(`
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS portfolio_id INTEGER;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(255);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS side VARCHAR(10);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS size DECIMAL(18, 8);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS notional_value DECIMAL(18, 2);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS market VARCHAR(50);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS simulation_mode BOOLEAN DEFAULT false;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS reason TEXT;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS prediction_market TEXT;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS current_pnl DECIMAL(18, 2) DEFAULT 0;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS realized_pnl DECIMAL(18, 2) DEFAULT 0;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS funding_paid DECIMAL(18, 2) DEFAULT 0;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS stop_loss DECIMAL(18, 2);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS take_profit DECIMAL(18, 2);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS zk_proof_hash VARCHAR(128);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS wallet_binding_hash VARCHAR(128);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS owner_commitment VARCHAR(128);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS hedge_id_onchain VARCHAR(66);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS chain VARCHAR(30) DEFAULT 'cronos-testnet';
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS chain_id INTEGER DEFAULT 338;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS contract_address VARCHAR(42);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS commitment_hash VARCHAR(66);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS nullifier VARCHAR(66);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS proxy_wallet VARCHAR(42);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS on_chain BOOLEAN DEFAULT false;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS explorer_link VARCHAR(256);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS block_number INTEGER;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS current_price DECIMAL(24, 10);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS price_source VARCHAR(50);
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE hedges ADD COLUMN IF NOT EXISTS close_reason VARCHAR(64);
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_hedges_order_id ON hedges(order_id);
      CREATE INDEX IF NOT EXISTS idx_hedges_portfolio ON hedges(portfolio_id);
      CREATE INDEX IF NOT EXISTS idx_hedges_status ON hedges(status);
      CREATE INDEX IF NOT EXISTS idx_hedges_asset ON hedges(asset);
      CREATE INDEX IF NOT EXISTS idx_hedges_created ON hedges(created_at);
      CREATE INDEX IF NOT EXISTS idx_hedges_wallet ON hedges(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_hedges_wallet_status ON hedges(wallet_address, status);
      CREATE INDEX IF NOT EXISTS idx_hedges_portfolio_status ON hedges(portfolio_id, status);
    `);
    hedgesTableReady = true;
    logger.debug('[Hedges DB] Table ensured');
  } catch (error) {
    logger.error('[Hedges DB] Failed to ensure table', { error });
    // Mark ready anyway to avoid retrying on every request if DB is up
    // but the table-creation SQL failed for a transient reason
    hedgesTableReady = true;
  }
}

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
  // DB-first optimization fields
  current_price: number | null;
  price_source: string | null;
  price_updated_at: Date | null;
}

export interface CreateHedgeParams {
  orderId: string;
  portfolioId?: number;
  walletAddress?: string;
  proxyWallet?: string;
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
  chain?: string;
  chainId?: number;
  zkProofHash?: string;
  walletBindingHash?: string;
  ownerCommitment?: string;
  metadata?: Record<string, unknown>;
}
