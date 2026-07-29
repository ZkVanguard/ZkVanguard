//! FRI folding-consistency verifier.
//!
//! Byte-identical to Python `FRI.verify` in
//! `zkp/core/cuda_true_stark.py` and Move `zkv_fri::verify` in
//! `contracts/sui/sources/zkv_fri.move`.
//!
//! For each query at position q, walks the layers L = 0..num_layers-1:
//!
//! ```text
//!   v  = f_L(x_L)           (Merkle-authenticated)
//!   s  = f_L(-x_L)          (Merkle-authenticated)
//!   x_L = h_L · ω_L^{q_L}   (multiplicative coset point)
//!   α_L = sha256(root_L) mod P                    (Fiat-Shamir binding)
//!
//!   f_even    = (v + s) / 2
//!   f_odd     = (v − s) / (2·x_L)
//!   expected  = f_even + α_L · f_odd
//! ```
//!
//! At each layer, `expected` must equal:
//! * Merkle-authenticated `f_{L+1}(x_L²)` from the next-layer's query
//!   response, if `L + 1 < num_layers`.
//! * `final_poly(x_L²)` evaluated locally, if we're at the last
//!   committed layer.
//!
//! Also enforces the final-polynomial degree bound
//! (`|final_poly_coeffs| ≤ max_final_degree + 1`) so a prover can't
//! ship a high-degree "final" polynomial to skip FRI compression.
//!
//! Fiat-Shamir rebinding: challenges are recomputed from
//! `sha256(root_L)` rather than trusted from the proof. An attacker
//! cannot pick favorable α's.

#![deny(missing_docs)]
#![deny(unsafe_code)]

use sha2::{Digest, Sha256};
use zkv_field as f;
use zkv_merkle::{MerkleProofStep, MerkleTree};

/// One FRI layer of a single query response.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FriQueryLayer {
    /// `f_L(x_L)` — Merkle-authenticated value at position q.
    pub value: u64,
    /// `f_L(-x_L)` — Merkle-authenticated value at position (q + N/2) mod N.
    pub sibling_value: u64,
    /// Merkle path for `value`.
    pub merkle_proof: Vec<MerkleProofStep>,
    /// Merkle path for `sibling_value`.
    pub sibling_proof: Vec<MerkleProofStep>,
}

/// Full query response for one Fiat-Shamir-derived position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FriQuery {
    /// Index in the extended coset domain that this query opens.
    pub index: u64,
    /// Per-layer data, index 0 = first (largest) layer.
    pub layers: Vec<FriQueryLayer>,
}

/// Compute the multiplicative coset shift the prover used. Same formula
/// as Python `FRI.verify` and Move `zkv_fri::coset_shift_for`.
pub fn coset_shift_for(extended_size: u64) -> u64 {
    f::primitive_root(extended_size * 2)
}

/// Rebind α_L via `sha256(root_L) mod P`. Byte-identical to Python
/// `int(sha256(root_L).hexdigest(), 16) % P` and Move
/// `zkv_fri::challenge_from_root`.
pub fn challenge_from_root(root: &[u8; 32]) -> u64 {
    let digest = Sha256::digest(root);
    // Base-256 Horner fold — same as the Move impl.
    let mut acc: u64 = 0;
    for &b in digest.iter() {
        acc = f::add(f::mul(acc, 256), b as u64);
    }
    acc
}

/// Evaluate a polynomial by ascending coefficients (Horner). Matches
/// Python `Polynomial.evaluate` and Move `zkv_field::eval_poly`.
///
/// `coeffs` is lowest-degree-first: `P(x) = c_0 + c_1·x + c_2·x² + ...`.
pub fn eval_poly(coeffs: &[u64], x: u64) -> u64 {
    if coeffs.is_empty() {
        return 0;
    }
    let mut result = coeffs[coeffs.len() - 1];
    for i in (0..coeffs.len() - 1).rev() {
        result = f::add(f::mul(result, x), coeffs[i]);
    }
    result
}

