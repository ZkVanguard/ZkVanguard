/// RWA Custody Attestor Module
///
/// On-chain primitive for institutional custodians to issue cryptographically-
/// signed attestations that bind a portfolio to off-chain backing assets,
/// without revealing the asset list publicly.
///
/// This is the bridge primitive between ZkVanguard's autonomous DeFi
/// infrastructure and real-world asset (RWA) integration paths. A custodian
/// signs `(portfolio_id, asset_list_hash, nonce, valid_until)` with their
/// enrolled ed25519 key; the attestation lives as an owned object on the
/// portfolio holder's wallet and can be displayed, shared, or verified by
/// any counterparty.
///
/// Trust model:
///   - The protocol admin (eventually MSafe-held AdminCap) enrolls and
///     revokes custodians by their ed25519 public key + jurisdiction.
///   - Anyone can submit an attestation; the signature gate decides whether
///     it's accepted (only signatures from enrolled, non-revoked custodians
///     pass).
///   - Nonces prevent replay (per-custodian, per-portfolio strictly increasing).
///   - Asset list itself stays off-chain; only its hash is on-chain so
///     portfolio composition remains private to the holder + custodian.
///
/// See docs/CUSTODY_ATTESTATION_SPEC.md for the full design rationale and
/// docs/VISION.md for how this primitive earns the "BlackRock-for-Web3" framing.
#[allow(unused_const, unused_field)]
module zkvanguard::rwa_custody_attestor {
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};
    use sui::ed25519;
    use std::string::String;

    // ============ Error Codes ============
    const E_INVALID_PUBKEY_LEN: u64 = 1;
    const E_INVALID_SIGNATURE_LEN: u64 = 2;
    const E_INVALID_HASH_LEN: u64 = 3;
    const E_CUSTODIAN_NOT_ENROLLED: u64 = 4;
    const E_CUSTODIAN_REVOKED: u64 = 5;
    const E_SIGNATURE_VERIFICATION_FAILED: u64 = 6;
    const E_NONCE_REPLAY: u64 = 7;
    const E_VALIDITY_TOO_LONG: u64 = 8;
    const E_VALIDITY_ALREADY_EXPIRED: u64 = 9;
    const E_ATTESTATION_EXPIRED: u64 = 10;

    // ============ Constants ============

    /// Maximum lifetime of an attestation = 1 year. Custodians who want
    /// longer windows must re-attest. Prevents stale attestations from
    /// silently outlasting an asset rebalance.
    const MAX_VALIDITY_MS: u64 = 31_536_000_000; // 365 days

    /// ed25519 pubkey length (32 bytes) and signature length (64 bytes).
    const ED25519_PUBKEY_LEN: u64 = 32;
    const ED25519_SIG_LEN: u64 = 64;

    /// SHA-256 hash length used for the asset_list_hash commitment.
    const ASSET_HASH_LEN: u64 = 32;

    // ============ Structs ============

    /// Admin capability for enrolling/revoking custodians.
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Per-custodian metadata stored inside the registry table.
    public struct EnrolledCustodian has store, drop {
        /// ed25519 public key (32 bytes).
        pubkey: vector<u8>,
        /// Human-readable label, e.g. "Bank of A — Custody Division".
        label: String,
        /// ISO-3166 country code or "MULTI" for international.
        jurisdiction: String,
        /// Timestamp (ms) when the custodian was enrolled.
        enrolled_at: u64,
        /// 0 = active. Non-zero = revoked at this timestamp.
        revoked_at: u64,
    }

    /// Shared registry of enrolled custodians + per-(custodian, portfolio)
    /// nonce ledger to prevent replay.
    public struct AttestorRegistry has key {
        id: UID,
        /// pubkey bytes → custodian metadata
        custodians: Table<vector<u8>, EnrolledCustodian>,
        /// (pubkey || portfolio_id_bytes) → highest nonce seen
        nonces: Table<vector<u8>, u64>,
        /// Total attestations issued (lifetime counter).
        total_issued: u64,
        /// Distinct enrolled custodians count.
        enrolled_count: u64,
    }

    /// Owned object that proves a portfolio is custody-backed. Lives on the
    /// portfolio holder's wallet. Can be transferred (e.g. to a smart-contract
    /// escrow for institutional flows).
    public struct CustodyAttestation has key, store {
        id: UID,
        /// Portfolio identifier (e.g. ZkVanguard pool position ID, or any
        /// counterparty-meaningful integer).
        portfolio_id: u64,
        /// Public key of the custodian who issued this attestation.
        custodian_pubkey: vector<u8>,
        /// Hash (SHA-256) of the off-chain asset list. The list itself is
        /// shared off-chain between holder and custodian only.
        asset_list_hash: vector<u8>,
        /// Monotonically-increasing nonce per (custodian, portfolio).
        nonce: u64,
        /// Timestamp (ms) the attestation was committed on-chain.
        attested_at: u64,
        /// Timestamp (ms) after which this attestation is considered expired.
        valid_until: u64,
        /// 64-byte ed25519 signature over the canonical message.
        /// Stored for off-chain verifiers who want to re-check independently.
        signature: vector<u8>,
    }

    // ============ Events ============

    public struct CustodianEnrolled has copy, drop {
        pubkey: vector<u8>,
        label: String,
        jurisdiction: String,
        enrolled_at: u64,
    }

    public struct CustodianRevoked has copy, drop {
        pubkey: vector<u8>,
        revoked_at: u64,
    }

    public struct AttestationIssued has copy, drop {
        attestation_id: ID,
        portfolio_id: u64,
        custodian_pubkey: vector<u8>,
        asset_list_hash: vector<u8>,
        nonce: u64,
        attested_at: u64,
        valid_until: u64,
        holder: address,
    }

    // ============ Init ============

    fun init(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);

        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin_cap, sender);

        let registry = AttestorRegistry {
            id: object::new(ctx),
            custodians: table::new(ctx),
            nonces: table::new(ctx),
            total_issued: 0,
            enrolled_count: 0,
        };
        transfer::share_object(registry);
    }

    // ============ Admin (AdminCap-gated) ============

    /// Enroll a new custodian. Identified by 32-byte ed25519 pubkey.
    /// Idempotent on re-enroll: if the pubkey already exists, the existing
    /// entry is overwritten (so a previously-revoked custodian can be
    /// re-enrolled by replacing their record).
    public entry fun enroll_custodian(
        _admin: &AdminCap,
        registry: &mut AttestorRegistry,
        pubkey: vector<u8>,
        label: String,
        jurisdiction: String,
        clock: &Clock,
        _ctx: &mut TxContext,
    ) {
        assert!(vector::length(&pubkey) == ED25519_PUBKEY_LEN, E_INVALID_PUBKEY_LEN);
        let now = clock::timestamp_ms(clock);

        // Replace existing record if any (handles re-enrollment cleanly).
        if (table::contains(&registry.custodians, pubkey)) {
            let _: EnrolledCustodian = table::remove(&mut registry.custodians, pubkey);
        } else {
            registry.enrolled_count = registry.enrolled_count + 1;
        };

        let record = EnrolledCustodian {
            pubkey,
            label,
            jurisdiction,
            enrolled_at: now,
            revoked_at: 0,
        };

        let pubkey_copy = record.pubkey;
        let label_copy = record.label;
        let jurisdiction_copy = record.jurisdiction;
        table::add(&mut registry.custodians, pubkey_copy, record);

        event::emit(CustodianEnrolled {
            pubkey: pubkey_copy,
            label: label_copy,
            jurisdiction: jurisdiction_copy,
            enrolled_at: now,
        });
    }

    /// Revoke a previously-enrolled custodian. Existing attestations remain
    /// in holders' wallets (immutable), but their validity should be checked
    /// against this registry — see `is_custodian_active`.
    public entry fun revoke_custodian(
        _admin: &AdminCap,
        registry: &mut AttestorRegistry,
        pubkey: vector<u8>,
        clock: &Clock,
        _ctx: &mut TxContext,
    ) {
        assert!(table::contains(&registry.custodians, pubkey), E_CUSTODIAN_NOT_ENROLLED);
        let now = clock::timestamp_ms(clock);
        let record = table::borrow_mut(&mut registry.custodians, pubkey);
        record.revoked_at = now;

        event::emit(CustodianRevoked {
            pubkey,
            revoked_at: now,
        });
    }

    // ============ Attestation issuance (anyone can submit) ============

    /// Submit a custodian-signed attestation. Anyone can call this; only
    /// signatures from currently-enrolled, non-revoked custodians are
    /// accepted. The resulting CustodyAttestation is transferred to the
    /// transaction sender (so a portfolio holder typically calls this from
    /// their own wallet, attaching the signature their custodian provided
    /// off-chain).
    public entry fun submit_attestation(
        registry: &mut AttestorRegistry,
        portfolio_id: u64,
        asset_list_hash: vector<u8>,
        nonce: u64,
        valid_until: u64,
        custodian_pubkey: vector<u8>,
        signature: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(vector::length(&custodian_pubkey) == ED25519_PUBKEY_LEN, E_INVALID_PUBKEY_LEN);
        assert!(vector::length(&signature) == ED25519_SIG_LEN, E_INVALID_SIGNATURE_LEN);
        assert!(vector::length(&asset_list_hash) == ASSET_HASH_LEN, E_INVALID_HASH_LEN);

        let now = clock::timestamp_ms(clock);
        assert!(valid_until > now, E_VALIDITY_ALREADY_EXPIRED);
        assert!(valid_until - now <= MAX_VALIDITY_MS, E_VALIDITY_TOO_LONG);

        // 1. Verify the custodian is enrolled and not revoked.
        assert!(table::contains(&registry.custodians, custodian_pubkey), E_CUSTODIAN_NOT_ENROLLED);
        let record = table::borrow(&registry.custodians, custodian_pubkey);
        assert!(record.revoked_at == 0, E_CUSTODIAN_REVOKED);

        // 2. Reconstruct canonical signed message:
        //    portfolio_id (u64 BE) || asset_list_hash || nonce (u64 BE) || valid_until (u64 BE)
        let msg = build_signed_message(portfolio_id, &asset_list_hash, nonce, valid_until);

        // 3. Verify ed25519 signature.
        assert!(
            ed25519::ed25519_verify(&signature, &custodian_pubkey, &msg),
            E_SIGNATURE_VERIFICATION_FAILED,
        );

        // 4. Nonce replay check. Key = pubkey || portfolio_id_bytes.
        let nonce_key = build_nonce_key(&custodian_pubkey, portfolio_id);
        if (table::contains(&registry.nonces, nonce_key)) {
            let last = *table::borrow(&registry.nonces, nonce_key);
            assert!(nonce > last, E_NONCE_REPLAY);
            let mut_ref = table::borrow_mut(&mut registry.nonces, nonce_key);
            *mut_ref = nonce;
        } else {
            table::add(&mut registry.nonces, nonce_key, nonce);
        };

        registry.total_issued = registry.total_issued + 1;

        let holder = tx_context::sender(ctx);
        let attestation = CustodyAttestation {
            id: object::new(ctx),
            portfolio_id,
            custodian_pubkey,
            asset_list_hash,
            nonce,
            attested_at: now,
            valid_until,
            signature,
        };
        let attestation_id = object::id(&attestation);

        event::emit(AttestationIssued {
            attestation_id,
            portfolio_id,
            custodian_pubkey: attestation.custodian_pubkey,
            asset_list_hash: attestation.asset_list_hash,
            nonce,
            attested_at: now,
            valid_until,
            holder,
        });

        transfer::transfer(attestation, holder);
    }

    // ============ View functions ============

    public fun is_custodian_enrolled(registry: &AttestorRegistry, pubkey: vector<u8>): bool {
        table::contains(&registry.custodians, pubkey)
    }

    public fun is_custodian_active(registry: &AttestorRegistry, pubkey: vector<u8>): bool {
        if (!table::contains(&registry.custodians, pubkey)) return false;
        let record = table::borrow(&registry.custodians, pubkey);
        record.revoked_at == 0
    }

    public fun total_issued(registry: &AttestorRegistry): u64 {
        registry.total_issued
    }

    public fun enrolled_count(registry: &AttestorRegistry): u64 {
        registry.enrolled_count
    }

    public fun is_valid_attestation(attestation: &CustodyAttestation, clock: &Clock): bool {
        attestation.valid_until > clock::timestamp_ms(clock)
    }

    public fun get_attestation_summary(
        attestation: &CustodyAttestation,
    ): (u64, vector<u8>, vector<u8>, u64, u64, u64) {
        (
            attestation.portfolio_id,
            attestation.custodian_pubkey,
            attestation.asset_list_hash,
            attestation.nonce,
            attestation.attested_at,
            attestation.valid_until,
        )
    }

    public fun get_attestation_signature(attestation: &CustodyAttestation): vector<u8> {
        attestation.signature
    }

    public fun get_last_nonce(
        registry: &AttestorRegistry,
        custodian_pubkey: vector<u8>,
        portfolio_id: u64,
    ): u64 {
        let key = build_nonce_key(&custodian_pubkey, portfolio_id);
        if (table::contains(&registry.nonces, key)) {
            *table::borrow(&registry.nonces, key)
        } else {
            0
        }
    }

    // ============ Internal helpers ============

    /// Canonical signed message layout. Off-chain custodians MUST sign exactly
    /// this byte sequence:
    ///   bytes 0..8    portfolio_id (big-endian u64)
    ///   bytes 8..40   asset_list_hash (32 bytes)
    ///   bytes 40..48  nonce (big-endian u64)
    ///   bytes 48..56  valid_until (big-endian u64)
    /// Total: 56 bytes.
    fun build_signed_message(
        portfolio_id: u64,
        asset_list_hash: &vector<u8>,
        nonce: u64,
        valid_until: u64,
    ): vector<u8> {
        let mut msg = vector::empty<u8>();
        append_u64_be(&mut msg, portfolio_id);
        let mut i: u64 = 0;
        while (i < vector::length(asset_list_hash)) {
            vector::push_back(&mut msg, *vector::borrow(asset_list_hash, i));
            i = i + 1;
        };
        append_u64_be(&mut msg, nonce);
        append_u64_be(&mut msg, valid_until);
        msg
    }

    /// Build the per-(custodian, portfolio) nonce key.
    fun build_nonce_key(pubkey: &vector<u8>, portfolio_id: u64): vector<u8> {
        let mut key = vector::empty<u8>();
        let mut i: u64 = 0;
        while (i < vector::length(pubkey)) {
            vector::push_back(&mut key, *vector::borrow(pubkey, i));
            i = i + 1;
        };
        append_u64_be(&mut key, portfolio_id);
        key
    }

    fun append_u64_be(buf: &mut vector<u8>, value: u64) {
        let mut i: u64 = 0;
        while (i < 8) {
            // shift right by (7 - i) * 8 bits to extract each byte big-endian
            let shift = (7 - i) * 8;
            let byte = ((value >> (shift as u8)) & 0xFF) as u8;
            vector::push_back(buf, byte);
            i = i + 1;
        };
    }

    // ============ Test helpers ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx)
    }

    #[test_only]
    public fun build_signed_message_for_testing(
        portfolio_id: u64,
        asset_list_hash: vector<u8>,
        nonce: u64,
        valid_until: u64,
    ): vector<u8> {
        build_signed_message(portfolio_id, &asset_list_hash, nonce, valid_until)
    }
}
