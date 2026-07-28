"""
LEGACY ZK-STARK SHIM
====================

Historical home of the ~2000 LOC `AuthenticZKStark` class. Deleted 2026-07-28
as part of the CUDATrueSTARK cutover (docs/ZK_WHITEPAPER_ALIGNMENT.md #6).

What survived here:
  - `AuthenticFiniteField` — NIST-P521 field helper still used by external
    Python callers that don't touch the prover.
  - `AuthenticMerkleTree` — SHA-256 Merkle helper with salted parents.
  - `AuthenticProofManager` — thin storage wrapper (create / verify / list /
    delete stored proof records on disk). Wired to CUDATrueSTARK internally.
  - `AuthenticZKStark` — compat alias for `CUDATrueSTARK`. Legacy imports
    (`from zkp.core.zk_system import AuthenticZKStark`) keep working, but
    the class body no longer lives in this file.

Anything that needs the prover should import `CUDATrueSTARK` directly from
`zkp.core.cuda_true_stark`.
"""

import hashlib
import json
import os
import tempfile
import time
import logging
from typing import Any, Dict, List, Optional, Tuple

from zkp.core.cuda_true_stark import CUDATrueSTARK

logger = logging.getLogger(__name__)


class AuthenticFiniteField:
    """Finite field operations for ZK proofs with complete authentic implementation"""

    def __init__(self, prime: Optional[int] = None):
        # NIST P-521 certified prime (2^521 - 1) for quantum resistance.
        self.prime = prime or 6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151

    def add(self, a: int, b: int) -> int:
        return (a + b) % self.prime

    def sub(self, a: int, b: int) -> int:
        return (a - b) % self.prime

    def mul(self, a: int, b: int) -> int:
        return (a * b) % self.prime

    def multiply(self, a: int, b: int) -> int:
        return self.mul(a, b)

    def div(self, a: int, b: int) -> int:
        return self.mul(a, self.inv(b))

    def divide(self, a: int, b: int) -> int:
        return self.div(a, b)

    def pow(self, base: int, exp: int) -> int:
        return pow(base, exp, self.prime)

    def power(self, base: int, exp: int) -> int:
        return self.pow(base, exp)

    def inv(self, a: int) -> int:
        return pow(a, self.prime - 2, self.prime)

    def inverse(self, a: int) -> int:
        return self.inv(a)

    def multiplicative_inverse(self, a: int) -> int:
        return self.inv(a)

    def neg(self, a: int) -> int:
        return (self.prime - a) % self.prime

    def square(self, a: int) -> int:
        return self.mul(a, a)

    def is_zero(self, a: int) -> bool:
        return (a % self.prime) == 0

    def is_one(self, a: int) -> bool:
        return (a % self.prime) == 1


class AuthenticMerkleTree:
    """Merkle tree for cryptographic commitments (SHA-256, salted parents)."""

    def __init__(self, leaves: List[bytes]):
        self.original_leaves = leaves
        self.leaves = leaves if leaves else []
        self.root = self._build_root()
        self.tree_levels = self._build_full_tree()

    def _build_root(self) -> bytes:
        if not self.leaves:
            return b''

        level = [hashlib.sha256(leaf).digest() for leaf in self.leaves]

        while len(level) > 1:
            next_level = []
            for i in range(0, len(level), 2):
                left = level[i]
                right = level[i + 1] if i + 1 < len(level) else left
                salt = hashlib.sha256(f"merkle_salt_{i}".encode()).digest()[:8]
                parent = hashlib.sha256(salt + left + right).digest()
                next_level.append(parent)
            level = next_level

        return level[0] if level else hashlib.sha256(b'empty').digest()

    def _build_full_tree(self) -> List[List[bytes]]:
        if not self.leaves:
            return [[]]

        levels = []
        current_level = [hashlib.sha256(leaf).digest() for leaf in self.leaves]
        levels.append(current_level[:])

        while len(current_level) > 1:
            next_level = []
            for i in range(0, len(current_level), 2):
                left = current_level[i]
                right = current_level[i + 1] if i + 1 < len(current_level) else left
                salt = hashlib.sha256(f"merkle_salt_{i}".encode()).digest()[:8]
                parent = hashlib.sha256(salt + left + right).digest()
                next_level.append(parent)
            current_level = next_level
            levels.append(current_level[:])

        return levels

    def get_proof(self, leaf_index: int) -> List[Tuple[bytes, str]]:
        if leaf_index >= len(self.leaves):
            return []

        proof: List[Tuple[bytes, str]] = []
        current_index = leaf_index

        for level in range(len(self.tree_levels) - 1):
            if current_index % 2 == 0:
                sibling_index = current_index + 1
                if sibling_index < len(self.tree_levels[level]):
                    proof.append((self.tree_levels[level][sibling_index], 'right'))
                else:
                    proof.append((self.tree_levels[level][current_index], 'right'))
            else:
                sibling_index = current_index - 1
                proof.append((self.tree_levels[level][sibling_index], 'left'))

            current_index //= 2

        return proof


