/// Merkle-proof verification for the on-chain STARK verifier.
///
/// Byte-identical to Python `MerkleTree.verify` in `zkp/core/cuda_true_stark.py`:
///
///     current = sha256(leaf)
///     for (sibling, is_left) in proof:
///         current = sha256(current || sibling) if is_left else sha256(sibling || current)
///     return current == root
///
/// `is_left` means the CURRENT node is on the LEFT half of the parent's
/// preimage — same convention Python uses. Trace / composition query
/// responses ship one `MerkleProofStep` per tree level; both hedge trace
/// openings and every FRI-layer commitment use this walk.
///
/// SHA-256 is a Move native (`std::hash::sha2_256`) — no need to implement
/// the hash primitive here. `sui::hash` only exposes `keccak256` +
/// `blake2b256`; SHA-256 lives in the Move stdlib alongside sha3_256.
module zkvanguard::zkv_merkle {
    use std::hash;
    use std::vector;

    /// One level of a Merkle-inclusion proof. `sibling` is the 32-byte
    /// hash of the counterpart node at this level; `is_left` says whether
    /// the value being verified sits on the LEFT of the parent preimage
    /// (i.e., parent = sha256(current || sibling) when true).
    public struct MerkleProofStep has copy, drop, store {
        sibling: vector<u8>,
        is_left: bool,
    }

    /// Constructor used by parsers reconstructing proofs from byte-encoded
    /// STARK proof structures. Kept public so on-chain callers can build
    /// steps element-by-element without importing this file's internals.
    public fun new_step(sibling: vector<u8>, is_left: bool): MerkleProofStep {
        MerkleProofStep { sibling, is_left }
    }

    /// Verify a Merkle inclusion proof. Matches Python `MerkleTree.verify`
    /// byte-for-byte on the same inputs.
    ///
    /// The `index` argument is deliberately omitted — the Python version
    /// accepts it but never reads it; `is_left` per step is the only
    /// piece of position information the walk actually needs.
    public fun verify(
        leaf: vector<u8>,
        proof: vector<MerkleProofStep>,
        root: vector<u8>,
    ): bool {
        let mut current = hash::sha2_256(leaf);
        let mut i = 0;
        let n = vector::length(&proof);
        while (i < n) {
            let step = vector::borrow(&proof, i);
            let mut buf = vector::empty<u8>();
            if (step.is_left) {
                vector::append(&mut buf, current);
                vector::append(&mut buf, step.sibling);
            } else {
                vector::append(&mut buf, step.sibling);
                vector::append(&mut buf, current);
            };
            current = hash::sha2_256(buf);
            i = i + 1;
        };
        current == root
    }
}
