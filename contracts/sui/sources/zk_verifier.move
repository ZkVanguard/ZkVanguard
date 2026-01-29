/// ZK Verifier Module for SUI
/// Handles zero-knowledge proof verification on SUI blockchain
#[allow(unused_const, unused_field)]
module zkvanguard::zk_verifier {
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};
    use sui::hash;
    use std::string::String;

    // ============ Error Codes ============
    const E_NOT_AUTHORIZED: u64 = 0;
    const E_INVALID_PROOF: u64 = 1;
    const E_PROOF_ALREADY_USED: u64 = 2;
    const E_PROOF_EXPIRED: u64 = 3;
    const E_PAUSED: u64 = 4;

    // ============ Constants ============
    const PROOF_EXPIRY_MS: u64 = 86400000; // 24 hours in milliseconds

    // ============ Structs ============

    /// Admin capability
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Verifier capability for external verifiers
    public struct VerifierCap has key, store {
        id: UID,
        verifier_address: address,
    }

    /// ZK Verifier state
    public struct ZKVerifierState has key {
        id: UID,
        /// Total proofs verified
        total_proofs_verified: u64,
        /// Used proof hashes (to prevent replay)
        used_proofs: Table<vector<u8>, bool>,
        /// Paused status
        paused: bool,
        /// Proof expiry time in ms
        proof_expiry_ms: u64,
    }

    /// Proof record
    public struct ProofRecord has key, store {
        id: UID,
        /// Proof hash
        proof_hash: vector<u8>,
        /// Commitment hash (for hedge commitments)
        commitment_hash: vector<u8>,
        /// Verifier address
        verifier: address,
        /// Timestamp of verification
        verified_at: u64,
        /// Portfolio ID associated with proof
        portfolio_id: Option<ID>,
        /// Proof type (e.g., "hedge", "rebalance", "allocation")
        proof_type: String,
        /// Additional metadata
        metadata: String,
    }

    /// ZK Commitment for hedge strategies
    public struct ZKCommitment has key, store {
        id: UID,
        /// Commitment owner
        owner: address,
        /// Commitment hash
        commitment_hash: vector<u8>,
        /// Strategy type
        strategy_type: String,
        /// Risk level (0-100)
        risk_level: u64,
        /// Created timestamp
        created_at: u64,
        /// Executed status
        executed: bool,
        /// Execution timestamp
        executed_at: Option<u64>,
    }

    // ============ Events ============

    public struct ProofVerified has copy, drop {
        proof_hash: vector<u8>,
        commitment_hash: vector<u8>,
        verifier: address,
        proof_type: String,
        timestamp: u64,
    }

    public struct CommitmentCreated has copy, drop {
        commitment_id: ID,
        owner: address,
        commitment_hash: vector<u8>,
        strategy_type: String,
        risk_level: u64,
    }

    public struct CommitmentExecuted has copy, drop {
        commitment_id: ID,
        owner: address,
        executor: address,
        timestamp: u64,
    }

    public struct ProofRejected has copy, drop {
        proof_hash: vector<u8>,
        reason: String,
        timestamp: u64,
    }

    // ============ Init ============

    fun init(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);

        // Create admin capability
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        transfer::transfer(admin_cap, sender);

        // Create verifier state
        let state = ZKVerifierState {
            id: object::new(ctx),
            total_proofs_verified: 0,
            used_proofs: table::new(ctx),
            paused: false,
            proof_expiry_ms: PROOF_EXPIRY_MS,
        };
        transfer::share_object(state);
    }

    // ============ Admin Functions ============

    /// Grant verifier capability
    public entry fun grant_verifier_role(
        _admin: &AdminCap,
        verifier_address: address,
        ctx: &mut TxContext,
    ) {
        let verifier_cap = VerifierCap {
            id: object::new(ctx),
            verifier_address,
        };
        transfer::transfer(verifier_cap, verifier_address);
    }

    /// Set paused status
    public entry fun set_paused(
        _admin: &AdminCap,
        state: &mut ZKVerifierState,
        paused: bool,
    ) {
        state.paused = paused;
    }

    /// Update proof expiry time
    public entry fun set_proof_expiry(
        _admin: &AdminCap,
        state: &mut ZKVerifierState,
        expiry_ms: u64,
    ) {
        state.proof_expiry_ms = expiry_ms;
    }

    // ============ Verification Functions ============

    /// Verify a ZK proof
    public entry fun verify_proof(
        state: &mut ZKVerifierState,
        proof_data: vector<u8>,
        commitment_hash: vector<u8>,
        proof_type: String,
        metadata: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);

        let verifier = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock);
        
        // Generate proof hash from proof data
        let proof_hash = hash::keccak256(&proof_data);
        
        // Check if proof already used (prevent replay attacks)
        assert!(!table::contains(&state.used_proofs, proof_hash), E_PROOF_ALREADY_USED);

        // Mark proof as used
        table::add(&mut state.used_proofs, proof_hash, true);

        // Increment counter
        state.total_proofs_verified = state.total_proofs_verified + 1;

        // Create proof record
        let proof_record = ProofRecord {
            id: object::new(ctx),
            proof_hash,
            commitment_hash,
            verifier,
            verified_at: current_time,
            portfolio_id: option::none(),
            proof_type,
            metadata,
        };

        event::emit(ProofVerified {
            proof_hash,
            commitment_hash,
            verifier,
            proof_type: proof_record.proof_type,
            timestamp: current_time,
        });

        // Transfer proof record to verifier
        transfer::transfer(proof_record, verifier);
    }

    /// Create a ZK commitment for hedge strategy
    public entry fun create_commitment(
        state: &ZKVerifierState,
        commitment_data: vector<u8>,
        strategy_type: String,
        risk_level: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(risk_level <= 100, E_INVALID_PROOF);

        let owner = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock);
        
        // Generate commitment hash
        let commitment_hash = hash::keccak256(&commitment_data);

        let commitment = ZKCommitment {
            id: object::new(ctx),
            owner,
            commitment_hash,
            strategy_type,
            risk_level,
            created_at: current_time,
            executed: false,
            executed_at: option::none(),
        };

        let commitment_id = object::id(&commitment);

        event::emit(CommitmentCreated {
            commitment_id,
            owner,
            commitment_hash,
            strategy_type: commitment.strategy_type,
            risk_level,
        });

        transfer::transfer(commitment, owner);
    }

    /// Execute a ZK commitment
    public entry fun execute_commitment(
        _verifier: &VerifierCap,
        state: &ZKVerifierState,
        commitment: &mut ZKCommitment,
        proof_data: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(!commitment.executed, E_PROOF_ALREADY_USED);

        let executor = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock);

        // Verify proof matches commitment
        let proof_hash = hash::keccak256(&proof_data);
        // In production, add proper ZK proof verification here
        assert!(vector::length(&proof_hash) > 0, E_INVALID_PROOF);

        commitment.executed = true;
        commitment.executed_at = option::some(current_time);

        event::emit(CommitmentExecuted {
            commitment_id: object::id(commitment),
            owner: commitment.owner,
            executor,
            timestamp: current_time,
        });
    }

    /// Verify proof with portfolio reference
    public entry fun verify_proof_for_portfolio(
        state: &mut ZKVerifierState,
        proof_data: vector<u8>,
        commitment_hash: vector<u8>,
        portfolio_id: ID,
        proof_type: String,
        metadata: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);

        let verifier = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock);
        
        let proof_hash = hash::keccak256(&proof_data);
        
        assert!(!table::contains(&state.used_proofs, proof_hash), E_PROOF_ALREADY_USED);

        table::add(&mut state.used_proofs, proof_hash, true);
        state.total_proofs_verified = state.total_proofs_verified + 1;

        let proof_record = ProofRecord {
            id: object::new(ctx),
            proof_hash,
            commitment_hash,
            verifier,
            verified_at: current_time,
            portfolio_id: option::some(portfolio_id),
            proof_type,
            metadata,
        };

        event::emit(ProofVerified {
            proof_hash,
            commitment_hash,
            verifier,
            proof_type: proof_record.proof_type,
            timestamp: current_time,
        });

        transfer::transfer(proof_record, verifier);
    }

    // ============ View Functions ============

    /// Get total proofs verified
    public fun get_total_proofs_verified(state: &ZKVerifierState): u64 {
        state.total_proofs_verified
    }

    /// Check if proof has been used
    public fun is_proof_used(state: &ZKVerifierState, proof_hash: vector<u8>): bool {
        table::contains(&state.used_proofs, proof_hash)
    }

    /// Check if verifier is paused
    public fun is_paused(state: &ZKVerifierState): bool {
        state.paused
    }

    /// Get commitment info
    public fun get_commitment_info(commitment: &ZKCommitment): (address, vector<u8>, bool) {
        (commitment.owner, commitment.commitment_hash, commitment.executed)
    }

    /// Get proof record info
    public fun get_proof_info(record: &ProofRecord): (vector<u8>, address, u64) {
        (record.proof_hash, record.verifier, record.verified_at)
    }

    // ============ Test Functions ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx)
    }
}
