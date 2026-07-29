/// End-to-end on-chain STARK verify for hedge proofs.
///
/// Composes zkv_fri (Merkle + folding), zkv_hedge_air (row-constraint
/// composition), and inline grinding PoW into a single check. Given a
/// full proof bundle, returns true iff:
///
///   1. Grinding PoW satisfies the declared bit count (≥ MIN_GRINDING_BITS).
///   2. FRI verify passes for every query (Merkle + folding + final poly).
///   3. Composition identity `H(x_q) == Σ α_j · P_j(T(x_q)) · inv(x_q − g^j)`
///      holds at every (opening, query) pair.
///   4. Each opening's index matches its paired FRI query index.
///
/// Match: `CUDATrueSTARK.verify_proof` in zkp/core/cuda_true_stark.py.
///
/// This module is prover-format-agnostic — it takes structured Move types
/// as arguments. The `zk_verifier.move` entry point owns parsing bytes
/// into these types (or accepting them from a PTB pre-decomposed).
#[allow(unused_const)]
module zkvanguard::zkv_stark {
    use std::hash;
    use std::vector;
    use sui::bcs;
    use zkvanguard::zkv_fri::{Self, FriQuery, FriQueryLayer};
    use zkvanguard::zkv_hedge_air::{Self, TraceOpening};
    use zkvanguard::zkv_merkle::{Self, MerkleProofStep};

    // ============ Constants ============

    /// Minimum grinding bits — matches Python `MIN_GRINDING_BITS` in
    /// zk/verifier/proof-metadata-guard.ts and the harness config.
    /// Whitepaper spec = 20; hedge proofs actually deliver 24.
    const MIN_GRINDING_BITS: u64 = 20;

    // ============ Error codes ============

    const E_INSUFFICIENT_GRINDING: u64 = 100;
    const E_GRINDING_POW_FAILED: u64 = 101;
    const E_FRI_VERIFY_FAILED: u64 = 102;
    const E_COMPOSITION_FAILED: u64 = 103;
    const E_QUERY_OPENING_COUNT_MISMATCH: u64 = 104;
    const E_QUERY_OPENING_INDEX_MISMATCH: u64 = 105;

    // ============ Grinding PoW ============

    /// Encode `n` as a 16-byte big-endian value. Matches Python
    /// `n.to_bytes(16, 'big')` for n ∈ [0, 2^64) — high 8 bytes zero,
    /// low 8 bytes are the u64 BE encoding.
    ///
    /// Prover uses u128 nonces; for grinding_bits ≤ ~28 the nonce fits
    /// comfortably in u64. Higher bit counts need a u128 arg — deferred
    /// to a Rust prover (see docs/ZK_ROADMAP.md Phase B).
    fun nonce_to_16be(n: u64): vector<u8> {
        let mut buf = vector::empty<u8>();
        let mut i: u64 = 0;
        while (i < 8) {
            vector::push_back(&mut buf, 0u8);
            i = i + 1;
        };
        let mut j: u64 = 0;
        while (j < 8) {
            let shift = (7 - j) * 8;
            vector::push_back(&mut buf, ((n >> (shift as u8)) & 0xff) as u8);
            j = j + 1;
        };
        buf
    }

    /// Return true iff `digest` has at least `bits` leading zero bits.
    /// Byte-identical to Python `_has_leading_zero_bits`.
    fun has_leading_zero_bits(digest: &vector<u8>, bits: u64): bool {
        if (bits == 0) return true;
        let full_bytes = bits / 8;
        let rem_bits = bits % 8;
        let needed = full_bytes + (if (rem_bits > 0) 1 else 0);
        if ((vector::length(digest) as u64) < needed) return false;
        let mut i: u64 = 0;
        while (i < full_bytes) {
            if (*vector::borrow(digest, i) != 0) return false;
            i = i + 1;
        };
        if (rem_bits > 0) {
            let b = *vector::borrow(digest, full_bytes);
            // High `rem_bits` of the next byte must be zero:
            // `(b >> (8 - rem_bits)) == 0`.
            let shift = 8 - rem_bits;
            if (((b as u64) >> (shift as u8)) != 0) return false;
        };
        true
    }

    /// Verify grinding PoW. Public for reuse + test isolation.
    public fun verify_grinding(
        trace_merkle_root: &vector<u8>,
        fri_roots: &vector<vector<u8>>,
        grinding_nonce: u64,
        grinding_bits: u64,
    ): bool {
        let mut transcript = *trace_merkle_root;
        let mut i: u64 = 0;
        let n = vector::length(fri_roots);
        while (i < n) {
            vector::append(&mut transcript, *vector::borrow(fri_roots, i));
            i = i + 1;
        };
        vector::append(&mut transcript, nonce_to_16be(grinding_nonce));
        let digest = hash::sha2_256(transcript);
        has_leading_zero_bits(&digest, grinding_bits)
    }

    // ============ End-to-end verify ============

