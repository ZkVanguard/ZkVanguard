//! Hedge-invariant composition verifier.
//!
//! Byte-identical to Python `hedge_invariant_air` +
//! composition-check block in `CUDATrueSTARK.verify_proof`
//! (`zkp/core/cuda_true_stark.py`) and Move `zkv_hedge_air` in
//! `contracts/sui/sources/zkv_hedge_air.move`.
//!
//! Given a trace opening at position q and the FRI-authenticated
//! `H(x_q)`, this crate re-evaluates the row constraints locally on
//! the Merkle-authenticated `T(x_q)` and asserts:
//!
//! ```text
//! H(x_q) == Σ α_j · P_j(T(x_q)) · inv(x_q − ω_trace^{row_j})
//! ```
//!
//! Row constraints (planted at rows 0, 1, 2 of the trace):
//!
//! * `P_0(t) = (t − 1)(t − 2)(t − 3)`         — asset ∈ {1, 2, 3}
//! * `P_1(t) = t (t − 1)`                      — side ∈ {0, 1}
//! * `P_2(t) = ∏_{k=1..cap} (t − k)`           — leverage ∈ {1..cap}
//!
//! `α_j` is rebound from `sha256(trace_merkle_root ‖ "alpha:{j}")` mod
//! P. Attacker cannot cook weights.

#![deny(missing_docs)]
#![deny(unsafe_code)]

use sha2::{Digest, Sha256};
use zkv_field as f;
use zkv_field::u64_to_ascii;
use zkv_merkle::{MerkleProofStep, MerkleTree};

/// Trace opening — Merkle-authenticated view of `T(x_q)`.
#[derive(Clone, Debug)]
pub struct TraceOpening {
    /// Position `q` in the extended coset.
    pub index: u64,
    /// Trace value at that position.
    pub value: u64,
    /// Merkle path against `trace_merkle_root`.
    pub merkle_proof: Vec<MerkleProofStep>,
}

/// `P_0(t) = (t − 1)(t − 2)(t − 3)`.
pub fn eval_asset_constraint(t: u64) -> u64 {
    let a = f::sub(t, 1);
    let b = f::sub(t, 2);
    let c = f::sub(t, 3);
    f::mul(f::mul(a, b), c)
}

/// `P_1(t) = t (t − 1)`.
pub fn eval_side_constraint(t: u64) -> u64 {
    f::mul(t, f::sub(t, 1))
}

/// `P_2(t) = ∏_{k=1..cap} (t − k)`.
///
/// # Panics
/// Panics on `cap == 0` — matches Python + Move behavior.
pub fn eval_leverage_constraint(t: u64, leverage_cap: u64) -> u64 {
    assert!(leverage_cap > 0, "leverage_cap must be positive");
    let mut acc: u64 = 1;
    for k in 1..=leverage_cap {
        acc = f::mul(acc, f::sub(t, k));
    }
    acc
}

/// α_j = sha256(trace_merkle_root ‖ b"alpha:{j}") reduced via base-256
/// Horner fold. Byte-identical to Move `zkv_hedge_air::derive_alpha`
/// and Python's constraint-alpha derivation in
/// `CUDATrueSTARK.verify_proof`.
pub fn derive_alpha(trace_merkle_root: &[u8; 32], j: u64) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(trace_merkle_root);
    hasher.update(b"alpha:");
    hasher.update(u64_to_ascii(j));
    let digest = hasher.finalize();
    let mut acc: u64 = 0;
    for &b in digest.iter() {
        acc = f::add(f::mul(acc, 256), b as u64);
    }
    acc
}

