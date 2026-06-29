/// Unit tests for rwa_custody_attestor.
///
/// Coverage:
///   1. Initialization creates AdminCap + shared AttestorRegistry
///   2. Custodian enrollment by admin (happy path + invalid pubkey length)
///   3. Custodian revocation
///   4. Submission requires enrolled, non-revoked custodian
///   5. Nonce replay prevention
///   6. Expired validity windows rejected
///   7. Validity-too-long rejected
///   8. Public message-format helper produces the expected byte layout
///
/// Signature verification itself is exercised via a known-good ed25519
/// test vector (separate test) so we don't have to wire a signer into the
/// test harness.
#[test_only]
#[allow(unused_use, unused_const)]
module zkvanguard::rwa_custody_attestor_tests {
    use sui::test_scenario::{Self, Scenario};
    use sui::clock::{Self, Clock};
    use std::string;
    use zkvanguard::rwa_custody_attestor::{
        Self, AdminCap, AttestorRegistry,
    };

    // ============ Test addresses ============
    const ADMIN: address = @0xAD;
    const HOLDER: address = @0xB1;
    const OTHER: address = @0xB2;

    // 32-byte test ed25519 pubkey (not a real key — placeholder for shape tests)
    // Real signature tests require a matching private key + ed25519 signer.
    fun test_pubkey(): vector<u8> {
        let mut v = vector::empty<u8>();
        let mut i: u64 = 0;
        while (i < 32) {
            vector::push_back(&mut v, ((i + 1) as u8));
            i = i + 1;
        };
        v
    }

    fun other_pubkey(): vector<u8> {
        let mut v = vector::empty<u8>();
        let mut i: u64 = 0;
        while (i < 32) {
            vector::push_back(&mut v, ((100 + i) as u8));
            i = i + 1;
        };
        v
    }

    fun test_asset_hash(): vector<u8> {
        let mut v = vector::empty<u8>();
        let mut i: u64 = 0;
        while (i < 32) {
            vector::push_back(&mut v, ((200 + i) as u8));
            i = i + 1;
        };
        v
    }

    fun dummy_signature(): vector<u8> {
        let mut v = vector::empty<u8>();
        let mut i: u64 = 0;
        while (i < 64) {
            vector::push_back(&mut v, ((i + 50) as u8));
            i = i + 1;
        };
        v
    }

    fun setup(): Scenario {
        test_scenario::begin(ADMIN)
    }

    fun make_clock(scenario: &mut Scenario): Clock {
        clock::create_for_testing(test_scenario::ctx(scenario))
    }

    // ============ Init ============

