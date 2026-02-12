-- ============================================================
-- PORTFOLIO SNAPSHOTS MIGRATION
-- Stores portfolio value history for PnL tracking and charts
-- Tracks actual on-chain positions and hedge PnL
-- ============================================================

-- ============================================
-- 1. PORTFOLIO SNAPSHOTS TABLE
-- Time-series portfolio values for performance charts
-- ============================================
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  total_value DECIMAL(24, 2) NOT NULL,
  
  -- On-chain verified data
  positions JSONB DEFAULT '[]',         -- Array of {symbol, value, amount, price, chain, onChain}
  hedges_data JSONB DEFAULT '{}',       -- {count, totalNotional, unrealizedPnL, portfolioIds}
  
  -- Calculated metrics
  positions_value DECIMAL(24, 2) DEFAULT 0,    -- Spot positions value
  hedges_value DECIMAL(24, 2) DEFAULT 0,       -- Hedge notional value
  unrealized_pnl DECIMAL(24, 2) DEFAULT 0,     -- Total unrealized PnL from hedges
  realized_pnl DECIMAL(24, 2) DEFAULT 0,       -- Total realized PnL
  
  -- Chain verification
  chain VARCHAR(30) DEFAULT 'cronos',
  block_number INTEGER,                         -- Block height at snapshot time
  verified_onchain BOOLEAN DEFAULT FALSE,       -- True if data verified via RPC
  
  -- Timestamps
  snapshot_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_psnap_wallet ON portfolio_snapshots(wallet_address);
CREATE INDEX IF NOT EXISTS idx_psnap_time ON portfolio_snapshots(snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_psnap_wallet_time ON portfolio_snapshots(wallet_address, snapshot_time DESC);

-- Time-based partitioning hint (for future scaling)
COMMENT ON TABLE portfolio_snapshots IS 'Time-series portfolio snapshots with on-chain verified data. Consider partitioning by month for scale.';

-- ============================================
-- 2. PORTFOLIO METRICS TABLE
-- Aggregated performance metrics per wallet
-- Updated on each snapshot for fast dashboard queries
-- ============================================
CREATE TABLE IF NOT EXISTS portfolio_metrics (
  wallet_address VARCHAR(42) PRIMARY KEY,
  
  -- Current values
  current_value DECIMAL(24, 2) DEFAULT 0,
  initial_value DECIMAL(24, 2) DEFAULT 0,       -- First recorded value
  highest_value DECIMAL(24, 2) DEFAULT 0,
  lowest_value DECIMAL(24, 2) DEFAULT 0,
  
  -- PnL metrics (calculated from hedges + positions)
  total_pnl DECIMAL(24, 2) DEFAULT 0,
  total_pnl_percentage DECIMAL(10, 4) DEFAULT 0,
  daily_pnl DECIMAL(24, 2) DEFAULT 0,
  daily_pnl_percentage DECIMAL(10, 4) DEFAULT 0,
  weekly_pnl DECIMAL(24, 2) DEFAULT 0,
  weekly_pnl_percentage DECIMAL(10, 4) DEFAULT 0,
  monthly_pnl DECIMAL(24, 2) DEFAULT 0,
  monthly_pnl_percentage DECIMAL(10, 4) DEFAULT 0,
  
  -- Risk metrics (from actual hedge data)
  volatility DECIMAL(10, 4) DEFAULT 0,
  sharpe_ratio DECIMAL(10, 4) DEFAULT 0,
  max_drawdown DECIMAL(10, 4) DEFAULT 0,
  win_rate DECIMAL(10, 4) DEFAULT 50,
  
  -- Hedge stats
  active_hedges INTEGER DEFAULT 0,
  total_hedge_pnl DECIMAL(24, 2) DEFAULT 0,
  
  -- Timestamps
  first_snapshot_at TIMESTAMP WITH TIME ZONE,
  last_snapshot_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE portfolio_metrics IS 'Aggregated portfolio metrics - fast dashboard queries without scanning snapshots';

-- ============================================
-- 3. HEDGE PNL HISTORY TABLE
-- Historical PnL for each hedge position
-- Enables hedge-level performance charts
-- ============================================
CREATE TABLE IF NOT EXISTS hedge_pnl_history (
  id SERIAL PRIMARY KEY,
  hedge_order_id VARCHAR(100) NOT NULL,
  wallet_address VARCHAR(42),
  
  -- Price and PnL at snapshot time
  entry_price DECIMAL(24, 10),
  current_price DECIMAL(24, 10),
  unrealized_pnl DECIMAL(24, 2),
  pnl_percentage DECIMAL(10, 4),
  
  -- Position info (denormalized for query performance)
  asset VARCHAR(20),
  side VARCHAR(10),
  size DECIMAL(24, 8),
  leverage INTEGER,
  notional_value DECIMAL(24, 2),
  
  -- Verification
  price_source VARCHAR(50),
  verified_onchain BOOLEAN DEFAULT FALSE,
  
  snapshot_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hpnl_order ON hedge_pnl_history(hedge_order_id);
CREATE INDEX IF NOT EXISTS idx_hpnl_wallet_time ON hedge_pnl_history(wallet_address, snapshot_time DESC);

COMMENT ON TABLE hedge_pnl_history IS 'Time-series hedge PnL for individual position performance tracking';

-- ============================================
-- 4. HELPER FUNCTIONS
-- ============================================

-- Function to get PnL within a time range
CREATE OR REPLACE FUNCTION get_period_pnl(
  p_wallet VARCHAR(42),
  p_start TIMESTAMP WITH TIME ZONE,
  p_end TIMESTAMP WITH TIME ZONE
) RETURNS TABLE(start_value DECIMAL, end_value DECIMAL, pnl DECIMAL, pnl_pct DECIMAL) AS $$
BEGIN
  RETURN QUERY
  WITH range_data AS (
    SELECT 
      (SELECT total_value FROM portfolio_snapshots 
       WHERE wallet_address = p_wallet AND snapshot_time >= p_start 
       ORDER BY snapshot_time ASC LIMIT 1) as sv,
      (SELECT total_value FROM portfolio_snapshots 
       WHERE wallet_address = p_wallet AND snapshot_time <= p_end 
       ORDER BY snapshot_time DESC LIMIT 1) as ev
  )
  SELECT 
    rd.sv as start_value,
    rd.ev as end_value,
    (rd.ev - rd.sv) as pnl,
    CASE WHEN rd.sv > 0 THEN ((rd.ev - rd.sv) / rd.sv) * 100 ELSE 0 END as pnl_pct
  FROM range_data rd;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_period_pnl IS 'Calculate PnL between two timestamps for a wallet';

-- ============================================
-- 5. MAINTENANCE: Retention policy
-- Keep detailed snapshots for 90 days, aggregate older
-- ============================================
-- (Can be scheduled as a cron job)
-- DELETE FROM portfolio_snapshots WHERE snapshot_time < NOW() - INTERVAL '90 days';
-- INSERT INTO portfolio_snapshots_monthly ... (aggregated data)
