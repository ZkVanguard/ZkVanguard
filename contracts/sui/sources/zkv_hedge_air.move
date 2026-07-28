/// Hedge-invariant composition check for the on-chain STARK verifier.
///
/// Mirrors the composition-polynomial verification in Python
/// `CUDATrueSTARK.verify_proof` (zkp/core/cuda_true_stark.py) for
/// `zkv-hedge-v1` claims. Given a trace-domain query at position q, the
/// prover commits H(x_q) via FRI (checked by zkv_fri) and the verifier
/// re-evaluates the composition locally on the Merkle-authenticated
/// trace value T(x_q):
///
///   H(x_q) == Σ α_j · P_j(T(x_q)) · inv(x_q − ω_trace^{row_j})
///
/// The three row constraints (planted at rows 0, 1, 2 of the trace):
///
///   P_0(t) = (t − 1)(t − 2)(t − 3)             — asset ∈ {1, 2, 3}
///   P_1(t) = t (t − 1)                          — side  ∈ {0, 1}
///   P_2(t) = ∏_{k=1..cap} (t − k)               — leverage ∈ {1..cap}
///
/// α_j is rebound from `sha256(trace_merkle_root ‖ "alpha:{j}")` mod P
/// — matches Python's constraint-alpha derivation. Attacker cannot cook
/// weights.
///
/// Depends on: zkv_field (Goldilocks arithmetic), zkv_merkle (trace
/// opening authentication).
module zkvanguard::zkv_hedge_air {
    use std::hash;
    use std::vector;
    use zkvanguard::zkv_field;
    use zkvanguard::zkv_merkle::{Self, MerkleProofStep};

    /// One trace opening — the prover's authenticated view of T(x_q) at
    /// FRI query position `index` in the extended coset domain. Ships
    /// alongside its Merkle path against `trace_merkle_root`.
    public struct TraceOpening has copy, drop, store {
        index: u64,
        value: u64,
        merkle_proof: vector<MerkleProofStep>,
    }

    public fun new_opening(
        index: u64,
        value: u64,
        merkle_proof: vector<MerkleProofStep>,
    ): TraceOpening {
        TraceOpening { index, value, merkle_proof }
    }

    /// Public accessor — needed by zkv_stark to cross-check that each
    /// trace opening is paired with a same-position FRI query.
    public fun opening_index(o: &TraceOpening): u64 { o.index }

    /// Public accessor — trace value T(x_q). Used by tests and by any
    /// external caller that wants to log which value was committed at
    /// the queried position.
    public fun opening_value(o: &TraceOpening): u64 { o.value }

    // ============ Row constraint evaluators ============
    //
    // Each row constraint is a fixed low-degree polynomial identity that
    // must vanish at the row's trace value if the hedge invariant holds.
    // Prover embeds the actual asset/side/leverage values at those rows;
    // verifier re-evaluates the constraint here.

    /// P_0(t) = (t − 1)(t − 2)(t − 3). Vanishes iff t ∈ {1, 2, 3}
    /// (asset code ∈ {BTC, ETH, SUI}).
    public fun eval_asset_constraint(t: u64): u64 {
        let a = zkv_field::sub(t, 1);
        let b = zkv_field::sub(t, 2);
        let c = zkv_field::sub(t, 3);
        zkv_field::mul(zkv_field::mul(a, b), c)
    }

    /// P_1(t) = t(t − 1). Vanishes iff t ∈ {0, 1} (side ∈ {LONG, SHORT}).
    public fun eval_side_constraint(t: u64): u64 {
        zkv_field::mul(t, zkv_field::sub(t, 1))
    }

    /// P_2(t) = ∏_{k=1..cap} (t − k). Vanishes iff t ∈ {1..cap}.
    /// Aborts on cap == 0 (prover would never legitimately pass cap == 0).
    public fun eval_leverage_constraint(t: u64, leverage_cap: u64): u64 {
        assert!(leverage_cap > 0, 3);
        let mut acc: u64 = 1;
        let mut k: u64 = 1;
        while (k <= leverage_cap) {
            acc = zkv_field::mul(acc, zkv_field::sub(t, k));
            k = k + 1;
        };
        acc
    }

    // ============ Fiat-Shamir alpha derivation ============

