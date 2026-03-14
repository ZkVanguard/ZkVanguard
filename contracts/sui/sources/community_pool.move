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
#[allow(unused_const, unused_field, unused_use)]
module zkvanguard::community_pool {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};
    use sui::math;

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

    // ============ Constants ============
    const BPS_DENOMINATOR: u64 = 10000;
    const SECONDS_PER_YEAR: u64 = 31536000; // 365 days
    const MIN_DEPOSIT: u64 = 10_000_000_000; // 10 SUI (in MIST, 9 decimals)
    const MIN_SHARES_FOR_WITHDRAWAL: u64 = 1_000_000; // 0.001 shares (9 decimals)
    const MIN_FIRST_DEPOSIT: u64 = 100_000_000_000; // 100 SUI
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

    /// Member data structure
    public struct MemberData has store, copy, drop {
        shares: u64,             // Number of shares owned
        deposited_sui: u64,      // Total SUI deposited
        withdrawn_sui: u64,      // Total SUI withdrawn
        joined_at: u64,          // Timestamp of first deposit
        last_deposit_at: u64,    // Timestamp of last deposit
        high_water_mark: u64,    // For performance fee calculation
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
        /// AI Agent address (for off-chain tracking)
        agent_addresses: vector<address>,
        /// Pool creation timestamp
        created_at: u64,
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

    // ============ Init ============

    /// Initialize module and create admin capability
    fun init(ctx: &mut TxContext) {
        transfer::transfer(
            AdminCap { id: object::new(ctx) },
            ctx.sender()
        );
        transfer::transfer(
            FeeManagerCap { id: object::new(ctx) },
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
