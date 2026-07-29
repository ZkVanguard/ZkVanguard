//! SHA-256 Merkle tree.
//!
//! Byte-identical to Python `MerkleTree` in
//! `zkp/core/cuda_true_stark.py` and Move `zkv_merkle` in
//! `contracts/sui/sources/zkv_merkle.move`.
//!
//! Rules (must match all three implementations):
//! * Each leaf is hashed once (`sha256(leaf)`) at the bottom level.
//! * Levels are built bottom-up; odd-count levels duplicate the last
//!   node as its own sibling (`right = left`).
//! * Parent = `sha256(left || right)`.
//! * Proof-step convention: `is_left == true` means the current node is
//!   on the LEFT of the concatenation (parent = sha256(current ||
//!   sibling)). Same semantics as the Python `Tuple[bytes, bool]` and
//!   the Move `MerkleProofStep { sibling, is_left }`.
//!
//! Any drift here breaks:
//! * The composition-polynomial verifier on-chain (Move reads what
//!   Python emits).
//! * The browser prover (Phase C) that will replace `/api/zk/attest`.

#![deny(missing_docs)]
#![deny(unsafe_code)]

use sha2::{Digest, Sha256};

/// A single step of a Merkle inclusion proof.
///
/// * `sibling` — 32-byte hash of the counterpart node at this level.
/// * `is_left` — `true` iff the current node sits on the LEFT half of
///   the parent preimage (parent = sha256(current || sibling)).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MerkleProofStep {
    /// Sibling hash at this tree level (32 bytes).
    pub sibling: [u8; 32],
    /// Whether the current node is the LEFT child at this level.
    pub is_left: bool,
}

/// SHA-256 Merkle tree over arbitrary-length byte leaves.
#[derive(Debug)]
pub struct MerkleTree {
    /// Level-by-level, bottom to top. `levels[0]` = leaf hashes;
    /// `levels[levels.len()-1] == [root]`.
    levels: Vec<Vec<[u8; 32]>>,
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

fn sha256_concat(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().into()
}

impl MerkleTree {
    /// Build a tree from raw leaf bytes. Matches Python
    /// `MerkleTree(leaves=[bytes, ...])`.
    ///
    /// Empty input is treated as `[b""]` (single empty-string leaf) —
    /// same as the Python fallback.
    pub fn new(leaves: &[Vec<u8>]) -> Self {
        let leaves: Vec<&[u8]> = if leaves.is_empty() {
            vec![&[][..]]
        } else {
            leaves.iter().map(|v| v.as_slice()).collect()
        };

        // Level 0: hash each leaf.
        let level0: Vec<[u8; 32]> = leaves.iter().map(|l| sha256(l)).collect();
        let mut levels = vec![level0];

        // Build upward. Odd counts duplicate the last node.
        while levels.last().unwrap().len() > 1 {
            let current = levels.last().unwrap();
            let mut next = Vec::with_capacity((current.len() + 1) / 2);
            let mut i = 0;
            while i < current.len() {
                let left = current[i];
                let right = if i + 1 < current.len() { current[i + 1] } else { left };
                next.push(sha256_concat(&left, &right));
                i += 2;
            }
            levels.push(next);
        }
        MerkleTree { levels }
    }

    /// Number of levels including leaf-hash level (>= 1).
    pub fn depth(&self) -> usize {
        self.levels.len()
    }

    /// The root hash. Byte-identical to Python `.root()`.
    pub fn root(&self) -> [u8; 32] {
        *self
            .levels
            .last()
            .and_then(|lvl| lvl.first())
            .unwrap_or_else(|| unreachable!("levels is never empty"))
    }

    /// Prove leaf at `index`. Matches Python `.prove(index)`.
    pub fn prove(&self, index: usize) -> Vec<MerkleProofStep> {
        let mut proof = Vec::new();
        let mut idx = index;
        // Walk every level EXCEPT the root.
        for level in self.levels.iter().take(self.levels.len() - 1) {
            let sibling_idx = idx ^ 1;
            let is_left = (idx % 2) == 0;
            let sibling = if sibling_idx < level.len() {
                level[sibling_idx]
            } else {
                // Python behavior: when sibling out of range, Python
                // simply skips the step (no push). Match exactly.
                idx /= 2;
                continue;
            };
            proof.push(MerkleProofStep { sibling, is_left });
            idx /= 2;
        }
        proof
    }