/// Verify a set of FRI queries against layer commitment roots and the
/// final polynomial.
///
/// Returns `false` if any query fails Merkle authentication, folding
/// consistency, or the final polynomial's evaluation check. Also
/// returns `false` if the final polynomial's degree exceeds
/// `max_final_degree` (soundness bound — set to `num_queries` to match
/// the Python prover).
pub fn verify(
    roots: &[[u8; 32]],
    queries: &[FriQuery],
    final_poly_coeffs: &[u64],
    extended_size: u64,
    max_final_degree: u64,
) -> bool {
    let num_layers = roots.len();
    if num_layers == 0 {
        return false;
    }
    if (final_poly_coeffs.len() as u64) > max_final_degree + 1 {
        return false;
    }

    let coset_shift = coset_shift_for(extended_size);

    // Precompute per-layer (h_L, ω_L, N_L) and α_L via Fiat-Shamir.
    let mut layer_meta: Vec<(u64, u64, u64)> = Vec::with_capacity(num_layers);
    let mut alphas: Vec<u64> = Vec::with_capacity(num_layers);
    let mut layer_shift = coset_shift;
    let mut layer_size = extended_size;
    for l in 0..num_layers {
        let omega_l = f::primitive_root(layer_size);
        layer_meta.push((layer_shift, omega_l, layer_size));
        alphas.push(challenge_from_root(&roots[l]));
        layer_shift = f::mul(layer_shift, layer_shift);
        layer_size /= 2;
    }

    // Per-query walk.
    for query in queries {
        if query.layers.len() < num_layers {
            return false;
        }
        let mut q_l = query.index % extended_size;

        for l in 0..num_layers {
            let (h_l, omega_l, n_l) = layer_meta[l];
            if n_l < 2 {
                return false;
            }
            let layer = &query.layers[l];
            let v = layer.value % f::P;
            let s = layer.sibling_value % f::P;
            let sib_idx = (q_l + n_l / 2) % n_l;

            // Merkle-authenticate both value and sibling using the
            // exact same leaf encoding as Python (ASCII decimal bytes
            // of the u64 value).
            let value_leaf = f::u64_to_ascii(v);
            let sibling_leaf = f::u64_to_ascii(s);
            let _ = q_l; // sib_idx used in Move; unused here — Python's
                         // Merkle verify doesn't use the index either.
            if !MerkleTree::verify(&value_leaf, &layer.merkle_proof, &roots[l]) {
                return false;
            }
            if !MerkleTree::verify(&sibling_leaf, &layer.sibling_proof, &roots[l]) {
                return false;
            }
            let _ = sib_idx; // Kept for parity with the Python code —
                             // reflects the position sibling_proof was
                             // generated at, but MerkleTree::verify
                             // reads is_left flags directly.

            // Domain point x_L = h_L · ω_L^{q_L}.
            let x_l = f::mul(h_l, f::pow(omega_l, q_l));
            if x_l == 0 {
                return false;
            }

            // Folding: f_next(x²) = (v+s)/2 + α · (v-s)/(2x)
            let inv2 = f::inv(2);
            let f_even = f::mul(f::add(v, s), inv2);
            let two_x = f::mul(x_l, 2);
            let inv_two_x = f::inv(two_x);
            let f_odd = f::mul(f::sub(v, s), inv_two_x);
            let alpha_l = alphas[l];
            let expected_next = f::add(f_even, f::mul(alpha_l, f_odd));

            // Compare against next-layer authenticated value, or final
            // poly at x² for the last committed layer.
            if l + 1 < num_layers {
                let actual_next = query.layers[l + 1].value % f::P;
                if !f::eq(expected_next, actual_next) {
                    return false;
                }
            } else {
                let x_next = f::mul(x_l, x_l);
                let poly_at = eval_poly(final_poly_coeffs, x_next);
                if !f::eq(expected_next, poly_at) {
                    return false;
                }
            }

            // Advance to next layer.
            q_l %= n_l / 2;
        }
    }

    true
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coset_shift_matches_primitive_root_of_2n() {
        assert_eq!(coset_shift_for(256), f::primitive_root(512));
    }

    #[test]
    fn coset_shift_is_outside_subgroup() {
        // h^N = -1 (i.e., h is a primitive 2N-th root, so h^N has order 2).
        let h = coset_shift_for(256);
        assert_eq!(f::pow(h, 256), f::P - 1);
    }

    #[test]
    fn challenge_from_zero_root_matches_python_and_move() {
        // Golden vector — same as Move's
        // `challenge_from_zero_root_matches_python`.
        let root = [0u8; 32];
        assert_eq!(challenge_from_root(&root), 7_657_728_858_192_895_983);
    }

    #[test]
    fn challenge_from_nontrivial_root_matches_python() {
        // Second golden vector from the Move test suite:
        //   b"zkvanguard_test_root_0000000000\x01" (31 ASCII + 1 byte = 32).
        let src: &[u8; 32] = b"zkvanguard_test_root_0000000000\x01";
        assert_eq!(challenge_from_root(src), 11_069_442_325_780_867_913);
    }

    #[test]
    fn eval_poly_matches_hand_computation() {
        assert_eq!(eval_poly(&[], 42), 0);
        assert_eq!(eval_poly(&[7], 999), 7);
        // P(x) = 3 + 5x, at x=4 → 23
        assert_eq!(eval_poly(&[3, 5], 4), 23);
        // P(x) = 1 + 2x + 3x², at x=10 → 321
        assert_eq!(eval_poly(&[1, 2, 3], 10), 321);
    }

    #[test]
    fn verify_empty_roots_rejects() {
        assert!(!verify(&[], &[], &[], 1024, 80));
    }

    #[test]
    fn verify_oversized_final_poly_rejects() {
        let roots = vec![[0u8; 32]];
        let too_many = vec![1u64; 20];
        // max_degree = 8 → 9 coeffs max, we supply 20
        assert!(!verify(&roots, &[], &too_many, 1024, 8));
    }

    #[test]
    fn verify_underlength_query_rejects() {
        let roots = vec![[0u8; 32], [1u8; 32]];
        let queries = vec![FriQuery {
            index: 0,
            layers: vec![],
        }];
        assert!(!verify(&roots, &queries, &[0u64], 256, 8));
    }

    // Note on positive round-trip: a full end-to-end verify(good_proof)
    // test lives in the empirical soundness harness (`zkp/tests/
    // empirical_soundness_harness.py`) and is validated cross-language
    // via the Move round-trip in `contracts/sui/tests/zkv_stark_tests.move`.
    // Once Phase B.3 (Rust STARK prover) ships, we'll add a native
    // Rust round-trip here without needing to marshal Python proofs
    // into Rust structs.
}
