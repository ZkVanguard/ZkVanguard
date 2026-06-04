/// RWAManager Module for SUI
/// Core contract for managing Real-World Asset portfolios on SUI
/// Handles portfolio tokenization, allocation tracking, and rebalancing
#[allow(unused_const, unused_field, unused_variable)]
module zkvanguard::rwa_manager {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};
    use sui::ed25519;
    use sui::dynamic_field as df;
    use std::string::String;

    // Audit 2026-06-04: ed25519 prover attestation key.
    const PROVER_PUBKEY_KEY: vector<u8> = b"rwa_prover_pubkey_v1";

    // ============ Error Codes ============
    const E_NOT_AUTHORIZED: u64 = 0;
    const E_PORTFOLIO_NOT_FOUND: u64 = 1;
    const E_PORTFOLIO_INACTIVE: u64 = 2;
    const E_INSUFFICIENT_BALANCE: u64 = 3;
    const E_REBALANCE_TOO_SOON: u64 = 4;
    const E_INVALID_ALLOCATION: u64 = 5;
    const E_ZERO_AMOUNT: u64 = 6;

    // ============ Constants ============
    const MIN_REBALANCE_INTERVAL: u64 = 3600000; // 1 hour in milliseconds
    const PROTOCOL_FEE_BPS: u64 = 50; // 0.5% = 50 basis points
    const BASIS_POINTS: u64 = 10000;

    // ============ Structs ============
    
    /// Admin capability for protocol management
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Agent capability for AI agent operations
    public struct AgentCap has key, store {
        id: UID,
        agent_address: address,
    }

    /// Strategy executor capability
    public struct StrategyExecutorCap has key, store {
        id: UID,
        executor_address: address,
    }

    /// Global state for the RWA Manager
    public struct RWAManagerState has key {
        id: UID,
        /// Total number of portfolios created
        portfolio_count: u64,
        /// Protocol fee in basis points
        protocol_fee_bps: u64,
        /// Fee collector address
        fee_collector: address,
        /// ZK Verifier module ID
        zk_verifier: Option<ID>,
        /// Minimum rebalance interval in milliseconds
        min_rebalance_interval: u64,
        /// Protocol paused status
        paused: bool,
        /// Collected fees
        fees: Balance<SUI>,
    }

    /// Portfolio structure
    public struct Portfolio has key, store {
        id: UID,
        /// Portfolio owner
        owner: address,
        /// Total value in SUI (in MIST - 1 SUI = 10^9 MIST)
        total_value: u64,
        /// Target yield in basis points (e.g., 800 = 8%)
        target_yield: u64,
        /// Risk tolerance 0-100
        risk_tolerance: u64,
        /// Last rebalance timestamp
        last_rebalance: u64,
        /// Active status
        is_active: bool,
        /// Portfolio balance
        balance: Balance<SUI>,
        /// Asset allocations (asset_id -> allocation percentage in BPS)
        allocations: Table<String, u64>,
        /// Creation timestamp
        created_at: u64,
    }

    /// Strategy execution record
    public struct StrategyExecution has store, drop, copy {
        portfolio_id: ID,
        strategy: String,
        timestamp: u64,
        executor: address,
        zk_proof_hash: vector<u8>,
        verified: bool,
        gas_used: u64,
    }

    // ============ Events ============

    public struct PortfolioCreated has copy, drop {
        portfolio_id: ID,
        owner: address,
        initial_value: u64,
        target_yield: u64,
        risk_tolerance: u64,
    }

    public struct Deposited has copy, drop {
        portfolio_id: ID,
        amount: u64,
        depositor: address,
        new_total: u64,
    }

    public struct Withdrawn has copy, drop {
        portfolio_id: ID,
        amount: u64,
        recipient: address,
        remaining_total: u64,
    }

    public struct StrategyExecuted has copy, drop {
        portfolio_id: ID,
        strategy: String,
        executor: address,
        zk_proof_hash: vector<u8>,
        success: bool,
    }

    public struct PortfolioRebalanced has copy, drop {
        portfolio_id: ID,
        old_value: u64,
        new_value: u64,
        timestamp: u64,
    }

    public struct ZKProofVerified has copy, drop {
        portfolio_id: ID,
        proof_hash: vector<u8>,
        verified: bool,
    }

    public struct AllocationUpdated has copy, drop {
        portfolio_id: ID,
        asset: String,
        previous_allocation: u64,
        new_allocation: u64,
    }

    // ============ Init ============

    /// Initialize the RWA Manager module
    fun init(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        
        // Create admin capability
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        transfer::transfer(admin_cap, sender);

        // Create global state
        let state = RWAManagerState {
            id: object::new(ctx),
            portfolio_count: 0,
            protocol_fee_bps: PROTOCOL_FEE_BPS,
            fee_collector: sender,
            zk_verifier: option::none(),
            min_rebalance_interval: MIN_REBALANCE_INTERVAL,
            paused: false,
            fees: balance::zero(),
        };
        transfer::share_object(state);
    }

    // ============ Admin Functions ============

    /// Grant agent capability
    public entry fun grant_agent_role(
        _admin: &AdminCap,
        agent_address: address,
        ctx: &mut TxContext,
    ) {
        let agent_cap = AgentCap {
            id: object::new(ctx),
            agent_address,
        };
        transfer::transfer(agent_cap, agent_address);
    }

    /// Grant strategy executor capability
    public entry fun grant_strategy_executor_role(
        _admin: &AdminCap,
        executor_address: address,
        ctx: &mut TxContext,
    ) {
        let executor_cap = StrategyExecutorCap {
            id: object::new(ctx),
            executor_address,
        };
        transfer::transfer(executor_cap, executor_address);
    }

    /// Set ZK verifier
    public entry fun set_zk_verifier(
        _admin: &AdminCap,
        state: &mut RWAManagerState,
        verifier_id: ID,
    ) {
        state.zk_verifier = option::some(verifier_id);
    }

    /// Set fee collector
    public entry fun set_fee_collector(
        _admin: &AdminCap,
        state: &mut RWAManagerState,
        new_collector: address,
    ) {
        state.fee_collector = new_collector;
    }

    /// Update protocol fee
    public entry fun set_protocol_fee(
        _admin: &AdminCap,
        state: &mut RWAManagerState,
        new_fee_bps: u64,
    ) {
        assert!(new_fee_bps <= 1000, E_INVALID_ALLOCATION); // Max 10%
        state.protocol_fee_bps = new_fee_bps;
    }

    /// Pause/unpause protocol
    public entry fun set_paused(
        _admin: &AdminCap,
        state: &mut RWAManagerState,
        paused: bool,
    ) {
        state.paused = paused;
    }

    /// Configure the off-chain prover's ed25519 public key (32 bytes).
    /// Empty pubkey clears it (back to insecure mode).
    public entry fun admin_set_prover_pubkey(
        _admin: &AdminCap,
        state: &mut RWAManagerState,
        pubkey: vector<u8>,
    ) {
        let len = vector::length(&pubkey);
        assert!(len == 32 || len == 0, E_INVALID_ALLOCATION);
        if (df::exists_(&state.id, PROVER_PUBKEY_KEY)) {
            let _: vector<u8> = df::remove(&mut state.id, PROVER_PUBKEY_KEY);
        };
        if (len == 32) {
            df::add(&mut state.id, PROVER_PUBKEY_KEY, pubkey);
        };
    }

    public fun has_prover_pubkey(state: &RWAManagerState): bool {
        df::exists_(&state.id, PROVER_PUBKEY_KEY)
    }

    /// Withdraw collected fees
    public entry fun withdraw_fees(
        _admin: &AdminCap,
        state: &mut RWAManagerState,
        ctx: &mut TxContext,
    ) {
        let fee_amount = balance::value(&state.fees);
        if (fee_amount > 0) {
            let fee_coin = coin::from_balance(
                balance::withdraw_all(&mut state.fees),
                ctx
            );
            transfer::public_transfer(fee_coin, state.fee_collector);
        }
    }

    // ============ Portfolio Functions ============

    /// Create a new portfolio
    public entry fun create_portfolio(
        state: &mut RWAManagerState,
        target_yield: u64,
        risk_tolerance: u64,
        deposit: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_NOT_AUTHORIZED);
        assert!(risk_tolerance <= 100, E_INVALID_ALLOCATION);
        
        let sender = tx_context::sender(ctx);
        let deposit_value = coin::value(&deposit);
        let current_time = clock::timestamp_ms(clock);

        let portfolio = Portfolio {
            id: object::new(ctx),
            owner: sender,
            total_value: deposit_value,
            target_yield,
            risk_tolerance,
            last_rebalance: current_time,
            is_active: true,
            balance: coin::into_balance(deposit),
            allocations: table::new(ctx),
            created_at: current_time,
        };

        let portfolio_id = object::id(&portfolio);
        
        state.portfolio_count = state.portfolio_count + 1;

        event::emit(PortfolioCreated {
            portfolio_id,
            owner: sender,
            initial_value: deposit_value,
            target_yield,
            risk_tolerance,
        });

        transfer::share_object(portfolio);
    }

    /// Deposit to portfolio
    public entry fun deposit(
        state: &mut RWAManagerState,
        portfolio: &mut Portfolio,
        deposit: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_NOT_AUTHORIZED);
        assert!(portfolio.is_active, E_PORTFOLIO_INACTIVE);
        
        let sender = tx_context::sender(ctx);
        let deposit_value = coin::value(&deposit);
        assert!(deposit_value > 0, E_ZERO_AMOUNT);

        // Calculate and deduct protocol fee
        let fee_amount = (deposit_value * state.protocol_fee_bps) / BASIS_POINTS;
        let net_deposit = deposit_value - fee_amount;

        let mut deposit_balance = coin::into_balance(deposit);
        
        // Extract fee
        let fee_balance = balance::split(&mut deposit_balance, fee_amount);
        balance::join(&mut state.fees, fee_balance);

        // Add remaining to portfolio
        balance::join(&mut portfolio.balance, deposit_balance);
        portfolio.total_value = portfolio.total_value + net_deposit;

        event::emit(Deposited {
            portfolio_id: object::id(portfolio),
            amount: net_deposit,
            depositor: sender,
            new_total: portfolio.total_value,
        });
    }

    /// Withdraw from portfolio
    public entry fun withdraw(
        state: &RWAManagerState,
        portfolio: &mut Portfolio,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_NOT_AUTHORIZED);
        let sender = tx_context::sender(ctx);
        assert!(sender == portfolio.owner, E_NOT_AUTHORIZED);
        assert!(portfolio.is_active, E_PORTFOLIO_INACTIVE);
        assert!(amount > 0, E_ZERO_AMOUNT);
        assert!(balance::value(&portfolio.balance) >= amount, E_INSUFFICIENT_BALANCE);

        let withdrawn = coin::from_balance(
            balance::split(&mut portfolio.balance, amount),
            ctx
        );
        
        portfolio.total_value = portfolio.total_value - amount;

        event::emit(Withdrawn {
            portfolio_id: object::id(portfolio),
            amount,
            recipient: sender,
            remaining_total: portfolio.total_value,
        });

        transfer::public_transfer(withdrawn, sender);
    }

    /// Execute strategy (agents/executors only).
    ///
    /// NOTE: The actual strategy execution logic is not implemented in
    /// this module — this function only verifies the proof of intent
    /// and emits an event. Real strategy actions live elsewhere (off-
    /// chain orchestrator, or future module composition).
    ///
    /// AUDIT 2026-06-04: previously `verified = length > 0` (theatre).
    /// Now: if a prover pubkey is set, the first 64 bytes of
    /// zk_proof_hash must be an ed25519 signature from that prover over
    /// the portfolio_id + strategy bytes.
    public entry fun execute_strategy(
        _agent: &AgentCap,
        state: &RWAManagerState,
        portfolio: &mut Portfolio,
        strategy: String,
        zk_proof_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_NOT_AUTHORIZED);
        assert!(portfolio.is_active, E_PORTFOLIO_INACTIVE);

        let executor = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock);

        // Build context message from portfolio id + strategy bytes so
        // the prover signs a binding over what is being executed.
        let portfolio_id = object::id(portfolio);
        let mut msg = sui::bcs::to_bytes(&portfolio_id);
        let strategy_bytes = std::string::as_bytes(&strategy);
        vector::append(&mut msg, *strategy_bytes);

        let verified = verify_with_prover_rwa(state, &zk_proof_hash, &msg);
        assert!(verified, E_NOT_AUTHORIZED);

        event::emit(StrategyExecuted {
            portfolio_id: object::id(portfolio),
            strategy,
            executor,
            zk_proof_hash,
            success: verified,
        });

        if (verified) {
            event::emit(ZKProofVerified {
                portfolio_id: object::id(portfolio),
                proof_hash: zk_proof_hash,
                verified: true,
            });
        }
    }

    /// Rebalance portfolio
    public entry fun rebalance(
        _agent: &AgentCap,
        state: &RWAManagerState,
        portfolio: &mut Portfolio,
        clock: &Clock,
        _ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_NOT_AUTHORIZED);
        assert!(portfolio.is_active, E_PORTFOLIO_INACTIVE);

        let current_time = clock::timestamp_ms(clock);
        assert!(
            current_time >= portfolio.last_rebalance + state.min_rebalance_interval,
            E_REBALANCE_TOO_SOON
        );

        let old_value = portfolio.total_value;
        
        // Update rebalance timestamp
        portfolio.last_rebalance = current_time;

        event::emit(PortfolioRebalanced {
            portfolio_id: object::id(portfolio),
            old_value,
            new_value: portfolio.total_value,
            timestamp: current_time,
        });
    }

    /// Update asset allocation
    public entry fun update_allocation(
        _agent: &AgentCap,
        state: &RWAManagerState,
        portfolio: &mut Portfolio,
        asset: String,
        new_allocation: u64,
        _ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_NOT_AUTHORIZED);
        assert!(portfolio.is_active, E_PORTFOLIO_INACTIVE);
        assert!(new_allocation <= BASIS_POINTS, E_INVALID_ALLOCATION);

        let previous_allocation = if (table::contains(&portfolio.allocations, asset)) {
            *table::borrow(&portfolio.allocations, asset)
        } else {
            0
        };

        if (table::contains(&portfolio.allocations, asset)) {
            *table::borrow_mut(&mut portfolio.allocations, asset) = new_allocation;
        } else {
            table::add(&mut portfolio.allocations, asset, new_allocation);
        };

        event::emit(AllocationUpdated {
            portfolio_id: object::id(portfolio),
            asset,
            previous_allocation,
            new_allocation,
        });
    }

    /// Deactivate portfolio
    public entry fun deactivate_portfolio(
        portfolio: &mut Portfolio,
        ctx: &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(sender == portfolio.owner, E_NOT_AUTHORIZED);
        portfolio.is_active = false;
    }

    // ============ View Functions ============

    /// Get portfolio total value
    public fun get_portfolio_value(portfolio: &Portfolio): u64 {
        portfolio.total_value
    }

    /// Get portfolio owner
    public fun get_portfolio_owner(portfolio: &Portfolio): address {
        portfolio.owner
    }

    /// Check if portfolio is active
    public fun is_portfolio_active(portfolio: &Portfolio): bool {
        portfolio.is_active
    }

    /// Get protocol state info
    public fun get_protocol_info(state: &RWAManagerState): (u64, u64, bool) {
        (state.portfolio_count, state.protocol_fee_bps, state.paused)
    }

    /// Get portfolio balance
    public fun get_portfolio_balance(portfolio: &Portfolio): u64 {
        balance::value(&portfolio.balance)
    }

    /// Internal: verify a proof with the configured prover, falling back
    /// to the legacy length check if no prover is configured.
    fun verify_with_prover_rwa(
        state: &RWAManagerState,
        proof: &vector<u8>,
        msg: &vector<u8>,
    ): bool {
        if (vector::length(proof) < 64) {
            // No prover, no minimum signature length — accept any
            // non-empty proof as in the legacy implementation.
            if (!df::exists_(&state.id, PROVER_PUBKEY_KEY)) {
                return vector::length(proof) > 0
            };
            return false
        };
        if (df::exists_(&state.id, PROVER_PUBKEY_KEY)) {
            let pubkey: &vector<u8> = df::borrow(&state.id, PROVER_PUBKEY_KEY);
            let mut sig = vector::empty<u8>();
            let mut i: u64 = 0;
            while (i < 64) {
                vector::push_back(&mut sig, *vector::borrow(proof, i));
                i = i + 1;
            };
            return ed25519::ed25519_verify(&sig, pubkey, msg)
        };
        // INSECURE legacy mode.
        true
    }

    // ============ Test Functions ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx)
    }
}
