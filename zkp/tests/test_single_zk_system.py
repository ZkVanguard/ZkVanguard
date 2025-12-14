"""
Single Comprehensive Test for the ONE ZK System
Tests only the 4 classes that actually exist in zk_system.py
"""

import asyncio
import pytest
import tempfile
from pathlib import Path

from zkp.core.zk_system import (
    AuthenticZKStark,
    AuthenticProofManager,
    AuthenticFiniteField,
    AuthenticMerkleTree
)


class TestSingleZKSystem:
    """Test the single comprehensive ZK implementation"""
    
    def setup_method(self):
        self.temp_dir = tempfile.mkdtemp()
        self.zk_system = AuthenticZKStark()
        self.proof_manager = AuthenticProofManager(self.temp_dir)
        self.field = AuthenticFiniteField(2**127 - 1)
    
    def test_finite_field_operations(self):
        """Test finite field arithmetic"""
        # Test basic operations
        assert self.field.add(5, 3) == 8
        assert self.field.mul(4, 6) == 24
        assert self.field.sub(10, 4) == 6
        
        # Test modular arithmetic
        large_a = self.field.prime - 1
        large_b = 5
        result = self.field.add(large_a, large_b)
        assert result == 4  # Should wrap around
    
    def test_merkle_tree(self):
        """Test Merkle tree construction"""
        leaves = [b"data1", b"data2", b"data3", b"data4"]
        tree = AuthenticMerkleTree(leaves)
        
        # Should have a root
        assert tree.root is not None
        assert len(tree.root) == 32  # SHA256 hash length
        
        # Empty tree should work
        empty_tree = AuthenticMerkleTree([])
        assert empty_tree.root == b''
    
    @pytest.mark.asyncio
    async def test_zk_proof_generation(self):
        """Test ZK-STARK proof generation"""
        statement = {
            "public_input": 42,
            "computation": "square"
        }
        witness = {
            "secret": 42,
            "intermediate": 42 * 42
        }
        
        proof = await self.zk_system.generate_proof(statement, witness)
        
        # Verify proof structure
        assert isinstance(proof, dict)
        assert "commitment" in proof
        assert "challenge" in proof
        assert "response" in proof
        assert "timestamp" in proof
        assert "field_prime" in proof
        
        # Verify proof verification
        is_valid = self.zk_system.verify_proof(proof, statement)
        assert is_valid is True
    
    @pytest.mark.asyncio 
    async def test_proof_manager(self):
        """Test proof storage and retrieval"""
        statement = {"value": 100}
        witness = {"secret": 10}
        
        # Generate and store proof
        proof = await self.zk_system.generate_proof(statement, witness)
        proof_id = await self.proof_manager.store_proof(proof, statement)
        
        # Retrieve and verify
        stored_proof = self.proof_manager.get_proof(proof_id)
        assert stored_proof is not None
        
        # Verify stored proof
        is_valid = self.proof_manager.verify_proof(proof_id)
        assert is_valid is True
    
    @pytest.mark.asyncio
    async def test_multiple_proofs(self):
        """Test multiple proof generations"""
        proofs = []
        
        for i in range(5):
            statement = {"iteration": i}
            witness = {"secret_value": i * 2}
            
            proof = await self.zk_system.generate_proof(statement, witness)
            proofs.append((proof, statement))
        
        # Verify all proofs
        for proof, statement in proofs:
            assert self.zk_system.verify_proof(proof, statement)
    
    def test_system_consistency(self):
        """Test system consistency across operations"""
        # Test field consistency
        a, b, c = 123, 456, 789
        result1 = self.field.add(self.field.mul(a, b), c)
        result2 = self.field.add(c, self.field.mul(a, b))
        assert result1 == result2  # Commutativity
        
        # Test Merkle tree consistency
        data = [b"consistent", b"data", b"test"]
        tree1 = AuthenticMerkleTree(data)
        tree2 = AuthenticMerkleTree(data)
        assert tree1.root == tree2.root  # Same input = same root


if __name__ == "__main__":
    # Simple test runner for direct execution
    import sys
    
    print("🧪 TESTING SINGLE ZK SYSTEM")
    print("=" * 40)
    
    test_instance = TestSingleZKSystem()
    test_instance.setup_method()
    
    try:
        # Test finite field
        print("✅ Testing finite field operations...")
        test_instance.test_finite_field_operations()
        
        # Test Merkle tree
        print("✅ Testing Merkle tree...")
        test_instance.test_merkle_tree()
        
        # Test ZK proofs
        print("✅ Testing ZK proof generation...")
        asyncio.run(test_instance.test_zk_proof_generation())
        
        # Test proof manager
        print("✅ Testing proof manager...")
        asyncio.run(test_instance.test_proof_manager())
        
        # Test multiple proofs
        print("✅ Testing multiple proofs...")
        asyncio.run(test_instance.test_multiple_proofs())
        
        # Test consistency
        print("✅ Testing system consistency...")
        test_instance.test_system_consistency()
        
        print("\n🎉 ALL TESTS PASSED!")
        print("💯 Single ZK system is fully functional")
        
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        sys.exit(1)