    /// Verify a full hedge STARK proof end-to-end. Returns true iff every
    /// layer of the check passes. Does NOT mutate any state — replay
    /// protection is a concern of the wrapper in zk_verifier.move that
    /// calls this.
    public fun verify_hedge_stark_proof(
        trace_merkle_root: &vector<u8>,
        fri_roots: vector<vector<u8>>,
        final_poly_coeffs: vector<u64>,
        fri_queries: vector<FriQuery>,
        trace_openings: vector<TraceOpening>,
        extended_size: u64,
        trace_length: u64,
        leverage_cap: u64,
        grinding_nonce: u64,
        grinding_bits: u64,
        max_final_degree: u64,
    ): bool {
        // Step 1: grinding minimum + PoW check.
        if (grinding_bits < MIN_GRINDING_BITS) return false;
        if (!verify_grinding(
            trace_merkle_root, &fri_roots, grinding_nonce, grinding_bits,
        )) return false;

        // Step 2: pair-count sanity — each FRI query must have a
        // paired trace opening at the same position. Also pre-extract
        // H(x_q) per query (FRI layer 0 value) since `zkv_fri::verify`
        // consumes `fri_queries` by value below.
        let n_q = vector::length(&fri_queries);
        let n_o = vector::length(&trace_openings);
        if (n_q != n_o) return false;
        let mut h_values = vector::empty<u64>();
        let mut i: u64 = 0;
        while (i < n_q) {
            let q = vector::borrow(&fri_queries, i);
            let o = vector::borrow(&trace_openings, i);
            if (zkv_fri::query_index(q) != zkv_hedge_air::opening_index(o)) {
                return false
            };
            vector::push_back(&mut h_values, zkv_fri::layer0_value(q));
            i = i + 1;
        };

        // Step 3: FRI verify — Merkle + folding + final poly. Consumes
        // fri_queries; from here on we work off `h_values` and the
        // still-borrowed `trace_openings`.
        if (!zkv_fri::verify(
            fri_roots,
            fri_queries,
            final_poly_coeffs,
            extended_size,
            max_final_degree,
        )) return false;

        // Step 4: composition check at every opening/query pair.
        i = 0;
        while (i < n_o) {
            let opening = vector::borrow(&trace_openings, i);
            let h_at_x_q = *vector::borrow(&h_values, i);
            if (!zkv_hedge_air::verify_composition_at(
                opening,
                h_at_x_q,
                trace_merkle_root,
                extended_size,
                trace_length,
                leverage_cap,
            )) return false;
            i = i + 1;
        };

        true
    }

    // ============ BCS decoders ============
    //
    // Move entry functions can't accept custom struct arguments, so
    // callers submitting a hedge proof directly from a Sui PTB have to
    // BCS-encode the deeply-nested pieces (vector<FriQuery> and
    // vector<TraceOpening>) as vector<u8> blobs. These decoders
    // reconstruct the Move structs from those blobs.
    //
    // BCS layout convention: struct fields in declaration order, no
    // field names. Vectors are ULEB128 length prefix followed by
    // concatenated elements (matches @mysten/bcs on the TS side).

    /// Decode `vector<MerkleProofStep>` from a BCS cursor.
    fun peel_merkle_proof(cursor: &mut bcs::BCS): vector<MerkleProofStep> {
        let n = bcs::peel_vec_length(cursor);
        let mut out = vector::empty<MerkleProofStep>();
        let mut i: u64 = 0;
        while (i < n) {
            let sibling = bcs::peel_vec_u8(cursor);
            let is_left = bcs::peel_bool(cursor);
            vector::push_back(&mut out, zkv_merkle::new_step(sibling, is_left));
            i = i + 1;
        };
        out
    }

    /// Decode one `FriQueryLayer` from a BCS cursor.
    fun peel_fri_layer(cursor: &mut bcs::BCS): FriQueryLayer {
        let value = bcs::peel_u64(cursor);
        let sibling_value = bcs::peel_u64(cursor);
        let merkle_proof = peel_merkle_proof(cursor);
        let sibling_proof = peel_merkle_proof(cursor);
        zkv_fri::new_layer(value, sibling_value, merkle_proof, sibling_proof)
    }

    /// Decode one `FriQuery` from a BCS cursor.
    fun peel_fri_query(cursor: &mut bcs::BCS): FriQuery {
        let index = bcs::peel_u64(cursor);
        let n_layers = bcs::peel_vec_length(cursor);
        let mut layers = vector::empty<FriQueryLayer>();
        let mut i: u64 = 0;
        while (i < n_layers) {
            vector::push_back(&mut layers, peel_fri_layer(cursor));
            i = i + 1;
        };
        zkv_fri::new_query(index, layers)
    }

    /// Public entry: decode a BCS-encoded `vector<FriQuery>` blob into
    /// the Move types the verifier operates on.
    public fun decode_fri_queries(blob: vector<u8>): vector<FriQuery> {
        let mut cursor = bcs::new(blob);
        let n = bcs::peel_vec_length(&mut cursor);
        let mut out = vector::empty<FriQuery>();
        let mut i: u64 = 0;
        while (i < n) {
            vector::push_back(&mut out, peel_fri_query(&mut cursor));
            i = i + 1;
        };
        out
    }

    /// Public entry: decode a BCS-encoded `vector<TraceOpening>` blob.
    public fun decode_trace_openings(blob: vector<u8>): vector<TraceOpening> {
        let mut cursor = bcs::new(blob);
        let n = bcs::peel_vec_length(&mut cursor);
        let mut out = vector::empty<TraceOpening>();
        let mut i: u64 = 0;
        while (i < n) {
            let index = bcs::peel_u64(&mut cursor);
            let value = bcs::peel_u64(&mut cursor);
            let merkle_proof = peel_merkle_proof(&mut cursor);
            vector::push_back(&mut out, zkv_hedge_air::new_opening(index, value, merkle_proof));
            i = i + 1;
        };
        out
    }
}
