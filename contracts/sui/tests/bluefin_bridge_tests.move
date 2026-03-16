/// Comprehensive tests for BlueFin Bridge Module
/// Testing position tracking, relayer management, and security
#[test_only]
#[allow(unused_use, unused_const)]
module zkvanguard::bluefin_bridge_tests {
    use sui::test_scenario::{Self, Scenario};
    use sui::clock::{Self, Clock};
    use zkvanguard::bluefin_bridge::{Self, BluefinBridgeState, AdminCap, RelayerCap, BluefinPosition};

    // ============ Test Addresses ============
    const ADMIN: address = @0xAD;
    const RELAYER1: address = @0x111;
    const RELAYER2: address = @0x222;
    const TRADER1: address = @0xA1;
    const TRADER2: address = @0xA2;
    const TRADER3: address = @0xA3;

    // ============ Test Constants ============
    // Pair indices
    const PAIR_BTC_PERP: u64 = 0;
    const PAIR_ETH_PERP: u64 = 1;
    const PAIR_SUI_PERP: u64 = 2;

    // Position status
    const STATUS_OPEN: u8 = 1;
    const STATUS_CLOSED: u8 = 2;

    // Test amounts (scaled by 1e9 for precision)
    const ONE_SUI: u64 = 1_000_000_000;       // 1 SUI margin
    const TEN_SUI: u64 = 10_000_000_000;      // 10 SUI margin
    const HUNDRED_SUI: u64 = 100_000_000_000; // 100 SUI margin

    // Prices (scaled by 1e9)
    const BTC_PRICE: u64 = 65000_000_000_000;  // $65,000
    const ETH_PRICE: u64 = 3500_000_000_000;   // $3,500
    const SUI_PRICE: u64 = 1_000_000_000;      // $1.00

    // ============ Test Utilities ============

    fun setup_test(): Scenario {
        test_scenario::begin(ADMIN)
    }

    fun create_clock(scenario: &mut Scenario): Clock {
        // Don't call next_tx here - it would change the current sender context
        clock::create_for_testing(test_scenario::ctx(scenario))
    }

    fun advance_time(clock: &mut Clock, ms: u64) {
        clock::increment_for_testing(clock, ms);
    }

    fun create_bluefin_id(prefix: vector<u8>, index: u64): vector<u8> {
        let mut id = prefix;
        vector::push_back(&mut id, ((index % 256) as u8));
        id
    }

    fun create_commitment_hash(_trader: address): vector<u8> {
        // Mock commitment hash
        b"ZK_COMMIT_MOCK"
    }

    // ============ Initialization Tests ============

    #[test]
    fun test_init_creates_admin_cap() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            assert!(test_scenario::has_most_recent_for_sender<AdminCap>(&scenario), 0);
            assert!(test_scenario::has_most_recent_shared<BluefinBridgeState>(), 1);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_init_state_is_correct() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            
            let (total, open, closed, margin) = bluefin_bridge::get_stats(&state);
            assert!(total == 0, 10);
            assert!(open == 0, 11);
            assert!(closed == 0, 12);
            assert!(margin == 0, 13);
            
