# zkp-rust — Rust port of the ZkVanguard STARK prover

Phase B of the ZK roadmap (see `../docs/ZK_ROADMAP.md`). The Python
prover in `zkp/core/cuda_true_stark.py` runs at ~30s per hedge proof on
CPU and can't do 30-bit grinding in reasonable time (~12min at Python's
SHA-256 throughput). It also runs server-side, so the operator sees the
depositor's inputs — the last honesty gap in the "private hedge" story.

This crate is the foundation for closing both:

1. **Fast prover** — Rust with `sha2` and native `u64` field ops runs
   ~100× faster than Python. 30-bit grinding becomes viable at ~7s
   per proof.
2. **Browser prover (Phase C)** — same crate compiled to WASM via
   `wasm-bindgen` runs in the depositor's browser. Operator sees only
   the commitment hash and the proof bytes; the private inputs never
   leave the client.

## Crates

| Crate | Purpose | Status |
|---|---|---|
| `zkv-field` | Goldilocks field arithmetic (`p = 2^64 - 2^32 + 1`) | ✅ shipped |
| `zkv-merkle` | SHA-256 Merkle tree — byte-identical to Python + Move | ✅ shipped |
| `zkv-fri` | FRI folding, coset shift, Fiat-Shamir | ⏳ next |
| `zkv-stark` | Composition polynomial + hedge AIR + grinding | ⏳ |
| `zkv-prover-server` | HTTP server exposing `/api/zk/generate` | ⏳ |

## Byte-exact guarantee

Every crate here MUST produce byte-identical output to the Python
`CUDAFiniteField` / `MerkleTree` and the Move `zkv_field` / `zkv_merkle`
on the same inputs. Cross-language golden vectors are pinned inside
each `#[cfg(test)] mod tests` — any drift fails loud before it can
break the on-chain verifier.

## Building

```sh
cargo test               # run every crate's tests
cargo test -p zkv-field  # just the field crate
cargo build --release    # optimized library build
```

## License

MIT (matches the repo).