    /// Verify a proof against a claimed root. Byte-identical to Python
    /// `MerkleTree.verify(leaf, index, proof, root)` and Move
    /// `zkv_merkle::verify`.
    pub fn verify(leaf: &[u8], proof: &[MerkleProofStep], root: &[u8; 32]) -> bool {
        let mut current = sha256(leaf);
        for step in proof {
            current = if step.is_left {
                sha256_concat(&current, &step.sibling)
            } else {
                sha256_concat(&step.sibling, &current)
            };
        }
        &current == root
    }
}

// ============================================================
// Tests — mirror Move `zkv_stark_tests::merkle_*` and Python
// tests. Cross-language golden vectors pinned below.
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn unhex(s: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        for i in 0..32 {
            out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
        }
        out
    }

    #[test]
    fn single_leaf_root_is_sha256_of_leaf() {
        let t = MerkleTree::new(&[b"solo".to_vec()]);
        let expected = sha256(b"solo");
        assert_eq!(t.root(), expected);
    }

    #[test]
    fn build_and_prove_roundtrip() {
        // 4 leaves — same shape as the Move golden vector.
        let leaves = vec![
            b"leaf_a".to_vec(),
            b"leaf_b".to_vec(),
            b"leaf_c".to_vec(),
            b"leaf_d".to_vec(),
        ];
        let tree = MerkleTree::new(&leaves);
        let root = tree.root();

        // Prove every leaf and verify.
        for (i, leaf) in leaves.iter().enumerate() {
            let proof = tree.prove(i);
            assert!(
                MerkleTree::verify(leaf, &proof, &root),
                "leaf {} failed to verify",
                i
            );
        }
    }

    #[test]
    fn verify_rejects_tampered_leaf() {
        let leaves = vec![
            b"leaf_a".to_vec(),
            b"leaf_b".to_vec(),
            b"leaf_c".to_vec(),
            b"leaf_d".to_vec(),
        ];
        let tree = MerkleTree::new(&leaves);
        let root = tree.root();
        let proof = tree.prove(2);
        assert!(!MerkleTree::verify(b"leaf_x", &proof, &root));
    }

    #[test]
    fn verify_rejects_wrong_root() {
        let tree = MerkleTree::new(&[b"leaf_a".to_vec(), b"leaf_b".to_vec()]);
        let proof = tree.prove(0);
        let wrong_root = [0u8; 32];
        assert!(!MerkleTree::verify(b"leaf_a", &proof, &wrong_root));
    }

    // ============================================================
    // CROSS-LANGUAGE GOLDEN VECTORS
    //
    // Same 4-leaf tree the Move test suite uses
    // (`contracts/sui/tests/zkv_stark_tests.move::proof_for_leaf_c`).
    // If Rust drifts from Python or Move, this fails loud.
    //
    // Generated from Python (2026-07-28):
    //   leaves = [b'leaf_a', b'leaf_b', b'leaf_c', b'leaf_d']
    //   hashed = [sha256(l).digest() for l in leaves]
    //   l1 = [sha256(h[0]+h[1]).digest(), sha256(h[2]+h[3]).digest()]
    //   root = sha256(l1[0] + l1[1]).digest()
    // ============================================================

    #[test]
    fn cross_lang_root_matches_python_and_move() {
        let leaves = vec![
            b"leaf_a".to_vec(),
            b"leaf_b".to_vec(),
            b"leaf_c".to_vec(),
            b"leaf_d".to_vec(),
        ];
        let tree = MerkleTree::new(&leaves);
        let expected =
            unhex("e3b58dfe27716ef42537b185903ddb93571f28061805339c06ab5d19cc87baa2");
        assert_eq!(
            tree.root(),
            expected,
            "root drift — got {}",
            hex(&tree.root())
        );
    }

    #[test]
    fn cross_lang_prove_leaf_c_matches_move_vector() {
        // Move test hardcodes these exact sibling hashes for leaf_c
        // (index 2). If either side drifts, this test breaks first.
        let leaves = vec![
            b"leaf_a".to_vec(),
            b"leaf_b".to_vec(),
            b"leaf_c".to_vec(),
            b"leaf_d".to_vec(),
        ];
        let tree = MerkleTree::new(&leaves);
        let proof = tree.prove(2);
        assert_eq!(proof.len(), 2);
        // Level 0 sibling = sha256(b"leaf_d"), current on LEFT.
        assert_eq!(
            hex(&proof[0].sibling),
            "65a71ead52358266086a3f6b7cdadf1b6b66e95cc6df4d78db9a3d1348f28f7d"
        );
        assert!(proof[0].is_left);
        // Level 1 sibling = sha256(h[0]||h[1]), current on RIGHT.
        assert_eq!(
            hex(&proof[1].sibling),
            "02bd8542459161387133827baecfb4aaa45e604059678a4e9e720d7cdadb1eda"
        );
        assert!(!proof[1].is_left);
    }
}
