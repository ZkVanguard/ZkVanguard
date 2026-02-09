-- Hedge Ownership Table for ZkVanguard
-- Stores off-chain ownership mapping for gasless hedge positions
-- Used to verify hedge ownership without revealing wallet on-chain

CREATE TABLE IF NOT EXISTS hedge_ownership (
  id SERIAL PRIMARY KEY,
  commitment_hash VARCHAR(66) UNIQUE NOT NULL,  -- bytes32 commitment from ZK proof
  wallet_address VARCHAR(42) NOT NULL,          -- Owner wallet
  pair_index INTEGER NOT NULL DEFAULT 0,        -- Trading pair index
  asset VARCHAR(20) NOT NULL,                   -- Asset symbol (BTC, ETH, etc)
  side VARCHAR(10) NOT NULL,                    -- LONG or SHORT
  collateral DECIMAL(18, 8) NOT NULL,           -- Collateral amount in USDC
  leverage INTEGER NOT NULL,                    -- Leverage multiplier
  opened_at TIMESTAMP WITH TIME ZONE NOT NULL,  -- When hedge was opened
  tx_hash VARCHAR(66),                          -- Transaction hash
  on_chain_hedge_id VARCHAR(66),                -- bytes32 hedgeId from HedgeExecutor
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_hedge_ownership_commitment ON hedge_ownership(commitment_hash);
CREATE INDEX IF NOT EXISTS idx_hedge_ownership_wallet ON hedge_ownership(wallet_address);
CREATE INDEX IF NOT EXISTS idx_hedge_ownership_asset ON hedge_ownership(asset);
