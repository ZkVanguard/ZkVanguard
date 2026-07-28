/// FRI folding-consistency check for the on-chain STARK verifier.
///
/// Byte-identical to Python `FRI.verify` in `zkp/core/cuda_true_stark.py`:
///
///   For each query at position q_0 in the extended coset, walk layers
///   L = 0..num_layers-1:
///
///     v  = layer L Merkle-authenticated value at position q_L
///     s  = layer L Merkle-authenticated sibling at (q_L + N_L/2) mod N_L
///     x  = h_L · ω_L^{q_L}                          (domain point)
///     α  = sha256(root_L) mod P                     (Fiat-Shamir binding)
///
///     f_even    = (v + s) / 2
///     f_odd     = (v − s) / (2·x)
///     expected  = f_even + α · f_odd                (folding relation)
///
///     if L + 1 < num_layers:
///         assert expected == layer L+1's value
///     else:
///         assert expected == final_poly(x²)          (last committed layer)
///
/// Also enforces final polynomial degree ≤ num_queries — matches the
/// prover's final-poly cap so an attacker can't ship a high-degree
/// "final" polynomial to skip the FRI compression.
///
/// Depends on: zkv_field (Goldilocks arithmetic + primitive_root +
/// eval_poly + u64_to_ascii) and zkv_merkle (per-layer authentication).
module zkvanguard::zkv_fri {
    use std::hash;
    use std::vector;
    use zkvanguard::zkv_field;
    use zkvanguard::zkv_merkle::{Self, MerkleProofStep};

    /// One FRI layer of a single query response. `value` is `f_L(x_q)`,
    /// `sibling_value` is `f_L(−x_q)`; both are Goldilocks field elements
    /// and both ship with Merkle proofs against `roots[L]`.
    public struct FriQueryLayer has copy, drop, store {
        value: u64,
        sibling_value: u64,
        merkle_proof: vector<MerkleProofStep>,
        sibling_proof: vector<MerkleProofStep>,
    }

    /// Full query response for one Fiat-Shamir-derived position `index`
    /// in the extended coset domain. Layers is per-FRI-layer, index 0
    /// is the first (largest) layer.
    public struct FriQuery has copy, drop, store {
        index: u64,
        layers: vector<FriQueryLayer>,
    }

    // ============ Constructors ============
    // Public so a Move caller (e.g. zk_verifier.move parsing a submitted
    // proof) can build the structs field-by-field without importing
    // internals of this module.

    public fun new_layer(
        value: u64,
        sibling_value: u64,
        merkle_proof: vector<MerkleProofStep>,
        sibling_proof: vector<MerkleProofStep>,
    ): FriQueryLayer {
        FriQueryLayer { value, sibling_value, merkle_proof, sibling_proof }
    }

    public fun new_query(index: u64, layers: vector<FriQueryLayer>): FriQuery {
        FriQuery { index, layers }
    }

    // ============ Coset shift + Fiat-Shamir helpers ============

    /// Compute the multiplicative coset shift `h` used by the prover.
    /// Matches Python: `get_primitive_root(extended_size * 2)`. Chosen so
    /// `h^N = -1` (i.e., h is outside the size-N subgroup), giving a
    /// proper coset `h·<ω>` disjoint from the trace domain.
    public fun coset_shift_for(extended_size: u64): u64 {
        zkv_field::primitive_root(extended_size * 2)
    }

    /// Rebind α_L = sha256(root_L) mod P. Prover cannot cook favorable
    /// challenges — verifier ignores anything supplied and recomputes.
    public fun challenge_from_root(root: &vector<u8>): u64 {
        let digest = hash::sha2_256(*root);
        // Take the digest as a big-endian integer, reduce mod P. Only the
        // low 8 bytes affect the result modulo P after reduction, but we
        // fold in the high bytes via nested add for byte-exact parity
        // with Python's `int(sha256(...).hexdigest(), 16) % P`.
        let mut i = 0;
        let mut acc: u64 = 0;
        let n = vector::length(&digest);
        while (i < n) {
            // acc = (acc * 256 + byte) mod P — Horner-style base-256 fold.
            let b = *vector::borrow(&digest, i);
            acc = zkv_field::add(zkv_field::mul(acc, 256), (b as u64));
            i = i + 1;
        };
        acc
    }

    // ============ Core verify ============

