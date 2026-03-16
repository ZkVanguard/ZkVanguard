/// ZkVanguard Community Pool Timelock Module for SUI
/// Timelock controller for CommunityPool admin operations
/// 
/// SECURITY:
/// - 48 hour minimum delay for mainnet
/// - Multiple proposers (multisig recommended)
/// - Single executor (can be any address for permissionless execution)
/// 
/// USAGE:
/// 1. Deploy timelock with proposers
/// 2. Transfer AdminCap to timelock
/// 3. All admin operations now require delay
#[allow(unused_const, unused_field, unused_use)]
module zkvanguard::community_pool_timelock {
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::table::{Self, Table};
    use sui::hash;
    use sui::bcs;

    // ============ Error Codes ============
    const E_NOT_PROPOSER: u64 = 0;
    const E_NOT_EXECUTOR: u64 = 1;
    const E_NOT_ADMIN: u64 = 2;
    const E_OPERATION_NOT_FOUND: u64 = 3;
    const E_OPERATION_NOT_READY: u64 = 4;
    const E_OPERATION_EXPIRED: u64 = 5;
    const E_OPERATION_ALREADY_EXECUTED: u64 = 6;
    const E_OPERATION_ALREADY_PENDING: u64 = 7;
    const E_DELAY_TOO_SHORT: u64 = 8;
    const E_DELAY_TOO_LONG: u64 = 9;

    // ============ Constants ============
    /// Mainnet minimum delay: 48 hours (in milliseconds)
    const MAINNET_MIN_DELAY: u64 = 172800000; // 48 * 60 * 60 * 1000
    
    /// Testnet minimum delay: 5 minutes (for testing)
    const TESTNET_MIN_DELAY: u64 = 300000; // 5 * 60 * 1000
    
    /// Operation expiry: 7 days (must execute within this window)
    const OPERATION_EXPIRY: u64 = 604800000; // 7 * 24 * 60 * 60 * 1000
    
    /// Maximum delay: 30 days
    const MAX_DELAY: u64 = 2592000000; // 30 * 24 * 60 * 60 * 1000

    // Operation types
    const OP_SET_TREASURY: u8 = 0;
    const OP_SET_FEES: u8 = 1;
    const OP_SET_LIMITS: u8 = 2;
    const OP_ADD_AGENT: u8 = 3;
    const OP_SET_PAUSE: u8 = 4;
    const OP_TRIP_BREAKER: u8 = 5;
    const OP_RESET_BREAKER: u8 = 6;
    const OP_EMERGENCY_WITHDRAW: u8 = 7;
    const OP_CUSTOM: u8 = 255;

    // ============ Structs ============

    /// Admin capability for the timelock itself
    public struct TimelockAdminCap has key, store {
        id: UID,
    }

    /// Proposer capability - can schedule operations
    public struct ProposerCap has key, store {
        id: UID,
        proposer: address,
    }

    /// Executor capability - can execute ready operations
    public struct ExecutorCap has key, store {
        id: UID,
        executor: address,
    }

    /// Queued operation
    public struct QueuedOperation has store, copy, drop {
        operation_id: vector<u8>,
        operation_type: u8,
        target_address: address,
        target_value: u64,
        data_hash: vector<u8>,         // Hash of additional data
        proposer: address,
        scheduled_time: u64,           // When it was scheduled
        ready_time: u64,               // When it can be executed
        expiry_time: u64,              // When it expires
        executed: bool,
        cancelled: bool,
    }

    /// Timelock state (shared object)
    public struct TimelockState has key {
        id: UID,
        /// Minimum delay before operations can be executed
        min_delay: u64,
        /// Pending operations
        pending_operations: Table<vector<u8>, QueuedOperation>,
        /// Operation count for tracking
        operation_count: u64,
        /// Timelock creation timestamp
        created_at: u64,
        /// Is mainnet (affects minimum delay)
        is_mainnet: bool,
    }

    // ============ Events ============

    public struct TimelockCreated has copy, drop {
        timelock_id: ID,
        min_delay: u64,
        is_mainnet: bool,
        timestamp: u64,
    }

    public struct OperationScheduled has copy, drop {
        operation_id: vector<u8>,
        operation_type: u8,
        target_address: address,
        target_value: u64,
        ready_time: u64,
        proposer: address,
        timestamp: u64,
    }

    public struct OperationExecuted has copy, drop {
        operation_id: vector<u8>,
        operation_type: u8,
        executor: address,
        timestamp: u64,
    }

