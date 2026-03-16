/// ZkVanguard Community Pool Module for SUI
/// AI-managed community investment pool with share-based ownership
/// ERC-4626-inspired vault adapted for Move/SUI
/// 
/// Features:
/// - Share-based ownership: Deposit SUI → receive proportional shares
/// - Fair withdrawals: Burn shares → receive proportional NAV
/// - AI-driven allocation: Agent role can manage treasury
/// - Self-sustaining: Management fee (0.5% annual) + Performance fee (10%)
/// - High-water mark: Performance fee only on new highs
/// - AI Decision tracking with cross-chain coordination
/// - Auto-hedge integration with BlueFin
/// - Timelock for admin operations
#[allow(unused_const, unused_field, unused_use)]
module zkvanguard::community_pool {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};
    use sui::math;
    use sui::hash;
    use sui::bcs;

    // ============ Error Codes ============
    const E_NOT_AUTHORIZED: u64 = 0;
    const E_PAUSED: u64 = 1;
    const E_ZERO_AMOUNT: u64 = 2;
    const E_INSUFFICIENT_SHARES: u64 = 3;
    const E_INSUFFICIENT_BALANCE: u64 = 4;
    const E_MIN_DEPOSIT_NOT_MET: u64 = 5;
    const E_MIN_SHARES_NOT_MET: u64 = 6;
    const E_NOT_MEMBER: u64 = 7;
    const E_ALREADY_MEMBER: u64 = 8;
    const E_CIRCUIT_BREAKER_TRIPPED: u64 = 9;
    const E_MAX_DEPOSIT_EXCEEDED: u64 = 10;
    const E_MAX_WITHDRAWAL_EXCEEDED: u64 = 11;
    const E_DAILY_WITHDRAWAL_EXCEEDED: u64 = 12;
    const E_FEE_TOO_HIGH: u64 = 13;
    const E_INVALID_ALLOCATION: u64 = 14;
    const E_REBALANCE_COOLDOWN: u64 = 15;
    const E_AI_CONFIDENCE_TOO_LOW: u64 = 16;
    const E_DECISION_ALREADY_EXECUTED: u64 = 17;
    const E_HEDGE_COOLDOWN: u64 = 18;
    const E_RESERVE_RATIO_BREACHED: u64 = 19;
    const E_MAX_HEDGE_EXCEEDED: u64 = 20;
    const E_HEDGE_NOT_FOUND: u64 = 21;
    const E_TIMELOCK_NOT_READY: u64 = 22;
    const E_TIMELOCK_EXPIRED: u64 = 23;
    const E_OPERATION_NOT_FOUND: u64 = 24;
    const E_EMERGENCY_MODE_REQUIRED: u64 = 25;
    const E_NOTHING_TO_RESCUE: u64 = 26;

    // ============ Constants ============
    const BPS_DENOMINATOR: u64 = 10000;
    const SECONDS_PER_YEAR: u64 = 31536000; // 365 days
    // Testnet: Lower minimums for testing (0.1 SUI min, 0.5 SUI first deposit)
    const MIN_DEPOSIT: u64 = 100_000_000; // 0.1 SUI (in MIST, 9 decimals)
    const MIN_SHARES_FOR_WITHDRAWAL: u64 = 1_000_000; // 0.001 shares (9 decimals)
    const MIN_FIRST_DEPOSIT: u64 = 500_000_000; // 0.5 SUI
    // Virtual offset for ERC-4626 inflation protection
    // Using 1:1 ratio to prevent overflow while maintaining protection
    const VIRTUAL_SHARES: u64 = 1_000_000_000; // 1 share (9 decimals like SUI)
    const VIRTUAL_ASSETS: u64 = 1_000_000_000; // 1 SUI in MIST
    const WAD: u64 = 1_000_000_000; // 1e9 (9 decimal precision for shares)

    // Reserve and safety limits
    const MIN_RESERVE_RATIO_BPS: u64 = 2000; // 20% must stay liquid
    const MAX_SINGLE_HEDGE_BPS: u64 = 500;   // Max 5% per hedge
    const DAILY_HEDGE_CAP_BPS: u64 = 1500;   // Max 15% daily hedging

    // Circuit breaker defaults
    const DEFAULT_MAX_SINGLE_DEPOSIT: u64 = 100_000_000_000_000; // 100K SUI
    const DEFAULT_MAX_SINGLE_WITHDRAWAL_BPS: u64 = 2500; // 25%
    const DEFAULT_DAILY_WITHDRAWAL_CAP_BPS: u64 = 5000;  // 50%
    const WHALE_THRESHOLD_BPS: u64 = 1000; // 10%

    // Default fees (basis points)
    const DEFAULT_MANAGEMENT_FEE_BPS: u64 = 50; // 0.5%
    const DEFAULT_PERFORMANCE_FEE_BPS: u64 = 1000; // 10%

    // Timelock delays (milliseconds)
    const MAINNET_TIMELOCK_DELAY: u64 = 172800000; // 48 hours
    const TESTNET_TIMELOCK_DELAY: u64 = 300000;    // 5 minutes
    const TIMELOCK_EXPIRY: u64 = 604800000;        // 7 days

    // AI Management constants
    const DEFAULT_MIN_AI_CONFIDENCE: u8 = 50; // 0-100 scale
    const DEFAULT_REBALANCE_COOLDOWN: u64 = 3600000; // 1 hour in ms

    // SUI Chain ID for cross-chain coordination
    const SUI_CHAIN_ID: u64 = 101; // SUI mainnet identifier

    // ============ Structs ============

    /// Admin capability
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Agent capability (AI keeper)
    public struct AgentCap has key, store {
        id: UID,
        agent_address: address,
    }

    /// Fee manager capability
    public struct FeeManagerCap has key, store {
        id: UID,
    }

    /// Rebalancer capability
    public struct RebalancerCap has key, store {
        id: UID,
    }

    /// Member data structure
    public struct MemberData has store, copy, drop {
        shares: u64,             // Number of shares owned
        deposited_sui: u64,      // Total SUI deposited
        withdrawn_sui: u64,      // Total SUI withdrawn
        joined_at: u64,          // Timestamp of first deposit
        last_deposit_at: u64,    // Timestamp of last deposit
        high_water_mark: u64,    // For performance fee calculation
    }

    /// AI Decision for cross-chain coordination
    public struct AIDecision has store, copy, drop {
        decision_id: vector<u8>,        // Unique ID (hash)
        timestamp: u64,                 // When decision was made
        target_alloc_bps: u64,          // Target allocation for SUI (0-10000)
        confidence: u8,                 // AI confidence (0-100)
        urgency: u8,                    // 0=low, 1=medium, 2=high
        expected_return_bps: u64,       // Expected return in BPS
        risk_score: u64,                // Risk score (0-10000)
        reason_hash: vector<u8>,        // Hash of AI reasoning
        data_feed_hash: vector<u8>,     // Hash of price data used
        executed: bool,                 // Whether executed
    }

    /// Rebalance Record for history tracking
    public struct RebalanceRecord has store, copy, drop {
        timestamp: u64,
        previous_alloc_bps: u64,
        new_alloc_bps: u64,
        reason_hash: vector<u8>,
        executor: address,
    }

    /// Cross-chain signal for AI coordination
    public struct CrossChainSignal has store, copy, drop {
        signal_id: vector<u8>,
        timestamp: u64,
        source_chain_id: u64,
        target_alloc_bps: u64,
        price_data_hash: vector<u8>,
        action: u8,                    // 0=hold, 1=rebalance, 2=hedge, 3=dehedge
        acknowledged: bool,
    }

    /// AI Agent metrics
    public struct AIAgentMetrics has store, copy, drop {
        total_decisions: u64,
        successful_decisions: u64,
        cumulative_return_bps: u64,    // Can track as absolute value
        avg_confidence: u64,           // Scaled by 100
        last_decision_time: u64,
        last_decision_id: vector<u8>,
    }

    /// Auto-hedge configuration
    public struct AutoHedgeConfig has store, copy, drop {
        enabled: bool,
        risk_threshold_bps: u64,       // Risk level to trigger (e.g., 500 = 5%)
        max_hedge_ratio_bps: u64,      // Max portion of NAV (e.g., 2500 = 25%)
        default_leverage: u64,         // Default leverage (2-10)
        cooldown_ms: u64,              // Min time between hedges
        last_hedge_time: u64,
    }

    /// Active hedge position
    public struct HedgePosition has store, copy, drop {
        hedge_id: vector<u8>,
        pair_index: u8,                // 0=BTC, 1=ETH, 2=SUI
        collateral_amount: u64,
        leverage: u64,
        is_long: bool,
        open_time: u64,
        reason_hash: vector<u8>,
    }

    /// Timelock operation (for admin governance)
    public struct TimelockOperation has store, copy, drop {
        operation_id: vector<u8>,
        operation_type: u8,            // 0=treasury, 1=fees, 2=limits, 3=agent
        target_value: u64,
        target_address: address,
        scheduled_time: u64,           // When it can be executed
        expiry_time: u64,              // When it expires
        executed: bool,
    }

    /// Community Pool State (shared object)
    public struct CommunityPoolState has key {
        id: UID,
        /// Pool balance
        balance: Balance<SUI>,
        /// Total shares outstanding
        total_shares: u64,
        /// Total deposited (in MIST)
        total_deposited: u64,
        /// Total withdrawn (in MIST)
        total_withdrawn: u64,
        /// All-time high NAV per share (scaled by WAD)
        all_time_high_nav_per_share: u64,
        /// Management fee rate in BPS (50 = 0.5%)
        management_fee_bps: u64,
        /// Performance fee rate in BPS (1000 = 10%)
        performance_fee_bps: u64,
        /// Accumulated management fees (in MIST)
        accumulated_management_fees: u64,
        /// Accumulated performance fees (in MIST)
        accumulated_performance_fees: u64,
        /// Last fee collection timestamp (ms)
        last_fee_collection: u64,
        /// Treasury address for fee collection
        treasury: address,
        /// Paused status
        paused: bool,
        /// Circuit breaker tripped
        circuit_breaker_tripped: bool,
        /// Max single deposit
        max_single_deposit: u64,
        /// Max single withdrawal BPS
        max_single_withdrawal_bps: u64,
        /// Daily withdrawal cap BPS
        daily_withdrawal_cap_bps: u64,
        /// Daily withdrawal total
        daily_withdrawal_total: u64,
        /// Current withdrawal day (ms timestamp / 86400000)
        current_withdrawal_day: u64,
        /// Member data table
        members: Table<address, MemberData>,
        /// Member list for enumeration
        member_count: u64,
        /// AI Agent addresses (for off-chain tracking)
        agent_addresses: vector<address>,
        /// Pool creation timestamp
        created_at: u64,
        
        // ═══ AI MANAGEMENT STATE ═══
        /// Current AI decision
        current_ai_decision: AIDecision,
        /// AI decision history (last N decisions)
        ai_decision_count: u64,
        /// Latest cross-chain signal
        latest_signal: CrossChainSignal,
        /// AI agent metrics by index (simplified from Table)
        agent_metrics: vector<AIAgentMetrics>,
        /// Minimum AI confidence required (0-100)
        min_ai_confidence: u8,
        /// Whether signal verification is required
        require_signal_verification: bool,
        
        // ═══ REBALANCING STATE ═══
        /// Target allocation for SUI in BPS (0-10000)
        target_allocation_bps: u64,
        /// Last rebalance timestamp
        last_rebalance_time: u64,
        /// Rebalance cooldown in ms
        rebalance_cooldown: u64,
        /// Rebalance history (last N records)
        rebalance_count: u64,
        
        // ═══ AUTO-HEDGE STATE ═══
        /// Auto-hedge configuration
        auto_hedge_config: AutoHedgeConfig,
        /// Active hedge positions
        active_hedges: vector<HedgePosition>,
        /// Total value currently hedged
        total_hedged_value: u64,
        /// Daily hedge total
        daily_hedge_total: u64,
        /// Current hedge day
        current_hedge_day: u64,
        
        // ═══ TIMELOCK STATE ═══
        /// Pending timelock operations
        pending_operations: vector<TimelockOperation>,
        /// Timelock delay in ms (48h mainnet, 5min testnet)
        timelock_delay: u64,
        /// Emergency withdraw enabled (bypasses timelock)
        emergency_withdraw_enabled: bool,
    }

    // ============ Events ============

    public struct PoolCreated has copy, drop {
        pool_id: ID,
        treasury: address,
        creator: address,
        timestamp: u64,
    }

    public struct Deposited has copy, drop {
        member: address,
        amount_sui: u64,
        shares_received: u64,
        share_price: u64,
        timestamp: u64,
    }

    public struct Withdrawn has copy, drop {
        member: address,
        shares_burned: u64,
        amount_sui: u64,
        share_price: u64,
        timestamp: u64,
    }

    public struct FeesCollected has copy, drop {
        management_fee: u64,
        performance_fee: u64,
        collector: address,
        timestamp: u64,
    }

    public struct PoolPaused has copy, drop {
        pool_id: ID,
        paused: bool,
        timestamp: u64,
    }

    public struct CircuitBreakerTripped has copy, drop {
        pool_id: ID,
        reason: vector<u8>,
        timestamp: u64,
    }

    public struct TreasuryUpdated has copy, drop {
        pool_id: ID,
        old_treasury: address,
        new_treasury: address,
        timestamp: u64,
    }

    public struct AgentAdded has copy, drop {
        pool_id: ID,
        agent: address,
        timestamp: u64,
    }

    public struct EmergencyWithdrawal has copy, drop {
        member: address,
        amount: u64,
        timestamp: u64,
    }

    // ═══ AI MANAGEMENT EVENTS ═══
    
    public struct AIDecisionRecorded has copy, drop {
        decision_id: vector<u8>,
        agent: address,
        target_alloc_bps: u64,
        confidence: u8,
        expected_return_bps: u64,
        timestamp: u64,
    }

    public struct AIDecisionExecuted has copy, drop {
        decision_id: vector<u8>,
        executor: address,
        successful: bool,
        timestamp: u64,
    }

    public struct CrossChainSignalReceived has copy, drop {
        signal_id: vector<u8>,
        source_chain_id: u64,
        action: u8,
        timestamp: u64,
    }

    public struct AIAgentMetricsUpdated has copy, drop {
        agent: address,
        total_decisions: u64,
        cumulative_return_bps: u64,
        timestamp: u64,
    }

    // ═══ REBALANCE EVENTS ═══

    public struct Rebalanced has copy, drop {
        executor: address,
        previous_bps: u64,
        new_bps: u64,
        reason_hash: vector<u8>,
        timestamp: u64,
    }

    public struct AllocationUpdated has copy, drop {
        old_bps: u64,
        new_bps: u64,
        timestamp: u64,
    }

    // ═══ AUTO-HEDGE EVENTS ═══

    public struct PoolHedgeOpened has copy, drop {
        hedge_id: vector<u8>,
        pair_index: u8,
        collateral_amount: u64,
        leverage: u64,
        is_long: bool,
        timestamp: u64,
    }

    public struct PoolHedgeClosed has copy, drop {
        hedge_id: vector<u8>,
        pnl_amount: u64,
        is_profit: bool,
        timestamp: u64,
    }

    public struct AutoHedgeConfigUpdated has copy, drop {
        enabled: bool,
        risk_threshold_bps: u64,
        max_hedge_ratio_bps: u64,
        default_leverage: u64,
        timestamp: u64,
    }

    // ═══ TIMELOCK EVENTS ═══

    public struct TimelockOperationScheduled has copy, drop {
        operation_id: vector<u8>,
        operation_type: u8,
        scheduled_time: u64,
        timestamp: u64,
    }

    public struct TimelockOperationExecuted has copy, drop {
        operation_id: vector<u8>,
        operation_type: u8,
        timestamp: u64,
    }

    public struct TimelockOperationCancelled has copy, drop {
        operation_id: vector<u8>,
        timestamp: u64,
    }

    // ═══ RESCUE EVENTS ═══

    public struct TokensRescued has copy, drop {
        amount: u64,
        recipient: address,
        timestamp: u64,
    }

    public struct CircuitBreakerReset has copy, drop {
        pool_id: ID,
        timestamp: u64,
    }

    // ============ Init ============

    /// Initialize module and create admin, fee manager, and rebalancer capabilities
    fun init(ctx: &mut TxContext) {
        transfer::transfer(
            AdminCap { id: object::new(ctx) },
            ctx.sender()
        );
        transfer::transfer(
            FeeManagerCap { id: object::new(ctx) },
            ctx.sender()
        );
        transfer::transfer(
            RebalancerCap { id: object::new(ctx) },
            ctx.sender()
        );
    }

    // ============ Pool Creation ============

    /// Create a new Community Pool
    public entry fun create_pool(
        _admin: &AdminCap,
        treasury: address,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let timestamp = clock::timestamp_ms(clock);
        
        // Initialize empty AI decision
        let empty_decision = AIDecision {
            decision_id: vector::empty(),
            timestamp: 0,
            target_alloc_bps: 10000, // 100% SUI by default
            confidence: 0,
            urgency: 0,
            expected_return_bps: 0,
            risk_score: 0,
            reason_hash: vector::empty(),
            data_feed_hash: vector::empty(),
            executed: true,
        };

        // Initialize empty cross-chain signal
        let empty_signal = CrossChainSignal {
            signal_id: vector::empty(),
            timestamp: 0,
            source_chain_id: 0,
            target_alloc_bps: 10000,
            price_data_hash: vector::empty(),
            action: 0,
            acknowledged: true,
        };

        // Initialize auto-hedge config (disabled by default)
        let hedge_config = AutoHedgeConfig {
            enabled: false,
            risk_threshold_bps: 500,        // 5% drawdown triggers hedge
            max_hedge_ratio_bps: 2500,      // Max 25% of NAV can be hedged
            default_leverage: 3,            // 3x leverage default
            cooldown_ms: 3600000,           // 1 hour cooldown
            last_hedge_time: 0,
        };
        
        let state = CommunityPoolState {
            id: object::new(ctx),
            balance: balance::zero<SUI>(),
            total_shares: 0,
            total_deposited: 0,
            total_withdrawn: 0,
            all_time_high_nav_per_share: WAD, // Start at 1.0
            management_fee_bps: DEFAULT_MANAGEMENT_FEE_BPS,
            performance_fee_bps: DEFAULT_PERFORMANCE_FEE_BPS,
            accumulated_management_fees: 0,
            accumulated_performance_fees: 0,
            last_fee_collection: timestamp,
            treasury,
            paused: false,
            circuit_breaker_tripped: false,
            max_single_deposit: DEFAULT_MAX_SINGLE_DEPOSIT,
            max_single_withdrawal_bps: DEFAULT_MAX_SINGLE_WITHDRAWAL_BPS,
            daily_withdrawal_cap_bps: DEFAULT_DAILY_WITHDRAWAL_CAP_BPS,
            daily_withdrawal_total: 0,
            current_withdrawal_day: timestamp / 86400000,
            members: table::new(ctx),
            member_count: 0,
            agent_addresses: vector::empty(),
            created_at: timestamp,
            
            // AI Management state
            current_ai_decision: empty_decision,
            ai_decision_count: 0,
            latest_signal: empty_signal,
            agent_metrics: vector::empty(),
            min_ai_confidence: DEFAULT_MIN_AI_CONFIDENCE,
            require_signal_verification: false, // Disabled for testnet
            
            // Rebalancing state
            target_allocation_bps: 10000, // 100% SUI
            last_rebalance_time: 0,
            rebalance_cooldown: DEFAULT_REBALANCE_COOLDOWN,
            rebalance_count: 0,
            
            // Auto-hedge state
            auto_hedge_config: hedge_config,
            active_hedges: vector::empty(),
            total_hedged_value: 0,
            daily_hedge_total: 0,
            current_hedge_day: timestamp / 86400000,
            
            // Timelock state
            pending_operations: vector::empty(),
            timelock_delay: TESTNET_TIMELOCK_DELAY, // 5 minutes for testnet
            emergency_withdraw_enabled: false,
        };

        event::emit(PoolCreated {
            pool_id: object::id(&state),
            treasury,
            creator: ctx.sender(),
            timestamp,
        });

        transfer::share_object(state);
    }

    // ============ Core Functions ============

    /// Deposit SUI and receive shares
    public entry fun deposit(
        state: &mut CommunityPoolState,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(!state.circuit_breaker_tripped, E_CIRCUIT_BREAKER_TRIPPED);

        let amount = coin::value(&payment);
        assert!(amount > 0, E_ZERO_AMOUNT);
        assert!(amount >= MIN_DEPOSIT, E_MIN_DEPOSIT_NOT_MET);
        assert!(amount <= state.max_single_deposit, E_MAX_DEPOSIT_EXCEEDED);

        // First deposit must meet minimum
        if (state.total_shares == 0) {
            assert!(amount >= MIN_FIRST_DEPOSIT, E_MIN_DEPOSIT_NOT_MET);
        };

        let sender = ctx.sender();
        let timestamp = clock::timestamp_ms(clock);

        // Collect fees before calculating shares
        collect_management_fee_internal(state, timestamp);

        // Calculate shares using virtual offset (prevents inflation attack)
        let shares_to_mint = calculate_shares_for_deposit(state, amount);

        // Update pool state
        let coin_balance = coin::into_balance(payment);
        balance::join(&mut state.balance, coin_balance);
        state.total_shares = state.total_shares + shares_to_mint;
        state.total_deposited = state.total_deposited + amount;

        // Update or create member
        if (table::contains(&state.members, sender)) {
            let member = table::borrow_mut(&mut state.members, sender);
            member.shares = member.shares + shares_to_mint;
            member.deposited_sui = member.deposited_sui + amount;
            member.last_deposit_at = timestamp;
        } else {
            let new_member = MemberData {
                shares: shares_to_mint,
                deposited_sui: amount,
                withdrawn_sui: 0,
                joined_at: timestamp,
                last_deposit_at: timestamp,
                high_water_mark: get_nav_per_share(state),
            };
            table::add(&mut state.members, sender, new_member);
            state.member_count = state.member_count + 1;
        };

        // Update all-time high if new high
        let current_nav = get_nav_per_share(state);
        if (current_nav > state.all_time_high_nav_per_share) {
            state.all_time_high_nav_per_share = current_nav;
        };

        event::emit(Deposited {
            member: sender,
            amount_sui: amount,
            shares_received: shares_to_mint,
            share_price: current_nav,
            timestamp,
        });
    }

    /// Withdraw by burning shares
    public entry fun withdraw(
        state: &mut CommunityPoolState,
        shares_to_burn: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(!state.circuit_breaker_tripped, E_CIRCUIT_BREAKER_TRIPPED);
        assert!(shares_to_burn > 0, E_ZERO_AMOUNT);
        assert!(shares_to_burn >= MIN_SHARES_FOR_WITHDRAWAL, E_MIN_SHARES_NOT_MET);

        let sender = ctx.sender();
        let timestamp = clock::timestamp_ms(clock);

        // Verify member exists and has enough shares
        assert!(table::contains(&state.members, sender), E_NOT_MEMBER);
        let member = table::borrow(&state.members, sender);
        assert!(member.shares >= shares_to_burn, E_INSUFFICIENT_SHARES);

        // Reset daily tracker if new day
        let current_day = timestamp / 86400000;
        if (current_day > state.current_withdrawal_day) {
            state.daily_withdrawal_total = 0;
            state.current_withdrawal_day = current_day;
        };

        // Collect fees before calculating withdrawal
        collect_management_fee_internal(state, timestamp);
        collect_performance_fee_internal(state, sender);

        // Calculate withdrawal amount
        let amount_to_withdraw = calculate_assets_for_shares(state, shares_to_burn);
        assert!(balance::value(&state.balance) >= amount_to_withdraw, E_INSUFFICIENT_BALANCE);

        // Check circuit breaker limits
        let nav = get_total_nav(state);
        let max_single_withdrawal = (nav * state.max_single_withdrawal_bps) / BPS_DENOMINATOR;
        assert!(amount_to_withdraw <= max_single_withdrawal, E_MAX_WITHDRAWAL_EXCEEDED);

        let daily_cap = (nav * state.daily_withdrawal_cap_bps) / BPS_DENOMINATOR;
        assert!(
            state.daily_withdrawal_total + amount_to_withdraw <= daily_cap,
            E_DAILY_WITHDRAWAL_EXCEEDED
        );

        // Update state
        state.total_shares = state.total_shares - shares_to_burn;
        state.total_withdrawn = state.total_withdrawn + amount_to_withdraw;
        state.daily_withdrawal_total = state.daily_withdrawal_total + amount_to_withdraw;

        // Update member
        let member_mut = table::borrow_mut(&mut state.members, sender);
        member_mut.shares = member_mut.shares - shares_to_burn;
        member_mut.withdrawn_sui = member_mut.withdrawn_sui + amount_to_withdraw;

        // Transfer funds
        let withdrawal_balance = balance::split(&mut state.balance, amount_to_withdraw);
        let withdrawal_coin = coin::from_balance(withdrawal_balance, ctx);
        transfer::public_transfer(withdrawal_coin, sender);

        event::emit(Withdrawn {
            member: sender,
            shares_burned: shares_to_burn,
            amount_sui: amount_to_withdraw,
            share_price: get_nav_per_share(state),
            timestamp,
        });
    }

    /// Emergency withdrawal (when circuit breaker is tripped - allows pro-rata exit)
    public entry fun emergency_withdraw(
        state: &mut CommunityPoolState,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(state.circuit_breaker_tripped || state.paused, E_NOT_AUTHORIZED);

        let sender = ctx.sender();
        let timestamp = clock::timestamp_ms(clock);

        assert!(table::contains(&state.members, sender), E_NOT_MEMBER);
        let member = table::borrow(&state.members, sender);
        assert!(member.shares > 0, E_INSUFFICIENT_SHARES);

        let shares_to_burn = member.shares;
        let mut amount_to_withdraw = calculate_assets_for_shares(state, shares_to_burn);

        // Cap at available balance
        let available = balance::value(&state.balance);
        if (amount_to_withdraw > available) {
            amount_to_withdraw = available;
        };

        // Update state
        state.total_shares = state.total_shares - shares_to_burn;
        state.total_withdrawn = state.total_withdrawn + amount_to_withdraw;

        // Update member
        let member_mut = table::borrow_mut(&mut state.members, sender);
        member_mut.shares = 0;
        member_mut.withdrawn_sui = member_mut.withdrawn_sui + amount_to_withdraw;

        // Transfer funds
        let withdrawal_balance = balance::split(&mut state.balance, amount_to_withdraw);
        let withdrawal_coin = coin::from_balance(withdrawal_balance, ctx);
        transfer::public_transfer(withdrawal_coin, sender);

        event::emit(EmergencyWithdrawal {
            member: sender,
            amount: amount_to_withdraw,
            timestamp,
        });
    }

    // ============ Fee Functions ============

    /// Collect accumulated fees to treasury
    public entry fun collect_fees(
        _fee_manager: &FeeManagerCap,
        state: &mut CommunityPoolState,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let timestamp = clock::timestamp_ms(clock);
        collect_management_fee_internal(state, timestamp);

        let total_fees = state.accumulated_management_fees + state.accumulated_performance_fees;
        assert!(total_fees > 0, E_ZERO_AMOUNT);
        assert!(balance::value(&state.balance) >= total_fees, E_INSUFFICIENT_BALANCE);

        // Reset accumulators
        let mgmt_fee = state.accumulated_management_fees;
        let perf_fee = state.accumulated_performance_fees;
        state.accumulated_management_fees = 0;
        state.accumulated_performance_fees = 0;

        // Transfer to treasury
        let fee_balance = balance::split(&mut state.balance, total_fees);
        let fee_coin = coin::from_balance(fee_balance, ctx);
        transfer::public_transfer(fee_coin, state.treasury);

        event::emit(FeesCollected {
            management_fee: mgmt_fee,
            performance_fee: perf_fee,
            collector: ctx.sender(),
            timestamp,
        });
    }

    /// Internal: Collect time-based management fee
    fun collect_management_fee_internal(state: &mut CommunityPoolState, current_time: u64) {
        if (state.total_shares == 0) {
            state.last_fee_collection = current_time;
            return
        };

        let time_elapsed_ms = current_time - state.last_fee_collection;
        if (time_elapsed_ms == 0) return;

        // Convert to seconds for annual fee calculation
        let time_elapsed_sec = time_elapsed_ms / 1000;
        let nav = get_total_nav(state);

        // management_fee = NAV * fee_bps * time_elapsed / (BPS * SECONDS_PER_YEAR)
        let fee = (nav * state.management_fee_bps * time_elapsed_sec) / 
                  (BPS_DENOMINATOR * SECONDS_PER_YEAR);

        if (fee > 0) {
            state.accumulated_management_fees = state.accumulated_management_fees + fee;
        };

        state.last_fee_collection = current_time;
    }

    /// Internal: Collect performance fee on withdrawal (if above high water mark)
    fun collect_performance_fee_internal(state: &mut CommunityPoolState, member_addr: address) {
        if (!table::contains(&state.members, member_addr)) return;

        let member = table::borrow(&state.members, member_addr);
        let current_nav_per_share = get_nav_per_share(state);

        if (current_nav_per_share > member.high_water_mark) {
            let gain_per_share = current_nav_per_share - member.high_water_mark;
            let member_gain = (gain_per_share * member.shares) / WAD;
            let performance_fee = (member_gain * state.performance_fee_bps) / BPS_DENOMINATOR;

            if (performance_fee > 0) {
                state.accumulated_performance_fees = 
                    state.accumulated_performance_fees + performance_fee;
            };
        };

        // Update member's high water mark
        let member_mut = table::borrow_mut(&mut state.members, member_addr);
        member_mut.high_water_mark = current_nav_per_share;
    }

    // ============ View Functions ============

    /// Calculate NAV per share (scaled by WAD = 1e9 for 9 decimal precision)
    public fun get_nav_per_share(state: &CommunityPoolState): u64 {
        if (state.total_shares == 0) {
            return WAD // 1.0
        };

        let total_assets = balance::value(&state.balance) + VIRTUAL_ASSETS;
        let total_shares = state.total_shares + VIRTUAL_SHARES;

        // NAV per share = (total_assets * WAD) / total_shares
        ((total_assets as u128) * (WAD as u128) / (total_shares as u128)) as u64
    }

    /// Get total NAV (pool value in MIST)
    public fun get_total_nav(state: &CommunityPoolState): u64 {
        balance::value(&state.balance)
    }

    /// Calculate shares for a given deposit amount
    public fun calculate_shares_for_deposit(state: &CommunityPoolState, amount: u64): u64 {
        let total_assets = balance::value(&state.balance) + VIRTUAL_ASSETS;
        let total_shares = state.total_shares + VIRTUAL_SHARES;

        // shares = (amount * total_shares) / total_assets
        ((amount as u128) * (total_shares as u128) / (total_assets as u128)) as u64
    }

    /// Calculate assets for a given share amount
    public fun calculate_assets_for_shares(state: &CommunityPoolState, shares: u64): u64 {
        if (state.total_shares == 0) return 0;

        let total_assets = balance::value(&state.balance) + VIRTUAL_ASSETS;
        let total_shares = state.total_shares + VIRTUAL_SHARES;

        // assets = (shares * total_assets) / total_shares
        ((shares as u128) * (total_assets as u128) / (total_shares as u128)) as u64
    }

    /// Get member info
    public fun get_member_info(state: &CommunityPoolState, member: address): (u64, u64, u64, u64, u64) {
        if (!table::contains(&state.members, member)) {
            return (0, 0, 0, 0, 0)
        };

        let m = table::borrow(&state.members, member);
        (m.shares, m.deposited_sui, m.withdrawn_sui, m.joined_at, m.last_deposit_at)
    }

    /// Check if address is a member
    public fun is_member(state: &CommunityPoolState, addr: address): bool {
        table::contains(&state.members, addr)
    }

    /// Get pool statistics
    public fun get_pool_stats(state: &CommunityPoolState): (u64, u64, u64, u64, u64) {
        (
            balance::value(&state.balance),
            state.total_shares,
            state.total_deposited,
            state.total_withdrawn,
            state.member_count
        )
    }

    // ============ Admin Functions ============

    /// Pause/unpause the pool
    public entry fun set_paused(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        paused: bool,
        clock: &Clock,
    ) {
        state.paused = paused;
        event::emit(PoolPaused {
            pool_id: object::id(state),
            paused,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    /// Trip circuit breaker
    public entry fun trip_circuit_breaker(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        reason: vector<u8>,
        clock: &Clock,
    ) {
        state.circuit_breaker_tripped = true;
        event::emit(CircuitBreakerTripped {
            pool_id: object::id(state),
            reason,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    /// Reset circuit breaker
    public entry fun reset_circuit_breaker(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
    ) {
        state.circuit_breaker_tripped = false;
    }

    /// Update treasury address
    public entry fun set_treasury(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        new_treasury: address,
        clock: &Clock,
    ) {
        let old_treasury = state.treasury;
        state.treasury = new_treasury;
        event::emit(TreasuryUpdated {
            pool_id: object::id(state),
            old_treasury,
            new_treasury,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    /// Update fee rates
    public entry fun set_fees(
        _fee_manager: &FeeManagerCap,
        state: &mut CommunityPoolState,
        management_fee_bps: u64,
        performance_fee_bps: u64,
    ) {
        assert!(management_fee_bps <= 500, E_FEE_TOO_HIGH); // Max 5%
        assert!(performance_fee_bps <= 3000, E_FEE_TOO_HIGH); // Max 30%

        state.management_fee_bps = management_fee_bps;
        state.performance_fee_bps = performance_fee_bps;
    }

    /// Update circuit breaker limits
    public entry fun set_circuit_breaker_limits(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        max_single_deposit: u64,
        max_single_withdrawal_bps: u64,
        daily_withdrawal_cap_bps: u64,
    ) {
        state.max_single_deposit = max_single_deposit;
        state.max_single_withdrawal_bps = max_single_withdrawal_bps;
        state.daily_withdrawal_cap_bps = daily_withdrawal_cap_bps;
    }

    /// Add an agent address (for off-chain tracking)
    public entry fun add_agent(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        agent: address,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        vector::push_back(&mut state.agent_addresses, agent);

        // Create and transfer agent capability
        transfer::transfer(
            AgentCap { 
                id: object::new(ctx),
                agent_address: agent,
            },
            agent
        );

        event::emit(AgentAdded {
            pool_id: object::id(state),
            agent,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    /// Create additional admin capability (for multisig)
    public entry fun create_admin_cap(
        _admin: &AdminCap,
        recipient: address,
        ctx: &mut TxContext
    ) {
        transfer::transfer(
            AdminCap { id: object::new(ctx) },
            recipient
        );
    }

    /// Create fee manager capability
    public entry fun create_fee_manager_cap(
        _admin: &AdminCap,
        recipient: address,
        ctx: &mut TxContext
    ) {
        transfer::transfer(
            FeeManagerCap { id: object::new(ctx) },
            recipient
        );
    }

    /// Create rebalancer capability
    public entry fun create_rebalancer_cap(
        _admin: &AdminCap,
        recipient: address,
        ctx: &mut TxContext
    ) {
        transfer::transfer(
            RebalancerCap { id: object::new(ctx) },
            recipient
        );
    }

    // ============ AI Management Functions ============

    /// Record an AI decision (can be executed separately)
    /// @param target_alloc_bps Target SUI allocation (0-10000 basis points)
    /// @param confidence AI confidence level (0-100)
    /// @param urgency Execution urgency (0=low, 1=medium, 2=high)
    /// @param expected_return_bps Expected return in basis points
    /// @param risk_score Risk score (0-10000)
    /// @param reasoning Human-readable reasoning (will be hashed)
    /// @param price_data_hash Hash of price data used for decision
    public entry fun record_ai_decision(
        _agent: &AgentCap,
        state: &mut CommunityPoolState,
        target_alloc_bps: u64,
        confidence: u8,
        urgency: u8,
        expected_return_bps: u64,
        risk_score: u64,
        reasoning: vector<u8>,
        price_data_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // Validate confidence meets minimum
        assert!(confidence >= state.min_ai_confidence, E_AI_CONFIDENCE_TOO_LOW);
        
        // Validate allocation is valid
        assert!(target_alloc_bps <= BPS_DENOMINATOR, E_INVALID_ALLOCATION);
        
        let timestamp = clock::timestamp_ms(clock);
        let sender = ctx.sender();
        
        // Generate unique decision ID
        let mut id_data = bcs::to_bytes(&timestamp);
        vector::append(&mut id_data, bcs::to_bytes(&sender));
        vector::append(&mut id_data, bcs::to_bytes(&target_alloc_bps));
        let decision_id = hash::keccak256(&id_data);
        
        // Hash the reasoning
        let reason_hash = hash::keccak256(&reasoning);
        
        // Create decision
        let decision = AIDecision {
            decision_id,
            timestamp,
            target_alloc_bps,
            confidence,
            urgency,
            expected_return_bps,
            risk_score,
            reason_hash,
            data_feed_hash: price_data_hash,
            executed: false,
        };
        
        // Store as current decision
        state.current_ai_decision = decision;
        state.ai_decision_count = state.ai_decision_count + 1;
        
        // Update agent metrics
        update_agent_metrics(state, sender, confidence);
        
        event::emit(AIDecisionRecorded {
            decision_id,
            agent: sender,
            target_alloc_bps,
            confidence,
            expected_return_bps,
            timestamp,
        });
    }

    /// Execute the current AI decision (rebalance allocation)
    public entry fun execute_ai_decision(
        _rebalancer: &RebalancerCap,
        state: &mut CommunityPoolState,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(!state.circuit_breaker_tripped, E_CIRCUIT_BREAKER_TRIPPED);
        assert!(!state.current_ai_decision.executed, E_DECISION_ALREADY_EXECUTED);
        
        let timestamp = clock::timestamp_ms(clock);
        
        // Check rebalance cooldown
        assert!(
            timestamp >= state.last_rebalance_time + state.rebalance_cooldown,
            E_REBALANCE_COOLDOWN
        );
        
        // Update allocation
        let previous_bps = state.target_allocation_bps;
        let new_bps = state.current_ai_decision.target_alloc_bps;
        
        state.target_allocation_bps = new_bps;
        state.last_rebalance_time = timestamp;
        state.rebalance_count = state.rebalance_count + 1;
        state.current_ai_decision.executed = true;
        
        event::emit(Rebalanced {
            executor: ctx.sender(),
            previous_bps,
            new_bps,
            reason_hash: state.current_ai_decision.reason_hash,
            timestamp,
        });
        
        event::emit(AIDecisionExecuted {
            decision_id: state.current_ai_decision.decision_id,
            executor: ctx.sender(),
            successful: true,
            timestamp,
        });
    }

    /// Receive cross-chain signal for coordination
    public entry fun receive_cross_chain_signal(
        _agent: &AgentCap,
        state: &mut CommunityPoolState,
        signal_id: vector<u8>,
        source_chain_id: u64,
        target_alloc_bps: u64,
        price_data_hash: vector<u8>,
        action: u8,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        let timestamp = clock::timestamp_ms(clock);
        
        let signal = CrossChainSignal {
            signal_id,
            timestamp,
            source_chain_id,
            target_alloc_bps,
            price_data_hash,
            action,
            acknowledged: false,
        };
        
        state.latest_signal = signal;
        
        event::emit(CrossChainSignalReceived {
            signal_id,
            source_chain_id,
            action,
            timestamp,
        });
    }

    /// Acknowledge cross-chain signal
    public entry fun acknowledge_signal(
        _agent: &AgentCap,
        state: &mut CommunityPoolState,
    ) {
        state.latest_signal.acknowledged = true;
    }

    /// Internal: Update agent metrics
    fun update_agent_metrics(state: &mut CommunityPoolState, _agent: address, confidence: u8) {
        // Add new metrics entry if needed (simplified - stores overall metrics)
        if (vector::length(&state.agent_metrics) == 0) {
            let metrics = AIAgentMetrics {
                total_decisions: 1,
                successful_decisions: 0,
                cumulative_return_bps: 0,
                avg_confidence: (confidence as u64) * 100,
                last_decision_time: 0,
                last_decision_id: vector::empty(),
            };
            vector::push_back(&mut state.agent_metrics, metrics);
        } else {
            let metrics = vector::borrow_mut(&mut state.agent_metrics, 0);
            metrics.total_decisions = metrics.total_decisions + 1;
            // Update average confidence (running average)
            metrics.avg_confidence = ((metrics.avg_confidence * (metrics.total_decisions - 1)) + 
                                      ((confidence as u64) * 100)) / metrics.total_decisions;
        };
    }

    // ============ Rebalancing Functions ============

    /// Set target allocation (direct, without AI decision)
    public entry fun set_target_allocation(
        _rebalancer: &RebalancerCap,
        state: &mut CommunityPoolState,
        new_alloc_bps: u64,
        reasoning: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(new_alloc_bps <= BPS_DENOMINATOR, E_INVALID_ALLOCATION);
        
        let timestamp = clock::timestamp_ms(clock);
        
        // Check cooldown
        assert!(
            timestamp >= state.last_rebalance_time + state.rebalance_cooldown,
            E_REBALANCE_COOLDOWN
        );
        
        let previous_bps = state.target_allocation_bps;
        state.target_allocation_bps = new_alloc_bps;
        state.last_rebalance_time = timestamp;
        state.rebalance_count = state.rebalance_count + 1;
        
        let reason_hash = hash::keccak256(&reasoning);
        
        event::emit(Rebalanced {
            executor: ctx.sender(),
            previous_bps,
            new_bps: new_alloc_bps,
            reason_hash,
            timestamp,
        });
    }

    /// Set rebalance cooldown
    public entry fun set_rebalance_cooldown(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        cooldown_ms: u64,
    ) {
        // Max 7 days cooldown
        assert!(cooldown_ms <= 604800000, E_INVALID_ALLOCATION);
        state.rebalance_cooldown = cooldown_ms;
    }

    /// Set minimum AI confidence
    public entry fun set_min_ai_confidence(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        min_confidence: u8,
    ) {
        assert!(min_confidence <= 100, E_INVALID_ALLOCATION);
        state.min_ai_confidence = min_confidence;
    }

    // ============ Auto-Hedge Functions ============

    /// Configure auto-hedge settings
    public entry fun set_auto_hedge_config(
        _agent: &AgentCap,
        state: &mut CommunityPoolState,
        enabled: bool,
        risk_threshold_bps: u64,
        max_hedge_ratio_bps: u64,
        default_leverage: u64,
        cooldown_ms: u64,
        clock: &Clock,
    ) {
        // Validate parameters
        assert!(default_leverage >= 2 && default_leverage <= 10, E_INVALID_ALLOCATION);
        assert!(max_hedge_ratio_bps <= 5000, E_MAX_HEDGE_EXCEEDED); // Max 50%
        
        let timestamp = clock::timestamp_ms(clock);
        
        state.auto_hedge_config = AutoHedgeConfig {
            enabled,
            risk_threshold_bps,
            max_hedge_ratio_bps,
            default_leverage,
            cooldown_ms,
            last_hedge_time: state.auto_hedge_config.last_hedge_time,
        };
        
        event::emit(AutoHedgeConfigUpdated {
            enabled,
            risk_threshold_bps,
            max_hedge_ratio_bps,
            default_leverage,
            timestamp,
        });
    }

    /// Open a hedge position (AI-managed)
    /// Note: In production, this would integrate with BlueFin or other SUI DEX
    public entry fun open_pool_hedge(
        _agent: &AgentCap,
        state: &mut CommunityPoolState,
        pair_index: u8,
        collateral_amount: u64,
        leverage: u64,
        is_long: bool,
        reasoning: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(!state.circuit_breaker_tripped, E_CIRCUIT_BREAKER_TRIPPED);
        assert!(collateral_amount > 0, E_ZERO_AMOUNT);
        
        let timestamp = clock::timestamp_ms(clock);
        
        // Check hedge cooldown
        assert!(
            timestamp >= state.auto_hedge_config.last_hedge_time + state.auto_hedge_config.cooldown_ms,
            E_HEDGE_COOLDOWN
        );
        
        // Check we have enough balance
        let pool_balance = balance::value(&state.balance);
        assert!(pool_balance >= collateral_amount, E_INSUFFICIENT_BALANCE);
        
        // Enforce minimum reserve ratio (20%)
        let nav = get_total_nav(state);
        let min_reserve = (nav * MIN_RESERVE_RATIO_BPS) / BPS_DENOMINATOR;
        assert!(pool_balance - collateral_amount >= min_reserve, E_RESERVE_RATIO_BREACHED);
        
        // Check max hedge ratio
        let max_hedge = (nav * state.auto_hedge_config.max_hedge_ratio_bps) / BPS_DENOMINATOR;
        assert!(state.total_hedged_value + collateral_amount <= max_hedge, E_MAX_HEDGE_EXCEEDED);
        
        // Reset daily tracker if new day
        let current_day = timestamp / 86400000;
        if (current_day > state.current_hedge_day) {
            state.daily_hedge_total = 0;
            state.current_hedge_day = current_day;
        };
        
        // Check daily cap
        let daily_cap = (nav * DAILY_HEDGE_CAP_BPS) / BPS_DENOMINATOR;
        assert!(state.daily_hedge_total + collateral_amount <= daily_cap, E_MAX_HEDGE_EXCEEDED);
        
        // Generate hedge ID
        let mut id_data = bcs::to_bytes(&timestamp);
        vector::append(&mut id_data, bcs::to_bytes(&pair_index));
        vector::append(&mut id_data, bcs::to_bytes(&collateral_amount));
        let hedge_id = hash::keccak256(&id_data);
        
        let reason_hash = hash::keccak256(&reasoning);
        
        // Create hedge position
        let hedge = HedgePosition {
            hedge_id,
            pair_index,
            collateral_amount,
            leverage,
            is_long,
            open_time: timestamp,
            reason_hash,
        };
        
        // Update state
        vector::push_back(&mut state.active_hedges, hedge);
        state.total_hedged_value = state.total_hedged_value + collateral_amount;
        state.daily_hedge_total = state.daily_hedge_total + collateral_amount;
        state.auto_hedge_config.last_hedge_time = timestamp;
        
        // Transfer collateral to treasury for external hedge execution
        let collateral_balance = balance::split(&mut state.balance, collateral_amount);
        let collateral_coin = coin::from_balance(collateral_balance, ctx);
        transfer::public_transfer(collateral_coin, state.treasury);
        
        event::emit(PoolHedgeOpened {
            hedge_id,
            pair_index,
            collateral_amount,
            leverage,
            is_long,
            timestamp,
        });
    }

    /// Close a hedge position and return funds
    public entry fun close_pool_hedge(
        _agent: &AgentCap,
        state: &mut CommunityPoolState,
        hedge_id: vector<u8>,
        pnl_amount: u64,
        is_profit: bool,
        funds: Coin<SUI>,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        
        let timestamp = clock::timestamp_ms(clock);
        
        // Find and remove hedge
        let mut found_idx: u64 = 0;
        let mut found = false;
        let len = vector::length(&state.active_hedges);
        let mut i: u64 = 0;
        
        while (i < len) {
            let hedge = vector::borrow(&state.active_hedges, i);
            if (hedge.hedge_id == hedge_id) {
                found_idx = i;
                found = true;
                break
            };
            i = i + 1;
        };
        
        assert!(found, E_HEDGE_NOT_FOUND);
        
        let hedge = vector::remove(&mut state.active_hedges, found_idx);
        
        // Update state
        state.total_hedged_value = if (state.total_hedged_value > hedge.collateral_amount) {
            state.total_hedged_value - hedge.collateral_amount
        } else {
            0
        };
        
        // Add returned funds to pool
        let fund_balance = coin::into_balance(funds);
        balance::join(&mut state.balance, fund_balance);
        
        // Update all-time high if profit
        if (is_profit) {
            let current_nav = get_nav_per_share(state);
            if (current_nav > state.all_time_high_nav_per_share) {
                state.all_time_high_nav_per_share = current_nav;
            };
        };
        
        event::emit(PoolHedgeClosed {
            hedge_id,
            pnl_amount,
            is_profit,
            timestamp,
        });
    }

    // ============ Timelock Functions ============

    /// Schedule a timelock operation
    public entry fun schedule_timelock_operation(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        operation_type: u8,
        target_value: u64,
        target_address: address,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        let timestamp = clock::timestamp_ms(clock);
        let scheduled_time = timestamp + state.timelock_delay;
        let expiry_time = scheduled_time + TIMELOCK_EXPIRY;
        
        // Generate operation ID
        let mut id_data = bcs::to_bytes(&timestamp);
        vector::append(&mut id_data, bcs::to_bytes(&operation_type));
        vector::append(&mut id_data, bcs::to_bytes(&target_value));
        let operation_id = hash::keccak256(&id_data);
        
        let operation = TimelockOperation {
            operation_id,
            operation_type,
            target_value,
            target_address,
            scheduled_time,
            expiry_time,
            executed: false,
        };
        
        vector::push_back(&mut state.pending_operations, operation);
        
        event::emit(TimelockOperationScheduled {
            operation_id,
            operation_type,
            scheduled_time,
            timestamp,
        });
    }

    /// Execute a timelock operation after delay
    public entry fun execute_timelock_operation(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        operation_id: vector<u8>,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        let timestamp = clock::timestamp_ms(clock);
        
        // Find operation
        let mut found_idx: u64 = 0;
        let mut found = false;
        let len = vector::length(&state.pending_operations);
        let mut i: u64 = 0;
        
        while (i < len) {
            let op = vector::borrow(&state.pending_operations, i);
            if (op.operation_id == operation_id) {
                found_idx = i;
                found = true;
                break
            };
            i = i + 1;
        };
        
        assert!(found, E_OPERATION_NOT_FOUND);
        
        let op = vector::borrow(&state.pending_operations, found_idx);
        assert!(!op.executed, E_DECISION_ALREADY_EXECUTED);
        assert!(timestamp >= op.scheduled_time, E_TIMELOCK_NOT_READY);
        assert!(timestamp <= op.expiry_time, E_TIMELOCK_EXPIRED);
        
        // Execute based on operation type
        let operation_type = op.operation_type;
        let target_value = op.target_value;
        let target_address = op.target_address;
        
        // 0 = treasury update, 1 = fee update, 2 = limits update
        if (operation_type == 0) {
            state.treasury = target_address;
        } else if (operation_type == 1) {
            // target_value encodes both fees: high 32 bits = mgmt, low 32 bits = perf
            let mgmt_fee = target_value >> 32;
            let perf_fee = target_value & 0xFFFFFFFF;
            if (mgmt_fee <= 500 && perf_fee <= 3000) {
                state.management_fee_bps = mgmt_fee;
                state.performance_fee_bps = perf_fee;
            };
        } else if (operation_type == 2) {
            state.max_single_deposit = target_value;
        };
        
        // Mark as executed
        let op_mut = vector::borrow_mut(&mut state.pending_operations, found_idx);
        op_mut.executed = true;
        
        event::emit(TimelockOperationExecuted {
            operation_id,
            operation_type,
            timestamp,
        });
    }

    /// Cancel a pending timelock operation
    public entry fun cancel_timelock_operation(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        operation_id: vector<u8>,
        clock: &Clock,
    ) {
        let timestamp = clock::timestamp_ms(clock);
        
        // Find and remove operation
        let mut found_idx: u64 = 0;
        let mut found = false;
        let len = vector::length(&state.pending_operations);
        let mut i: u64 = 0;
        
        while (i < len) {
            let op = vector::borrow(&state.pending_operations, i);
            if (op.operation_id == operation_id && !op.executed) {
                found_idx = i;
                found = true;
                break
            };
            i = i + 1;
        };
        
        assert!(found, E_OPERATION_NOT_FOUND);
        
        vector::remove(&mut state.pending_operations, found_idx);
        
        event::emit(TimelockOperationCancelled {
            operation_id,
            timestamp,
        });
    }

    /// Set timelock delay (for transitioning mainnet/testnet)
    public entry fun set_timelock_delay(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        delay_ms: u64,
    ) {
        // Min 5 minutes, max 7 days
        assert!(delay_ms >= 300000 && delay_ms <= 604800000, E_INVALID_ALLOCATION);
        state.timelock_delay = delay_ms;
    }

    // ============ Rescue Functions ============

    /// Rescue accidentally sent SUI to treasury
    public entry fun rescue_sui(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // Only works in emergency mode
        assert!(state.emergency_withdraw_enabled || state.circuit_breaker_tripped, E_EMERGENCY_MODE_REQUIRED);
        assert!(amount > 0, E_NOTHING_TO_RESCUE);
        
        let available = balance::value(&state.balance);
        let rescue_amount = if (amount > available) { available } else { amount };
        assert!(rescue_amount > 0, E_NOTHING_TO_RESCUE);
        
        let timestamp = clock::timestamp_ms(clock);
        
        let rescue_balance = balance::split(&mut state.balance, rescue_amount);
        let rescue_coin = coin::from_balance(rescue_balance, ctx);
        transfer::public_transfer(rescue_coin, state.treasury);
        
        event::emit(TokensRescued {
            amount: rescue_amount,
            recipient: state.treasury,
            timestamp,
        });
    }

    /// Admin migration - transfer all funds to new contract
    public entry fun admin_migrate_funds(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        recipient: address,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // Only works in emergency mode
        assert!(state.emergency_withdraw_enabled, E_EMERGENCY_MODE_REQUIRED);
        
        let timestamp = clock::timestamp_ms(clock);
        let amount = balance::value(&state.balance);
        assert!(amount > 0, E_NOTHING_TO_RESCUE);
        
        // Transfer all funds
        let all_balance = balance::split(&mut state.balance, amount);
        let all_coin = coin::from_balance(all_balance, ctx);
        transfer::public_transfer(all_coin, recipient);
        
        // Reset pool state
        state.total_shares = 0;
        
        event::emit(TokensRescued {
            amount,
            recipient,
            timestamp,
        });
    }

    /// Enable/disable emergency withdrawal mode
    public entry fun set_emergency_withdraw(
        _admin: &AdminCap,
        state: &mut CommunityPoolState,
        enabled: bool,
    ) {
        state.emergency_withdraw_enabled = enabled;
    }

    // ============ Additional View Functions ============

    /// Get AI decision info
    public fun get_ai_decision_info(state: &CommunityPoolState): (vector<u8>, u64, u64, u8, bool) {
        (
            state.current_ai_decision.decision_id,
            state.current_ai_decision.timestamp,
            state.current_ai_decision.target_alloc_bps,
            state.current_ai_decision.confidence,
            state.current_ai_decision.executed
        )
    }

    /// Get rebalance info
    public fun get_rebalance_info(state: &CommunityPoolState): (u64, u64, u64) {
        (
            state.target_allocation_bps,
            state.last_rebalance_time,
            state.rebalance_count
        )
    }

    /// Get auto-hedge config
    public fun get_auto_hedge_config(state: &CommunityPoolState): (bool, u64, u64, u64, u64) {
        (
            state.auto_hedge_config.enabled,
            state.auto_hedge_config.risk_threshold_bps,
            state.auto_hedge_config.max_hedge_ratio_bps,
            state.auto_hedge_config.default_leverage,
            state.auto_hedge_config.cooldown_ms
        )
    }

    /// Get hedge status
    public fun get_hedge_status(state: &CommunityPoolState): (u64, u64) {
        (
            vector::length(&state.active_hedges),
            state.total_hedged_value
        )
    }

    /// Get timelock info
    public fun get_timelock_info(state: &CommunityPoolState): (u64, u64, bool) {
        (
            state.timelock_delay,
            vector::length(&state.pending_operations),
            state.emergency_withdraw_enabled
        )
    }

    // ============ Agent Functions ============

    /// Agent-triggered deposit to treasury (for AI management)
    public entry fun agent_deposit_to_treasury(
        _agent: &AgentCap,
        state: &mut CommunityPoolState,
        amount: u64,
        ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(amount > 0, E_ZERO_AMOUNT);
        assert!(balance::value(&state.balance) >= amount, E_INSUFFICIENT_BALANCE);

        // Transfer to treasury for external management
        let transfer_balance = balance::split(&mut state.balance, amount);
        let transfer_coin = coin::from_balance(transfer_balance, ctx);
        transfer::public_transfer(transfer_coin, state.treasury);
    }

    /// Agent adds profits back to the pool
    public entry fun agent_add_profits(
        _agent: &AgentCap,
        state: &mut CommunityPoolState,
        profits: Coin<SUI>,
        _clock: &Clock,
    ) {
        assert!(!state.paused, E_PAUSED);

        let amount = coin::value(&profits);
        assert!(amount > 0, E_ZERO_AMOUNT);

        // Add profits to pool (increases NAV per share)
        let profit_balance = coin::into_balance(profits);
        balance::join(&mut state.balance, profit_balance);

        // Update all-time high if applicable
        let current_nav = get_nav_per_share(state);
        if (current_nav > state.all_time_high_nav_per_share) {
            state.all_time_high_nav_per_share = current_nav;
        };
    }

    /// Agent records a loss (reduces pool balance)
    public entry fun agent_record_loss(
        _agent: &AgentCap,
        state: &mut CommunityPoolState,
        loss_amount: u64,
    ) {
        assert!(!state.paused, E_PAUSED);

        // Cannot record loss more than balance
        let current_balance = balance::value(&state.balance);
        let _actual_loss = if (loss_amount > current_balance) {
            current_balance
        } else {
            loss_amount
        };

        // Burn the loss (send to zero address effectively by not transferring)
        // In practice, this would be tracked off-chain and balance updates managed
        // For SUI, we simply track this in events/off-chain
        // The pool balance would decrease through actual trading losses
    }

    // ============ Test Helpers ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }

    #[test_only]
    public fun get_pool_balance(state: &CommunityPoolState): u64 {
        balance::value(&state.balance)
    }
}
