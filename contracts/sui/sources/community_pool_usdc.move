/// ZkVanguard Community Pool USDC Module for SUI
/// AI-managed community investment pool accepting USDC deposits
/// 4-Asset allocation: BTC, ETH, SUI, CRO managed by AI via QStash
///
/// Features:
/// - USDC deposits (6 decimal precision)
/// - Share-based ownership with ERC-4626 inflation protection
/// - 4-asset AI allocation tracking (BTC/ETH/SUI/CRO)
/// - Auto-hedge integration with BlueFin
/// - QStash-driven AI management
/// - High-water mark performance fees
#[allow(unused_const, unused_field, unused_use)]
module zkvanguard::community_pool_usdc {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};
    use sui::hash;
    use sui::bcs;

    // ============ USDC Coin Type (Phantom) ============
    // On SUI mainnet: 0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC
    // On SUI testnet: Use the deployed test USDC or a mock
    // This module is generic over coin type T so it works with any USDC deployment
    // IMPORTANT: The pool creator specifies which coin type to use at pool creation

    // ============ Error Codes ============
    const E_NOT_AUTHORIZED: u64 = 0;
    const E_PAUSED: u64 = 1;
    const E_ZERO_AMOUNT: u64 = 2;
    const E_INSUFFICIENT_SHARES: u64 = 3;
    const E_INSUFFICIENT_BALANCE: u64 = 4;
    const E_MIN_DEPOSIT_NOT_MET: u64 = 5;
    const E_MIN_SHARES_NOT_MET: u64 = 6;
    const E_NOT_MEMBER: u64 = 7;
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
    const E_ALLOC_SUM_INVALID: u64 = 28;

    // ============ Constants ============
    const BPS_DENOMINATOR: u64 = 10000;
    const SECONDS_PER_YEAR: u64 = 31536000;

    // USDC has 6 decimals on SUI
    const USDC_DECIMALS: u64 = 6;
    const USDC_UNIT: u64 = 1_000_000; // 1 USDC = 1e6

    // Minimums in USDC (6 decimals)
    const MIN_DEPOSIT: u64 = 10_000_000;         // $10 USDC
    const MIN_FIRST_DEPOSIT: u64 = 50_000_000;   // $50 USDC
    const MIN_SHARES_FOR_WITHDRAWAL: u64 = 1_000; // 0.001 shares (6 decimals)

    // Virtual offset for inflation protection (1 share = 1 USDC)
    const VIRTUAL_SHARES: u64 = 1_000_000; // 1 share (6 decimals)
    const VIRTUAL_ASSETS: u64 = 1_000_000; // 1 USDC

    // Share precision matches USDC (6 decimals)
    const WAD: u64 = 1_000_000; // 1e6

    // Reserve and safety limits
    const MIN_RESERVE_RATIO_BPS: u64 = 2000; // 20% must stay liquid
    const MAX_SINGLE_HEDGE_BPS: u64 = 500;   // Max 5% per hedge
    const DAILY_HEDGE_CAP_BPS: u64 = 1500;   // Max 15% daily hedging

    // Circuit breaker defaults
    const DEFAULT_MAX_SINGLE_DEPOSIT: u64 = 1_000_000_000_000; // $1M USDC
    const DEFAULT_MAX_SINGLE_WITHDRAWAL_BPS: u64 = 2500; // 25%
    const DEFAULT_DAILY_WITHDRAWAL_CAP_BPS: u64 = 5000;  // 50%

    // Default fees
    const DEFAULT_MANAGEMENT_FEE_BPS: u64 = 50;   // 0.5% annual
    const DEFAULT_PERFORMANCE_FEE_BPS: u64 = 1000; // 10% on new highs

    // AI Management
    const DEFAULT_MIN_AI_CONFIDENCE: u8 = 50;
    const DEFAULT_REBALANCE_COOLDOWN: u64 = 3600000; // 1 hour in ms

    // Asset indices for 4-asset allocation
    const ASSET_BTC: u8 = 0;
    const ASSET_ETH: u8 = 1;
    const ASSET_SUI: u8 = 2;
    const ASSET_CRO: u8 = 3;

    // ============ Structs ============

    /// Admin capability
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Agent capability (AI keeper, used by QStash cron)
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

    /// Member data
    public struct MemberData has store, copy, drop {
        shares: u64,
        deposited_usdc: u64,    // Total USDC deposited (6 decimals)
        withdrawn_usdc: u64,    // Total USDC withdrawn (6 decimals)
        joined_at: u64,
        last_deposit_at: u64,
        high_water_mark: u64,   // For performance fee
    }

    /// 4-Asset allocation tracking
    public struct AssetAllocation has store, copy, drop {
        btc_bps: u64,  // BTC allocation in basis points
        eth_bps: u64,  // ETH allocation in basis points
        sui_bps: u64,  // SUI allocation in basis points
        cro_bps: u64,  // CRO allocation in basis points
    }

    /// AI Decision record
    public struct AIDecision has store, copy, drop {
        decision_id: vector<u8>,
        timestamp: u64,
        target_allocation: AssetAllocation,
        confidence: u8,               // 0-100
        urgency: u8,                   // 0=low, 1=medium, 2=high
        expected_return_bps: u64,
        risk_score: u64,               // 0-10000
        reason_hash: vector<u8>,
        data_feed_hash: vector<u8>,
        executed: bool,
    }

    /// Hedge position (via BlueFin)
    public struct HedgePosition has store, copy, drop {
        hedge_id: vector<u8>,
        pair_index: u8,           // 0=BTC, 1=ETH, 2=SUI, 3=CRO
        collateral_usdc: u64,     // USDC collateral (6 decimals)
        leverage: u64,
        is_long: bool,
        open_time: u64,
        reason_hash: vector<u8>,
    }

    /// Auto-hedge configuration
    public struct AutoHedgeConfig has store, copy, drop {
        enabled: bool,
        risk_threshold_bps: u64,
        max_hedge_ratio_bps: u64,
        default_leverage: u64,
        cooldown_ms: u64,
        last_hedge_time: u64,
    }

    /// USDC Community Pool State (shared object, generic over coin type T)
    public struct UsdcPoolState<phantom T> has key {
        id: UID,
        /// Pool USDC balance
        balance: Balance<T>,
        /// Total shares outstanding (6 decimal precision)
        total_shares: u64,
        /// Total USDC deposited
        total_deposited: u64,
        /// Total USDC withdrawn
        total_withdrawn: u64,
        /// All-time high NAV per share (scaled by WAD)
        all_time_high_nav_per_share: u64,
        /// Fees
        management_fee_bps: u64,
        performance_fee_bps: u64,
        accumulated_management_fees: u64,
        accumulated_performance_fees: u64,
        last_fee_collection: u64,
        /// Treasury address
        treasury: address,
        /// Status
        paused: bool,
        circuit_breaker_tripped: bool,
        /// Limits
        max_single_deposit: u64,
        max_single_withdrawal_bps: u64,
        daily_withdrawal_cap_bps: u64,
        daily_withdrawal_total: u64,
        current_withdrawal_day: u64,
        /// Members
        members: Table<address, MemberData>,
        member_count: u64,
        /// Pool creation
        created_at: u64,

        // ═══ 4-ASSET AI ALLOCATION ═══
        current_allocation: AssetAllocation,
        target_allocation: AssetAllocation,
        current_ai_decision: AIDecision,
        ai_decision_count: u64,
        min_ai_confidence: u8,

        // ═══ REBALANCING ═══
        last_rebalance_time: u64,
        rebalance_cooldown: u64,
        rebalance_count: u64,

        // ═══ AUTO-HEDGE ═══
        auto_hedge_config: AutoHedgeConfig,
        active_hedges: vector<HedgePosition>,
        total_hedged_value: u64,
        daily_hedge_total: u64,
        current_hedge_day: u64,
    }

    // ============ Events ============

    public struct UsdcPoolCreated has copy, drop {
        pool_id: ID,
        treasury: address,
        creator: address,
        initial_allocation: AssetAllocation,
        timestamp: u64,
    }

    public struct UsdcDeposited has copy, drop {
        member: address,
        amount_usdc: u64,
        shares_received: u64,
        share_price: u64,
        timestamp: u64,
    }

    public struct UsdcWithdrawn has copy, drop {
        member: address,
        shares_burned: u64,
        amount_usdc: u64,
        share_price: u64,
        timestamp: u64,
    }

    public struct AllocationUpdated has copy, drop {
        old_allocation: AssetAllocation,
        new_allocation: AssetAllocation,
        decision_id: vector<u8>,
        confidence: u8,
        timestamp: u64,
    }

    public struct UsdcFeesCollected has copy, drop {
        management_fee: u64,
        performance_fee: u64,
        collector: address,
        timestamp: u64,
    }

    public struct UsdcHedgeOpened has copy, drop {
        hedge_id: vector<u8>,
        pair_index: u8,
        collateral_usdc: u64,
        leverage: u64,
        is_long: bool,
        timestamp: u64,
    }

    public struct UsdcHedgeClosed has copy, drop {
        hedge_id: vector<u8>,
        pnl_usdc: u64,
        is_profit: bool,
        timestamp: u64,
    }

    public struct UsdcPoolPaused has copy, drop {
        pool_id: ID,
        paused: bool,
        timestamp: u64,
    }

    // ============ Init ============

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

    /// Create a USDC community pool with initial 4-asset allocation
    /// Default: BTC 30%, ETH 30%, SUI 20%, CRO 20%
    public entry fun create_pool<T>(
        _admin: &AdminCap,
        treasury: address,
        btc_bps: u64,
        eth_bps: u64,
        sui_bps: u64,
        cro_bps: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // Allocations must sum to 10000 BPS (100%)
        assert!(btc_bps + eth_bps + sui_bps + cro_bps == BPS_DENOMINATOR, E_ALLOC_SUM_INVALID);

        let timestamp = clock::timestamp_ms(clock);
        let initial_alloc = AssetAllocation {
            btc_bps,
            eth_bps,
            sui_bps,
            cro_bps,
        };

        let empty_decision = AIDecision {
            decision_id: vector::empty(),
            timestamp: 0,
            target_allocation: copy initial_alloc,
            confidence: 0,
            urgency: 0,
            expected_return_bps: 0,
            risk_score: 0,
            reason_hash: vector::empty(),
            data_feed_hash: vector::empty(),
            executed: true,
        };

        let hedge_config = AutoHedgeConfig {
            enabled: false,
            risk_threshold_bps: 500,
            max_hedge_ratio_bps: 2500,
            default_leverage: 3,
            cooldown_ms: 3600000,
            last_hedge_time: 0,
        };

        let state = UsdcPoolState<T> {
            id: object::new(ctx),
            balance: balance::zero<T>(),
            total_shares: 0,
            total_deposited: 0,
            total_withdrawn: 0,
            all_time_high_nav_per_share: WAD,
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
            created_at: timestamp,

            current_allocation: copy initial_alloc,
            target_allocation: copy initial_alloc,
            current_ai_decision: empty_decision,
            ai_decision_count: 0,
            min_ai_confidence: DEFAULT_MIN_AI_CONFIDENCE,

            last_rebalance_time: 0,
            rebalance_cooldown: DEFAULT_REBALANCE_COOLDOWN,
            rebalance_count: 0,

            auto_hedge_config: hedge_config,
            active_hedges: vector::empty(),
            total_hedged_value: 0,
            daily_hedge_total: 0,
            current_hedge_day: timestamp / 86400000,
        };

        event::emit(UsdcPoolCreated {
            pool_id: object::id(&state),
            treasury,
            creator: ctx.sender(),
            initial_allocation: initial_alloc,
            timestamp,
        });

        transfer::share_object(state);
    }

    // ============ Deposit USDC ============

    /// Deposit USDC and receive pool shares
    public entry fun deposit<T>(
        state: &mut UsdcPoolState<T>,
        payment: Coin<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(!state.circuit_breaker_tripped, E_CIRCUIT_BREAKER_TRIPPED);

        let amount = coin::value(&payment);
        assert!(amount > 0, E_ZERO_AMOUNT);
        assert!(amount >= MIN_DEPOSIT, E_MIN_DEPOSIT_NOT_MET);
        assert!(amount <= state.max_single_deposit, E_MAX_DEPOSIT_EXCEEDED);

        if (state.total_shares == 0) {
            assert!(amount >= MIN_FIRST_DEPOSIT, E_MIN_DEPOSIT_NOT_MET);
        };

        let sender = ctx.sender();
        let timestamp = clock::timestamp_ms(clock);

        // Collect management fees before share calculation
        collect_management_fee_internal(state, timestamp);

        // Calculate shares (with virtual offset for inflation protection)
        let shares_to_mint = calculate_shares_for_deposit(state, amount);

        // Update pool 
        let coin_balance = coin::into_balance(payment);
        balance::join(&mut state.balance, coin_balance);
        state.total_shares = state.total_shares + shares_to_mint;
        state.total_deposited = state.total_deposited + amount;

        // Update or create member
        if (table::contains(&state.members, sender)) {
            let member = table::borrow_mut(&mut state.members, sender);
            member.shares = member.shares + shares_to_mint;
            member.deposited_usdc = member.deposited_usdc + amount;
            member.last_deposit_at = timestamp;
        } else {
            let new_member = MemberData {
                shares: shares_to_mint,
                deposited_usdc: amount,
                withdrawn_usdc: 0,
                joined_at: timestamp,
                last_deposit_at: timestamp,
                high_water_mark: get_nav_per_share(state),
            };
            table::add(&mut state.members, sender, new_member);
            state.member_count = state.member_count + 1;
        };

        // Update all-time high
        let current_nav = get_nav_per_share(state);
        if (current_nav > state.all_time_high_nav_per_share) {
            state.all_time_high_nav_per_share = current_nav;
        };

        event::emit(UsdcDeposited {
            member: sender,
            amount_usdc: amount,
            shares_received: shares_to_mint,
            share_price: current_nav,
            timestamp,
        });
    }

    // ============ Withdraw USDC ============

    /// Withdraw by burning shares, receive USDC
    public entry fun withdraw<T>(
        state: &mut UsdcPoolState<T>,
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

        assert!(table::contains(&state.members, sender), E_NOT_MEMBER);
        let member = table::borrow(&state.members, sender);
        assert!(member.shares >= shares_to_burn, E_INSUFFICIENT_SHARES);

        // Reset daily tracker
        let current_day = timestamp / 86400000;
        if (current_day > state.current_withdrawal_day) {
            state.daily_withdrawal_total = 0;
            state.current_withdrawal_day = current_day;
        };

        // Collect fees before withdrawal calculation
        collect_management_fee_internal(state, timestamp);
        collect_performance_fee_internal(state, sender);

        // Calculate USDC to return
        let amount_to_withdraw = calculate_assets_for_shares(state, shares_to_burn);
        assert!(balance::value(&state.balance) >= amount_to_withdraw, E_INSUFFICIENT_BALANCE);

        // Circuit breaker checks
        let nav = get_total_nav(state);
        let max_single = (nav * state.max_single_withdrawal_bps) / BPS_DENOMINATOR;
        assert!(amount_to_withdraw <= max_single, E_MAX_WITHDRAWAL_EXCEEDED);

        let daily_cap = (nav * state.daily_withdrawal_cap_bps) / BPS_DENOMINATOR;
        assert!(state.daily_withdrawal_total + amount_to_withdraw <= daily_cap, E_DAILY_WITHDRAWAL_EXCEEDED);

        // Update state
        state.total_shares = state.total_shares - shares_to_burn;
        state.total_withdrawn = state.total_withdrawn + amount_to_withdraw;
        state.daily_withdrawal_total = state.daily_withdrawal_total + amount_to_withdraw;

        let member_mut = table::borrow_mut(&mut state.members, sender);
        member_mut.shares = member_mut.shares - shares_to_burn;
        member_mut.withdrawn_usdc = member_mut.withdrawn_usdc + amount_to_withdraw;

        // Transfer USDC to user
        let withdrawal_balance = balance::split(&mut state.balance, amount_to_withdraw);
        let withdrawal_coin = coin::from_balance(withdrawal_balance, ctx);
        transfer::public_transfer(withdrawal_coin, sender);

        event::emit(UsdcWithdrawn {
            member: sender,
            shares_burned: shares_to_burn,
            amount_usdc: amount_to_withdraw,
            share_price: get_nav_per_share(state),
            timestamp,
        });
    }

    // ============ Fee Functions ============

    /// Collect accumulated fees to treasury
    public entry fun collect_fees<T>(
        _fee_manager: &FeeManagerCap,
        state: &mut UsdcPoolState<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let timestamp = clock::timestamp_ms(clock);
        collect_management_fee_internal(state, timestamp);

        let total_fees = state.accumulated_management_fees + state.accumulated_performance_fees;
        assert!(total_fees > 0, E_ZERO_AMOUNT);
        assert!(balance::value(&state.balance) >= total_fees, E_INSUFFICIENT_BALANCE);

        let mgmt_fee = state.accumulated_management_fees;
        let perf_fee = state.accumulated_performance_fees;
        state.accumulated_management_fees = 0;
        state.accumulated_performance_fees = 0;

        let fee_balance = balance::split(&mut state.balance, total_fees);
        let fee_coin = coin::from_balance(fee_balance, ctx);
        transfer::public_transfer(fee_coin, state.treasury);

        event::emit(UsdcFeesCollected {
            management_fee: mgmt_fee,
            performance_fee: perf_fee,
            collector: ctx.sender(),
            timestamp,
        });
    }

    fun collect_management_fee_internal<T>(state: &mut UsdcPoolState<T>, current_time: u64) {
        if (state.total_shares == 0) {
            state.last_fee_collection = current_time;
            return
        };
        let time_elapsed_ms = current_time - state.last_fee_collection;
        if (time_elapsed_ms == 0) return;

        let time_elapsed_sec = time_elapsed_ms / 1000;
        let nav = get_total_nav(state);
        let fee = (nav * state.management_fee_bps * time_elapsed_sec) /
                  (BPS_DENOMINATOR * SECONDS_PER_YEAR);

        if (fee > 0) {
            state.accumulated_management_fees = state.accumulated_management_fees + fee;
        };
        state.last_fee_collection = current_time;
    }

    fun collect_performance_fee_internal<T>(state: &mut UsdcPoolState<T>, member_addr: address) {
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

        let member_mut = table::borrow_mut(&mut state.members, member_addr);
        member_mut.high_water_mark = current_nav_per_share;
    }

    // ============ View Functions ============

    public fun get_nav_per_share<T>(state: &UsdcPoolState<T>): u64 {
        if (state.total_shares == 0) {
            return WAD
        };
        let total_assets = balance::value(&state.balance) + VIRTUAL_ASSETS;
        let total_shares = state.total_shares + VIRTUAL_SHARES;
        ((total_assets as u128) * (WAD as u128) / (total_shares as u128)) as u64
    }

    public fun get_total_nav<T>(state: &UsdcPoolState<T>): u64 {
        balance::value(&state.balance)
    }

    public fun calculate_shares_for_deposit<T>(state: &UsdcPoolState<T>, amount: u64): u64 {
        let total_assets = balance::value(&state.balance) + VIRTUAL_ASSETS;
        let total_shares = state.total_shares + VIRTUAL_SHARES;
        ((amount as u128) * (total_shares as u128) / (total_assets as u128)) as u64
    }

    public fun calculate_assets_for_shares<T>(state: &UsdcPoolState<T>, shares: u64): u64 {
        if (state.total_shares == 0) return 0;
        let total_assets = balance::value(&state.balance) + VIRTUAL_ASSETS;
        let total_shares = state.total_shares + VIRTUAL_SHARES;
        ((shares as u128) * (total_assets as u128) / (total_shares as u128)) as u64
    }

    public fun get_member_info<T>(state: &UsdcPoolState<T>, member: address): (u64, u64, u64, u64, u64) {
        if (!table::contains(&state.members, member)) {
            return (0, 0, 0, 0, 0)
        };
        let m = table::borrow(&state.members, member);
        (m.shares, m.deposited_usdc, m.withdrawn_usdc, m.joined_at, m.last_deposit_at)
    }

    public fun get_allocation<T>(state: &UsdcPoolState<T>): (u64, u64, u64, u64) {
        (
            state.current_allocation.btc_bps,
            state.current_allocation.eth_bps,
            state.current_allocation.sui_bps,
            state.current_allocation.cro_bps,
        )
    }

    public fun get_pool_stats<T>(state: &UsdcPoolState<T>): (u64, u64, u64, u64, u64) {
        (
            balance::value(&state.balance),
            state.total_shares,
            state.total_deposited,
            state.total_withdrawn,
            state.member_count
        )
    }

    // ============ AI Management (QStash-driven) ============

    /// Record an AI allocation decision from QStash cron
    /// The 4 allocation BPS values must sum to 10000
    public entry fun record_ai_decision<T>(
        _agent: &AgentCap,
        state: &mut UsdcPoolState<T>,
        btc_bps: u64,
        eth_bps: u64,
        sui_bps: u64,
        cro_bps: u64,
        confidence: u8,
        urgency: u8,
        expected_return_bps: u64,
        risk_score: u64,
        reasoning: vector<u8>,
        price_data_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(confidence >= state.min_ai_confidence, E_AI_CONFIDENCE_TOO_LOW);
        assert!(btc_bps + eth_bps + sui_bps + cro_bps == BPS_DENOMINATOR, E_ALLOC_SUM_INVALID);

        let timestamp = clock::timestamp_ms(clock);
        let sender = ctx.sender();

        let mut id_data = bcs::to_bytes(&timestamp);
        vector::append(&mut id_data, bcs::to_bytes(&sender));
        vector::append(&mut id_data, bcs::to_bytes(&btc_bps));
        let decision_id = hash::keccak256(&id_data);

        let target_alloc = AssetAllocation { btc_bps, eth_bps, sui_bps, cro_bps };

        let decision = AIDecision {
            decision_id,
            timestamp,
            target_allocation: copy target_alloc,
            confidence,
            urgency,
            expected_return_bps,
            risk_score,
            reason_hash: hash::keccak256(&reasoning),
            data_feed_hash: price_data_hash,
            executed: false,
        };

        state.current_ai_decision = decision;
        state.ai_decision_count = state.ai_decision_count + 1;
        state.target_allocation = target_alloc;

        event::emit(AllocationUpdated {
            old_allocation: state.current_allocation,
            new_allocation: state.target_allocation,
            decision_id,
            confidence,
            timestamp,
        });
    }

    /// Execute the current AI decision (apply target allocation)
    public entry fun execute_ai_decision<T>(
        _rebalancer: &RebalancerCap,
        state: &mut UsdcPoolState<T>,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(!state.circuit_breaker_tripped, E_CIRCUIT_BREAKER_TRIPPED);
        assert!(!state.current_ai_decision.executed, E_DECISION_ALREADY_EXECUTED);

        let timestamp = clock::timestamp_ms(clock);
        assert!(
            timestamp >= state.last_rebalance_time + state.rebalance_cooldown,
            E_REBALANCE_COOLDOWN
        );

        let old_alloc = state.current_allocation;
        state.current_allocation = state.target_allocation;
        state.last_rebalance_time = timestamp;
        state.rebalance_count = state.rebalance_count + 1;
        state.current_ai_decision.executed = true;

        event::emit(AllocationUpdated {
            old_allocation: old_alloc,
            new_allocation: state.current_allocation,
            decision_id: state.current_ai_decision.decision_id,
            confidence: state.current_ai_decision.confidence,
            timestamp,
        });
    }

    /// Direct allocation update (rebalancer-only, no AI decision required)
    public entry fun set_allocation<T>(
        _rebalancer: &RebalancerCap,
        state: &mut UsdcPoolState<T>,
        btc_bps: u64,
        eth_bps: u64,
        sui_bps: u64,
        cro_bps: u64,
        reasoning: vector<u8>,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(btc_bps + eth_bps + sui_bps + cro_bps == BPS_DENOMINATOR, E_ALLOC_SUM_INVALID);

        let timestamp = clock::timestamp_ms(clock);
        assert!(
            timestamp >= state.last_rebalance_time + state.rebalance_cooldown,
            E_REBALANCE_COOLDOWN
        );

        let old_alloc = state.current_allocation;
        let new_alloc = AssetAllocation { btc_bps, eth_bps, sui_bps, cro_bps };
        state.current_allocation = new_alloc;
        state.target_allocation = new_alloc;
        state.last_rebalance_time = timestamp;
        state.rebalance_count = state.rebalance_count + 1;

        let reason_hash = hash::keccak256(&reasoning);

        event::emit(AllocationUpdated {
            old_allocation: old_alloc,
            new_allocation: new_alloc,
            decision_id: reason_hash,
            confidence: 100,
            timestamp,
        });
    }

    // ============ Auto-Hedge Functions ============

    /// Open a hedge position using pool USDC as collateral
    public entry fun open_hedge<T>(
        _agent: &AgentCap,
        state: &mut UsdcPoolState<T>,
        pair_index: u8,
        collateral_usdc: u64,
        leverage: u64,
        is_long: bool,
        reasoning: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(!state.circuit_breaker_tripped, E_CIRCUIT_BREAKER_TRIPPED);
        assert!(collateral_usdc > 0, E_ZERO_AMOUNT);

        let timestamp = clock::timestamp_ms(clock);
        assert!(
            timestamp >= state.auto_hedge_config.last_hedge_time + state.auto_hedge_config.cooldown_ms,
            E_HEDGE_COOLDOWN
        );

        let pool_balance = balance::value(&state.balance);
        assert!(pool_balance >= collateral_usdc, E_INSUFFICIENT_BALANCE);

        // Reserve ratio check (20%)
        let nav = get_total_nav(state);
        let min_reserve = (nav * MIN_RESERVE_RATIO_BPS) / BPS_DENOMINATOR;
        assert!(pool_balance - collateral_usdc >= min_reserve, E_RESERVE_RATIO_BREACHED);

        // Max hedge ratio check
        let max_hedge = (nav * state.auto_hedge_config.max_hedge_ratio_bps) / BPS_DENOMINATOR;
        assert!(state.total_hedged_value + collateral_usdc <= max_hedge, E_MAX_HEDGE_EXCEEDED);

        // Daily cap check
        let current_day = timestamp / 86400000;
        if (current_day > state.current_hedge_day) {
            state.daily_hedge_total = 0;
            state.current_hedge_day = current_day;
        };
        let daily_cap = (nav * DAILY_HEDGE_CAP_BPS) / BPS_DENOMINATOR;
        assert!(state.daily_hedge_total + collateral_usdc <= daily_cap, E_MAX_HEDGE_EXCEEDED);

        // Generate hedge ID
        let mut id_data = bcs::to_bytes(&timestamp);
        vector::append(&mut id_data, bcs::to_bytes(&pair_index));
        vector::append(&mut id_data, bcs::to_bytes(&collateral_usdc));
        let hedge_id = hash::keccak256(&id_data);

        let hedge = HedgePosition {
            hedge_id,
            pair_index,
            collateral_usdc,
            leverage,
            is_long,
            open_time: timestamp,
            reason_hash: hash::keccak256(&reasoning),
        };

        vector::push_back(&mut state.active_hedges, hedge);
        state.total_hedged_value = state.total_hedged_value + collateral_usdc;
        state.daily_hedge_total = state.daily_hedge_total + collateral_usdc;
        state.auto_hedge_config.last_hedge_time = timestamp;

        // Transfer collateral to treasury for external hedge execution (BlueFin)
        let collateral_balance = balance::split(&mut state.balance, collateral_usdc);
        let collateral_coin = coin::from_balance(collateral_balance, ctx);
        transfer::public_transfer(collateral_coin, state.treasury);

        event::emit(UsdcHedgeOpened {
            hedge_id,
            pair_index,
            collateral_usdc,
            leverage,
            is_long,
            timestamp,
        });
    }

    /// Close hedge and return USDC to pool
    public entry fun close_hedge<T>(
        _agent: &AgentCap,
        state: &mut UsdcPoolState<T>,
        hedge_id: vector<u8>,
        pnl_usdc: u64,
        is_profit: bool,
        funds: Coin<T>,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        let timestamp = clock::timestamp_ms(clock);

        let mut found_idx: u64 = 0;
        let mut found = false;
        let len = vector::length(&state.active_hedges);
        let mut i: u64 = 0;
        while (i < len) {
            let h = vector::borrow(&state.active_hedges, i);
            if (h.hedge_id == hedge_id) {
                found_idx = i;
                found = true;
                break
            };
            i = i + 1;
        };
        assert!(found, E_HEDGE_NOT_FOUND);

        let hedge = vector::remove(&mut state.active_hedges, found_idx);
        state.total_hedged_value = if (state.total_hedged_value > hedge.collateral_usdc) {
            state.total_hedged_value - hedge.collateral_usdc
        } else {
            0
        };

        balance::join(&mut state.balance, coin::into_balance(funds));

        if (is_profit) {
            let current_nav = get_nav_per_share(state);
            if (current_nav > state.all_time_high_nav_per_share) {
                state.all_time_high_nav_per_share = current_nav;
            };
        };

        event::emit(UsdcHedgeClosed {
            hedge_id,
            pnl_usdc,
            is_profit,
            timestamp,
        });
    }

    // ============ Admin Functions ============

    public entry fun set_paused<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        paused: bool,
        clock: &Clock,
    ) {
        state.paused = paused;
        event::emit(UsdcPoolPaused {
            pool_id: object::id(state),
            paused,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public entry fun trip_circuit_breaker<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
    ) {
        state.circuit_breaker_tripped = true;
    }

    public entry fun reset_circuit_breaker<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
    ) {
        state.circuit_breaker_tripped = false;
    }

    public entry fun set_treasury<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        new_treasury: address,
    ) {
        state.treasury = new_treasury;
    }

    public entry fun set_fees<T>(
        _fee_manager: &FeeManagerCap,
        state: &mut UsdcPoolState<T>,
        management_fee_bps: u64,
        performance_fee_bps: u64,
    ) {
        assert!(management_fee_bps <= 500, E_FEE_TOO_HIGH);
        assert!(performance_fee_bps <= 3000, E_FEE_TOO_HIGH);
        state.management_fee_bps = management_fee_bps;
        state.performance_fee_bps = performance_fee_bps;
    }

    public entry fun set_auto_hedge_config<T>(
        _agent: &AgentCap,
        state: &mut UsdcPoolState<T>,
        enabled: bool,
        risk_threshold_bps: u64,
        max_hedge_ratio_bps: u64,
        default_leverage: u64,
        cooldown_ms: u64,
        clock: &Clock,
    ) {
        assert!(default_leverage >= 2 && default_leverage <= 10, E_INVALID_ALLOCATION);
        assert!(max_hedge_ratio_bps <= 5000, E_MAX_HEDGE_EXCEEDED);

        state.auto_hedge_config = AutoHedgeConfig {
            enabled,
            risk_threshold_bps,
            max_hedge_ratio_bps,
            default_leverage,
            cooldown_ms,
            last_hedge_time: state.auto_hedge_config.last_hedge_time,
        };

        let _timestamp = clock::timestamp_ms(clock);
    }

    public entry fun set_rebalance_cooldown<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        cooldown_ms: u64,
    ) {
        assert!(cooldown_ms <= 604800000, E_INVALID_ALLOCATION);
        state.rebalance_cooldown = cooldown_ms;
    }

    public entry fun set_min_ai_confidence<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        min_confidence: u8,
    ) {
        assert!(min_confidence <= 100, E_INVALID_ALLOCATION);
        state.min_ai_confidence = min_confidence;
    }

    /// Add an agent address and transfer AgentCap
    public entry fun add_agent<T>(
        _admin: &AdminCap,
        _state: &mut UsdcPoolState<T>,
        agent: address,
        ctx: &mut TxContext
    ) {
        transfer::transfer(
            AgentCap {
                id: object::new(ctx),
                agent_address: agent,
            },
            agent
        );
    }

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

    /// Emergency withdrawal when pool is paused/tripped
    public entry fun emergency_withdraw<T>(
        state: &mut UsdcPoolState<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(state.circuit_breaker_tripped || state.paused, E_NOT_AUTHORIZED);

        let sender = ctx.sender();
        let _timestamp = clock::timestamp_ms(clock);

        assert!(table::contains(&state.members, sender), E_NOT_MEMBER);
        let member = table::borrow(&state.members, sender);
        assert!(member.shares > 0, E_INSUFFICIENT_SHARES);

        let shares_to_burn = member.shares;
        let mut amount = calculate_assets_for_shares(state, shares_to_burn);

        let available = balance::value(&state.balance);
        if (amount > available) {
            amount = available;
        };

        state.total_shares = state.total_shares - shares_to_burn;
        state.total_withdrawn = state.total_withdrawn + amount;

        let member_mut = table::borrow_mut(&mut state.members, sender);
        member_mut.shares = 0;
        member_mut.withdrawn_usdc = member_mut.withdrawn_usdc + amount;

        let withdrawal_balance = balance::split(&mut state.balance, amount);
        let withdrawal_coin = coin::from_balance(withdrawal_balance, ctx);
        transfer::public_transfer(withdrawal_coin, sender);
    }
}
