-- Add ZK Proof fields for privacy-preserving wallet ownership verification
-- This enables proxy wallet hedging while maintaining cryptographic proof of ownership

-- Add ZK proof columns to hedges table
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS zk_proof_hash VARCHAR(128);
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS wallet_binding_hash VARCHAR(128);
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS owner_commitment VARCHAR(128);
ALTER TABLE hedges ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Create index for ZK lookups
CREATE INDEX IF NOT EXISTS idx_hedges_zk_proof ON hedges(zk_proof_hash);
CREATE INDEX IF NOT EXISTS idx_hedges_wallet_binding ON hedges(wallet_binding_hash);
CREATE INDEX IF NOT EXISTS idx_hedges_owner_commitment ON hedges(owner_commitment);

-- Comments for documentation
COMMENT ON COLUMN hedges.zk_proof_hash IS 'ZK-STARK proof hash for the hedge position';
COMMENT ON COLUMN hedges.wallet_binding_hash IS 'Hash that cryptographically binds hedge to wallet without revealing wallet address';
COMMENT ON COLUMN hedges.owner_commitment IS 'ZK commitment proving wallet ownership - can be verified without revealing real wallet';
COMMENT ON COLUMN hedges.metadata IS 'Additional metadata including privacy settings, binding proofs, etc.';
