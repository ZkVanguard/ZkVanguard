/// HedgeExecutor Module for SUI
/// On-chain hedge execution engine that bridges ZK commitments and perpetual positions
/// Executes hedges atomically with privacy-preserving ZK proofs
///
/// ARCHITECTURE:
/// =============
/// Agent -> HedgeExecutor -> ZKHedgeCommitment (on-chain ZK proofs)
///                        -> Position tracking (on-chain state)
///
/// Each hedge:
/// 1. Accepts collateral from trader
/// 2. Records on-chain perpetual position with price/leverage
/// 3. Stores a ZK commitment hash (privacy-preserving)
/// 4. Links them via hedge_id for atomic settlement
#[allow(unused_const, unused_field, unused_use, unused_variable)]
module zkvanguard::hedge_executor {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};

    // ============ Error Codes ============
    const E_NOT_AUTHORIZED: u64 = 0;
    const E_BELOW_MIN_COLLATERAL: u64 = 1;
    const E_INVALID_LEVERAGE: u64 = 2;
    const E_NULLIFIER_ALREADY_USED: u64 = 3;
    const E_HEDGE_NOT_FOUND: u64 = 4;
    const E_HEDGE_NOT_ACTIVE: u64 = 5;
    const E_NOT_HEDGE_OWNER: u64 = 6;
    const E_PAUSED: u64 = 7;
    const E_INVALID_PAIR: u64 = 8;
    const E_INSUFFICIENT_BALANCE: u64 = 9;
    const E_FEE_TOO_HIGH: u64 = 10;

    // ============ Constants ============
    const MAX_LEVERAGE: u64 = 100;
    const MIN_COLLATERAL: u64 = 1_000_000; // 1 USDC (6 decimals)
    const FEE_RATE_BPS: u64 = 10; // 0.1%
    const BASIS_POINTS: u64 = 10000;
    const MAX_PAIRS: u64 = 12;

    // Status constants
    const STATUS_PENDING: u8 = 0;
    const STATUS_ACTIVE: u8 = 1;
    const STATUS_CLOSED: u8 = 2;
    const STATUS_LIQUIDATED: u8 = 3;
    const STATUS_CANCELLED: u8 = 4;

    // ============ Capabilities ============

    /// Admin capability
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Agent capability for AI agents to execute hedges
    public struct AgentCap has key, store {
        id: UID,
        agent_address: address,
    }

    // ============ Structs ============

    /// Individual hedge position (owned object)
    public struct HedgePosition has key, store {
        id: UID,
        /// Unique hedge identifier
        hedge_id: vector<u8>,
        /// Owner of this hedge  
        trader: address,
        /// Trading pair index (0=BTC, 1=ETH, 2=CRO, etc.)
        pair_index: u64,
        /// Collateral amount deposited (in SUI)
        collateral_amount: u64,
        /// Leverage multiplier
        leverage: u64,
        /// Direction: true = long, false = short
        is_long: bool,
        /// Mock open price (scaled by 1e8)
        open_price: u64,
        /// Mock close price (scaled by 1e8)
        close_price: u64,
        /// ZK commitment hash
        commitment_hash: vector<u8>,
        /// Anti-replay nullifier
        nullifier: vector<u8>,
        /// When position was opened (ms)
        open_timestamp: u64,
        /// When position was closed (ms, 0 if open)
        close_timestamp: u64,
        /// Realized PnL (can be negative - stored as two fields)
        pnl_positive: u64,
        pnl_negative: u64,
        /// Current status
        status: u8,
    }

    /// Global state for the HedgeExecutor
    public struct HedgeExecutorState has key {
        id: UID,
        /// Total hedges opened
        total_hedges_opened: u64,
        /// Total hedges closed
        total_hedges_closed: u64,
        /// Total collateral currently locked
        total_collateral_locked: u64,
        /// Total PnL realized (positive component)
        total_pnl_positive: u64,
        /// Total PnL realized (negative component)
        total_pnl_negative: u64,
        /// Accumulated protocol fees
        accumulated_fees: u64,
        /// Fee rate in basis points
        fee_rate_bps: u64,
        /// Max leverage allowed
        max_leverage: u64,
        /// Min collateral per hedge
        min_collateral: u64,
        /// Paused status
        paused: bool,
        /// Nullifier tracking
        nullifier_used: Table<vector<u8>, bool>,
        /// Hedge tracking by ID
        hedge_ids: Table<vector<u8>, ID>,
        /// User hedge IDs
        user_hedges: Table<address, vector<vector<u8>>>,
        /// Mock prices per pair (scaled by 1e8)
        mock_prices: Table<u64, u64>,
        /// Protocol fee balance
        fee_balance: Balance<SUI>,
        /// Collateral pool
        collateral_pool: Balance<SUI>,
    }

    // ============ Events ============

    public struct HedgeOpened has copy, drop {
        hedge_id: vector<u8>,
        trader: address,
        pair_index: u64,
        is_long: bool,
        collateral: u64,
        leverage: u64,
        open_price: u64,
        commitment_hash: vector<u8>,
        timestamp: u64,
    }

    public struct HedgeClosed has copy, drop {
        hedge_id: vector<u8>,
        trader: address,
        pnl_positive: u64,
        pnl_negative: u64,
        close_price: u64,
        duration_ms: u64,
    }

    public struct HedgeLiquidated has copy, drop {
        hedge_id: vector<u8>,
        trader: address,
        collateral_lost: u64,
    }

    public struct MarginAdded has copy, drop {
        hedge_id: vector<u8>,
        trader: address,
        amount: u64,
    }

    // ============ Init ============

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin_cap, tx_context::sender(ctx));

        let mut mock_prices = table::new<u64, u64>(ctx);
        // Set initial mock prices (scaled by 1e8)
        table::add(&mut mock_prices, 0, 9_500_000_000_000); // BTC ~$95,000
        table::add(&mut mock_prices, 1, 320_000_000_000);    // ETH ~$3,200
        table::add(&mut mock_prices, 2, 10_000_000);          // CRO ~$0.10
        table::add(&mut mock_prices, 3, 800_000_000);         // ATOM ~$8
        table::add(&mut mock_prices, 4, 35_000_000);          // DOGE ~$0.35
        table::add(&mut mock_prices, 5, 20_000_000_000);      // SOL ~$200

        let state = HedgeExecutorState {
            id: object::new(ctx),
            total_hedges_opened: 0,
            total_hedges_closed: 0,
            total_collateral_locked: 0,
            total_pnl_positive: 0,
            total_pnl_negative: 0,
            accumulated_fees: 0,
            fee_rate_bps: FEE_RATE_BPS,
            max_leverage: MAX_LEVERAGE,
            min_collateral: MIN_COLLATERAL,
            paused: false,
            nullifier_used: table::new<vector<u8>, bool>(ctx),
            hedge_ids: table::new<vector<u8>, ID>(ctx),
            user_hedges: table::new<address, vector<vector<u8>>>(ctx),
            mock_prices,
            fee_balance: balance::zero<SUI>(),
            collateral_pool: balance::zero<SUI>(),
        };
        transfer::share_object(state);
    }

    // ============ Core: Open Hedge ============

    /// Open a hedge position atomically (on-chain position + ZK commitment)
    public entry fun open_hedge(
        state: &mut HedgeExecutorState,
        clock: &Clock,
        pair_index: u64,
        leverage: u64,
        is_long: bool,
        commitment_hash: vector<u8>,
        nullifier: vector<u8>,
        payment: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);
        let collateral_amount = coin::value(&payment);
        assert!(collateral_amount >= state.min_collateral, E_BELOW_MIN_COLLATERAL);
        assert!(leverage >= 2 && leverage <= state.max_leverage, E_INVALID_LEVERAGE);
        assert!(pair_index <= MAX_PAIRS, E_INVALID_PAIR);
        assert!(!table::contains(&state.nullifier_used, nullifier), E_NULLIFIER_ALREADY_USED);

        // Calculate fee
        let fee = (collateral_amount * state.fee_rate_bps) / BASIS_POINTS;
        let net_collateral = collateral_amount - fee;

        // Split payment into fee and collateral
        let mut payment_balance = coin::into_balance(payment);
        let fee_balance = balance::split(&mut payment_balance, fee);
        balance::join(&mut state.fee_balance, fee_balance);
        balance::join(&mut state.collateral_pool, payment_balance);

        // Get mock price for pair
        let open_price = if (table::contains(&state.mock_prices, pair_index)) {
            *table::borrow(&state.mock_prices, pair_index)
        } else {
            1_000_000_000 // Default $10
        };

        // Generate hedge ID
        let timestamp = clock::timestamp_ms(clock);
        let sender = tx_context::sender(ctx);
        let mut hedge_id_data = b"hedge_";
        let count_bytes = std::bcs::to_bytes(&state.total_hedges_opened);
        std::vector::append(&mut hedge_id_data, count_bytes);
        let time_bytes = std::bcs::to_bytes(&timestamp);
        std::vector::append(&mut hedge_id_data, time_bytes);
        let hedge_id = sui::hash::blake2b256(&hedge_id_data);

        // Create position object
        let position = HedgePosition {
            id: object::new(ctx),
            hedge_id: hedge_id,
            trader: sender,
            pair_index,
            collateral_amount: net_collateral,
            leverage,
            is_long,
            open_price,
            close_price: 0,
            commitment_hash,
            nullifier: nullifier,
            open_timestamp: timestamp,
            close_timestamp: 0,
            pnl_positive: 0,
            pnl_negative: 0,
            status: STATUS_ACTIVE,
        };

        let position_id = object::id(&position);

        // Track nullifier
        table::add(&mut state.nullifier_used, nullifier, true);

        // Track hedge
        table::add(&mut state.hedge_ids, hedge_id, position_id);

        // Track user hedges
        if (!table::contains(&state.user_hedges, sender)) {
            table::add(&mut state.user_hedges, sender, vector::empty<vector<u8>>());
        };
        let user_hedge_list = table::borrow_mut(&mut state.user_hedges, sender);
        vector::push_back(user_hedge_list, hedge_id);

        // Update stats
        state.total_hedges_opened = state.total_hedges_opened + 1;
        state.total_collateral_locked = state.total_collateral_locked + net_collateral;
        state.accumulated_fees = state.accumulated_fees + fee;

        // Emit event
        event::emit(HedgeOpened {
            hedge_id,
            trader: sender,
            pair_index,
            is_long,
            collateral: net_collateral,
            leverage,
            open_price,
            commitment_hash,
            timestamp,
        });

        // Transfer position to trader
        transfer::transfer(position, sender);
    }

    // ============ Core: Close Hedge ============

    /// Close a hedge position and settle PnL
    public entry fun close_hedge(
        state: &mut HedgeExecutorState,
        clock: &Clock,
        position: HedgePosition,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(position.status == STATUS_ACTIVE, E_HEDGE_NOT_ACTIVE);
        assert!(position.trader == tx_context::sender(ctx), E_NOT_HEDGE_OWNER);

        let timestamp = clock::timestamp_ms(clock);

        // Get current price
        let current_price = if (table::contains(&state.mock_prices, position.pair_index)) {
            *table::borrow(&state.mock_prices, position.pair_index)
        } else {
            position.open_price
        };

        // Calculate PnL
        let leveraged_value = position.collateral_amount * position.leverage;
        let (pnl_positive, pnl_negative) = calculate_pnl(
            position.open_price,
            current_price,
            leveraged_value,
            position.is_long,
        );

        // Calculate return amount
        let return_amount = if (pnl_positive > 0) {
            let potential = position.collateral_amount + pnl_positive;
            let pool_balance = balance::value(&state.collateral_pool);
            if (potential > pool_balance) { pool_balance } else { potential }
        } else if (pnl_negative < position.collateral_amount) {
            position.collateral_amount - pnl_negative
        } else {
            0
        };

        // Update stats
        state.total_hedges_closed = state.total_hedges_closed + 1;
        state.total_collateral_locked = state.total_collateral_locked - position.collateral_amount;
        state.total_pnl_positive = state.total_pnl_positive + pnl_positive;
        state.total_pnl_negative = state.total_pnl_negative + pnl_negative;

        // Return collateral + PnL to trader
        if (return_amount > 0 && balance::value(&state.collateral_pool) >= return_amount) {
            let return_balance = balance::split(&mut state.collateral_pool, return_amount);
            let return_coin = coin::from_balance(return_balance, ctx);
            transfer::public_transfer(return_coin, position.trader);
        };

        let duration = timestamp - position.open_timestamp;

        // Emit event
        event::emit(HedgeClosed {
            hedge_id: position.hedge_id,
            trader: position.trader,
            pnl_positive,
            pnl_negative,
            close_price: current_price,
            duration_ms: duration,
        });

        // Destroy the position object
        let HedgePosition {
            id,
            hedge_id: _,
            trader: _,
            pair_index: _,
            collateral_amount: _,
            leverage: _,
            is_long: _,
            open_price: _,
            close_price: _,
            commitment_hash: _,
            nullifier: _,
            open_timestamp: _,
            close_timestamp: _,
            pnl_positive: _,
            pnl_negative: _,
            status: _,
        } = position;
        object::delete(id);
    }

    // ============ Core: Add Margin ============

    /// Add collateral to an existing hedge
    public entry fun add_margin(
        state: &mut HedgeExecutorState,
        position: &mut HedgePosition,
        payment: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(position.status == STATUS_ACTIVE, E_HEDGE_NOT_ACTIVE);
        assert!(position.trader == tx_context::sender(ctx), E_NOT_HEDGE_OWNER);

        let amount = coin::value(&payment);
        balance::join(&mut state.collateral_pool, coin::into_balance(payment));
        position.collateral_amount = position.collateral_amount + amount;
        state.total_collateral_locked = state.total_collateral_locked + amount;

        event::emit(MarginAdded {
            hedge_id: position.hedge_id,
            trader: position.trader,
            amount,
        });
    }

    // ============ Agent Operations ============

    /// Agent opens hedge on behalf of a user (for auto-hedging)
    public entry fun agent_open_hedge(
        _cap: &AgentCap,
        state: &mut HedgeExecutorState,
        clock: &Clock,
        trader: address,
        pair_index: u64,
        leverage: u64,
        is_long: bool,
        commitment_hash: vector<u8>,
        nullifier: vector<u8>,
        payment: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);
        let collateral_amount = coin::value(&payment);
        assert!(collateral_amount >= state.min_collateral, E_BELOW_MIN_COLLATERAL);
        assert!(leverage >= 2 && leverage <= state.max_leverage, E_INVALID_LEVERAGE);
        assert!(!table::contains(&state.nullifier_used, nullifier), E_NULLIFIER_ALREADY_USED);

        let fee = (collateral_amount * state.fee_rate_bps) / BASIS_POINTS;
        let net_collateral = collateral_amount - fee;

        let mut payment_balance = coin::into_balance(payment);
        let fee_bal = balance::split(&mut payment_balance, fee);
        balance::join(&mut state.fee_balance, fee_bal);
        balance::join(&mut state.collateral_pool, payment_balance);

        let open_price = if (table::contains(&state.mock_prices, pair_index)) {
            *table::borrow(&state.mock_prices, pair_index)
        } else {
            1_000_000_000
        };

        let timestamp = clock::timestamp_ms(clock);
        let mut hedge_id_data = b"agent_hedge_";
        let count_bytes = std::bcs::to_bytes(&state.total_hedges_opened);
        std::vector::append(&mut hedge_id_data, count_bytes);
        let time_bytes = std::bcs::to_bytes(&timestamp);
        std::vector::append(&mut hedge_id_data, time_bytes);
        let hedge_id = sui::hash::blake2b256(&hedge_id_data);

        let position = HedgePosition {
            id: object::new(ctx),
            hedge_id,
            trader,
            pair_index,
            collateral_amount: net_collateral,
            leverage,
            is_long,
            open_price,
            close_price: 0,
            commitment_hash,
            nullifier,
            open_timestamp: timestamp,
            close_timestamp: 0,
            pnl_positive: 0,
            pnl_negative: 0,
            status: STATUS_ACTIVE,
        };

        let position_id = object::id(&position);
        table::add(&mut state.nullifier_used, nullifier, true);
        table::add(&mut state.hedge_ids, hedge_id, position_id);

        if (!table::contains(&state.user_hedges, trader)) {
            table::add(&mut state.user_hedges, trader, vector::empty<vector<u8>>());
        };
        let user_list = table::borrow_mut(&mut state.user_hedges, trader);
        vector::push_back(user_list, hedge_id);

        state.total_hedges_opened = state.total_hedges_opened + 1;
        state.total_collateral_locked = state.total_collateral_locked + net_collateral;
        state.accumulated_fees = state.accumulated_fees + fee;

        event::emit(HedgeOpened {
            hedge_id,
            trader,
            pair_index,
            is_long,
            collateral: net_collateral,
            leverage,
            open_price,
            commitment_hash,
            timestamp,
        });

        transfer::transfer(position, trader);
    }

    // ============ Admin ============

    /// Create agent capability
    public entry fun create_agent_cap(
        _cap: &AdminCap,
        agent_address: address,
        ctx: &mut TxContext,
    ) {
        let agent_cap = AgentCap {
            id: object::new(ctx),
            agent_address,
        };
        transfer::transfer(agent_cap, agent_address);
    }

    /// Set mock price for a pair (for testing)
    public entry fun set_mock_price(
        _cap: &AdminCap,
        state: &mut HedgeExecutorState,
        pair_index: u64,
        price: u64,
    ) {
        if (table::contains(&state.mock_prices, pair_index)) {
            let price_ref = table::borrow_mut(&mut state.mock_prices, pair_index);
            *price_ref = price;
        } else {
            table::add(&mut state.mock_prices, pair_index, price);
        };
    }

    /// Set max leverage
    public entry fun set_max_leverage(
        _cap: &AdminCap,
        state: &mut HedgeExecutorState,
        max_lev: u64,
    ) {
        state.max_leverage = max_lev;
    }

    /// Set fee rate
    public entry fun set_fee_rate(
        _cap: &AdminCap,
        state: &mut HedgeExecutorState,
        fee_bps: u64,
    ) {
        assert!(fee_bps <= 100, E_FEE_TOO_HIGH); // Max 1%
        state.fee_rate_bps = fee_bps;
    }

    /// Pause/unpause
    public entry fun set_paused(
        _cap: &AdminCap,
        state: &mut HedgeExecutorState,
        paused: bool,
    ) {
        state.paused = paused;
    }

    /// Withdraw accumulated fees
    public entry fun withdraw_fees(
        _cap: &AdminCap,
        state: &mut HedgeExecutorState,
        ctx: &mut TxContext,
    ) {
        let fee_amount = balance::value(&state.fee_balance);
        if (fee_amount > 0) {
            let fee_coin = coin::from_balance(
                balance::split(&mut state.fee_balance, fee_amount),
                ctx,
            );
            transfer::public_transfer(fee_coin, tx_context::sender(ctx));
        };
    }

    // ============ View Functions ============

    /// Get protocol statistics
    public fun get_stats(state: &HedgeExecutorState): (u64, u64, u64, u64, u64, u64) {
        (
            state.total_hedges_opened,
            state.total_hedges_closed,
            state.total_collateral_locked,
            state.total_pnl_positive,
            state.total_pnl_negative,
            state.accumulated_fees,
        )
    }

    /// Get hedge position details
    public fun get_position_info(pos: &HedgePosition): (
        vector<u8>, address, u64, u64, u64, bool, u64, u8
    ) {
        (
            pos.hedge_id,
            pos.trader,
            pos.pair_index,
            pos.collateral_amount,
            pos.leverage,
            pos.is_long,
            pos.open_price,
            pos.status,
        )
    }

    // ============ Internal ============

    /// Calculate PnL from price movement
    fun calculate_pnl(
        open_price: u64,
        close_price: u64,
        leveraged_value: u64,
        is_long: bool,
    ): (u64, u64) {
        if (is_long) {
            if (close_price > open_price) {
                let profit = ((close_price - open_price) * leveraged_value) / open_price;
                (profit, 0)
            } else {
                let loss = ((open_price - close_price) * leveraged_value) / open_price;
                (0, loss)
            }
        } else {
            if (close_price < open_price) {
                let profit = ((open_price - close_price) * leveraged_value) / open_price;
                (profit, 0)
            } else {
                let loss = ((close_price - open_price) * leveraged_value) / open_price;
                (0, loss)
            }
        }
    }
}