            test_scenario::return_shared(state);
        };
        test_scenario::end(scenario);
    }

    // ============ Admin Function Tests ============

    #[test]
    fun test_add_relayer() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Admin adds relayer
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            
            bluefin_bridge::add_relayer(
                &admin_cap,
                &mut state,
                RELAYER1,
                test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // Verify relayer received RelayerCap
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            assert!(test_scenario::has_most_recent_for_sender<RelayerCap>(&scenario), 20);
        };
        
        test_scenario::end(scenario);
    }

    #[test]
    fun test_pause_bridge() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Admin pauses
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            
            bluefin_bridge::set_paused(&admin_cap, &mut state, true);
            
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        test_scenario::end(scenario);
    }

    // ============ Position Tracking Tests ============

    #[test]
    fun test_record_position_open() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Add relayer
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            
            bluefin_bridge::add_relayer(&admin_cap, &mut state, RELAYER1, test_scenario::ctx(&mut scenario));
            
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // Relayer records position
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let clock = create_clock(&mut scenario);
            
            let bluefin_id = create_bluefin_id(b"BF_POS_", 1);
            let commitment = create_commitment_hash(TRADER1);
            
            bluefin_bridge::record_position_open(
                &relayer_cap,
                &mut state,
                bluefin_id,
                TRADER1,
                PAIR_BTC_PERP,  // BTC-PERP
                false,          // SHORT
                1_000_000_000,  // 1 BTC size
                5,              // 5x leverage
                TEN_SUI,        // 10 SUI margin
                BTC_PRICE,      // Entry price $65,000
                63000_000_000_000, // Liquidation at $63,000
                commitment,
                1,              // Portfolio ID
                &clock,
                test_scenario::ctx(&mut scenario)
            );
            
            // Verify state updated
            let (total, open, closed, margin) = bluefin_bridge::get_stats(&state);
            assert!(total == 1, 30);
            assert!(open == 1, 31);
            assert!(closed == 0, 32);
            assert!(margin == TEN_SUI, 33);
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            clock::destroy_for_testing(clock);
        };
        
        // Verify trader received position
        test_scenario::next_tx(&mut scenario, TRADER1);
        {
            assert!(test_scenario::has_most_recent_for_sender<BluefinPosition>(&scenario), 34);
        };
        
        test_scenario::end(scenario);
    }

    #[test]
    fun test_record_position_close() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Setup: Add relayer
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            bluefin_bridge::add_relayer(&admin_cap, &mut state, RELAYER1, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // Relayer opens position
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let clock = create_clock(&mut scenario);
            
            bluefin_bridge::record_position_open(
                &relayer_cap,
                &mut state,
                b"BF_CLOSE_TEST",
                TRADER1,
                PAIR_ETH_PERP,
                true,           // LONG
                10_000_000_000, // 10 ETH
                3,              // 3x
                HUNDRED_SUI,    // 100 SUI margin
                ETH_PRICE,      // $3,500 entry
                3000_000_000_000, // $3,000 liq
                b"commitment123",
                1,
                &clock,
                test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            clock::destroy_for_testing(clock);
        };
        
        // Relayer closes position (profit scenario)
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let mut position = test_scenario::take_from_address<BluefinPosition>(&scenario, TRADER1);
            let mut clock = create_clock(&mut scenario);
            
            // Advance time
            advance_time(&mut clock, 3600000); // 1 hour
            
            bluefin_bridge::record_position_close(
                &relayer_cap,
                &mut state,
                &mut position,
                3700_000_000_000,  // Close at $3,700 (profit)
                20_000_000_000,    // +20 SUI profit
                0,                 // No loss
                &clock,
                test_scenario::ctx(&mut scenario)
            );
            
            // Verify stats
            let (total, open, closed, margin) = bluefin_bridge::get_stats(&state);
            assert!(total == 1, 40);
            assert!(open == 0, 41);
            assert!(closed == 1, 42);
            assert!(margin == 0, 43); // Margin released
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            test_scenario::return_to_address(TRADER1, position);
            clock::destroy_for_testing(clock);
        };
        
        test_scenario::end(scenario);
    }

    #[test]
    fun test_sync_position() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Setup: Add relayer and open position
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            bluefin_bridge::add_relayer(&admin_cap, &mut state, RELAYER1, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let clock = create_clock(&mut scenario);
            
            bluefin_bridge::record_position_open(
                &relayer_cap,
                &mut state,
                b"BF_SYNC_TEST",
                TRADER2,
                PAIR_SUI_PERP,
                false,          // SHORT
                100_000_000_000, // 100 SUI
                10,             // 10x
                TEN_SUI,
                SUI_PRICE,
                1_200_000_000,  // Liq at $1.20
                b"sync_commit",
                2,
                &clock,
                test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            clock::destroy_for_testing(clock);
        };
        
        // Sync position with new mark price
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let mut position = test_scenario::take_from_address<BluefinPosition>(&scenario, TRADER2);
            let mut clock = create_clock(&mut scenario);
            
            advance_time(&mut clock, 1800000); // 30 minutes
            
            bluefin_bridge::sync_position(
                &relayer_cap,
                &state,
                &mut position,
                950_000_000,     // Price dropped to $0.95 (profitable for short)
                5_000_000_000,   // +5 SUI unrealized profit
                0,
                &clock,
                test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            test_scenario::return_to_address(TRADER2, position);
            clock::destroy_for_testing(clock);
        };
        
        test_scenario::end(scenario);
    }

    // ============ Multiple Positions Tests ============

    #[test]
    fun test_multiple_positions() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Add relayer
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            bluefin_bridge::add_relayer(&admin_cap, &mut state, RELAYER1, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // Open 3 positions for different traders
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let clock = create_clock(&mut scenario);
            
            // Position 1 - TRADER1 BTC SHORT
            bluefin_bridge::record_position_open(
                &relayer_cap, &mut state, b"POS_001", TRADER1, PAIR_BTC_PERP,
                false, 500_000_000, 5, TEN_SUI, BTC_PRICE, 63000_000_000_000,
                b"commit1", 1, &clock, test_scenario::ctx(&mut scenario)
            );
            
            // Position 2 - TRADER2 ETH LONG
            bluefin_bridge::record_position_open(
                &relayer_cap, &mut state, b"POS_002", TRADER2, PAIR_ETH_PERP,
                true, 5_000_000_000, 3, HUNDRED_SUI, ETH_PRICE, 3000_000_000_000,
                b"commit2", 2, &clock, test_scenario::ctx(&mut scenario)
            );
            
            // Position 3 - TRADER3 SUI SHORT
            bluefin_bridge::record_position_open(
                &relayer_cap, &mut state, b"POS_003", TRADER3, PAIR_SUI_PERP,
                false, 1000_000_000_000, 10, HUNDRED_SUI, SUI_PRICE, 1_150_000_000,
                b"commit3", 3, &clock, test_scenario::ctx(&mut scenario)
            );
            
            // Verify stats
            let (total, open, closed, margin) = bluefin_bridge::get_stats(&state);
            assert!(total == 3, 50);
            assert!(open == 3, 51);
            assert!(closed == 0, 52);
            assert!(margin == TEN_SUI + HUNDRED_SUI + HUNDRED_SUI, 53);
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            clock::destroy_for_testing(clock);
        };
        
        test_scenario::end(scenario);
    }

    // ============ Security Tests ============

    #[test]
    #[expected_failure(abort_code = bluefin_bridge::E_PAUSED)]
    fun test_cannot_open_when_paused() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Add relayer
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            bluefin_bridge::add_relayer(&admin_cap, &mut state, RELAYER1, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // Pause bridge
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            bluefin_bridge::set_paused(&admin_cap, &mut state, true);
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // Try to open position - should fail
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let clock = create_clock(&mut scenario);
            
            bluefin_bridge::record_position_open(
                &relayer_cap, &mut state, b"FAIL", TRADER1, PAIR_BTC_PERP,
                false, 1_000_000_000, 5, TEN_SUI, BTC_PRICE, 63000_000_000_000,
                b"commit", 1, &clock, test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            clock::destroy_for_testing(clock);
        };
        
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = bluefin_bridge::E_INVALID_PAIR)]
    fun test_invalid_pair_fails() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Add relayer
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            bluefin_bridge::add_relayer(&admin_cap, &mut state, RELAYER1, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // Try to open with invalid pair index
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let clock = create_clock(&mut scenario);
            
            bluefin_bridge::record_position_open(
                &relayer_cap, &mut state, b"INVALID_PAIR", TRADER1,
                99, // Invalid pair index
                false, 1_000_000_000, 5, TEN_SUI, BTC_PRICE, 63000_000_000_000,
                b"commit", 1, &clock, test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            clock::destroy_for_testing(clock);
        };
        
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = bluefin_bridge::E_INVALID_AMOUNT)]
    fun test_excessive_leverage_fails() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Add relayer
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            bluefin_bridge::add_relayer(&admin_cap, &mut state, RELAYER1, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // Try to open with leverage > 50
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let clock = create_clock(&mut scenario);
            
            bluefin_bridge::record_position_open(
                &relayer_cap, &mut state, b"HIGH_LEV", TRADER1, PAIR_BTC_PERP,
                false, 1_000_000_000,
                100, // 100x leverage - exceeds MAX_LEVERAGE=50
                TEN_SUI, BTC_PRICE, 63000_000_000_000,
                b"commit", 1, &clock, test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            clock::destroy_for_testing(clock);
        };
        
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = bluefin_bridge::E_POSITION_ALREADY_CLOSED)]
    fun test_cannot_close_twice() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Setup
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            bluefin_bridge::add_relayer(&admin_cap, &mut state, RELAYER1, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // Open position
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let clock = create_clock(&mut scenario);
            
            bluefin_bridge::record_position_open(
                &relayer_cap, &mut state, b"DOUBLE_CLOSE", TRADER1, PAIR_BTC_PERP,
                true, 1_000_000_000, 5, TEN_SUI, BTC_PRICE, 60000_000_000_000,
                b"commit", 1, &clock, test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            clock::destroy_for_testing(clock);
        };
        
        // Close position first time
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let mut position = test_scenario::take_from_address<BluefinPosition>(&scenario, TRADER1);
            let clock = create_clock(&mut scenario);
            
            bluefin_bridge::record_position_close(
                &relayer_cap, &mut state, &mut position,
                66000_000_000_000, 1_000_000_000, 0, &clock, test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            test_scenario::return_to_address(TRADER1, position);
            clock::destroy_for_testing(clock);
        };
        
        // Try to close again - should fail
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let mut position = test_scenario::take_from_address<BluefinPosition>(&scenario, TRADER1);
            let clock = create_clock(&mut scenario);
            
            bluefin_bridge::record_position_close(
                &relayer_cap, &mut state, &mut position,
                67000_000_000_000, 2_000_000_000, 0, &clock, test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            test_scenario::return_to_address(TRADER1, position);
            clock::destroy_for_testing(clock);
        };
        
        test_scenario::end(scenario);
    }

    // ============ View Function Tests ============

    #[test]
    fun test_is_valid_pair() {
        assert!(bluefin_bridge::is_valid_pair(0), 60); // BTC-PERP
        assert!(bluefin_bridge::is_valid_pair(1), 61); // ETH-PERP
        assert!(bluefin_bridge::is_valid_pair(7), 62); // PEPE-PERP
        assert!(!bluefin_bridge::is_valid_pair(8), 63); // Invalid
        assert!(!bluefin_bridge::is_valid_pair(100), 64); // Invalid
    }

    #[test]
    fun test_get_pair_name() {
        let btc_name = bluefin_bridge::get_pair_name(0);
        assert!(btc_name == b"BTC-PERP", 70);
        
        let eth_name = bluefin_bridge::get_pair_name(1);
        assert!(eth_name == b"ETH-PERP", 71);
        
        let sui_name = bluefin_bridge::get_pair_name(2);
        assert!(sui_name == b"SUI-PERP", 72);
        
        let unknown = bluefin_bridge::get_pair_name(99);
        assert!(unknown == b"UNKNOWN", 73);
    }

    #[test]
    fun test_get_position_info() {
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Setup
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            bluefin_bridge::add_relayer(&admin_cap, &mut state, RELAYER1, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // Open position
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let clock = create_clock(&mut scenario);
            
            bluefin_bridge::record_position_open(
                &relayer_cap, &mut state, b"INFO_TEST", TRADER1, PAIR_ETH_PERP,
                true, 2_000_000_000, 3, TEN_SUI, ETH_PRICE, 3000_000_000_000,
                b"info_commit", 5, &clock, test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            clock::destroy_for_testing(clock);
        };
        
        // Check position info
        test_scenario::next_tx(&mut scenario, TRADER1);
        {
            let position = test_scenario::take_from_sender<BluefinPosition>(&scenario);
            
            let (
                bf_id, trader, pair, is_long, size, leverage, margin, entry, mark, status
            ) = bluefin_bridge::get_position_info(&position);
            
            assert!(bf_id == b"INFO_TEST", 80);
            assert!(trader == TRADER1, 81);
            assert!(pair == PAIR_ETH_PERP, 82);
            assert!(is_long == true, 83);
            assert!(size == 2_000_000_000, 84);
            assert!(leverage == 3, 85);
            assert!(margin == TEN_SUI, 86);
            assert!(entry == ETH_PRICE, 87);
            assert!(mark == ETH_PRICE, 88); // Mark starts at entry
            assert!(status == STATUS_OPEN, 89);
            
            test_scenario::return_to_sender(&scenario, position);
        };
        
        test_scenario::end(scenario);
    }

    // ============ Hedge Integration Tests ============

    #[test]
    fun test_hedge_scenario_btc_short() {
        // Simulates a typical hedge scenario:
        // Portfolio has BTC exposure, AI hedges with BTC-PERP short
        
        let mut scenario = setup_test();
        {
            bluefin_bridge::test_init(test_scenario::ctx(&mut scenario));
        };
        
        // Setup relayer
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            bluefin_bridge::add_relayer(&admin_cap, &mut state, RELAYER1, test_scenario::ctx(&mut scenario));
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(state);
        };
        
        // 1. Open short hedge on BTC crash
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let clock = create_clock(&mut scenario);
            
            // AI detected volatility, opens short
            bluefin_bridge::record_position_open(
                &relayer_cap, &mut state,
                b"HEDGE_BTC_SHORT_001",
                TRADER1,
                PAIR_BTC_PERP,
                false,                    // SHORT
                5_000_000_000,            // 5 BTC notional
                5,                        // 5x leverage
                HUNDRED_SUI,              // 100 SUI margin
                65000_000_000_000,        // Entry $65,000
                68000_000_000_000,        // Liq at $68,000
                b"ZK_COMMITMENT_HEDGE_1",
                100,                      // Portfolio ID
                &clock,
                test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            clock::destroy_for_testing(clock);
        };
        
        // 2. BTC drops - sync position with profit
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let mut position = test_scenario::take_from_address<BluefinPosition>(&scenario, TRADER1);
            let mut clock = create_clock(&mut scenario);
            
            advance_time(&mut clock, 7200000); // 2 hours later
            
            // BTC dropped to $62,000 - $3,000 profit per BTC
            bluefin_bridge::sync_position(
                &relayer_cap, &state, &mut position,
                62000_000_000_000,         // New mark price
                15_000_000_000,            // +15 SUI unrealized (5 BTC * $3000 / price) 
                0,
                &clock,
                test_scenario::ctx(&mut scenario)
            );
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            test_scenario::return_to_address(TRADER1, position);
            clock::destroy_for_testing(clock);
        };
        
        // 3. Close position with realized profit
        test_scenario::next_tx(&mut scenario, RELAYER1);
        {
            let relayer_cap = test_scenario::take_from_sender<RelayerCap>(&scenario);
            let mut state = test_scenario::take_shared<BluefinBridgeState>(&scenario);
            let mut position = test_scenario::take_from_address<BluefinPosition>(&scenario, TRADER1);
            let mut clock = create_clock(&mut scenario);
            
            advance_time(&mut clock, 3600000); // 1 more hour
            
            bluefin_bridge::record_position_close(
                &relayer_cap, &mut state, &mut position,
                61500_000_000_000,  // Closed at $61,500
                17_500_000_000,     // +17.5 SUI realized profit
                0,
                &clock,
                test_scenario::ctx(&mut scenario)
            );
            
            // Verify final state
            let (total, open, closed, margin) = bluefin_bridge::get_stats(&state);
            assert!(total == 1, 90);
            assert!(open == 0, 91);
            assert!(closed == 1, 92);
            assert!(margin == 0, 93); // All margin released
            
            test_scenario::return_to_sender(&scenario, relayer_cap);
            test_scenario::return_shared(state);
            test_scenario::return_to_address(TRADER1, position);
            clock::destroy_for_testing(clock);
        };
        
        test_scenario::end(scenario);
    }
}
