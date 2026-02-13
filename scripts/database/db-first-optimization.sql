-- ============================================================
-- DB-FIRST OPTIMIZATION MIGRATION
-- Adds tables for caching on-chain data, prices, portfolio 
-- transactions, and wallet positions. Eliminates redundant RPC
-- calls by serving from DB with background chain sync.
-- ============================================================

-- ============================================
-- 1. PRICE CACHE TABLE
-- Shared price cache eliminates 6+ independent
-- Crypto.com API calls across routes
-- ============================================
CREATE TABLE IF NOT EXISTS price_cache (
  symbol VARCHAR(20) PRIMARY KEY,
  price DECIMAL(24, 10) NOT NULL,
  change_24h DECIMAL(10, 4) DEFAULT 0,
  volume_24h DECIMAL(24, 2) DEFAULT 0,
  high_24h DECIMAL(24, 10),
  low_24h DECIMAL(24, 10),
  source VARCHAR(50) DEFAULT 'cryptocom-exchange',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_price_cache_updated ON price_cache(updated_at);

COMMENT ON TABLE price_cache IS 'Shared price cache – refreshed every 15s, eliminates duplicate Crypto.com API calls';

-- ============================================
-- 2. PORTFOLIO TRANSACTIONS TABLE
-- Caches on-chain deposit/withdraw/rebalance events
-- so we only scan new blocks since last sync
-- ============================================
CREATE TABLE IF NOT EXISTS portfolio_transactions (
  id SERIAL PRIMARY KEY,
  portfolio_id INTEGER NOT NULL,
  tx_type VARCHAR(20) NOT NULL CHECK (tx_type IN ('deposit', 'withdraw', 'rebalance')),
  tx_hash VARCHAR(66) NOT NULL,
  block_number INTEGER NOT NULL,
  timestamp BIGINT NOT NULL,
  token VARCHAR(42),
  token_symbol VARCHAR(20),
  amount DECIMAL(24, 8),
  depositor VARCHAR(42),
  recipient VARCHAR(42),
  chain VARCHAR(30) DEFAULT 'cronos-testnet',
  chain_id INTEGER DEFAULT 338,
  contract_address VARCHAR(42),
  wallet_address VARCHAR(42),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tx_hash, portfolio_id, tx_type)
);

-- Add wallet_address column if it doesn't exist (migration)
ALTER TABLE portfolio_transactions ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(42);

CREATE INDEX IF NOT EXISTS idx_ptx_portfolio ON portfolio_transactions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_ptx_block ON portfolio_transactions(block_number);
CREATE INDEX IF NOT EXISTS idx_ptx_timestamp ON portfolio_transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ptx_type ON portfolio_transactions(tx_type);
CREATE INDEX IF NOT EXISTS idx_ptx_wallet ON portfolio_transactions(wallet_address);

COMMENT ON TABLE portfolio_transactions IS 'Cached on-chain portfolio events – only scan new blocks since max(block_number)';

-- ============================================
-- 3. WALLET POSITIONS TABLE
-- Caches wallet token balances & USD values
-- Refresh interval: 30s (matches current API cache)
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_positions (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  balance VARCHAR(50) NOT NULL,
  balance_usd DECIMAL(18, 2) DEFAULT 0,
  price DECIMAL(24, 10) DEFAULT 0,
  change_24h DECIMAL(10, 4) DEFAULT 0,
  token_address VARCHAR(42),
  source VARCHAR(50) DEFAULT 'rpc',
  chain VARCHAR(30) DEFAULT 'cronos-testnet',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wallet_address, symbol, chain)
);

CREATE INDEX IF NOT EXISTS idx_wpos_wallet ON wallet_positions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wpos_updated ON wallet_positions(updated_at);

COMMENT ON TABLE wallet_positions IS 'Cached wallet balances – serves /api/positions instantly, background RPC refresh';

-- ============================================
-- 4. SYNC METADATA TABLE
-- Tracks last synced block per contract/event type
-- for incremental chain sync
-- ============================================
CREATE TABLE IF NOT EXISTS sync_metadata (
  sync_key VARCHAR(100) PRIMARY KEY,
  last_block INTEGER NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

COMMENT ON TABLE sync_metadata IS 'Tracks last synced block for incremental on-chain event scanning';

-- Seed initial sync metadata entries
INSERT INTO sync_metadata (sync_key, last_block) VALUES
  ('hedge_events', 0),
  ('portfolio_transactions', 0),
  ('price_cache_refresh', 0)
ON CONFLICT (sync_key) DO NOTHING;

-- ============================================
-- 5. ADD current_price TO hedges TABLE
-- Store last known price so DB-only queries
-- return meaningful PnL without live RPC
-- ============================================
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS current_price DECIMAL(24, 10);
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS price_source VARCHAR(50);
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN hedges.current_price IS 'Last known market price for PnL calculation';
COMMENT ON COLUMN hedges.price_source IS 'Source of last price (e.g. cryptocom-exchange)';
COMMENT ON COLUMN hedges.price_updated_at IS 'When current_price was last updated';

-- ============================================
-- 6. VIEWS FOR OPTIMIZED QUERIES
-- ============================================

-- Active on-chain hedges with full details (single query)
CREATE OR REPLACE VIEW v_active_onchain_hedges AS
SELECT 
  h.*,
  pc.price AS live_price,
  pc.change_24h AS price_change_24h,
  pc.updated_at AS price_fetched_at,
  CASE 
    WHEN h.entry_price IS NOT NULL AND h.entry_price > 0 AND pc.price IS NOT NULL THEN
      CASE 
        WHEN h.side = 'LONG' THEN h.size * h.leverage * ((pc.price - h.entry_price) / h.entry_price)
        ELSE h.size * h.leverage * ((h.entry_price - pc.price) / h.entry_price)
      END
    ELSE h.current_pnl
  END AS computed_pnl
FROM hedges h
LEFT JOIN price_cache pc ON UPPER(h.asset) = UPPER(pc.symbol)
WHERE h.on_chain = true AND h.status = 'active';

-- Hedge summary stats (eliminates contract.getProtocolStats() RPC)
CREATE OR REPLACE VIEW v_hedge_protocol_stats AS
SELECT
  COUNT(*) FILTER (WHERE status = 'active' AND on_chain = true) AS active_count,
  COUNT(*) FILTER (WHERE status IN ('closed', 'liquidated') AND on_chain = true) AS closed_count,
  COUNT(*) FILTER (WHERE on_chain = true) AS total_onchain,
  COALESCE(SUM(size) FILTER (WHERE status = 'active' AND on_chain = true), 0) AS collateral_locked,
  COALESCE(SUM(realized_pnl) FILTER (WHERE on_chain = true), 0) AS total_pnl_realized
FROM hedges;
