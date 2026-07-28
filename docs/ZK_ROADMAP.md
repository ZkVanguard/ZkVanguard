# ZK Roadmap — path to a completely-real, end-to-end verifiable ZK-STARK

Snapshot 2026-07-28. Companion to `docs/ZK_WHITEPAPER_ALIGNMENT.md` (which
tracks the whitepaper-vs-code gap). This doc is forward-looking: what has
to ship for the ZK stack to be "completely real" — depositor-trustless,
chain-verified, quantum-secure — with honest scoping so future sessions
can pick a phase and finish it without rediscovering the map.

## What's actually done (as of `af23679e`, `c56ff363`, `c40737ce`)

- ✅ Goldilocks field (was NIST P-521; P-521 gives zero PQ benefit, breaks FFT).
- ✅ Real FRI on a multiplicative coset. Per-layer folding-consistency
  `f_L+1(x²) = (v+s)/2 + α·(v−s)/(2x)` checked at verify. Fiat-Shamir
  rebinding on FRI challenges from `sha256(root_L)`.
- ✅ Grinding PoW bound to the full trace + FRI commitment transcript.
  20 bits for legacy proofs (0.7s per proof), 24 bits for hedge proofs
  (~11s per proof).
- ✅ **Hedge invariants inside the STARK** (not just server-side gate):
  composition polynomial `H(x) = Σ α_j · Q_j(x)` where each Q_j =
  P_j(T(x)) / (x − g^j). Verifier re-evaluates P_j locally on Merkle-
  authenticated T(x_q) and asserts H(x_q) equality. Alphas rebound
  to `sha256(trace_merkle_root ‖ "alpha:{j}")` so attacker can't cook
  weights.
- ✅ **10 actual FRI folds for hedge proofs** (matches whitepaper §7).
  Emitted as `proof.actual_fri_layers` for auditor verifiability.
- ✅ Canonical hedge binding — TS + Python byte-identical, golden hash
  pinned in cross-lang tests.
- ✅ Server-side prover-side gate (`assert_hedge_binding`) as defense in
  depth. STARK catches the same violations even if the gate is bypassed.
- ✅ TS metadata guard rebound to Goldilocks + ≥80 queries + ≥20 grinding.

## What's still open (the "completely real" gap)

Three deliverables remain, each is a real project:

1. **On-chain STARK verifier in Move** — chain today only checks
   `ed25519(commitment_hash)`; the STARK itself is verified off-chain by
   `/api/zk/verify`. For trustless on-chain settlement, Move needs to
   run the STARK verifier itself.
2. **Rust prover with real 30-bit+ grinding + faster proof generation.**
   Python prover is fine for correctness but not for prod throughput.
3. **Browser WASM prover for full depositor cryptographic privacy.**
   Today the operator's server sees inputs at `/api/zk/attest`. For
   cryptographic (not just server-attested) privacy, the depositor must
   prove locally.

Below is a phased plan for each.

---

## Phase A — Move on-chain STARK verifier

**Goal:** `contracts/sui/sources/zk_verifier.move` runs the full STARK
verify circuit, replacing today's `ed25519_verify(sig, pubkey, commitment_hash)`
one-liner. Chain observers can independently verify hedge invariants
without trusting the operator's ed25519 key.

**Scale:** ~800-1200 Move LOC across ~5 files, split into 5 sub-phases.
Each sub-phase ships independently and is separately testable.

### Phase A.1 — Move-side finite field arithmetic (~200 LOC)

- New file: `contracts/sui/sources/zkv_field.move`.
- Goldilocks arithmetic: add, sub, mul (with barrett/mont reduction),
  inv, pow. All modulo `p = 2^64 − 2^32 + 1 = 18446744069414584321`.
- Move's `u64` overflow behavior + explicit u128 intermediates.
- Unit tests via `sui move test`: field axioms, random round-trips.

### Phase A.2 — Move-side Merkle verify (~150 LOC)

- New file: `contracts/sui/sources/zkv_merkle.move`.
- SHA-256 over `vector<u8>` (native SUI opcode `sui::hash::sha2_256`).
- `verify(leaf: vector<u8>, index: u64, proof: vector<vector<u8>>, root: vector<u8>): bool`.
- Matches the exact Python `MerkleTree.verify` byte layout.
- Unit tests: pass/fail on random Merkle trees.