class AuthenticProofManager:
    """Disk-backed proof storage wired to CUDATrueSTARK.

    Stores proof records as JSON so external callers can retrieve them
    later and re-verify. The prover itself is CUDATrueSTARK; this manager
    is just persistence + housekeeping.
    """

    def __init__(self, storage_dir: Optional[str] = None):
        self.storage_dir = storage_dir or tempfile.mkdtemp()
        self.zk_system = CUDATrueSTARK()
        self._ensure_storage_dir()

    def _ensure_storage_dir(self):
        os.makedirs(self.storage_dir, exist_ok=True)

    @staticmethod
    def _json_encoder(obj):
        if isinstance(obj, bytes):
            return obj.hex()
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

    async def create_proof(self, proof_id: str, statement: Dict[str, Any],
                           witness: Dict[str, Any]) -> Dict[str, Any]:
        """Generate a proof and persist it to disk."""
        try:
            # CUDATrueSTARK.generate_proof is sync; the async wrapper on the
            # class is fire-and-forget-safe. Use the async wrapper so callers
            # awaiting this coroutine don't crash on a plain dict.
            proof = await self.zk_system.generate_proof_async(statement, witness)

            proof_record = {
                'proof_id': proof_id,
                'statement': statement,
                'proof': proof,
                'created_at': time.time(),
                'status': 'valid',
            }

            proof_file = os.path.join(self.storage_dir, f"{proof_id}.json")
            with open(proof_file, 'w') as f:
                json.dump(proof_record, f, indent=2, default=self._json_encoder)

            return proof_record

        except Exception as e:
            return {
                'proof_id': proof_id,
                'status': 'error',
                'error': str(e),
                'created_at': time.time(),
            }

    def verify_proof_sync(self, proof_id: str) -> bool:
        try:
            proof_file = os.path.join(self.storage_dir, f"{proof_id}.json")
            if not os.path.exists(proof_file):
                return False

            with open(proof_file, 'r') as f:
                proof_record = json.load(f)

            proof = proof_record.get('proof')
            statement = proof_record.get('statement')

            if not proof or not statement:
                return False

            return self.zk_system.verify_proof(proof, statement)

        except Exception:
            return False

    async def verify_proof_async(self, proof_id: str,
                                 statement: Dict[str, Any]) -> Dict[str, Any]:
        try:
            proof_file = os.path.join(self.storage_dir, f"{proof_id}.json")
            if not os.path.exists(proof_file):
                return {'is_valid': False, 'error': 'Proof not found', 'proof_id': proof_id}

            with open(proof_file, 'r') as f:
                proof_record = json.load(f)

            stored_proof = proof_record.get('proof')
            if not stored_proof:
                return {'is_valid': False, 'error': 'Invalid proof record', 'proof_id': proof_id}

            is_valid = self.zk_system.verify_proof(stored_proof, statement)
            return {
                'is_valid': is_valid,
                'proof_id': proof_id,
                'verified_at': time.time(),
                'statement_hash': stored_proof.get('statement_hash'),
            }

        except Exception as e:
            return {'is_valid': False, 'error': str(e), 'proof_id': proof_id}

    def get_proof(self, proof_id: str) -> Optional[Dict[str, Any]]:
        try:
            proof_file = os.path.join(self.storage_dir, f"{proof_id}.json")
            if not os.path.exists(proof_file):
                return None
            with open(proof_file, 'r') as f:
                return json.load(f)
        except Exception:
            return None

    def list_proofs(self) -> List[str]:
        try:
            proof_files = [f for f in os.listdir(self.storage_dir) if f.endswith('.json')]
            return [f[:-5] for f in proof_files]
        except Exception:
            return []

    def delete_proof(self, proof_id: str) -> bool:
        try:
            proof_file = os.path.join(self.storage_dir, f"{proof_id}.json")
            if os.path.exists(proof_file):
                os.remove(proof_file)
                return True
            return False
        except Exception:
            return False


# Compat alias — legacy imports (`from zkp.core.zk_system import AuthenticZKStark`)
# now resolve to CUDATrueSTARK. The distinct class no longer exists.
AuthenticZKStark = CUDATrueSTARK


__all__ = [
    'AuthenticZKStark',
    'AuthenticFiniteField',
    'AuthenticMerkleTree',
    'AuthenticProofManager',
]