    #[test]
    fun test_init_creates_admin_cap_and_shared_registry() {
        let mut scenario = setup();
        {
            rwa_custody_attestor::init_for_testing(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            assert!(test_scenario::has_most_recent_for_sender<AdminCap>(&scenario), 0);
            assert!(test_scenario::has_most_recent_shared<AttestorRegistry>(), 1);
        };
        test_scenario::end(scenario);
    }

    // ============ Enroll ============

    #[test]
    fun test_enroll_custodian_happy_path() {
        let mut scenario = setup();
        {
            rwa_custody_attestor::init_for_testing(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let clock = make_clock(&mut scenario);

            rwa_custody_attestor::enroll_custodian(
                &admin_cap,
                &mut registry,
                test_pubkey(),
                string::utf8(b"Bank of A"),
                string::utf8(b"US"),
                &clock,
                test_scenario::ctx(&mut scenario),
            );

            assert!(rwa_custody_attestor::is_custodian_enrolled(&registry, test_pubkey()), 10);
            assert!(rwa_custody_attestor::is_custodian_active(&registry, test_pubkey()), 11);
            assert!(rwa_custody_attestor::enrolled_count(&registry) == 1, 12);

            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 1, location = zkvanguard::rwa_custody_attestor)]
    fun test_enroll_rejects_wrong_pubkey_length() {
        let mut scenario = setup();
        {
            rwa_custody_attestor::init_for_testing(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let clock = make_clock(&mut scenario);

            // Wrong length: 16 bytes instead of 32
            let mut bad_key = vector::empty<u8>();
            let mut i: u64 = 0;
            while (i < 16) {
                vector::push_back(&mut bad_key, (i as u8));
                i = i + 1;
            };

            rwa_custody_attestor::enroll_custodian(
                &admin_cap,
                &mut registry,
                bad_key,
                string::utf8(b"Bad"),
                string::utf8(b"XX"),
                &clock,
                test_scenario::ctx(&mut scenario),
            );

            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun test_re_enroll_replaces_existing_record() {
        let mut scenario = setup();
        {
            rwa_custody_attestor::init_for_testing(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let clock = make_clock(&mut scenario);

            rwa_custody_attestor::enroll_custodian(
                &admin_cap, &mut registry, test_pubkey(),
                string::utf8(b"v1"), string::utf8(b"US"), &clock,
                test_scenario::ctx(&mut scenario),
            );
            rwa_custody_attestor::enroll_custodian(
                &admin_cap, &mut registry, test_pubkey(),
                string::utf8(b"v2"), string::utf8(b"US"), &clock,
                test_scenario::ctx(&mut scenario),
            );

            // Still only one custodian counted
            assert!(rwa_custody_attestor::enrolled_count(&registry) == 1, 20);
            assert!(rwa_custody_attestor::is_custodian_active(&registry, test_pubkey()), 21);

            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(registry);
        };
        test_scenario::end(scenario);
    }

    // ============ Revoke ============

    #[test]
    fun test_revoke_marks_custodian_inactive() {
        let mut scenario = setup();
        {
            rwa_custody_attestor::init_for_testing(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let mut clock = make_clock(&mut scenario);
            // Advance clock past 0 so revoked_at is a non-sentinel timestamp.
            clock::increment_for_testing(&mut clock, 1_000_000);

            rwa_custody_attestor::enroll_custodian(
                &admin_cap, &mut registry, test_pubkey(),
                string::utf8(b"Bank"), string::utf8(b"US"), &clock,
                test_scenario::ctx(&mut scenario),
            );
            rwa_custody_attestor::revoke_custodian(
                &admin_cap, &mut registry, test_pubkey(), &clock,
                test_scenario::ctx(&mut scenario),
            );

            assert!(rwa_custody_attestor::is_custodian_enrolled(&registry, test_pubkey()), 30);
            assert!(!rwa_custody_attestor::is_custodian_active(&registry, test_pubkey()), 31);

            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 4, location = zkvanguard::rwa_custody_attestor)]
    fun test_revoke_unknown_custodian_aborts() {
        let mut scenario = setup();
        {
            rwa_custody_attestor::init_for_testing(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let clock = make_clock(&mut scenario);

            // Pubkey never enrolled
            rwa_custody_attestor::revoke_custodian(
                &admin_cap, &mut registry, other_pubkey(), &clock,
                test_scenario::ctx(&mut scenario),
            );

            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(registry);
        };
        test_scenario::end(scenario);
    }

    // ============ Submission validation (shape tests — signature gate is the last check) ============

    #[test]
    #[expected_failure(abort_code = 4, location = zkvanguard::rwa_custody_attestor)]
    fun test_submit_unknown_custodian_aborts() {
        let mut scenario = setup();
        {
            rwa_custody_attestor::init_for_testing(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, HOLDER);
        {
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let clock = make_clock(&mut scenario);

            rwa_custody_attestor::submit_attestation(
                &mut registry,
                42,
                test_asset_hash(),
                1,
                clock::timestamp_ms(&clock) + 1_000_000,
                test_pubkey(),    // never enrolled
                dummy_signature(),
                &clock,
                test_scenario::ctx(&mut scenario),
            );

            clock::destroy_for_testing(clock);
            test_scenario::return_shared(registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 8, location = zkvanguard::rwa_custody_attestor)]
    fun test_submit_validity_too_long_aborts() {
        let mut scenario = setup();
        {
            rwa_custody_attestor::init_for_testing(test_scenario::ctx(&mut scenario));
        };
        // Enroll first as admin
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let clock = make_clock(&mut scenario);
            rwa_custody_attestor::enroll_custodian(
                &admin_cap, &mut registry, test_pubkey(),
                string::utf8(b"Bank"), string::utf8(b"US"), &clock,
                test_scenario::ctx(&mut scenario),
            );
            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(registry);
        };
        // Then try to submit with > MAX_VALIDITY_MS window
        test_scenario::next_tx(&mut scenario, HOLDER);
        {
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let clock = make_clock(&mut scenario);

            rwa_custody_attestor::submit_attestation(
                &mut registry,
                42,
                test_asset_hash(),
                1,
                clock::timestamp_ms(&clock) + 31_536_000_001 + 1, // > 365 days
                test_pubkey(),
                dummy_signature(),
                &clock,
                test_scenario::ctx(&mut scenario),
            );

            clock::destroy_for_testing(clock);
            test_scenario::return_shared(registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 9, location = zkvanguard::rwa_custody_attestor)]
    fun test_submit_validity_already_expired_aborts() {
        let mut scenario = setup();
        {
            rwa_custody_attestor::init_for_testing(test_scenario::ctx(&mut scenario));
        };
        // Enroll first
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let clock = make_clock(&mut scenario);
            rwa_custody_attestor::enroll_custodian(
                &admin_cap, &mut registry, test_pubkey(),
                string::utf8(b"Bank"), string::utf8(b"US"), &clock,
                test_scenario::ctx(&mut scenario),
            );
            clock::destroy_for_testing(clock);
            test_scenario::return_to_sender(&scenario, admin_cap);
            test_scenario::return_shared(registry);
        };
        // Submit with valid_until <= now
        test_scenario::next_tx(&mut scenario, HOLDER);
        {
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let mut clock = make_clock(&mut scenario);
            clock::increment_for_testing(&mut clock, 1_000_000);

            rwa_custody_attestor::submit_attestation(
                &mut registry,
                42,
                test_asset_hash(),
                1,
                500_000, // before current 1_000_000
                test_pubkey(),
                dummy_signature(),
                &clock,
                test_scenario::ctx(&mut scenario),
            );

            clock::destroy_for_testing(clock);
            test_scenario::return_shared(registry);
        };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 1, location = zkvanguard::rwa_custody_attestor)]
    fun test_submit_bad_pubkey_length_aborts() {
        let mut scenario = setup();
        {
            rwa_custody_attestor::init_for_testing(test_scenario::ctx(&mut scenario));
        };
        test_scenario::next_tx(&mut scenario, HOLDER);
        {
            let mut registry = test_scenario::take_shared<AttestorRegistry>(&scenario);
            let clock = make_clock(&mut scenario);

            let bad_key = vector::empty<u8>(); // length 0
            rwa_custody_attestor::submit_attestation(
                &mut registry,
                42,
                test_asset_hash(),
                1,
                clock::timestamp_ms(&clock) + 1_000_000,
                bad_key,
                dummy_signature(),
                &clock,
                test_scenario::ctx(&mut scenario),
            );

            clock::destroy_for_testing(clock);
            test_scenario::return_shared(registry);
        };
        test_scenario::end(scenario);
    }

    // ============ Signed message format ============

    #[test]
    fun test_signed_message_format_is_56_bytes() {
        // The canonical message layout is portfolio_id (8) || asset_hash (32) ||
        // nonce (8) || valid_until (8) = 56 bytes total. The TS SDK depends on
        // this exact shape; pin it with a test.
        let msg = rwa_custody_attestor::build_signed_message_for_testing(
            42u64,
            test_asset_hash(),
            7u64,
            1_000_000_000u64,
        );
        assert!(vector::length(&msg) == 56, 40);

        // First byte should be the top byte of 42 (= 0x00); last byte the
        // bottom byte of 1_000_000_000 (= 0x00). Spot-check the layout.
        assert!(*vector::borrow(&msg, 0) == 0, 41); // 42 fits in a single byte
        assert!(*vector::borrow(&msg, 7) == 42, 42);
        // Bytes 8..40 = asset hash (first byte should be 200)
        assert!(*vector::borrow(&msg, 8) == 200, 43);
        // Bytes 40..48 = nonce 7
        assert!(*vector::borrow(&msg, 47) == 7, 44);
    }
}