    /// α_j = sha256(trace_merkle_root ‖ "alpha:{j}") reduced via base-256
    /// Horner fold (byte-identical to Python's
    /// `int(sha256(...).hexdigest(), 16) % P`).
    public fun derive_alpha(trace_merkle_root: &vector<u8>, j: u64): u64 {
        let mut buf = *trace_merkle_root;
        // Append b"alpha:" then the ASCII decimal of j.
        let prefix = b"alpha:";
        vector::append(&mut buf, prefix);
        let j_ascii = zkv_field::u64_to_ascii(j);
        vector::append(&mut buf, j_ascii);
        let digest = hash::sha2_256(buf);

        let mut acc: u64 = 0;
        let mut i = 0;
        let n = vector::length(&digest);
        while (i < n) {
            let b = *vector::borrow(&digest, i);
            acc = zkv_field::add(zkv_field::mul(acc, 256), (b as u64));
            i = i + 1;
        };
        acc
    }

    // ============ Composition check ============

    /// Verify one (trace_opening, H(x_q)) pair — the core composition
    /// identity at a single FRI query position.
    ///
    /// Arguments:
    ///   * `opening` — Merkle-authenticated view of T(x_q) at position q.
    ///   * `h_at_x_q` — Value of H(x_q) as authenticated by FRI layer 0.
    ///     Caller MUST have run zkv_fri::verify first; if `h_at_x_q` is
    ///     not the FRI-authenticated value, this check is meaningless.
    ///   * `trace_merkle_root` — Merkle commitment over T on the
    ///     extended coset.
    ///   * `extended_size` — |extended coset| (== extended_trace_length).
    ///   * `trace_length` — |trace domain|; ω_trace = primitive_root(trace_length).
    ///   * `leverage_cap` — cap the proof is bound to (statement.public_inputs[3]).
    ///
    /// Returns true iff the opening is Merkle-authenticated AND the
    /// composition identity holds.
    public fun verify_composition_at(
        opening: &TraceOpening,
        h_at_x_q: u64,
        trace_merkle_root: &vector<u8>,
        extended_size: u64,
        trace_length: u64,
        leverage_cap: u64,
    ): bool {
        // Merkle-authenticate T(x_q) against trace_merkle_root.
        let leaf = zkv_field::u64_to_ascii(opening.value);
        if (!zkv_merkle::verify(leaf, opening.merkle_proof, *trace_merkle_root)) {
            return false
        };

        // Reconstruct extended-domain point x_q = coset_shift · ω_e^{q}.
        let coset_shift = zkv_field::primitive_root(extended_size * 2);
        let omega_e = zkv_field::primitive_root(extended_size);
        let x_q = zkv_field::mul(coset_shift, zkv_field::pow(omega_e, opening.index));

        // Row constraint positions in trace domain.
        let omega_trace = zkv_field::primitive_root(trace_length);
        let g_row_0: u64 = 1;                                   // ω_trace^0
        let g_row_1: u64 = omega_trace;                         // ω_trace^1
        let g_row_2: u64 = zkv_field::mul(omega_trace, omega_trace); // ω_trace^2

        // Evaluate the three constraint polynomials on T(x_q).
        let t = opening.value;
        let p0 = eval_asset_constraint(t);
        let p1 = eval_side_constraint(t);
        let p2 = eval_leverage_constraint(t, leverage_cap);

        // Recompute alphas from Fiat-Shamir.
        let alpha_0 = derive_alpha(trace_merkle_root, 0);
        let alpha_1 = derive_alpha(trace_merkle_root, 1);
        let alpha_2 = derive_alpha(trace_merkle_root, 2);

        // Per-constraint quotient Q_j(x_q) = P_j(T(x_q)) · inv(x_q − g^j).
        // Coset shift guarantees x_q ∉ trace domain, so denom != 0.
        let denom_0 = zkv_field::sub(x_q, g_row_0);
        let denom_1 = zkv_field::sub(x_q, g_row_1);
        let denom_2 = zkv_field::sub(x_q, g_row_2);
        if (denom_0 == 0 || denom_1 == 0 || denom_2 == 0) return false;

        let q0 = zkv_field::mul(p0, zkv_field::inv(denom_0));
        let q1 = zkv_field::mul(p1, zkv_field::inv(denom_1));
        let q2 = zkv_field::mul(p2, zkv_field::inv(denom_2));

        // expected = α_0·Q_0 + α_1·Q_1 + α_2·Q_2
        let sum01 = zkv_field::add(
            zkv_field::mul(alpha_0, q0),
            zkv_field::mul(alpha_1, q1),
        );
        let expected = zkv_field::add(
            sum01,
            zkv_field::mul(alpha_2, q2),
        );

        zkv_field::eq(h_at_x_q, expected)
    }
}