    public struct OperationCancelled has copy, drop {
        operation_id: vector<u8>,
        canceller: address,
        timestamp: u64,
    }

    public struct MinDelayUpdated has copy, drop {
        old_delay: u64,
        new_delay: u64,
        timestamp: u64,
    }

    // ============ Init ============

    /// Initialize the timelock module
    fun init(ctx: &mut TxContext) {
        transfer::transfer(
            TimelockAdminCap { id: object::new(ctx) },
            ctx.sender()
        );
    }

    // ============ Timelock Creation ============

    /// Create a new timelock with initial proposers and executors
    public entry fun create_timelock(
        _admin: &TimelockAdminCap,
        min_delay: u64,
        is_mainnet: bool,
        proposers: vector<address>,
        executors: vector<address>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let timestamp = clock::timestamp_ms(clock);
        
        // Validate delay based on network
        let actual_min_delay = if (is_mainnet) {
            assert!(min_delay >= MAINNET_MIN_DELAY, E_DELAY_TOO_SHORT);
            min_delay
        } else {
            if (min_delay < TESTNET_MIN_DELAY) {
                TESTNET_MIN_DELAY
            } else {
                min_delay
            }
        };
        assert!(actual_min_delay <= MAX_DELAY, E_DELAY_TOO_LONG);

        let state = TimelockState {
            id: object::new(ctx),
            min_delay: actual_min_delay,
            pending_operations: table::new(ctx),
            operation_count: 0,
            created_at: timestamp,
            is_mainnet,
        };

        event::emit(TimelockCreated {
            timelock_id: object::id(&state),
            min_delay: actual_min_delay,
            is_mainnet,
            timestamp,
        });

        // Create proposer caps
        let mut i = 0;
        while (i < vector::length(&proposers)) {
            let proposer = *vector::borrow(&proposers, i);
            transfer::transfer(
                ProposerCap {
                    id: object::new(ctx),
                    proposer,
                },
                proposer
            );
            i = i + 1;
        };

        // Create executor caps
        let mut j = 0;
        while (j < vector::length(&executors)) {
            let executor = *vector::borrow(&executors, j);
            transfer::transfer(
                ExecutorCap {
                    id: object::new(ctx),
                    executor,
                },
                executor
            );
            j = j + 1;
        };

        transfer::share_object(state);
    }

    // ============ Proposer Functions ============

    /// Schedule an operation
    public entry fun schedule_operation(
        _proposer: &ProposerCap,
        state: &mut TimelockState,
        operation_type: u8,
        target_address: address,
        target_value: u64,
        data: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let timestamp = clock::timestamp_ms(clock);
        let proposer = ctx.sender();
        
        // Calculate times
        let ready_time = timestamp + state.min_delay;
        let expiry_time = ready_time + OPERATION_EXPIRY;
        
        // Generate unique operation ID
        let mut id_data = bcs::to_bytes(&timestamp);
        vector::append(&mut id_data, bcs::to_bytes(&operation_type));
        vector::append(&mut id_data, bcs::to_bytes(&target_address));
        vector::append(&mut id_data, bcs::to_bytes(&target_value));
        vector::append(&mut id_data, bcs::to_bytes(&state.operation_count));
        let operation_id = hash::keccak256(&id_data);
        
        // Hash additional data
        let data_hash = hash::keccak256(&data);
        
        // Ensure not duplicate
        assert!(!table::contains(&state.pending_operations, operation_id), E_OPERATION_ALREADY_PENDING);
        
        let operation = QueuedOperation {
            operation_id,
            operation_type,
            target_address,
            target_value,
            data_hash,
            proposer,
            scheduled_time: timestamp,
            ready_time,
            expiry_time,
            executed: false,
            cancelled: false,
        };
        
        table::add(&mut state.pending_operations, operation_id, operation);
        state.operation_count = state.operation_count + 1;
        
        event::emit(OperationScheduled {
            operation_id,
            operation_type,
            target_address,
            target_value,
            ready_time,
            proposer,
            timestamp,
        });
    }

    /// Cancel a pending operation (proposer only)
    public entry fun cancel_operation(
        _proposer: &ProposerCap,
        state: &mut TimelockState,
        operation_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let timestamp = clock::timestamp_ms(clock);
        
        assert!(table::contains(&state.pending_operations, operation_id), E_OPERATION_NOT_FOUND);
        
        let operation = table::borrow_mut(&mut state.pending_operations, operation_id);
        assert!(!operation.executed, E_OPERATION_ALREADY_EXECUTED);
        
        operation.cancelled = true;
        
        event::emit(OperationCancelled {
            operation_id,
            canceller: ctx.sender(),
            timestamp,
        });
    }

