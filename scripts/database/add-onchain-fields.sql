-- Add on-chain hedge fields to support DB-cached tx hashes and contract data
-- This eliminates slow event log scanning by storing on-chain data at creation time

-- On-chain hedge identifier (bytes32 from HedgeExecutor contract)
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS hedge_id_onchain VARCHAR(66);

-- Chain & contract info
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS chain VARCHAR(30) DEFAULT 'cronos-testnet';
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS chain_id INTEGER DEFAULT 338;
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS contract_address VARCHAR(42);

-- ZK on-chain fields
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS commitment_hash VARCHAR(66);
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS nullifier VARCHAR(66);
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS proxy_wallet VARCHAR(42);

-- Flags
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS on_chain BOOLEAN DEFAULT false;

-- Explorer link convenience
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS explorer_link VARCHAR(256);

-- Block number when created (useful for audit)
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS block_number INTEGER;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hedges_hedge_id_onchain ON hedges(hedge_id_onchain);
CREATE INDEX IF NOT EXISTS idx_hedges_on_chain ON hedges(on_chain);
CREATE INDEX IF NOT EXISTS idx_hedges_chain ON hedges(chain);
CREATE INDEX IF NOT EXISTS idx_hedges_commitment_hash ON hedges(commitment_hash);

-- Comments
COMMENT ON COLUMN hedges.hedge_id_onchain IS 'bytes32 hedge ID from HedgeExecutor smart contract';
COMMENT ON COLUMN hedges.chain IS 'Chain name (e.g. cronos-testnet)';
COMMENT ON COLUMN hedges.contract_address IS 'HedgeExecutor contract address';
COMMENT ON COLUMN hedges.commitment_hash IS 'ZK commitment hash stored on-chain';
COMMENT ON COLUMN hedges.nullifier IS 'ZK nullifier (prevents double-spend)';
COMMENT ON COLUMN hedges.proxy_wallet IS 'Derived ZK proxy wallet address';
COMMENT ON COLUMN hedges.on_chain IS 'Whether this hedge exists on-chain (vs simulation)';
COMMENT ON COLUMN hedges.explorer_link IS 'Cronos Explorer URL for the creation transaction';
COMMENT ON COLUMN hedges.block_number IS 'Block number of creation transaction';
