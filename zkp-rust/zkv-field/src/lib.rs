//! Goldilocks finite-field arithmetic.
//!
//! Field: `p = 2^64 - 2^32 + 1 = 18_446_744_069_414_584_321`.
//!
//! This crate is the Rust port of the Python `CUDAFiniteField` in
//! `zkp/core/cuda_true_stark.py` and the Move `zkv_field` in
//! `contracts/sui/sources/zkv_field.move`. All three MUST produce
//! byte-identical output on identical inputs; that's the whole point.
//! Any drift breaks the browser prover (Phase C) and the on-chain
//! verifier round-trip.
//!
//! Design notes:
//! * `p < 2^64`, so a field element fits in a single `u64`.
//! * `(p-1)^2 < 2^128`, so `mul` uses a `u128` intermediate.
//! * FFT-friendly: `p - 1 = 2^32 * (2^32 - 1)`, so 2^k-th roots of unity
//!   exist for every `k <= 32`. Needed by FRI.
//! * Field generator: `g = 7` (matches Python + Move).
//! * Post-quantum: security comes from SHA-256, not field size — see
//!   `docs/ZK_ROADMAP.md`. This crate has no elliptic curve, no DLP,
//!   no pairings.

#![deny(missing_docs)]
#![deny(unsafe_code)]

/// Goldilocks prime.
pub const P: u64 = 18_446_744_069_414_584_321;

/// Field multiplicative generator (matches Python `CUDAFiniteField.generator`).
pub const G: u64 = 7;

/// Reduce a `u128` to a `u64` field element modulo `P`.
///
/// Safe because `P < 2^64`, so `x % P` fits in `u64`.
#[inline]
pub fn reduce(x: u128) -> u64 {
    (x % (P as u128)) as u64
}

/// Field addition.
#[inline]
pub fn add(a: u64, b: u64) -> u64 {
    reduce((a as u128) + (b as u128))
}

/// Field subtraction. Handles underflow: if `a < b`, wraps via `P - (b - a)`.
#[inline]
pub fn sub(a: u64, b: u64) -> u64 {
    let a = a % P;
    let b = b % P;
    if a >= b {
        a - b
    } else {
        P - (b - a)
    }
}

/// Field multiplication.
#[inline]
pub fn mul(a: u64, b: u64) -> u64 {
    reduce((a as u128) * (b as u128))
}

/// Field negation. `neg(0) = 0`, otherwise `P - a`.
#[inline]
pub fn neg(a: u64) -> u64 {
    let a = a % P;
    if a == 0 {
        0
    } else {
        P - a
    }
}

/// Modular exponentiation via square-and-multiply. `base^exp mod P`.
pub fn pow(base: u64, mut exp: u64) -> u64 {
    let mut result: u64 = 1;
    let mut b: u64 = base % P;
    while exp > 0 {
        if exp & 1 == 1 {
            result = mul(result, b);
        }
        b = mul(b, b);
        exp >>= 1;
    }
    result
}

/// Multiplicative inverse via Fermat's little theorem: `a^(P-2) mod P`.
///
/// # Panics
/// Panics if `a == 0` (mod P) — matches Python `CUDAFiniteField.inv`.
pub fn inv(a: u64) -> u64 {
    assert!(a % P != 0, "cannot invert zero");
    pow(a, P - 2)
}

/// Field division: `a / b = a * inv(b)`.
pub fn div(a: u64, b: u64) -> u64 {
    mul(a, inv(b))
}

/// Equality after reduction.
#[inline]
pub fn eq(a: u64, b: u64) -> bool {
    (a % P) == (b % P)
}

/// Primitive N-th root of unity: `g^((P-1) / order) mod P`.
///
/// # Panics
/// Panics if `order == 0` or `order` does not divide `P - 1`. Matches
/// Python `CUDAFiniteField.get_primitive_root` and Move
/// `zkv_field::primitive_root`.
///
/// For extended domains used by FRI, `order` is always a power of 2
/// dividing `2^32`, so the divisibility check trivially holds.
pub fn primitive_root(order: u64) -> u64 {
    assert!(order > 0, "order must be positive");
    let p_minus_1: u64 = P - 1;
    assert!(p_minus_1 % order == 0, "order must divide P - 1");
    pow(G, p_minus_1 / order)
}

/// Encode a `u64` as its ASCII-decimal byte representation ("42" → `[0x34, 0x32]`).
///
/// Byte-identical to Python `str(int_value).encode()` for values in
/// `[0, 2^64)`. Used by the Merkle leaf preimage — FRI query values are
/// `u64` but hash as ASCII decimal bytes.
pub fn u64_to_ascii(mut v: u64) -> Vec<u8> {
    if v == 0 {
        return vec![b'0'];
    }
    let mut buf = Vec::with_capacity(20);
    while v > 0 {
        buf.push(b'0' + (v % 10) as u8);
        v /= 10;
    }
    buf.reverse();
    buf
}