    // ============ Executor Functions ============

    /// Execute a ready operation
    /// Returns the operation details so caller can perform the actual action
    public fun execute_operation(
        _executor: &ExecutorCap,
        state: &mut TimelockState,
        operation_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ): (u8, address, u64, vector<u8>) {
        let timestamp = clock::timestamp_ms(clock);
        
        assert!(table::contains(&state.pending_operations, operation_id), E_OPERATION_NOT_FOUND);
        
        let operation = table::borrow_mut(&mut state.pending_operations, operation_id);
        
        assert!(!operation.executed, E_OPERATION_ALREADY_EXECUTED);
        assert!(!operation.cancelled, E_OPERATION_NOT_FOUND);
        assert!(timestamp >= operation.ready_time, E_OPERATION_NOT_READY);
        assert!(timestamp <= operation.expiry_time, E_OPERATION_EXPIRED);
        
        operation.executed = true;
        
        event::emit(OperationExecuted {
            operation_id,
            operation_type: operation.operation_type,
            executor: ctx.sender(),
            timestamp,
        });
        
        (
            operation.operation_type,
            operation.target_address,
            operation.target_value,
            operation.data_hash
        )
    }

    // ============ Admin Functions ============

    /// Update minimum delay
    public entry fun set_min_delay(
        _admin: &TimelockAdminCap,
        state: &mut TimelockState,
        new_delay: u64,
        clock: &Clock,
    ) {
        let timestamp = clock::timestamp_ms(clock);
        
        // Validate based on network type
        if (state.is_mainnet) {
            assert!(new_delay >= MAINNET_MIN_DELAY, E_DELAY_TOO_SHORT);
        } else {
            assert!(new_delay >= TESTNET_MIN_DELAY, E_DELAY_TOO_SHORT);
        };
        assert!(new_delay <= MAX_DELAY, E_DELAY_TOO_LONG);
        
        let old_delay = state.min_delay;
        state.min_delay = new_delay;
        
        event::emit(MinDelayUpdated {
            old_delay,
            new_delay,
            timestamp,
        });
    }

    /// Create additional proposer cap
    public entry fun create_proposer_cap(
        _admin: &TimelockAdminCap,
        proposer: address,
        ctx: &mut TxContext
    ) {
        transfer::transfer(
            ProposerCap {
                id: object::new(ctx),
                proposer,
            },
            proposer
        );
    }

    /// Create additional executor cap
    public entry fun create_executor_cap(
        _admin: &TimelockAdminCap,
        executor: address,
        ctx: &mut TxContext
    ) {
        transfer::transfer(
            ExecutorCap {
                id: object::new(ctx),
                executor,
            },
            executor
        );
    }

    // ============ View Functions ============

    /// Get timelock info
    public fun get_timelock_info(state: &TimelockState): (u64, u64, bool) {
        (
            state.min_delay,
            state.operation_count,
            state.is_mainnet
        )
    }

    /// Check if operation exists and is pending
    public fun is_operation_pending(state: &TimelockState, operation_id: vector<u8>): bool {
        if (!table::contains(&state.pending_operations, operation_id)) {
            return false
        };
        let op = table::borrow(&state.pending_operations, operation_id);
        !op.executed && !op.cancelled
    }

    /// Check if operation is ready to execute
    public fun is_operation_ready(state: &TimelockState, operation_id: vector<u8>, clock: &Clock): bool {
        if (!table::contains(&state.pending_operations, operation_id)) {
            return false
        };
        let op = table::borrow(&state.pending_operations, operation_id);
        let timestamp = clock::timestamp_ms(clock);
        !op.executed && !op.cancelled && timestamp >= op.ready_time && timestamp <= op.expiry_time
    }

    /// Get operation details
    public fun get_operation_info(state: &TimelockState, operation_id: vector<u8>): (u8, address, u64, u64, u64, bool, bool) {
        assert!(table::contains(&state.pending_operations, operation_id), E_OPERATION_NOT_FOUND);
        let op = table::borrow(&state.pending_operations, operation_id);
        (
            op.operation_type,
            op.target_address,
            op.target_value,
            op.ready_time,
            op.expiry_time,
            op.executed,
            op.cancelled
        )
    }

    // ============ Test Helpers ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }

    #[test_only]
    public fun mainnet_min_delay(): u64 {
        MAINNET_MIN_DELAY
    }

    #[test_only]
    public fun testnet_min_delay(): u64 {
        TESTNET_MIN_DELAY
    }
}
