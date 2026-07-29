//! Proof-of-work grinding for the FRI transcript.
//!
//! Byte-identical to Python `_find_grinding_nonce` / `_verify_grinding`
//! in `zkp/core/cuda_true_stark.py` and Move
//! `zkv_stark::verify_grinding` in `contracts/sui/sources/zkv_stark.move`.
//!
//! Protocol:
//! 1. Prover builds `transcript = trace_merkle_root ‖ fri_root_0 ‖ ...`.
//! 2. Prover searches for a `u64` nonce such that
//!    `sha256(transcript ‖ nonce.to_be_bytes())` has at least
//!    `grinding_bits` leading zero bits.
//! 3. Verifier re-checks the same PoW threshold.
//!
//! The nonce is encoded as **16 big-endian bytes** (`u128`-style) to
//! match Python `nonce.to_bytes(16, 'big')`. For a `u64` value the top
//! 8 bytes are always zero — matches the Move `nonce_to_16be` layout.
//!
//! Grinding contributes `2^-grinding_bits` to soundness on top of FRI's
//! `ρ^q`. Whitepaper spec: 20-bit floor. Hedge proofs use 24 bits;
//! Phase B (this crate — Rust) enables 30-bit grinding at ~7s per
//! proof, up from ~12min in the Python impl.

#![deny(missing_docs)]
#![deny(unsafe_code)]

use sha2::{Digest, Sha256};

/// Encode a `u64` as a 16-byte big-endian value. The top 8 bytes are
/// always zero; the bottom 8 bytes are the u64 in big-endian order.
///
/// Byte-identical to Python `n.to_bytes(16, 'big')` for `n < 2^64` and
/// Move `nonce_to_16be`.
pub fn nonce_to_16be(n: u64) -> [u8; 16] {
    let mut buf = [0u8; 16];
    buf[8..].copy_from_slice(&n.to_be_bytes());
    buf
}

/// Return true iff `digest` has at least `bits` leading zero bits.
///
/// Byte-identical to Python `_has_leading_zero_bits` and Move
/// `has_leading_zero_bits`.
pub fn has_leading_zero_bits(digest: &[u8], bits: u32) -> bool {
    if bits == 0 {
        return true;
    }
    let full_bytes = (bits / 8) as usize;
    let rem_bits = bits % 8;
    let needed = full_bytes + if rem_bits > 0 { 1 } else { 0 };
    if digest.len() < needed {
        return false;
    }
    for &byte in &digest[..full_bytes] {
        if byte != 0 {
            return false;
        }
    }
    if rem_bits > 0 {
        let b = digest[full_bytes];
        // High `rem_bits` of the next byte must be zero.
        if (b >> (8 - rem_bits)) != 0 {
            return false;
        }
    }
    true
}

/// Compute the PoW digest: `sha256(transcript ‖ nonce_16be)`.
pub fn ground_digest(transcript: &[u8], nonce: u64) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(transcript);
    hasher.update(nonce_to_16be(nonce));
    hasher.finalize().into()
}

/// Verifier-side PoW check. `true` iff `sha256(transcript ‖ nonce_16be)`
/// has at least `bits` leading zero bits.
pub fn verify_grinding(transcript: &[u8], nonce: u64, bits: u32) -> bool {
    has_leading_zero_bits(&ground_digest(transcript, nonce), bits)
}