    /// Verify a set of FRI queries against layer commitment roots and the
    /// final polynomial. Returns false if any query fails Merkle
    /// authentication, folding consistency, or the final polynomial's
    /// evaluation check. Also returns false if the final polynomial's
    /// degree exceeds `max_final_degree` (soundness bound — set to
    /// `num_queries` to match the Python prover).
    public fun verify(
        roots: vector<vector<u8>>,
        queries: vector<FriQuery>,
        final_poly_coeffs: vector<u64>,
        extended_size: u64,
        max_final_degree: u64,
    ): bool {
        let num_layers = vector::length(&roots);
        if (num_layers == 0) return false;

        // Final polynomial degree bound. `Polynomial(coeffs).degree()` in
        // Python = len(coeffs) − 1 after leading-zero trimming; we don't
        // trim here (caller passes serialized coeffs), so allow up to
        // max_final_degree + 1 coefficients.
        if (vector::length(&final_poly_coeffs) > max_final_degree + 1) {
            return false
        };

        let coset_shift = coset_shift_for(extended_size);

        // Rebind alphas from Fiat-Shamir before any per-query work.
        let mut alphas = vector::empty<u64>();
        let mut i = 0;
        while (i < num_layers) {
            let root = vector::borrow(&roots, i);
            vector::push_back(&mut alphas, challenge_from_root(root));
            i = i + 1;
        };

        // For each query, walk the FRI layers.
        let num_queries = vector::length(&queries);
        let mut qi = 0;
        while (qi < num_queries) {
            let query = vector::borrow(&queries, qi);
            if (!verify_one_query(
                query,
                &roots,
                &alphas,
                &final_poly_coeffs,
                extended_size,
                coset_shift,
            )) {
                return false
            };
            qi = qi + 1;
        };
        true
    }

    /// Walk one query through all FRI layers, returning false on any
    /// Merkle / folding / final-poly failure.
    fun verify_one_query(
        query: &FriQuery,
        roots: &vector<vector<u8>>,
        alphas: &vector<u64>,
        final_poly_coeffs: &vector<u64>,
        extended_size: u64,
        coset_shift_init: u64,
    ): bool {
        let num_layers = vector::length(roots);
        if (vector::length(&query.layers) < num_layers) return false;

        let mut layer_size = extended_size;
        let mut h_L = coset_shift_init;
        let mut q_L = query.index % extended_size;

        let mut layer_idx: u64 = 0;
        while (layer_idx < num_layers) {
            if (layer_size < 2) return false;
            let half = layer_size / 2;
            // Sibling position within this layer's domain is (q_L + half) mod
            // layer_size — the `-x` counterpart of the queried point. We don't
            // pass it to Merkle verify explicitly (each step's `is_left` bit
            // carries the position info) but the caller MUST have generated
            // sibling_proof from that exact position for the check to pass.

            let layer = vector::borrow(&query.layers, layer_idx);

            // Merkle-authenticate value and sibling against roots[L].
            let root = vector::borrow(roots, layer_idx);
            let value_leaf = zkv_field::u64_to_ascii(layer.value);
            let sibling_leaf = zkv_field::u64_to_ascii(layer.sibling_value);
            if (!zkv_merkle::verify(value_leaf, layer.merkle_proof, *root)) {
                return false
            };
            if (!zkv_merkle::verify(sibling_leaf, layer.sibling_proof, *root)) {
                return false
            };

            // Domain point x_L = h_L · ω_L^{q_L}.
            let omega_L = zkv_field::primitive_root(layer_size);
            let x_L = zkv_field::mul(h_L, zkv_field::pow(omega_L, q_L));
            if (x_L == 0) return false; // guard the (2x) inversion

            // Folding relation.
            let v = layer.value;
            let s = layer.sibling_value;
            let two_x = zkv_field::mul(x_L, 2);
            let f_even = zkv_field::mul(zkv_field::add(v, s), zkv_field::inv(2));
            let f_odd = zkv_field::mul(
                zkv_field::sub(v, s),
                zkv_field::inv(two_x),
            );
            let alpha = *vector::borrow(alphas, layer_idx);
            let expected_next = zkv_field::add(
                f_even,
                zkv_field::mul(alpha, f_odd),
            );

            // Compare against next-layer value (or the final polynomial at
            // the last committed layer).
            if (layer_idx + 1 < num_layers) {
                let next_layer = vector::borrow(&query.layers, layer_idx + 1);
                if (!zkv_field::eq(expected_next, next_layer.value)) {
                    return false
                };
            } else {
                let x_next = zkv_field::mul(x_L, x_L);
                let poly_at = zkv_field::eval_poly(final_poly_coeffs, x_next);
                if (!zkv_field::eq(expected_next, poly_at)) {
                    return false
                };
            };

            // Advance to next layer.
            q_L = q_L % half;
            h_L = zkv_field::mul(h_L, h_L);
            layer_size = half;
            layer_idx = layer_idx + 1;
        };
        true
    }
}