// ============================================================
// Tests — mirror the Move test module in
// `contracts/sui/tests/zkv_stark_tests.move`.
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    const P_MINUS_1: u64 = P - 1;

    // ---------- Prime + identity ----------

    #[test]
    fn add_zero_is_identity() {
        assert_eq!(add(0, 42), 42);
        assert_eq!(add(42, 0), 42);
    }

    #[test]
    fn add_wraps_at_prime() {
        assert_eq!(add(P_MINUS_1, 1), 0);
        assert_eq!(add(P_MINUS_1, 2), 1);
    }

    #[test]
    fn add_handles_max_u64_operands() {
        let expected = P - 10;
        assert_eq!(add(P_MINUS_1 - 4, P_MINUS_1 - 4), expected);
    }

    // ---------- Sub ----------

    #[test]
    fn sub_basic() {
        assert_eq!(sub(10, 3), 7);
        assert_eq!(sub(5, 5), 0);
    }

    #[test]
    fn sub_underflow_wraps_to_prime() {
        assert_eq!(sub(3, 10), P - 7);
    }

    // ---------- Mul ----------

    #[test]
    fn mul_basic() {
        assert_eq!(mul(6, 7), 42);
        assert_eq!(mul(0, 999), 0);
        assert_eq!(mul(1, 999), 999);
    }

    #[test]
    fn mul_handles_full_range() {
        // (-1) * (-1) = 1
        assert_eq!(mul(P_MINUS_1, P_MINUS_1), 1);
    }

    // ---------- Neg ----------

    #[test]
    fn neg_zero_is_zero() {
        assert_eq!(neg(0), 0);
    }

    #[test]
    fn neg_and_add_cancels() {
        let a: u64 = 12345;
        assert_eq!(add(a, neg(a)), 0);
    }

    // ---------- Pow ----------

    #[test]
    fn pow_zero_is_one() {
        assert_eq!(pow(7, 0), 1);
    }

    #[test]
    fn pow_one_is_base() {
        assert_eq!(pow(7, 1), 7);
    }

    #[test]
    fn pow_matches_hand_computation() {
        assert_eq!(pow(3, 5), 243);
        assert_eq!(pow(2, 10), 1024);
    }

    #[test]
    fn pow_p_minus_1_is_one() {
        // Fermat: a^(p-1) = 1 for a != 0.
        assert_eq!(pow(7, P_MINUS_1), 1);
        assert_eq!(pow(12345, P_MINUS_1), 1);
    }

    // ---------- Inv + Div ----------

    #[test]
    fn inv_then_mul_yields_one() {
        assert_eq!(mul(7, inv(7)), 1);
        assert_eq!(mul(99999, inv(99999)), 1);
    }

    #[test]
    #[should_panic(expected = "cannot invert zero")]
    fn inv_zero_panics() {
        inv(0);
    }

    #[test]
    fn div_matches_mul_inv() {
        assert_eq!(div(42, 6), 7);
    }

    #[test]
    fn eq_reduces_before_comparing() {
        assert!(eq(0, 0));
        assert!(eq(P, 0));
    }

    // ---------- Primitive roots ----------

    #[test]
    fn primitive_root_of_order_2_is_p_minus_1() {
        assert_eq!(primitive_root(2), P_MINUS_1);
    }

    #[test]
    fn primitive_root_of_order_4_has_order_4() {
        let r = primitive_root(4);
        assert_eq!(pow(r, 4), 1);
        assert_ne!(pow(r, 2), 1);
    }

    // ---------- u64_to_ascii ----------

    #[test]
    fn u64_to_ascii_zero() {
        assert_eq!(u64_to_ascii(0), b"0");
    }

    #[test]
    fn u64_to_ascii_small() {
        assert_eq!(u64_to_ascii(7), b"7");
        assert_eq!(u64_to_ascii(42), b"42");
    }

    #[test]
    fn u64_to_ascii_max_u64() {
        assert_eq!(u64_to_ascii(u64::MAX), b"18446744073709551615");
    }

    // ============================================================
    // CROSS-LANGUAGE GOLDEN VECTORS
    //
    // Same inputs → same outputs in Python `CUDAFiniteField`, Move
    // `zkv_field`, and this Rust crate. If any of these constants
    // drift, every downstream cross-language test fails loud.
    //
    // Generated from Python:
    //   >>> from zkp.core.cuda_true_stark import CUDAFiniteField
    //   >>> f = CUDAFiniteField()
    //   >>> f.mul(12345, 67890), f.pow(7, 100), f.inv(42)
    // ============================================================

    #[test]
    fn cross_lang_mul_medium_values() {
        // 12345 * 67890 = 838,102,050 — well below P, so reduces to itself.
        assert_eq!(mul(12345, 67890), 838_102_050);
    }

    #[test]
    fn cross_lang_pow_7_100() {
        // 7^100 mod P — computed by Python `pow(7, 100, P)`.
        assert_eq!(pow(7, 100), 2_335_214_203_647_002_900);
    }

    #[test]
    fn cross_lang_primitive_root_1024() {
        // ω_1024 = g^((P-1)/1024). Used at FRI extended_size = 1024.
        // Computed by Python `pow(7, (P-1)//1024, P)`.
        assert_eq!(primitive_root(1024), 11_353_340_290_879_379_826);
        // Also verify the algebraic property: ω^1024 = 1 and ω^512 = P - 1.
        let omega = primitive_root(1024);
        assert_eq!(pow(omega, 1024), 1);
        assert_eq!(pow(omega, 512), P_MINUS_1);
    }
}
