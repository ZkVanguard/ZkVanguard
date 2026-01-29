/// Payment Router Module for SUI
/// Handles payment routing and sponsored transactions
#[allow(unused_const, unused_field)]
module zkvanguard::payment_router {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};
    use std::string::String;

    // ============ Error Codes ============
    const E_NOT_AUTHORIZED: u64 = 0;
    const E_INSUFFICIENT_BALANCE: u64 = 1;
    const E_INVALID_AMOUNT: u64 = 2;
    const E_PAUSED: u64 = 3;
    const E_ROUTE_NOT_FOUND: u64 = 4;
    const E_DAILY_LIMIT_EXCEEDED: u64 = 5;

    // ============ Constants ============
    const DEFAULT_DAILY_LIMIT: u64 = 1000_000_000_000; // 1000 SUI in MIST
    const MS_PER_DAY: u64 = 86400000;

    // ============ Structs ============

    /// Admin capability
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Agent capability for routing
    public struct AgentCap has key, store {
        id: UID,
        agent_address: address,
    }

    /// Sponsor capability for gasless transactions
    public struct SponsorCap has key, store {
        id: UID,
        sponsor_address: address,
        daily_limit: u64,
        used_today: u64,
        last_reset: u64,
    }

    /// Payment Router state
    public struct PaymentRouterState has key {
        id: UID,
        /// Total payments routed
        total_payments: u64,
        /// Total volume routed (in MIST)
        total_volume: u64,
        /// Sponsored transaction fund
        sponsor_fund: Balance<SUI>,
        /// Payment routes (destination -> route_id)
        routes: Table<address, ID>,
        /// Paused status
        paused: bool,
        /// Fee recipient
        fee_recipient: address,
        /// Routing fee in basis points
        routing_fee_bps: u64,
    }

    /// Payment route configuration
    public struct PaymentRoute has key, store {
        id: UID,
        /// Destination address
        destination: address,
        /// Route name
        name: String,
        /// Active status
        is_active: bool,
        /// Total payments through this route
        payment_count: u64,
        /// Total volume through this route
        volume: u64,
    }

    /// Payment record
    public struct PaymentRecord has key, store {
        id: UID,
        /// Sender
        sender: address,
        /// Recipient
        recipient: address,
        /// Amount
        amount: u64,
        /// Fee paid
        fee: u64,
        /// Timestamp
        timestamp: u64,
        /// Reference/memo
        reference: String,
        /// Was sponsored (gasless)
        sponsored: bool,
    }

    // ============ Events ============

    public struct PaymentRouted has copy, drop {
        payment_id: ID,
        sender: address,
        recipient: address,
        amount: u64,
        fee: u64,
        sponsored: bool,
    }

    public struct RouteCreated has copy, drop {
        route_id: ID,
        destination: address,
        name: String,
    }

    public struct RouteUpdated has copy, drop {
        route_id: ID,
        is_active: bool,
    }

    public struct SponsorFundDeposited has copy, drop {
        sponsor: address,
        amount: u64,
        new_balance: u64,
    }

    public struct SponsoredTransaction has copy, drop {
        sponsor: address,
        beneficiary: address,
        gas_covered: u64,
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

        // Create router state
        let state = PaymentRouterState {
            id: object::new(ctx),
            total_payments: 0,
            total_volume: 0,
            sponsor_fund: balance::zero(),
            routes: table::new(ctx),
            paused: false,
            fee_recipient: sender,
            routing_fee_bps: 10, // 0.1%
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

    /// Create sponsor capability
    public entry fun create_sponsor(
        _admin: &AdminCap,
        sponsor_address: address,
        daily_limit: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sponsor_cap = SponsorCap {
            id: object::new(ctx),
            sponsor_address,
            daily_limit,
            used_today: 0,
            last_reset: clock::timestamp_ms(clock),
        };
        transfer::transfer(sponsor_cap, sponsor_address);
    }

    /// Set paused status
    public entry fun set_paused(
        _admin: &AdminCap,
        state: &mut PaymentRouterState,
        paused: bool,
    ) {
        state.paused = paused;
    }

    /// Update routing fee
    public entry fun set_routing_fee(
        _admin: &AdminCap,
        state: &mut PaymentRouterState,
        fee_bps: u64,
    ) {
        assert!(fee_bps <= 1000, E_INVALID_AMOUNT); // Max 10%
        state.routing_fee_bps = fee_bps;
    }

    /// Set fee recipient
    public entry fun set_fee_recipient(
        _admin: &AdminCap,
        state: &mut PaymentRouterState,
        new_recipient: address,
    ) {
        state.fee_recipient = new_recipient;
    }

    // ============ Route Management ============

    /// Create a payment route
    public entry fun create_route(
        _admin: &AdminCap,
        state: &mut PaymentRouterState,
        destination: address,
        name: String,
        ctx: &mut TxContext,
    ) {
        let route = PaymentRoute {
            id: object::new(ctx),
            destination,
            name,
            is_active: true,
            payment_count: 0,
            volume: 0,
        };

        let route_id = object::id(&route);
        table::add(&mut state.routes, destination, route_id);

        event::emit(RouteCreated {
            route_id,
            destination,
            name: route.name,
        });

        transfer::share_object(route);
    }

    /// Update route status
    public entry fun update_route_status(
        _admin: &AdminCap,
        route: &mut PaymentRoute,
        is_active: bool,
    ) {
        route.is_active = is_active;

        event::emit(RouteUpdated {
            route_id: object::id(route),
            is_active,
        });
    }

    // ============ Payment Functions ============

    /// Route a payment
    public entry fun route_payment(
        state: &mut PaymentRouterState,
        payment: Coin<SUI>,
        recipient: address,
        reference: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);

        let sender = tx_context::sender(ctx);
        let amount = coin::value(&payment);
        assert!(amount > 0, E_INVALID_AMOUNT);

        // Calculate fee
        let fee = (amount * state.routing_fee_bps) / 10000;
        let net_amount = amount - fee;

        let mut payment_balance = coin::into_balance(payment);

        // Extract fee if applicable
        if (fee > 0) {
            let fee_balance = balance::split(&mut payment_balance, fee);
            let fee_coin = coin::from_balance(fee_balance, ctx);
            transfer::public_transfer(fee_coin, state.fee_recipient);
        };

        // Transfer to recipient
        let payment_coin = coin::from_balance(payment_balance, ctx);
        transfer::public_transfer(payment_coin, recipient);

        // Update state
        state.total_payments = state.total_payments + 1;
        state.total_volume = state.total_volume + amount;

        // Create payment record
        let payment_record = PaymentRecord {
            id: object::new(ctx),
            sender,
            recipient,
            amount: net_amount,
            fee,
            timestamp: clock::timestamp_ms(clock),
            reference,
            sponsored: false,
        };

        let payment_id = object::id(&payment_record);

        event::emit(PaymentRouted {
            payment_id,
            sender,
            recipient,
            amount: net_amount,
            fee,
            sponsored: false,
        });

        transfer::transfer(payment_record, sender);
    }

    /// Route payment through a specific route
    public entry fun route_payment_via_route(
        state: &mut PaymentRouterState,
        route: &mut PaymentRoute,
        payment: Coin<SUI>,
        reference: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);
        assert!(route.is_active, E_ROUTE_NOT_FOUND);

        let sender = tx_context::sender(ctx);
        let amount = coin::value(&payment);
        let recipient = route.destination;

        // Calculate fee
        let fee = (amount * state.routing_fee_bps) / 10000;
        let net_amount = amount - fee;

        let mut payment_balance = coin::into_balance(payment);

        if (fee > 0) {
            let fee_balance = balance::split(&mut payment_balance, fee);
            let fee_coin = coin::from_balance(fee_balance, ctx);
            transfer::public_transfer(fee_coin, state.fee_recipient);
        };

        let payment_coin = coin::from_balance(payment_balance, ctx);
        transfer::public_transfer(payment_coin, recipient);

        // Update route stats
        route.payment_count = route.payment_count + 1;
        route.volume = route.volume + amount;

        // Update state
        state.total_payments = state.total_payments + 1;
        state.total_volume = state.total_volume + amount;

        let payment_record = PaymentRecord {
            id: object::new(ctx),
            sender,
            recipient,
            amount: net_amount,
            fee,
            timestamp: clock::timestamp_ms(clock),
            reference,
            sponsored: false,
        };

        let payment_id = object::id(&payment_record);

        event::emit(PaymentRouted {
            payment_id,
            sender,
            recipient,
            amount: net_amount,
            fee,
            sponsored: false,
        });

        transfer::transfer(payment_record, sender);
    }

    // ============ Sponsor Functions ============

    /// Deposit to sponsor fund
    public entry fun deposit_sponsor_fund(
        state: &mut PaymentRouterState,
        deposit: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        let sponsor = tx_context::sender(ctx);
        let amount = coin::value(&deposit);

        balance::join(&mut state.sponsor_fund, coin::into_balance(deposit));

        let new_balance = balance::value(&state.sponsor_fund);

        event::emit(SponsorFundDeposited {
            sponsor,
            amount,
            new_balance,
        });
    }

    /// Withdraw from sponsor fund (admin only)
    public entry fun withdraw_sponsor_fund(
        _admin: &AdminCap,
        state: &mut PaymentRouterState,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert!(balance::value(&state.sponsor_fund) >= amount, E_INSUFFICIENT_BALANCE);

        let withdrawn = coin::from_balance(
            balance::split(&mut state.sponsor_fund, amount),
            ctx
        );
        
        transfer::public_transfer(withdrawn, state.fee_recipient);
    }

    /// Record a sponsored transaction
    public entry fun record_sponsored_tx(
        sponsor_cap: &mut SponsorCap,
        state: &PaymentRouterState,
        beneficiary: address,
        gas_amount: u64,
        clock: &Clock,
        _ctx: &mut TxContext,
    ) {
        assert!(!state.paused, E_PAUSED);

        let current_time = clock::timestamp_ms(clock);
        
        // Reset daily limit if new day
        if (current_time >= sponsor_cap.last_reset + MS_PER_DAY) {
            sponsor_cap.used_today = 0;
            sponsor_cap.last_reset = current_time;
        };

        assert!(
            sponsor_cap.used_today + gas_amount <= sponsor_cap.daily_limit,
            E_DAILY_LIMIT_EXCEEDED
        );

        sponsor_cap.used_today = sponsor_cap.used_today + gas_amount;

        event::emit(SponsoredTransaction {
            sponsor: sponsor_cap.sponsor_address,
            beneficiary,
            gas_covered: gas_amount,
            timestamp: current_time,
        });
    }

    // ============ View Functions ============

    /// Get router stats
    public fun get_router_stats(state: &PaymentRouterState): (u64, u64, u64) {
        (state.total_payments, state.total_volume, balance::value(&state.sponsor_fund))
    }

    /// Get route info
    public fun get_route_info(route: &PaymentRoute): (address, bool, u64, u64) {
        (route.destination, route.is_active, route.payment_count, route.volume)
    }

    /// Get sponsor cap info
    public fun get_sponsor_info(cap: &SponsorCap): (u64, u64) {
        (cap.daily_limit, cap.used_today)
    }

    /// Check if router is paused
    public fun is_paused(state: &PaymentRouterState): bool {
        state.paused
    }

    // ============ Test Functions ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx)
    }
}