### Phase A.3 — Move-side FRI folding-consistency check (~250 LOC)

- New file: `contracts/sui/sources/zkv_fri.move`.
- Per-query, per-layer: reconstruct `(h_L, ω_L, N_L)`, Merkle-verify
  value + sibling at positions `(q, q + N/2 mod N)`, compute
  `(v+s)/2 + α·(v−s)/(2x)`, compare to Merkle-authenticated next-layer
  value or the final polynomial evaluation.
- Fiat-Shamir binding: recompute α_L via `sha256(root_L)`.
- Grinding PoW re-check: `sha256(transcript ‖ nonce)` has ≥N leading zeros.

### Phase A.4 — Move-side hedge composition check (~200 LOC)

- New file: `contracts/sui/sources/zkv_hedge_air.move`.
- Reconstruct hedge AIR row constraints (asset ∈ {1,2,3}, side ∈ {0,1},
  leverage ∈ {1..cap}) from `statement.public_inputs[3]` (leverage_cap).
- Per query: Merkle-verify trace opening at position q against
  `trace_merkle_root`, evaluate P_j(T(x_q)) locally, compare to FRI-
  layer-0 authenticated H(x_q).
- Rebind α_j from `sha256(trace_merkle_root ‖ "alpha:{j}")`.

### Phase A.5 — Wire new verifier into `zk_verifier.move` (~200 LOC)

- Extend `verify_proof(state, proof_bytes, commitment_hash, ...)` to
  parse the STARK proof format (trace_merkle_root, fri_roots, query
  responses, trace openings, grinding nonce, final polynomial).
- Call the new verifier chain: A.2 → A.3 → A.4.
- Keep the ed25519 sig path as a fast path (with `state.strict_mode`
  toggle: strict rejects ed25519-only proofs).
- Migration: deploy new package alongside v0.4.0; existing hedges keep
  using ed25519; new hedges use full STARK.

**Cost:** ~800-1200 Move LOC, 3-6 weeks of focused work + audit.

**Gas:** rough estimate ~100k-500k SUI gas per verify. Prohibitive for
per-hedge on-chain verification at scale; likely used for periodic
audit-verification or on-demand challenge.

---

## Phase B — Rust prover

**Goal:** replace `zkp/core/cuda_true_stark.py` with a Rust implementation
that runs the same protocol but 100-1000× faster. Enables:
- 30-bit grinding at reasonable proof-gen time (~1s vs Python 12min)
- Sub-second per-hedge proof gen on CPU (vs current ~30s)
- WASM compilation for Phase C

**Scale:** ~2000-3000 Rust LOC, 4-8 weeks.

### Phase B.1 — Rust field + Merkle + FFT (~800 LOC)

- New crate: `zkp-rust/` with `Cargo.toml`, `src/field.rs`, `src/merkle.rs`,
  `src/fft.rs`.
- Goldilocks arithmetic (single-u64 with 128-bit intermediate).
- Cooley-Tukey FFT + inverse.
- SHA-256 Merkle tree.
- Property tests via `proptest`.

### Phase B.2 — Rust FRI (~600 LOC)

- `src/fri.rs`: commit, query, verify. Multiplicative coset, folding
  consistency, Fiat-Shamir binding.
- Grinding: parallelized nonce search via `rayon`.
- Byte-compatible proof format with Python (JSON serialization order fixed).

### Phase B.3 — Rust CUDATrueSTARK + hedge AIR (~600 LOC)

- `src/stark.rs`: full prover including composition polynomial.
- `src/air.rs`: parametric AIR with row constraints.
- `src/hedge_air.rs`: hedge invariant AIR builder.

### Phase B.4 — Rust HTTP server + Python interop (~400 LOC)

- Actix/axum HTTP server exposing `/api/zk/generate`, `/api/zk/verify`,
  `/api/zk/attest`.
- Byte-compatible request/response format so `zkp/api/server.py` clients
  need zero changes.
- Feature flag to route TS callers to Rust prover in prod.

**Cost:** ~2000-3000 Rust LOC + Rust toolchain in CI. Real speedup: 100x
per-proof, unlocks 30-bit grinding and higher trace lengths.

---

## Phase C — Browser WASM prover

