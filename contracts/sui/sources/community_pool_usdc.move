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
    use sui::dynamic_field as df;

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
    /// External NAV oracle errors (added 2026-06-03 for withdrawal-underpayment fix)
    const E_EXTERNAL_NAV_STALE: u64 = 29;
    const E_EXTERNAL_NAV_CHANGE_TOO_LARGE: u64 = 30;
    const E_EXTERNAL_NAV_REQUIRED: u64 = 31;

    // ============ Constants ============
    const BPS_DENOMINATOR: u64 = 10000;
    const SECONDS_PER_YEAR: u64 = 31536000;

    // USDC has 6 decimals on SUI
    const USDC_DECIMALS: u64 = 6;
    const USDC_UNIT: u64 = 1_000_000; // 1 USDC = 1e6

    // Minimums in USDC (6 decimals)
    const MIN_DEPOSIT: u64 = 500_000;             // $0.50 USDC
    const MIN_FIRST_DEPOSIT: u64 = 500_000;       // $0.50 USDC
    const MIN_SHARES_FOR_WITHDRAWAL: u64 = 1_000; // 0.001 shares (6 decimals)

    // Virtual offset for inflation protection (1 share = 1 USDC)
    const VIRTUAL_SHARES: u64 = 1_000_000; // 1 share (6 decimals)
    const VIRTUAL_ASSETS: u64 = 1_000_000; // 1 USDC

    // Share precision matches USDC (6 decimals)
    const WAD: u64 = 1_000_000; // 1e6

    // Reserve and safety limits
    const MIN_RESERVE_RATIO_BPS: u64 = 2000; // 20% must stay liquid
    const MAX_SINGLE_HEDGE_BPS: u64 = 500;   // Max 5% per hedge
    const DAILY_HEDGE_CAP_BPS: u64 = 5000;   // Max 50% daily hedging (increased for small pools)

    // External NAV oracle (added 2026-06-03 for withdrawal-underpayment fix).
    //
    // Bug background: the original `calculate_assets_for_shares` /
    // `calculate_shares_for_deposit` / `get_nav_per_share` used only
    // `balance::value(&state.balance) + VIRTUAL_ASSETS` as total assets.
    // That ignores wBTC/wETH/SUI on the admin wallet and BlueFin perp
    // collateral — value the cron's NAV view correctly includes but the
    // contract was unaware of. At one point on 2026-06-03 the pool had
    // $0.41 on-chain balance vs $44.99 true NAV; a member withdrawing
    // 10% of shares would have received $0.135 instead of $4.50 (97%
    // underpayment).
    //
    // Fix: an oracle field the cron pushes each tick (admin-only via
    // AdminCap). Stored in a dynamic field so the upgrade is layout-
    // safe (no UsdcPoolState struct field change).
    const EXTERNAL_NAV_MAX_AGE_MS: u64 = 7_200_000;   // 2 hours — must be < this old for entries
    const EXTERNAL_NAV_MAX_CHANGE_BPS: u64 = 3000;    // 30% max change per attestation (anti-manipulation)
    const EXTERNAL_NAV_KEY: vector<u8> = b"external_nav_usdc";
    const EXTERNAL_NAV_TS_KEY: vector<u8> = b"external_nav_ts_ms";
    const EXTERNAL_NAV_REQUIRED_KEY: vector<u8> = b"external_nav_required";
    /// Audit 2026-06-06 phase 6: lockdown flag for capability minting.
    /// Once set true, `create_admin_cap`, `create_rebalancer_cap`, and
    /// `add_agent` all revert. Used to prevent a compromised AdminCap
    /// holder from minting backup caps for persistence. Default = false
    /// (minting allowed) so existing flows continue to work; admin
    /// should lock as soon as the cap set is final.
    const CAP_MINTING_LOCKED_KEY: vector<u8> = b"cap_minting_locked";

    /// AUDIT 2026-06-09 phase 13 (CRITICAL FOR SCALE): TVL ceiling.
    ///
    /// Operator-settable maximum on total_deposited. Below this cap,
    /// deposits work normally. Above this cap, deposits revert. The
    /// operator ratchets the cap upward explicitly as confidence
    /// grows: initially small (e.g., $100k or $1M), raised after the
    /// external audit (T4-C) completes, multi-sig migration (T4-A)
    /// lands, and the pool has accumulated a production track record.
    ///
    /// Why this is required for billion-dollar safety:
    ///   - No matter how many audit phases we run in-session, there's
    ///     a residual probability of a bug we missed.
    ///   - At $30 NAV today, a critical bug costs $30. Tolerable.
    ///   - At $1B NAV, the same bug costs $1B. Catastrophic.
    ///   - The TVL ceiling caps potential damage at the operator's
    ///     current confidence level, independent of any bug.
    ///
    /// Default value 0 = unlimited (backwards compatible — pools
    /// without the cap field set behave as before). Operator should
    /// set a real cap right after the upgrade as part of the deploy
    /// runbook.
    ///
    /// Compound, Aave, Morpho, and every other billion-dollar DeFi
    /// protocol uses supply caps per asset. This is industry standard.
    const TVL_CAP_KEY: vector<u8> = b"tvl_cap_usdc";

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

    /// AI & Allocation sub-state (extracted for 32-field limit)
    public struct UsdcAIState has store {
        current_allocation: AssetAllocation,
        target_allocation: AssetAllocation,
        current_ai_decision: AIDecision,
        ai_decision_count: u64,
        min_ai_confidence: u8,
        last_rebalance_time: u64,
        rebalance_cooldown: u64,
        rebalance_count: u64,
    }

    /// Auto-hedge sub-state
    public struct UsdcHedgeState has store {
        auto_hedge_config: AutoHedgeConfig,
        active_hedges: vector<HedgePosition>,
        total_hedged_value: u64,
        daily_hedge_total: u64,
        current_hedge_day: u64,
    }

    /// USDC Community Pool State (shared object, generic over coin type T) — 24 fields
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
        // ═══ SUB-STATES (grouped to stay under 32-field limit) ═══
        ai_state: UsdcAIState,
        hedge_state: UsdcHedgeState,
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

    /// External NAV oracle attestation event (added 2026-06-03).
    public struct ExternalNavAttested has copy, drop {
        prior_external_nav_usdc: u64,
        new_external_nav_usdc: u64,
        change_bps: u64,
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

            ai_state: UsdcAIState {
                current_allocation: copy initial_alloc,
                target_allocation: copy initial_alloc,
                current_ai_decision: empty_decision,
                ai_decision_count: 0,
                min_ai_confidence: DEFAULT_MIN_AI_CONFIDENCE,
                last_rebalance_time: 0,
                rebalance_cooldown: DEFAULT_REBALANCE_COOLDOWN,
                rebalance_count: 0,
            },
            hedge_state: UsdcHedgeState {
                auto_hedge_config: hedge_config,
                active_hedges: vector::empty(),
                total_hedged_value: 0,
                daily_hedge_total: 0,
                current_hedge_day: timestamp / 86400000,
            },
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
        // External NAV freshness — when strict mode is on, deposits revert
        // unless the cron has attested off-chain holdings recently.
        // Without this, new depositors get over-issued shares against a
        // depleted on-chain balance (the underpayment bug's mirror image).
        assert_external_nav_fresh_if_required(state, clock);

        let amount = coin::value(&payment);
        assert!(amount > 0, E_ZERO_AMOUNT);
        assert!(amount >= MIN_DEPOSIT, E_MIN_DEPOSIT_NOT_MET);
        assert!(amount <= state.max_single_deposit, E_MAX_DEPOSIT_EXCEEDED);

        // AUDIT 2026-06-09 phase 13 (CRITICAL FOR SCALE): TVL ceiling.
        // Operator-settable cap on total_deposited. Default 0 means
        // unlimited (backwards compat for pools without the cap set).
        // Operator ratchets this up as confidence grows: external
        // audit completes, multi-sig migrates, track record builds.
        let tvl_cap = get_tvl_cap_usdc(state);
        if (tvl_cap > 0) {
            assert!(state.total_deposited + amount <= tvl_cap, E_MAX_DEPOSIT_EXCEEDED);
        };

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
        // External NAV freshness gate — see deposit() commentary above.
        // Without this, members would receive payout against the depleted
        // on-chain balance only (the original 2026-06-03 underpayment bug).
        assert_external_nav_fresh_if_required(state, clock);

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
        // AUDIT 2026-06-09 phase 14 (LOW): refuse zero-payout withdraws.
        // For very small share amounts vs total_shares, integer division
        // in calculate_assets_for_shares can round to 0. Without this
        // guard, the member would burn their shares but receive nothing —
        // foot gun. Now reverts cleanly so they keep their shares and
        // can retry with a larger amount.
        assert!(amount_to_withdraw > 0, E_ZERO_AMOUNT);
        assert!(balance::value(&state.balance) >= amount_to_withdraw, E_INSUFFICIENT_BALANCE);

        // Circuit breaker checks.
        // AUDIT 2026-06-08 phase 12 (MEDIUM): u128 intermediates to
        // avoid overflow at scale. nav (u64) × bps (≤10000) overflows
        // u64 at nav > 1.8e15 raw = $1.8 billion. We expect to
        // pass that with billions of dollars of AUM.
        let nav = get_total_nav(state);
        let max_single = (((nav as u128) * (state.max_single_withdrawal_bps as u128)) / (BPS_DENOMINATOR as u128)) as u64;
        assert!(amount_to_withdraw <= max_single, E_MAX_WITHDRAWAL_EXCEEDED);

        let daily_cap = (((nav as u128) * (state.daily_withdrawal_cap_bps as u128)) / (BPS_DENOMINATOR as u128)) as u64;
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

    /// Collect accumulated fees to treasury.
    ///
    /// AUDIT 2026-06-08 phase 12 (MEDIUM): now respects pause. Previously
    /// FeeManagerCap could withdraw fees to treasury even during a pause,
    /// which is the operational state we use for emergencies and audits.
    /// The treasury address is admin-controlled — a compromised admin
    /// could pause, set_treasury(attacker), then collect_fees during the
    /// frozen window to drain accumulated fees to the attacker. Gating
    /// on pause blocks this and aligns fee collection with normal pool
    /// operation. emergency_withdraw remains available during pause for
    /// members; collect_fees does not.
    public entry fun collect_fees<T>(
        _fee_manager: &FeeManagerCap,
        state: &mut UsdcPoolState<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
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
        // AUDIT 2026-06-06 phase 5 (LOW): defend against clock skew.
        // Move u64 subtraction aborts on underflow; if Clock somehow
        // reports a value below last_fee_collection (epoch boundary,
        // RPC inconsistency) the whole tx would abort. Skip fee accrual
        // gracefully instead.
        if (current_time < state.last_fee_collection) return;
        let time_elapsed_ms = current_time - state.last_fee_collection;
        if (time_elapsed_ms == 0) return;

        let time_elapsed_sec = time_elapsed_ms / 1000;
        let nav = get_total_nav(state);
        // AUDIT 2026-06-06 phase 5 (HIGH): u128 intermediate to prevent
        // u64 overflow. Original: nav * fee_bps * time_elapsed_sec.
        // At $10M NAV × 100 bps × 1 day = 10e12 × 100 × 86400 = 8.64e19,
        // already over u64::MAX (1.8e19). u128 max is 3.4e38 — fits
        // even at $500M × 1000 bps × 7 days (3.0e22) with room to spare.
        let fee_u128 = (nav as u128) * (state.management_fee_bps as u128) * (time_elapsed_sec as u128) /
                       ((BPS_DENOMINATOR as u128) * (SECONDS_PER_YEAR as u128));
        // Fee is bounded by nav, so it always fits in u64 (nav itself is u64).
        let fee = (fee_u128 as u64);

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
            // AUDIT 2026-06-06 phase 5 (MEDIUM): u128 intermediate.
            // gain_per_share × member.shares overflows u64 at modest
            // scale: with WAD=1e6 precision, member.shares=10^11 (= $100k
            // worth) × gain_per_share=10^9 (a 1000x ratio) = 10^20 > u64.
            // Performance fees are charged at every withdraw + collect,
            // so realistic gain_per_share is small, but defense in depth.
            let member_gain_u128 = (gain_per_share as u128) * (member.shares as u128) / (WAD as u128);
            let performance_fee_u128 = member_gain_u128 * (state.performance_fee_bps as u128) / (BPS_DENOMINATOR as u128);
            let performance_fee = (performance_fee_u128 as u64);

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
        // Fix 2026-06-03: include attested external NAV so the share
        // price reflects the off-chain wBTC/wETH/SUI + BlueFin
        // collateral, not just on-chain USDC.
        let total_assets = total_assets_including_external(state) + VIRTUAL_ASSETS;
        let total_shares = state.total_shares + VIRTUAL_SHARES;
        ((total_assets as u128) * (WAD as u128) / (total_shares as u128)) as u64
    }

    /// Get total NAV = pool balance + attested external NAV + operational hedge value.
    /// The operational hedge_state.total_hedged_value tracks USDC sent through
    /// open_hedge (the capability-transfer rail) and is double-counted with
    /// the external NAV unless cron is careful, so external NAV should be
    /// reported NET of the operational rail.
    public fun get_total_nav<T>(state: &UsdcPoolState<T>): u64 {
        balance::value(&state.balance)
            + get_external_nav_usdc(state)
            + state.hedge_state.total_hedged_value
    }

    /// On-chain NAV = pool balance + operational hedge value. EXCLUDES
    /// admin-attested external NAV. Used by ratios that need to reason
    /// about the contract's actual liquid + operationally-tracked USDC
    /// (reserve ratio, hedge caps in open_hedge), NOT by share-pricing
    /// math. Including external_nav in those checks would break the
    /// cron's operational rail: with $0.41 on-chain and $44 external,
    /// the 20% reserve floor becomes $8.89 which the pool can never
    /// satisfy on-chain.
    public fun get_onchain_nav<T>(state: &UsdcPoolState<T>): u64 {
        balance::value(&state.balance) + state.hedge_state.total_hedged_value
    }

    public fun calculate_shares_for_deposit<T>(state: &UsdcPoolState<T>, amount: u64): u64 {
        // Fix 2026-06-03: include external NAV so new depositors aren't
        // over-issued shares when off-chain holdings are non-trivial.
        let total_assets = total_assets_including_external(state) + VIRTUAL_ASSETS;
        let total_shares = state.total_shares + VIRTUAL_SHARES;
        ((amount as u128) * (total_shares as u128) / (total_assets as u128)) as u64
    }

    public fun calculate_assets_for_shares<T>(state: &UsdcPoolState<T>, shares: u64): u64 {
        if (state.total_shares == 0) return 0;
        // Fix 2026-06-03: include external NAV so withdrawing members
        // get paid their fair share, not just their portion of the
        // depleted on-chain balance.
        let total_assets = total_assets_including_external(state) + VIRTUAL_ASSETS;
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
            state.ai_state.current_allocation.btc_bps,
            state.ai_state.current_allocation.eth_bps,
            state.ai_state.current_allocation.sui_bps,
            state.ai_state.current_allocation.cro_bps,
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
        assert!(confidence >= state.ai_state.min_ai_confidence, E_AI_CONFIDENCE_TOO_LOW);
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

        state.ai_state.current_ai_decision = decision;
        state.ai_state.ai_decision_count = state.ai_state.ai_decision_count + 1;
        state.ai_state.target_allocation = target_alloc;

        event::emit(AllocationUpdated {
            old_allocation: state.ai_state.current_allocation,
            new_allocation: state.ai_state.target_allocation,
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
        assert!(!state.ai_state.current_ai_decision.executed, E_DECISION_ALREADY_EXECUTED);

        let timestamp = clock::timestamp_ms(clock);
        assert!(
            timestamp >= state.ai_state.last_rebalance_time + state.ai_state.rebalance_cooldown,
            E_REBALANCE_COOLDOWN
        );

        let old_alloc = state.ai_state.current_allocation;
        state.ai_state.current_allocation = state.ai_state.target_allocation;
        state.ai_state.last_rebalance_time = timestamp;
        state.ai_state.rebalance_count = state.ai_state.rebalance_count + 1;
        state.ai_state.current_ai_decision.executed = true;

        event::emit(AllocationUpdated {
            old_allocation: old_alloc,
            new_allocation: state.ai_state.current_allocation,
            decision_id: state.ai_state.current_ai_decision.decision_id,
            confidence: state.ai_state.current_ai_decision.confidence,
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
            timestamp >= state.ai_state.last_rebalance_time + state.ai_state.rebalance_cooldown,
            E_REBALANCE_COOLDOWN
        );

        let old_alloc = state.ai_state.current_allocation;
        let new_alloc = AssetAllocation { btc_bps, eth_bps, sui_bps, cro_bps };
        state.ai_state.current_allocation = new_alloc;
        state.ai_state.target_allocation = new_alloc;
        state.ai_state.last_rebalance_time = timestamp;
        state.ai_state.rebalance_count = state.ai_state.rebalance_count + 1;

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
            timestamp >= state.hedge_state.auto_hedge_config.last_hedge_time + state.hedge_state.auto_hedge_config.cooldown_ms,
            E_HEDGE_COOLDOWN
        );

        let pool_balance = balance::value(&state.balance);
        assert!(pool_balance >= collateral_usdc, E_INSUFFICIENT_BALANCE);

        // AUDIT 2026-06-04: ratio checks below must use ON-CHAIN NAV
        // (balance + operational hedge state). Using the full
        // get_total_nav — which now includes admin-attested external NAV
        // after the 2026-06-03 share-pricing fix — would break the
        // cron's operational rail: at $0.41 balance and $44 external,
        // a 20% reserve floor of $8.89 is unreachable on-chain. Reserve
        // and hedge caps are about the contract's controllable USDC,
        // not depositor wealth.
        let onchain_nav = get_onchain_nav(state);

        // Reserve ratio check (20%).
        // AUDIT 2026-06-08 phase 12 (MEDIUM): u128 intermediates here
        // and in the two checks below. onchain_nav × bps overflows u64
        // at ~$1.8-3.6B depending on bps value.
        let min_reserve = (((onchain_nav as u128) * (MIN_RESERVE_RATIO_BPS as u128)) / (BPS_DENOMINATOR as u128)) as u64;
        assert!(pool_balance - collateral_usdc >= min_reserve, E_RESERVE_RATIO_BREACHED);

        // Max hedge ratio check
        let max_hedge = (((onchain_nav as u128) * (state.hedge_state.auto_hedge_config.max_hedge_ratio_bps as u128)) / (BPS_DENOMINATOR as u128)) as u64;
        assert!(state.hedge_state.total_hedged_value + collateral_usdc <= max_hedge, E_MAX_HEDGE_EXCEEDED);

        // Daily cap check
        let current_day = timestamp / 86400000;
        if (current_day > state.hedge_state.current_hedge_day) {
            state.hedge_state.daily_hedge_total = 0;
            state.hedge_state.current_hedge_day = current_day;
        };
        let daily_cap = (((onchain_nav as u128) * (DAILY_HEDGE_CAP_BPS as u128)) / (BPS_DENOMINATOR as u128)) as u64;
        assert!(state.hedge_state.daily_hedge_total + collateral_usdc <= daily_cap, E_MAX_HEDGE_EXCEEDED);

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

        vector::push_back(&mut state.hedge_state.active_hedges, hedge);
        state.hedge_state.total_hedged_value = state.hedge_state.total_hedged_value + collateral_usdc;
        state.hedge_state.daily_hedge_total = state.hedge_state.daily_hedge_total + collateral_usdc;
        state.hedge_state.auto_hedge_config.last_hedge_time = timestamp;

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
        let len = vector::length(&state.hedge_state.active_hedges);
        let mut i: u64 = 0;
        while (i < len) {
            let h = vector::borrow(&state.hedge_state.active_hedges, i);
            if (h.hedge_id == hedge_id) {
                found_idx = i;
                found = true;
                break
            };
            i = i + 1;
        };
        assert!(found, E_HEDGE_NOT_FOUND);

        let hedge = vector::remove(&mut state.hedge_state.active_hedges, found_idx);
        state.hedge_state.total_hedged_value = if (state.hedge_state.total_hedged_value > hedge.collateral_usdc) {
            state.hedge_state.total_hedged_value - hedge.collateral_usdc
        } else {
            0
        };

        // AUDIT 2026-06-04: verify the caller actually transferred USDC
        // consistent with the claimed PnL. Without this check, a
        // compromised AgentCap holder could call close_hedge with
        // is_profit=false, pnl_usdc=collateral_usdc, funds=Coin::zero(),
        // wiping the hedge accounting without returning any USDC —
        // silent collateral drain.
        //
        // Expected funds returned:
        //   profit:  collateral + pnl
        //   loss:    collateral - pnl   (or 0 if pnl > collateral)
        // We allow >= expected so a generous return (e.g. funding rewards
        // captured during the hedge) doesn't revert. Excess is donated
        // to the pool.
        let expected_return = if (is_profit) {
            hedge.collateral_usdc + pnl_usdc
        } else if (pnl_usdc >= hedge.collateral_usdc) {
            0
        } else {
            hedge.collateral_usdc - pnl_usdc
        };
        assert!(coin::value(&funds) >= expected_return, E_INSUFFICIENT_BALANCE);

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

    // ============ External NAV Oracle (added 2026-06-03) ============

    /// Read the current attested external NAV (USDC value of off-chain
    /// holdings — admin-wallet wBTC/wETH/SUI + BlueFin collateral that
    /// the pool contract has no direct view of). Returns 0 if no
    /// attestation has ever been made. Does NOT staleness-check.
    public fun get_external_nav_usdc<T>(state: &UsdcPoolState<T>): u64 {
        if (!df::exists_(&state.id, EXTERNAL_NAV_KEY)) return 0;
        let v: &u64 = df::borrow(&state.id, EXTERNAL_NAV_KEY);
        *v
    }

    /// Read the timestamp of the last external NAV attestation, or 0
    /// if none. Caller checks staleness against EXTERNAL_NAV_MAX_AGE_MS.
    public fun get_external_nav_ts_ms<T>(state: &UsdcPoolState<T>): u64 {
        if (!df::exists_(&state.id, EXTERNAL_NAV_TS_KEY)) return 0;
        let t: &u64 = df::borrow(&state.id, EXTERNAL_NAV_TS_KEY);
        *t
    }

    /// True when the attestation is recent enough that withdraw/deposit
    /// math may rely on it. False when stale or never set.
    public fun is_external_nav_fresh<T>(state: &UsdcPoolState<T>, clock: &Clock): bool {
        let ts = get_external_nav_ts_ms(state);
        if (ts == 0) return false;
        let now = clock::timestamp_ms(clock);
        now >= ts && now - ts <= EXTERNAL_NAV_MAX_AGE_MS
    }

    /// Read the operator's choice of whether deposits/withdrawals MUST
    /// have a fresh external NAV attestation. Default false (pools that
    /// were deployed before this fix keep working until admin opts in).
    public fun is_external_nav_required<T>(state: &UsdcPoolState<T>): bool {
        if (!df::exists_(&state.id, EXTERNAL_NAV_REQUIRED_KEY)) return false;
        let v: &bool = df::borrow(&state.id, EXTERNAL_NAV_REQUIRED_KEY);
        *v
    }

    /// AdminCap-gated: switch on the freshness requirement. Once true,
    /// withdraw/deposit will revert with E_EXTERNAL_NAV_STALE when the
    /// last attestation is older than EXTERNAL_NAV_MAX_AGE_MS. Operator
    /// MUST attest within the cron cadence (every 30 min default).
    public entry fun admin_set_external_nav_required<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        required: bool,
    ) {
        let id_mut = &mut state.id;
        if (df::exists_(id_mut, EXTERNAL_NAV_REQUIRED_KEY)) {
            let v_mut: &mut bool = df::borrow_mut(id_mut, EXTERNAL_NAV_REQUIRED_KEY);
            *v_mut = required;
        } else {
            df::add(id_mut, EXTERNAL_NAV_REQUIRED_KEY, required);
        };
    }

    /// Helper used by withdraw + deposit entry points. Asserts when
    /// strict mode is on AND the oracle is stale. Cheap no-op when off.
    fun assert_external_nav_fresh_if_required<T>(state: &UsdcPoolState<T>, clock: &Clock) {
        if (is_external_nav_required(state)) {
            assert!(is_external_nav_fresh(state, clock), E_EXTERNAL_NAV_STALE);
        };
    }

    /// Internal helper: total assets including the (possibly stale)
    /// external NAV. Used by share-math view functions.
    ///
    /// AUDIT 2026-06-06 phase 5 (MEDIUM): when total_shares == 0,
    /// ignore external_nav. The external NAV represents members' claim
    /// on off-chain holdings; with no members, the claim is undefined
    /// and including a stale external_nav would dilute the next
    /// depositor with phantom assets. After everyone withdraws, the
    /// pool is effectively empty regardless of whatever the cron last
    /// attested. The cron should also clear external_nav when no
    /// members remain, but this guard protects against ordering races.
    fun total_assets_including_external<T>(state: &UsdcPoolState<T>): u64 {
        if (state.total_shares == 0) {
            return balance::value(&state.balance)
        };
        balance::value(&state.balance) + get_external_nav_usdc(state)
    }

    /// AdminCap-gated oracle update. Bounded change magnitude prevents
    /// rugpull-style manipulation: a single attestation cannot move the
    /// recorded value by more than EXTERNAL_NAV_MAX_CHANGE_BPS (30%).
    ///
    /// AUDIT 2026-06-06 phase 5 (MEDIUM): first attestation now also
    /// bounded. Previously the 30% delta cap only kicked in once a
    /// prior value existed (`prior > 0`); first-ever attestation was
    /// unbounded. A compromised AdminCap holder could push an
    /// arbitrarily large initial external_nav, inflate share price via
    /// get_nav_per_share, trigger HWM crossings on every member, and
    /// harvest performance fees to the admin-controlled treasury.
    ///
    /// First attestation is now capped at 100x of total_deposited as
    /// a sanity bound. Real yields don't approach 100x; the cap leaves
    /// room for legitimate growth while blocking a one-shot nuke. For
    /// pools with total_deposited=0 (brand new), first attestation
    /// must be 0 (which is the contract's default state already).
    public entry fun admin_attest_external_nav<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        external_nav_usdc: u64,
        clock: &Clock,
    ) {
        let now = clock::timestamp_ms(clock);
        let id_mut = &mut state.id;
        let prior = if (df::exists_(id_mut, EXTERNAL_NAV_KEY)) {
            let p: &u64 = df::borrow(id_mut, EXTERNAL_NAV_KEY);
            *p
        } else { 0 };

        // AUDIT 2026-06-07 phase 9 (MEDIUM): absolute cap on external_nav.
        // Previously, only the FIRST attestation had an absolute bound
        // (100x total_deposited). Subsequent attestations were limited to
        // 30% delta from prior, which is per-tick. Over many ticks, a
        // compromised admin could cumulatively grow external_nav to any
        // value (1.3^N grows fast — 50 ticks ≈ 1B× growth). The 100x
        // total_deposited cap applies to EVERY attestation now. Real
        // yields don't approach 100x; this stops the slow-drift attack.
        //
        // u128 intermediate prevents overflow when total_deposited is
        // very large (>$184 trillion would otherwise abort the mul).
        let absolute_cap_u128 = (state.total_deposited as u128) * 100u128;
        assert!((external_nav_usdc as u128) <= absolute_cap_u128, E_EXTERNAL_NAV_CHANGE_TOO_LARGE);

        // Bound per-tick delta magnitude.
        let change_bps = if (prior > 0) {
            let delta = if (external_nav_usdc > prior) {
                external_nav_usdc - prior
            } else {
                prior - external_nav_usdc
            };
            // AUDIT 2026-06-07 phase 9 (LOW, defense in depth):
            // do the bound comparison in u128 to be robust against
            // any cast semantics. The intermediate (delta × 10000) /
            // prior can be up to ~1.8e23 in pathological cases; cast
            // to u64 may abort or truncate depending on the Move VM
            // version. Compare in u128 first, then cast safely once
            // we know it fits.
            let bps_u128 = (delta as u128) * (BPS_DENOMINATOR as u128) / (prior as u128);
            assert!(bps_u128 <= (EXTERNAL_NAV_MAX_CHANGE_BPS as u128), E_EXTERNAL_NAV_CHANGE_TOO_LARGE);
            (bps_u128 as u64) // safe — we just asserted ≤ 3000
        } else {
            // First attestation has no prior to delta against. The
            // absolute_cap above handles the bound.
            0
        };

        if (df::exists_(id_mut, EXTERNAL_NAV_KEY)) {
            let val_mut: &mut u64 = df::borrow_mut(id_mut, EXTERNAL_NAV_KEY);
            *val_mut = external_nav_usdc;
            let ts_mut: &mut u64 = df::borrow_mut(id_mut, EXTERNAL_NAV_TS_KEY);
            *ts_mut = now;
        } else {
            df::add(id_mut, EXTERNAL_NAV_KEY, external_nav_usdc);
            df::add(id_mut, EXTERNAL_NAV_TS_KEY, now);
        };

        event::emit(ExternalNavAttested {
            prior_external_nav_usdc: prior,
            new_external_nav_usdc: external_nav_usdc,
            change_bps,
            timestamp: now,
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

    /// Admin function to update withdrawal limits (circuit breaker settings)
    public entry fun set_withdrawal_limits<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        max_single_withdrawal_bps: u64,
        daily_withdrawal_cap_bps: u64,
    ) {
        // Max single withdrawal can be up to 100% (10000 bps)
        assert!(max_single_withdrawal_bps <= BPS_DENOMINATOR, E_INVALID_ALLOCATION);
        assert!(max_single_withdrawal_bps > 0, E_ZERO_AMOUNT);
        // Daily cap can be up to 100%
        assert!(daily_withdrawal_cap_bps <= BPS_DENOMINATOR, E_INVALID_ALLOCATION);
        assert!(daily_withdrawal_cap_bps > 0, E_ZERO_AMOUNT);
        state.max_single_withdrawal_bps = max_single_withdrawal_bps;
        state.daily_withdrawal_cap_bps = daily_withdrawal_cap_bps;
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

        state.hedge_state.auto_hedge_config = AutoHedgeConfig {
            enabled,
            risk_threshold_bps,
            max_hedge_ratio_bps,
            default_leverage,
            cooldown_ms,
            last_hedge_time: state.hedge_state.auto_hedge_config.last_hedge_time,
        };

        let _timestamp = clock::timestamp_ms(clock);
    }

    public entry fun set_rebalance_cooldown<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        cooldown_ms: u64,
    ) {
        assert!(cooldown_ms <= 604800000, E_INVALID_ALLOCATION);
        state.ai_state.rebalance_cooldown = cooldown_ms;
    }

    public entry fun set_min_ai_confidence<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        min_confidence: u8,
    ) {
        assert!(min_confidence <= 100, E_INVALID_ALLOCATION);
        state.ai_state.min_ai_confidence = min_confidence;
    }

    /// Emergency reset of hedge tracking state.
    ///
    /// Use when hedge positions were liquidated/closed outside the contract
    /// and the on-chain tracking is out of sync with actual positions.
    /// CAUTION: This resets all hedge tracking - only use after verifying
    /// external positions are actually closed.
    ///
    /// AUDIT 2026-06-06 phase 5 (HIGH): NAV inconsistency window.
    /// Before this fix, admin clearing total_hedged_value on-chain while
    /// the attested external_nav was still computed NET of the hedge value
    /// caused get_total_nav to under-report by the hedge amount. A
    /// deposit or withdraw landing in the window between this call and
    /// the next attest_external_nav from the cron would be priced
    /// against the wrong NAV — symmetric mirror of the original
    /// underpayment bug.
    ///
    /// Fix: this function now ALSO stales the external_nav timestamp
    /// (deletes it) so any deposit/withdraw with strict mode ON reverts
    /// until the cron observes the cleared hedge state and re-attests
    /// with the correct gross-of-hedge value.
    public entry fun admin_reset_hedge_state<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        clock: &Clock,
    ) {
        // AUDIT 2026-06-07 phase 8 (HIGH): require a safety net to be
        // already in place. This function clears hedge state AND wipes
        // external_nav (per phase 7), which creates a window where
        // share-math reads as balance-only — the original underpayment
        // behavior. If the pool is active and strict mode is OFF, a
        // deposit/withdraw landing in that window silently underpays.
        //
        // Allowed contexts:
        //   1. Pool is paused — user flow already blocked at the front.
        //   2. Strict mode is on — assert_external_nav_fresh_if_required
        //      reverts deposit/withdraw once we wipe the TS key.
        // Either way, the inconsistency window is invisible to users.
        assert!(state.paused || is_external_nav_required(state), E_NOT_AUTHORIZED);

        // Clear all active hedges
        state.hedge_state.active_hedges = vector::empty();
        // Reset counters
        state.hedge_state.total_hedged_value = 0;
        state.hedge_state.daily_hedge_total = 0;
        state.hedge_state.current_hedge_day = clock::timestamp_ms(clock) / 86400000;

        // Force the external NAV to be stale AND wipe the value so:
        //   1. Strict mode protects deposit/withdraw until cron re-attests
        //      (TS_KEY removed → is_external_nav_fresh = false).
        //   2. Next attestation can push directly to the true value in
        //      one tick instead of ratcheting at 30%/tick. Without this
        //      step, end-to-end verification showed: after clearing a
        //      $10 hedge from $20 external_nav, cron needs to push to $30
        //      (+50%), which the 30% delta cap rejects — locking the pool
        //      for 2-3 ticks. Clearing VALUE makes the next attestation
        //      a "first" (bounded by 100x total_deposited instead).
        //
        // Strict mode caveat: if the operator has not enabled
        // admin_set_external_nav_required, the brief window between this
        // call and the next attestation will have external_nav=0 in the
        // share-math view functions — re-introducing the original
        // underpayment behavior for that window. Operators MUST keep
        // strict mode on around admin_reset_hedge_state calls.
        let id_mut = &mut state.id;
        if (df::exists_(id_mut, EXTERNAL_NAV_TS_KEY)) {
            let _: u64 = df::remove(id_mut, EXTERNAL_NAV_TS_KEY);
        };
        if (df::exists_(id_mut, EXTERNAL_NAV_KEY)) {
            let _: u64 = df::remove(id_mut, EXTERNAL_NAV_KEY);
        };

        event::emit(UsdcPoolPaused {
            pool_id: object::id(state),
            paused: false,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    /// Reset daily hedge counter without clearing active hedges.
    /// Useful when daily cap is too restrictive and needs a fresh start.
    public entry fun admin_reset_daily_hedge<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        clock: &Clock,
    ) {
        state.hedge_state.daily_hedge_total = 0;
        state.hedge_state.current_hedge_day = clock::timestamp_ms(clock) / 86400000;
        
        event::emit(UsdcPoolPaused {
            pool_id: object::id(state),
            paused: false,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    /// Add an agent address and transfer AgentCap.
    ///
    /// AUDIT 2026-06-06 phase 6 (HIGH): now respects the cap-minting
    /// lockdown. The function already had a `state: &mut UsdcPoolState<T>`
    /// parameter (previously unused as `_state`), so we can check the
    /// lockdown flag without changing the ABI.
    public entry fun add_agent<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        agent: address,
        ctx: &mut TxContext
    ) {
        assert!(!is_cap_minting_locked(state), E_NOT_AUTHORIZED);
        transfer::transfer(
            AgentCap {
                id: object::new(ctx),
                agent_address: agent,
            },
            agent
        );
    }

    /// AUDIT 2026-06-06 phase 6 (HIGH): DISABLED. Body always aborts.
    ///
    /// Previously this minted a fresh AdminCap to any recipient — a free
    /// persistence escalation if the AdminCap was ever compromised. The
    /// only legitimate post-deploy reason to "create an AdminCap" was
    /// multi-sig migration, but that pattern transfers the existing cap
    /// instead of minting a duplicate (`transfer::public_transfer`).
    ///
    /// Signature preserved (policy=0 compatible upgrade); body now
    /// always aborts so existing callers fail loudly rather than
    /// silently producing a security risk.
    public entry fun create_admin_cap(
        _admin: &AdminCap,
        _recipient: address,
        _ctx: &mut TxContext
    ) {
        abort E_NOT_AUTHORIZED
    }

    /// AUDIT 2026-06-06 phase 6 (HIGH): DISABLED. Same rationale as
    /// create_admin_cap — the only safe post-deploy delegation path is
    /// `transfer::public_transfer` of the existing cap.
    public entry fun create_rebalancer_cap(
        _admin: &AdminCap,
        _recipient: address,
        _ctx: &mut TxContext
    ) {
        abort E_NOT_AUTHORIZED
    }

    /// AUDIT 2026-06-09 phase 13: Return the operator-set TVL ceiling
    /// in raw USDC (6 decimals). Returns 0 when unset, which the
    /// deposit function interprets as "unlimited" for backwards
    /// compatibility.
    public fun get_tvl_cap_usdc<T>(state: &UsdcPoolState<T>): u64 {
        if (!df::exists_(&state.id, TVL_CAP_KEY)) return 0;
        let v: &u64 = df::borrow(&state.id, TVL_CAP_KEY);
        *v
    }

    /// AUDIT 2026-06-09 phase 13: AdminCap-gated TVL ceiling setter.
    ///
    /// Sets the maximum value of `total_deposited` the pool will
    /// accept. Once `total_deposited` would exceed this cap (via a
    /// new deposit), the deposit reverts with `E_MAX_DEPOSIT_EXCEEDED`.
    /// Existing deposits are not affected.
    ///
    /// Operator sequence for billion-dollar readiness:
    ///   1. Deploy upgrade with this function available.
    ///   2. Set cap = $100,000 (raw 100_000_000_000) for initial
    ///      operation. Members above the cap stay; new depositors
    ///      are blocked until cap is raised.
    ///   3. After 1 month of clean operation: raise to $1M.
    ///   4. After T4-A multi-sig migration: raise to $10M.
    ///   5. After T4-C external audit: raise to $100M.
    ///   6. After production track record at $100M for 6 months
    ///      and T4-B u128 redeploy: raise toward $1B+.
    ///
    /// Setting cap = 0 explicitly removes the cap. Setting cap lower
    /// than current total_deposited stops new deposits but doesn't
    /// affect existing members.
    public entry fun admin_set_tvl_cap<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
        cap_usdc: u64,
    ) {
        let id_mut = &mut state.id;
        if (df::exists_(id_mut, TVL_CAP_KEY)) {
            let v_mut: &mut u64 = df::borrow_mut(id_mut, TVL_CAP_KEY);
            *v_mut = cap_usdc;
        } else {
            df::add(id_mut, TVL_CAP_KEY, cap_usdc);
        };
    }

    /// True if cap-minting (specifically `add_agent`) has been locked.
    /// One-way: the dynamic_field is only ever added.
    ///
    /// AUDIT 2026-06-08 phase 12 (LOW): also reads the stored value
    /// for defense in depth. Today `admin_lock_cap_minting` only adds
    /// the field with value=true, so exists_ alone is equivalent. But
    /// reading the value makes the check robust to any future code
    /// path that might add the field with value=false.
    public fun is_cap_minting_locked<T>(state: &UsdcPoolState<T>): bool {
        if (!df::exists_(&state.id, CAP_MINTING_LOCKED_KEY)) return false;
        let v: &bool = df::borrow(&state.id, CAP_MINTING_LOCKED_KEY);
        *v
    }

    /// AUDIT 2026-06-06 phase 6 (HIGH): one-way lockdown for `add_agent`.
    /// Once called, `add_agent` reverts. Should be called by the admin
    /// once the agent set is final (after multi-sig migration), so even
    /// a compromised AdminCap cannot mint new AgentCaps for unauthorized
    /// cron operators. Irreversible by design.
    public entry fun admin_lock_cap_minting<T>(
        _admin: &AdminCap,
        state: &mut UsdcPoolState<T>,
    ) {
        let id_mut = &mut state.id;
        if (!df::exists_(id_mut, CAP_MINTING_LOCKED_KEY)) {
            df::add(id_mut, CAP_MINTING_LOCKED_KEY, true);
        };
    }

    /// Emergency withdrawal when pool is paused/tripped.
    ///
    /// AUDIT 2026-06-04: cap payout at the caller's PRO-RATA share of the
    /// available on-chain balance, not their full fair share value. The
    /// old logic capped at `min(fair_share, available)` which allowed
    /// the first caller to drain the balance up to their fair share,
    /// starving later callers. Severity increased after the external-
    /// NAV oracle fix because fair_share can now far exceed available
    /// (off-chain assets aren't directly accessible at withdraw time).
    /// Pro-rata gives every member a proportional cut regardless of order.
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
        let fair_share = calculate_assets_for_shares(state, shares_to_burn);

        // Pro-rata cap: this member can only claim their proportional
        // slice of whatever USDC is currently on-chain. The remainder of
        // their fair share value lives in off-chain holdings the
        // contract can't unwind here — they recover it by waiting for
        // the operator to repatriate and unpause the pool.
        let available = balance::value(&state.balance);
        let pro_rata = if (state.total_shares == 0) {
            0
        } else {
            ((available as u128) * (shares_to_burn as u128) / (state.total_shares as u128)) as u64
        };
        let amount = if (fair_share < pro_rata) { fair_share } else { pro_rata };

        // AUDIT 2026-06-09 phase 14 (LOW): refuse zero-payout exits.
        // If balance is 0 or pro_rata rounds to 0, the member would
        // burn all their shares for nothing. Now reverts so they
        // retain their position. Useful when pool is temporarily
        // out of liquidity — wait for cron repatriation instead of
        // losing shares irreversibly.
        assert!(amount > 0, E_ZERO_AMOUNT);

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