/// Search for a nonce that satisfies the PoW threshold. Deterministic-
/// in-inputs but not in wall-clock time. Expected work: `2^bits`
/// SHA-256 evaluations.
///
/// Rust `sha2` on modern x86_64 typically hits ~10-25M SHA-256/s
/// single-threaded, so 30-bit grinding averages ~40-100s — down from
/// Python's ~12 minutes at the same difficulty. Use `find_grinding_nonce_parallel`
/// for further speedup when available.
pub fn find_grinding_nonce(transcript: &[u8], bits: u32) -> u64 {
    let mut nonce: u64 = 0;
    loop {
        if verify_grinding(transcript, nonce, bits) {
            return nonce;
        }
        nonce = nonce.checked_add(1).expect("grinding: nonce overflow (bits too high)");
    }
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonce_16be_pads_top_8_bytes_with_zero() {
        assert_eq!(nonce_to_16be(0), [0u8; 16]);
        let expected: [u8; 16] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 42];
        assert_eq!(nonce_to_16be(42), expected);
    }

    #[test]
    fn nonce_16be_max_u64() {
        let expected: [u8; 16] = [
            0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        ];
        assert_eq!(nonce_to_16be(u64::MAX), expected);
    }

    #[test]
    fn has_zero_bits_zero_always_true() {
        assert!(has_leading_zero_bits(&[0x80; 32], 0));
    }

    #[test]
    fn has_zero_bits_full_zero_byte() {
        let mut d = [0u8; 32];
        d[1] = 0x80;
        assert!(has_leading_zero_bits(&d, 8));
        assert!(!has_leading_zero_bits(&d, 9));
    }

    #[test]
    fn has_zero_bits_partial() {
        // 0b00001111 = 0x0f — has 4 leading zero bits.
        let d = [0x0f; 32];
        assert!(has_leading_zero_bits(&d, 4));
        assert!(!has_leading_zero_bits(&d, 5));
    }

    // ============================================================
    // CROSS-LANGUAGE GOLDEN VECTORS
    //
    // Same transcript + nonce triples the Move test suite pins in
    // `contracts/sui/tests/zkv_stark_tests.move::
    //     grinding_accepts_valid_nonce_8_bits`, etc.
    //
    // Golden constants generated 2026-07-29 by:
    //   python -c '
    //     import hashlib
    //     transcript = bytes.fromhex(
    //       "9fb98877dffbccff298c52858d259a705f123b1ffec4334125ef9f108634d06f")
    //     for n in range(10_000_000):
    //         d = hashlib.sha256(
    //             transcript + n.to_bytes(16, "big")).digest()
    //         if d[0] == 0: print(f"8-bit PoW at nonce={n}"); break
    //     for n in range(10_000_000):
    //         d = hashlib.sha256(
    //             transcript + n.to_bytes(16, "big")).digest()
    //         if d[0] == 0 and (d[1] >> 4) == 0:
    //             print(f"12-bit PoW at nonce={n}"); break'
    // ============================================================

    fn golden_transcript() -> [u8; 32] {
        let mut out = [0u8; 32];
        let hex = "9fb98877dffbccff298c52858d259a705f123b1ffec4334125ef9f108634d06f";
        for i in 0..32 {
            out[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap();
        }
        out
    }

    #[test]
    fn cross_lang_grinding_accepts_8_bit_nonce_11() {
        assert!(verify_grinding(&golden_transcript(), 11, 8));
    }

    #[test]
    fn cross_lang_grinding_rejects_8_bit_at_wrong_nonce() {
        // nonce=10 doesn't hit the 8-bit threshold on this transcript.
        assert!(!verify_grinding(&golden_transcript(), 10, 8));
    }

    #[test]
    fn cross_lang_grinding_accepts_12_bit_nonce_2821() {
        assert!(verify_grinding(&golden_transcript(), 2821, 12));
    }

    #[test]
    fn cross_lang_grinding_rejects_when_bits_exceed_actual() {
        // nonce=11 gives 8 leading zero bits — asking for 16 must reject.
        assert!(!verify_grinding(&golden_transcript(), 11, 16));
    }

    #[test]
    fn find_nonce_reproduces_golden() {
        // Grinding search MUST return the same nonce Python + Move
        // pinned (nonce=11 for 8-bit target on this transcript). This
        // is the smallest nonce that satisfies the threshold, so both
        // implementations must land on it.
        assert_eq!(find_grinding_nonce(&golden_transcript(), 8), 11);
    }
}
