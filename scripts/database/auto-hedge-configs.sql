-- AUTO-HEDGE CONFIGURATIONS MIGRATION
-- Stores persistent auto-hedge settings for portfolios
-- Enables automatic hedging configuration without hardcoded values

-- ============================================
-- AUTO_HEDGE_CONFIGS TABLE
-- Stores enable/disable state and risk parameters for each portfolio
-- ============================================

CREATE TABLE IF NOT EXISTS auto_hedge_configs (
  -- Portfolio identification
  portfolio_id INTEGER PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  
  -- Configuration
  enabled BOOLEAN NOT NULL DEFAULT true,
  risk_threshold INTEGER NOT NULL DEFAULT 5,           -- 1-10 scale: trigger hedging at this risk level
  max_leverage INTEGER NOT NULL DEFAULT 3,              -- Maximum leverage for hedges
  allowed_assets JSONB DEFAULT '[]',                    -- Empty array = all assets allowed
  risk_tolerance INTEGER DEFAULT 50,                    -- 0-100 from on-chain portfolio settings
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_auto_hedge_enabled ON auto_hedge_configs(enabled);
CREATE INDEX IF NOT EXISTS idx_auto_hedge_wallet ON auto_hedge_configs(wallet_address);

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_auto_hedge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_auto_hedge_configs_updated_at ON auto_hedge_configs;
CREATE TRIGGER update_auto_hedge_configs_updated_at 
BEFORE UPDATE ON auto_hedge_configs
FOR EACH ROW EXECUTE FUNCTION update_auto_hedge_updated_at();

-- Comments for documentation
COMMENT ON TABLE auto_hedge_configs IS 'Persistent auto-hedge configurations for portfolios. Loaded on service startup to avoid hardcoded portfolio IDs.';
COMMENT ON COLUMN auto_hedge_configs.portfolio_id IS 'Portfolio ID from RWAManager contract';
COMMENT ON COLUMN auto_hedge_configs.risk_threshold IS 'Risk score (1-10) that triggers automatic hedging. Lower = more aggressive hedging.';
COMMENT ON COLUMN auto_hedge_configs.risk_tolerance IS 'On-chain risk tolerance (0-100) from portfolio settings. Maps to risk_threshold.';
COMMENT ON COLUMN auto_hedge_configs.allowed_assets IS 'JSON array of asset symbols that can be hedged. Empty array means all assets allowed.';

-- ============================================
-- INITIAL DATA (OPTIONAL)
-- Default configurations for existing portfolios
-- ============================================

-- Portfolio #3 (Institutional Portfolio - $157M+)
-- Wallet: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1
INSERT INTO auto_hedge_configs (portfolio_id, wallet_address, enabled, risk_threshold, max_leverage, allowed_assets)
VALUES (3, '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1', true, 5, 3, '["BTC", "ETH", "CRO", "SUI"]'::jsonb)
ON CONFLICT (portfolio_id) DO NOTHING;

-- Community Pool (Special ID: 0)
-- Contract: 0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B
INSERT INTO auto_hedge_configs (portfolio_id, wallet_address, enabled, risk_threshold, max_leverage, allowed_assets)
VALUES (0, '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B', true, 4, 2, '["BTC", "ETH", "CRO", "SUI"]'::jsonb)
ON CONFLICT (portfolio_id) DO NOTHING;

-- ============================================
-- HELPER VIEWS
-- ============================================

-- View for active auto-hedge configs with metadata
CREATE OR REPLACE VIEW active_auto_hedges AS
SELECT 
  portfolio_id,
  wallet_address,
  risk_threshold,
  max_leverage,
  allowed_assets,
  risk_tolerance,
  created_at,
  updated_at,
  CASE 
    WHEN risk_threshold <= 3 THEN 'AGGRESSIVE'
    WHEN risk_threshold <= 5 THEN 'MODERATE'
    WHEN risk_threshold <= 7 THEN 'CONSERVATIVE'
    ELSE 'VERY_CONSERVATIVE'
  END as hedge_strategy
FROM auto_hedge_configs
WHERE enabled = true
ORDER BY portfolio_id;

-- ============================================
-- USAGE EXAMPLES
-- ============================================

-- Get all enabled configurations
-- SELECT * FROM active_auto_hedges;

-- Enable auto-hedging for a new portfolio
-- INSERT INTO auto_hedge_configs (portfolio_id, wallet_address, enabled, risk_threshold, max_leverage, allowed_assets)
-- VALUES (4, '0x...', true, 5, 3, '["BTC", "ETH"]'::jsonb)
-- ON CONFLICT (portfolio_id) DO UPDATE SET enabled = true;

-- Disable auto-hedging for a portfolio
-- UPDATE auto_hedge_configs SET enabled = false WHERE portfolio_id = 3;

-- Update risk settings
-- UPDATE auto_hedge_configs 
-- SET risk_threshold = 7, max_leverage = 2 
-- WHERE portfolio_id = 3;

-- Delete configuration
-- DELETE FROM auto_hedge_configs WHERE portfolio_id = 4;
