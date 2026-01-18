-- Hedges Table Schema for ZkVanguard
-- Stores simulated hedge positions from Moonlander
-- Can be migrated to real on-chain data later

-- ============================================
-- HEDGES TABLE
-- Stores all hedge positions (simulated & real)
-- ============================================

CREATE TABLE IF NOT EXISTS hedges (
  id SERIAL PRIMARY KEY,
  
  -- Order identification
  order_id VARCHAR(100) UNIQUE NOT NULL,
  portfolio_id INTEGER,
  
  -- Position details
  asset VARCHAR(20) NOT NULL,
  market VARCHAR(50) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  
  -- Financials
  size DECIMAL(18, 8) NOT NULL,
  notional_value DECIMAL(18, 2) NOT NULL,
  leverage INTEGER NOT NULL,
  entry_price DECIMAL(18, 2),
  liquidation_price DECIMAL(18, 2),
  stop_loss DECIMAL(18, 2),
  take_profit DECIMAL(18, 2),
  
  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'liquidated', 'cancelled')),
  simulation_mode BOOLEAN NOT NULL DEFAULT true,
  
  -- Metadata
  reason TEXT,
  prediction_market TEXT,
  
  -- PnL tracking
  current_pnl DECIMAL(18, 2) DEFAULT 0,
  realized_pnl DECIMAL(18, 2) DEFAULT 0,
  funding_paid DECIMAL(18, 2) DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP WITH TIME ZONE,
  
  -- Transaction reference (if on-chain)
  tx_hash VARCHAR(66)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_hedges_order_id ON hedges(order_id);
CREATE INDEX IF NOT EXISTS idx_hedges_portfolio ON hedges(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_hedges_status ON hedges(status);
CREATE INDEX IF NOT EXISTS idx_hedges_asset ON hedges(asset);
CREATE INDEX IF NOT EXISTS idx_hedges_created ON hedges(created_at);
CREATE INDEX IF NOT EXISTS idx_hedges_simulation ON hedges(simulation_mode);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_hedges_updated_at BEFORE UPDATE ON hedges
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEWS FOR ANALYTICS
-- ============================================

-- Active hedges summary
CREATE OR REPLACE VIEW active_hedges_summary AS
SELECT 
  asset,
  side,
  COUNT(*) as position_count,
  SUM(notional_value) as total_notional,
  AVG(leverage) as avg_leverage,
  SUM(current_pnl) as total_pnl,
  simulation_mode
FROM hedges
WHERE status = 'active'
GROUP BY asset, side, simulation_mode;

-- Daily hedge statistics
CREATE OR REPLACE VIEW daily_hedge_stats AS
SELECT 
  DATE(created_at) as date,
  COUNT(*) as hedges_created,
  SUM(notional_value) as total_volume,
  AVG(leverage) as avg_leverage,
  COUNT(CASE WHEN status = 'closed' AND realized_pnl > 0 THEN 1 END) as profitable_closes,
  COUNT(CASE WHEN status = 'closed' THEN 1 END) as total_closes
FROM hedges
GROUP BY DATE(created_at)
ORDER BY date DESC;
