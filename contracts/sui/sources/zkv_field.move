/// Goldilocks field arithmetic for the on-chain STARK verifier.
///
/// Field: p = 2^64 - 2^32 + 1 = 18446744069414584321
///
/// The Goldilocks prime is used by CUDATrueSTARK (see zkp/core/cuda_true_stark.py
/// CUDAFiniteField). Same prime as Polygon zkEVM / Plonky2. Chosen because:
///
///   1. FFT-friendly: p - 1 = 2^32 * (2^32 - 1) has a large 2-adic subgroup,
///      so roots of unity of every 2^k for k <= 32 exist. (Only matters to
///      the prover, not this verifier.)
///   2. Fits in u64: p < 2^64, so every element is a single u64.
///   3. Products fit in u128: (p-1)^2 ≈ 2^128, so `mul` needs u128 intermediates.
///   4. Post-quantum secure: PQ security comes from SHA-256 collision
///      resistance, not field size — see docs/ZK_ROADMAP.md.
///
/// This module MUST behave byte-identically to Python `CUDAFiniteField` on the
/// same inputs. Any deviation breaks proof verification.
module zkvanguard::zkv_field {

    /// Goldilocks prime.
    const P: u64 = 18446744069414584321;

    /// Public getter — used by tests + external callers that need to know
    /// which prime a proof was made over (must match `proof.field_prime`).
    public fun prime(): u64 { P }

    /// Reduce a u128 to a u64 field element modulo P. `x % (P as u128)` is
    /// guaranteed to fit in u64 because P < 2^64.
    fun reduce(x: u128): u64 {
        ((x % (P as u128)) as u64)
    }

    /// Field addition. `a + b` can overflow u64 (both operands can be
    /// nearly P), so widen to u128 before reducing.
    public fun add(a: u64, b: u64): u64 {
        reduce((a as u128) + (b as u128))
    }

    /// Field subtraction. Handle the underflow case explicitly instead of
    /// relying on modular wrap; Move u64 subtraction with a < b aborts.
    public fun sub(a: u64, b: u64): u64 {
        let a = a % P;
        let b = b % P;
        if (a >= b) {
            a - b
        } else {
            P - (b - a)
        }
    }

    /// Field multiplication. Product can reach (P-1)^2 ≈ 2^128, so use u128.
    public fun mul(a: u64, b: u64): u64 {
        reduce((a as u128) * (b as u128))
    }

    /// Field negation. `neg(0) = 0`, otherwise `P - a`.
    public fun neg(a: u64): u64 {
        let a = a % P;
        if (a == 0) { 0 } else { P - a }
    }

    /// Modular exponentiation via square-and-multiply. `base^exp mod P`.
    /// Used both directly (roots of unity, coset shift) and by `inv`
    /// (via Fermat's little theorem).
    public fun pow(base: u64, exp: u64): u64 {
        let mut result: u64 = 1;
        let mut b: u64 = base % P;
        let mut e: u64 = exp;
        while (e > 0) {
            if (e & 1 == 1) {
                result = mul(result, b);
            };
            b = mul(b, b);
            e = e >> 1;
        };
        result
    }

    /// Multiplicative inverse via Fermat's little theorem: `a^(P-2) mod P`.
    /// Aborts on `a == 0` (matches Python `CUDAFiniteField.inv`).
    public fun inv(a: u64): u64 {
        assert!(a % P != 0, 0);
        pow(a, P - 2)
    }

    /// Field division: `a / b = a * inv(b)`.
    public fun div(a: u64, b: u64): u64 {
        mul(a, inv(b))
    }

    /// Equality after reduction. Callers passing values > P get a
    /// meaningful compare instead of a spurious mismatch.
    public fun eq(a: u64, b: u64): bool {
        (a % P) == (b % P)
    }

    /// Encode a u64 as its ASCII-decimal byte representation ("42" → 0x3432).
    ///
    /// Byte-identical to Python `str(int_value).encode()` for values in
    /// [0, 2^64). Merkle leaves in FRI query responses are exactly this
    /// encoding, so this is how the on-chain verifier reconstructs the
    /// leaf preimage before hashing (matches `str(e).encode()` in
    /// `MerkleTree(leaves=[str(e).encode() for e in extended_evaluations])`).
    public fun u64_to_ascii(mut v: u64): vector<u8> {
        if (v == 0) {
            return b"0"
        };
        let mut buf = vector::empty<u8>();
        while (v > 0) {
            // 48 = '0'
            std::vector::push_back(&mut buf, ((v % 10) as u8) + 48);
            v = v / 10;
        };
        std::vector::reverse(&mut buf);
        buf
    }

    /// Horner evaluation of a polynomial with the given coefficients
    /// (lowest degree first) at point `x`. Matches Python `Polynomial.evaluate`.
    ///
    ///     P(x) = c_0 + c_1·x + c_2·x² + ... + c_{n-1}·x^{n-1}
    ///
    /// Empty coefficient list evaluates to 0 (matches Python 0-poly).
    public fun eval_poly(coeffs: &vector<u64>, x: u64): u64 {
        let n = std::vector::length(coeffs);
        if (n == 0) return 0;
        let mut result: u64 = *std::vector::borrow(coeffs, n - 1);
        let mut i = n - 1;
        while (i > 0) {
            i = i - 1;
            result = add(mul(result, x), *std::vector::borrow(coeffs, i));
        };
        result
    }

    /// Primitive N-th root of unity in Goldilocks: `g^((P-1) / order) mod P`
    /// where g = 7 is the field generator. `order` MUST divide `P-1`
    /// (aborts otherwise). Matches Python `CUDAFiniteField.get_primitive_root`.
    ///
    /// For extended domains used by FRI, `order` is always a power of 2
    /// dividing 2^32, so the divisibility check trivially holds.
    public fun primitive_root(order: u64): u64 {
        assert!(order > 0, 1);
        let p_minus_1: u64 = P - 1;
        assert!(p_minus_1 % order == 0, 2);
        pow(7, p_minus_1 / order)
    }
}