**Goal:** depositor proves locally in-browser. Operator never sees the
private hedge inputs. This is what makes it "cryptographic privacy"
instead of "server-attested privacy".

Depends on Phase B (Rust prover).

**Scale:** ~500 Rust + ~500 TS LOC, 2-4 weeks after Phase B.

### Phase C.1 — wasm-pack build of the Rust prover (~200 LOC)

- Add `wasm-bindgen` bindings to `zkp-rust/`.
- Compile to `wasm32-unknown-unknown`.
- Publish as npm package `@zkvanguard/prover-wasm`.

### Phase C.2 — Browser JS integration (~300 TS LOC)

- New file: `lib/browser/wasmProver.ts`.
- `generateHedgeProofInBrowser(inputs) → { proof, commitment, statement }`.
- Uses Web Workers for the ~5-30s proof-gen (doesn't block UI).
- Includes canonical binding (already exists in TS: `zk/prover/hedgeCanonical.ts`).

### Phase C.3 — Depositor flow rewrite (~200 TS LOC)

- Update `SuiPrivateHedgeService.getAttestedHedgeCommitmentProof()` to
  call the browser prover instead of POSTing to `/api/zk/attest`.
- Attestation signing MOVES to depositor's own key (or a threshold sig
  scheme) — no more operator ed25519 key seeing everything.
- `/api/zk/attest` becomes obsolete for hedges; kept for internal /
  risk-attestation flows.

**Result:** operator sees only `(commitment_hash, proof)`. Trade details
never leave the depositor's browser.

**Cost:** ~1000 LOC total, ~4 weeks.

---

## Phase D — Optional formal verification (Coq / Lean)

**Not on any planned timeline.** Real machine-checked STARK soundness
proofs are a year+ of specialist work. Documented in the whitepaper §7
footnote as a "necessary-but-not-sufficient" caveat: "empirical checks
pass, formal proofs would require Coq/Lean encoding."

Reference implementations that could be adapted:
- `ethSTARK` (StarkWare) has partial formal analysis.
- `Plonky2` (Polygon Zero) has proptest coverage but not full Coq.

Deferred indefinitely. Not blocking any product milestone.

---

## Milestone table

| Phase | Effort | Status | Blocks |
|-------|--------|--------|--------|
| A.1 Move field arithmetic | ~200 Move LOC, 1w | pending | A.2 |
| A.2 Move Merkle verify | ~150 Move LOC, 3d | pending | A.3, A.4 |
| A.3 Move FRI verify | ~250 Move LOC, 2w | pending | A.5 |
| A.4 Move hedge AIR check | ~200 Move LOC, 1w | pending | A.5 |
| A.5 Wire into zk_verifier | ~200 Move LOC, 1w + audit | pending | on-chain STARK done |
| B.1 Rust field + Merkle + FFT | ~800 Rust LOC, 2w | pending | B.2, B.3 |
| B.2 Rust FRI | ~600 Rust LOC, 2w | pending | B.3, B.4 |
| B.3 Rust STARK + hedge AIR | ~600 Rust LOC, 2w | pending | B.4 |
| B.4 Rust HTTP server | ~400 Rust LOC, 1w | pending | 100x speedup done |
| C.1 wasm-pack build | ~200 LOC, 3d | pending on B | C.2 |
| C.2 Browser JS integration | ~300 TS LOC, 1w | pending on C.1 | C.3 |
| C.3 Depositor flow rewrite | ~200 TS LOC, 1w | pending on C.2 | cryptographic privacy done |
| D Formal verification (Coq/Lean) | ~1yr specialist | not planned | — |

## Ordering recommendation

**If the constraint is "no operator trust":** ship B then C (Rust prover
→ WASM). Chain still verifies via ed25519 attestation, but the ed25519
KEY belongs to the depositor's browser, not the operator's server. That
closes the "operator sees inputs" gap without needing Move-side STARK.

**If the constraint is "no chain-side trust":** ship A (Move on-chain
STARK verifier). Chain independently verifies the STARK, no ed25519
key at all. Higher gas cost but zero prover trust.

**If both are wanted:** A + B + C. Time budget ~4-6 months.

Neither ordering is required for the current commit chain; both are
tracked as follow-ups. Whatever ships next in this doc should update
the milestone table above and cross-reference in commit messages.
