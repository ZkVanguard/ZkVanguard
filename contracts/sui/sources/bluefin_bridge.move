/// BlueFin Bridge Module for SUI
/// Bridges hedge positions to BlueFin perpetual DEX
///
/// This module provides:
/// - Position tracking for BlueFin hedges
/// - ZK commitment integration
/// - Event emission for off-chain indexing
///
/// Note: Actual order execution happens via BlueFin's API/SDK
/// This module maintains on-chain state for verification

#[allow(unused_const, unused_field, unused_use, unused_variable)]
module zkvanguard::bluefin_bridge {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};

    // ============ Error Codes ============
    const E_NOT_AUTHORIZED: u64 = 0;
    const E_INVALID_PAIR: u64 = 1;
    const E_POSITION_NOT_FOUND: u64 = 2;
    const E_POSITION_ALREADY_CLOSED: u64 = 3;
    const E_INVALID_AMOUNT: u64 = 4;
    const E_PAUSED: u64 = 5;

    // ============ Constants ============
    // BlueFin pair indices (matching their DEX)
    const PAIR_BTC_PERP: u64 = 0;
    const PAIR_ETH_PERP: u64 = 1;
    const PAIR_SUI_PERP: u64 = 2;
    const PAIR_SOL_PERP: u64 = 3;
    const PAIR_APT_PERP: u64 = 4;
    const PAIR_ARB_PERP: u64 = 5;
    const PAIR_DOGE_PERP: u64 = 6;
    const PAIR_PEPE_PERP: u64 = 7;

    const MAX_LEVERAGE: u64 = 50;
    const MAX_PAIRS: u64 = 8;

    // Position status
    const STATUS_PENDING: u8 = 0;
    const STATUS_OPEN: u8 = 1;
    const STATUS_CLOSED: u8 = 2;
    const STATUS_LIQUIDATED: u8 = 3;

    // ============ Capabilities ============

    /// Admin capability for managing the bridge
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Relayer capability for syncing off-chain positions
    public struct RelayerCap has key, store {
        id: UID,
        relayer_address: address,
    }

    // ============ Structs ============

    /// Represents a BlueFin position tracked on-chain
    public struct BluefinPosition has key, store {
        id: UID,
        /// Position ID from BlueFin DEX
        bluefin_position_id: vector<u8>,
        /// Owner address
        trader: address,
        /// Trading pair (0=BTC-PERP, 1=ETH-PERP, etc.)
        pair_index: u64,
        /// LONG = true, SHORT = false
        is_long: bool,
        /// Position size in base asset (scaled by 1e9)
        size: u64,
        /// Leverage used
        leverage: u64,
        /// Margin deposited (in SUI or USDC)
        margin: u64,
        /// Entry price (scaled by 1e9)
        entry_price: u64,
        /// Mark price at last update (scaled by 1e9)
        mark_price: u64,
        /// Liquidation price (scaled by 1e9)
        liquidation_price: u64,
        /// Unrealized PnL (can be negative)
        unrealized_pnl_positive: u64,
        unrealized_pnl_negative: u64,
        /// ZK commitment hash for privacy
        commitment_hash: vector<u8>,
        /// Open timestamp
        open_timestamp: u64,
        /// Close timestamp (0 if still open)
        close_timestamp: u64,
        /// Realized PnL on close
        realized_pnl_positive: u64,
        realized_pnl_negative: u64,
        /// Current status
        status: u8,
        /// Portfolio ID (for linking)
        portfolio_id: u64,
    }

    /// Global bridge state
    public struct BluefinBridgeState has key {
        id: UID,
        /// Total positions tracked
        total_positions: u64,
        /// Total open positions
        open_positions: u64,
        /// Total closed positions
        closed_positions: u64,
        /// Total margin locked
        total_margin_locked: u64,
        /// Positions by trader
        trader_positions: Table<address, vector<ID>>,
        /// Position lookup by BlueFin ID
        position_lookup: Table<vector<u8>, ID>,
        /// Paused state
        paused: bool,
        /// Authorized relayers
        relayer_whitelist: Table<address, bool>,
    }

    // ============ Events ============

    public struct PositionOpened has copy, drop {
        position_id: ID,
        bluefin_id: vector<u8>,
        trader: address,
        pair_index: u64,
        is_long: bool,
        size: u64,
        leverage: u64,
        margin: u64,
        entry_price: u64,
        commitment_hash: vector<u8>,
        timestamp: u64,
    }

    public struct PositionClosed has copy, drop {
        position_id: ID,
        bluefin_id: vector<u8>,
        trader: address,
        pair_index: u64,
        close_price: u64,
        realized_pnl_positive: u64,
        realized_pnl_negative: u64,
        timestamp: u64,
    }

    public struct PositionSynced has copy, drop {
        position_id: ID,
        mark_price: u64,
        unrealized_pnl_positive: u64,
        unrealized_pnl_negative: u64,
        timestamp: u64,
    }

    // ============ Initialize ============

    fun init(ctx: &mut TxContext) {
        // Create admin cap
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        
        // Create bridge state
        let state = BluefinBridgeState {
            id: object::new(ctx),
            total_positions: 0,
            open_positions: 0,
            closed_positions: 0,
            total_margin_locked: 0,
            trader_positions: table::new(ctx),
            position_lookup: table::new(ctx),
            paused: false,
            relayer_whitelist: table::new(ctx),
        };

        // Transfer ownership
        transfer::transfer(admin_cap, tx_context::sender(ctx));
        transfer::share_object(state);
    }

    // ============ Admin Functions ============

    /// Add a relayer to the whitelist
    public entry fun add_relayer(
        _: &AdminCap,
        state: &mut BluefinBridgeState,
        relayer: address,
        ctx: &mut TxContext
    ) {
        table::add(&mut state.relayer_whitelist, relayer, true);
        
        // Create relayer cap
        let relayer_cap = RelayerCap {
            id: object::new(ctx),
            relayer_address: relayer,
        };
        transfer::transfer(relayer_cap, relayer);
    }

    /// Pause/unpause the bridge
    public entry fun set_paused(
        _: &AdminCap,
        state: &mut BluefinBridgeState,
        paused: bool,
    ) {
        state.paused = paused;
    }

    // ============ Position Tracking ============

    /// Record a position opened on BlueFin (called by relayer)
    public entry fun record_position_open(
        _: &RelayerCap,
        state: &mut BluefinBridgeState,
        bluefin_id: vector<u8>,
        trader: address,
        pair_index: u64,
        is_long: bool,
        size: u64,
        leverage: u64,
        margin: u64,
        entry_price: u64,
        liquidation_price: u64,
        commitment_hash: vector<u8>,
        portfolio_id: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(pair_index < MAX_PAIRS, E_INVALID_PAIR);
        assert!(leverage <= MAX_LEVERAGE, E_INVALID_AMOUNT);

        let timestamp = clock::timestamp_ms(clock);

        // Create position
        let position = BluefinPosition {
            id: object::new(ctx),
            bluefin_position_id: bluefin_id,
            trader,
            pair_index,
            is_long,
            size,
            leverage,
            margin,
            entry_price,
            mark_price: entry_price,
            liquidation_price,
            unrealized_pnl_positive: 0,
            unrealized_pnl_negative: 0,
            commitment_hash,
            open_timestamp: timestamp,
            close_timestamp: 0,
            realized_pnl_positive: 0,
            realized_pnl_negative: 0,
            status: STATUS_OPEN,
            portfolio_id,
        };

        let position_id = object::id(&position);
        let bf_id = position.bluefin_position_id;

        // Update state
        state.total_positions = state.total_positions + 1;
        state.open_positions = state.open_positions + 1;
        state.total_margin_locked = state.total_margin_locked + margin;

        // Track by trader
        if (!table::contains(&state.trader_positions, trader)) {
            table::add(&mut state.trader_positions, trader, vector::empty());
        };
        let trader_pos = table::borrow_mut(&mut state.trader_positions, trader);
        vector::push_back(trader_pos, position_id);

        // Track by BlueFin ID
        table::add(&mut state.position_lookup, bf_id, position_id);

        // Emit event
        event::emit(PositionOpened {
            position_id,
            bluefin_id: position.bluefin_position_id,
            trader,
            pair_index,
            is_long,
            size,
            leverage,
            margin,
            entry_price,
            commitment_hash: position.commitment_hash,
            timestamp,
        });

        // Transfer position to trader
        transfer::transfer(position, trader);
    }

    /// Record a position closed on BlueFin (called by relayer)
    public entry fun record_position_close(
        _: &RelayerCap,
        state: &mut BluefinBridgeState,
        position: &mut BluefinPosition,
        close_price: u64,
        realized_pnl_positive: u64,
        realized_pnl_negative: u64,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(position.status == STATUS_OPEN, E_POSITION_ALREADY_CLOSED);

        let timestamp = clock::timestamp_ms(clock);

        // Update position
        position.mark_price = close_price;
        position.close_timestamp = timestamp;
        position.realized_pnl_positive = realized_pnl_positive;
        position.realized_pnl_negative = realized_pnl_negative;
        position.status = STATUS_CLOSED;

        // Update state
        state.open_positions = state.open_positions - 1;
        state.closed_positions = state.closed_positions + 1;
        if (state.total_margin_locked >= position.margin) {
            state.total_margin_locked = state.total_margin_locked - position.margin;
        } else {
            state.total_margin_locked = 0;
        };

        // Emit event
        event::emit(PositionClosed {
            position_id: object::id(position),
            bluefin_id: position.bluefin_position_id,
            trader: position.trader,
            pair_index: position.pair_index,
            close_price,
            realized_pnl_positive,
            realized_pnl_negative,
            timestamp,
        });
    }

    /// Sync mark price and PnL from off-chain (called by relayer)
    public entry fun sync_position(
        _: &RelayerCap,
        state: &BluefinBridgeState,
        position: &mut BluefinPosition,
        mark_price: u64,
        unrealized_pnl_positive: u64,
        unrealized_pnl_negative: u64,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(position.status == STATUS_OPEN, E_POSITION_ALREADY_CLOSED);

        let timestamp = clock::timestamp_ms(clock);

        // Update position
        position.mark_price = mark_price;
        position.unrealized_pnl_positive = unrealized_pnl_positive;
        position.unrealized_pnl_negative = unrealized_pnl_negative;

        // Emit event
        event::emit(PositionSynced {
            position_id: object::id(position),
            mark_price,
            unrealized_pnl_positive,
            unrealized_pnl_negative,
            timestamp,
        });
    }

    // ============ View Functions ============

    /// Get bridge stats
    public fun get_stats(state: &BluefinBridgeState): (u64, u64, u64, u64) {
        (
            state.total_positions,
            state.open_positions,
            state.closed_positions,
            state.total_margin_locked
        )
    }

    /// Get position details
    public fun get_position_info(position: &BluefinPosition): (
        vector<u8>,  // bluefin_id
        address,     // trader
        u64,         // pair_index
        bool,        // is_long
        u64,         // size
        u64,         // leverage
        u64,         // margin
        u64,         // entry_price
        u64,         // mark_price
        u8           // status
    ) {
        (
            position.bluefin_position_id,
            position.trader,
            position.pair_index,
            position.is_long,
            position.size,
            position.leverage,
            position.margin,
            position.entry_price,
            position.mark_price,
            position.status
        )
    }

    /// Check if pair is supported
    public fun is_valid_pair(pair_index: u64): bool {
        pair_index < MAX_PAIRS
    }

    /// Get pair name
    public fun get_pair_name(pair_index: u64): vector<u8> {
        if (pair_index == PAIR_BTC_PERP) { b"BTC-PERP" }
        else if (pair_index == PAIR_ETH_PERP) { b"ETH-PERP" }
        else if (pair_index == PAIR_SUI_PERP) { b"SUI-PERP" }
        else if (pair_index == PAIR_SOL_PERP) { b"SOL-PERP" }
        else if (pair_index == PAIR_APT_PERP) { b"APT-PERP" }
        else if (pair_index == PAIR_ARB_PERP) { b"ARB-PERP" }
        else if (pair_index == PAIR_DOGE_PERP) { b"DOGE-PERP" }
        else if (pair_index == PAIR_PEPE_PERP) { b"PEPE-PERP" }
        else { b"UNKNOWN" }
    }

    // ============ Test Functions ============

    #[test_only]
    public fun test_init(ctx: &mut TxContext) {
        init(ctx);
    }
}