/// Verify one `(trace_opening, H(x_q))` pair — the composition
/// identity at a single FRI query position.
///
/// Returns `true` iff the opening is Merkle-authenticated AND the
/// composition identity holds.
///
/// * `opening.index` — position `q` in the extended coset.
/// * `h_at_x_q` — value of `H(x_q)` as authenticated by FRI layer 0.
///   Caller MUST have already run `zkv_fri::verify` first; if
///   `h_at_x_q` isn't the FRI-authenticated value this check is
///   meaningless.
/// * `trace_merkle_root` — commitment over T on the extended coset.
/// * `extended_size` — |extended coset|.
/// * `trace_length` — |trace domain|.
/// * `leverage_cap` — cap the proof is bound to
///   (`statement.public_inputs[3]`).
pub fn verify_composition_at(
    opening: &TraceOpening,
    h_at_x_q: u64,
    trace_merkle_root: &[u8; 32],
    extended_size: u64,
    trace_length: u64,
    leverage_cap: u64,
) -> bool {
    // Merkle-authenticate T(x_q) against trace_merkle_root.
    let leaf = u64_to_ascii(opening.value);
    if !MerkleTree::verify(&leaf, &opening.merkle_proof, trace_merkle_root) {
        return false;
    }

    // Extended-domain point x_q = coset_shift · ω_e^q.
    let coset_shift = f::primitive_root(extended_size * 2);
    let omega_e = f::primitive_root(extended_size);
    let x_q = f::mul(coset_shift, f::pow(omega_e, opening.index));

    // Row constraint positions in trace domain.
    let omega_trace = f::primitive_root(trace_length);
    let g_row_0: u64 = 1;
    let g_row_1: u64 = omega_trace;
    let g_row_2: u64 = f::mul(omega_trace, omega_trace);

    // Evaluate P_j(T(x_q)).
    let t = opening.value;
    let p0 = eval_asset_constraint(t);
    let p1 = eval_side_constraint(t);
    let p2 = eval_leverage_constraint(t, leverage_cap);

    // Rebind α_j via Fiat-Shamir.
    let alpha_0 = derive_alpha(trace_merkle_root, 0);
    let alpha_1 = derive_alpha(trace_merkle_root, 1);
    let alpha_2 = derive_alpha(trace_merkle_root, 2);

    // Q_j(x_q) = P_j(T(x_q)) · inv(x_q − g^j).
    let denom_0 = f::sub(x_q, g_row_0);
    let denom_1 = f::sub(x_q, g_row_1);
    let denom_2 = f::sub(x_q, g_row_2);
    if denom_0 == 0 || denom_1 == 0 || denom_2 == 0 {
        return false;
    }
    let q0 = f::mul(p0, f::inv(denom_0));
    let q1 = f::mul(p1, f::inv(denom_1));
    let q2 = f::mul(p2, f::inv(denom_2));

    // expected = α_0·Q_0 + α_1·Q_1 + α_2·Q_2
    let sum01 = f::add(f::mul(alpha_0, q0), f::mul(alpha_1, q1));
    let expected = f::add(sum01, f::mul(alpha_2, q2));
    f::eq(h_at_x_q, expected)
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_constraint_vanishes_on_allowed_values() {
        assert_eq!(eval_asset_constraint(1), 0);
        assert_eq!(eval_asset_constraint(2), 0);
        assert_eq!(eval_asset_constraint(3), 0);
    }

    #[test]
    fn asset_constraint_nonzero_on_disallowed() {
        assert_ne!(eval_asset_constraint(0), 0);
        assert_ne!(eval_asset_constraint(4), 0);
        assert_ne!(eval_asset_constraint(99), 0);
    }

    #[test]
    fn side_constraint_vanishes_on_allowed_values() {
        assert_eq!(eval_side_constraint(0), 0);
        assert_eq!(eval_side_constraint(1), 0);
    }

    #[test]
    fn side_constraint_nonzero_on_disallowed() {
        assert_ne!(eval_side_constraint(2), 0);
        assert_ne!(eval_side_constraint(99), 0);
    }

    #[test]
    fn leverage_constraint_vanishes_across_cap_range() {
        for k in 1..=4u64 {
            assert_eq!(eval_leverage_constraint(k, 4), 0, "k={}", k);
        }
    }

    #[test]
    fn leverage_constraint_nonzero_outside_cap() {
        assert_ne!(eval_leverage_constraint(0, 4), 0);
        assert_ne!(eval_leverage_constraint(5, 4), 0);
        assert_ne!(eval_leverage_constraint(999, 4), 0);
    }

    #[test]
    #[should_panic(expected = "leverage_cap must be positive")]
    fn leverage_constraint_zero_cap_panics() {
        eval_leverage_constraint(1, 0);
    }

    #[test]
    fn derive_alpha_deterministic_and_j_dependent() {
        let mut root = [0u8; 32];
        for (i, byte) in root.iter_mut().enumerate() {
            *byte = i as u8;
        }
        let a = derive_alpha(&root, 0);
        let a2 = derive_alpha(&root, 0);
        let b = derive_alpha(&root, 1);
        assert_eq!(a, a2);
        assert_ne!(a, b);
    }
}
