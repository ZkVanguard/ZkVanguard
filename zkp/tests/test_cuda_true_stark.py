#!/usr/bin/env python3
"""
🧪 COMPREHENSIVE TEST SUITE FOR CUDA TRUE STARK
==============================================
Tests the CUDA-accelerated True STARK implementation to ensure
it matches StarkWare/Starknet protocol standards.

Test Categories:
1. Field Operations - Finite field arithmetic correctness
2. Polynomial Operations - Interpolation, evaluation, FFT
3. Merkle Tree - Commitment and proof verification
4. AIR Constraints - Boundary and transition constraints
5. FRI Protocol - Commit, query, and verify phases
6. Full STARK - End-to-end proof generation and verification
7. Security Tests - Invalid proof rejection, tamper detection
8. Performance Tests - CUDA acceleration benchmarks
"""

import sys
import os
import json
import time
import hashlib
import unittest
from typing import List, Dict, Any

# Add project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.cuda_true_stark import (
    CUDATrueSTARK,
    CUDAFiniteField,
    Polynomial,
    MerkleTree,
    AIR,
    FRI,
    STARKConfig,
    CUDA_AVAILABLE
)


class TestFieldOperations(unittest.TestCase):
    """Test finite field arithmetic"""
    
    def setUp(self):
        self.field = CUDAFiniteField()
        self.prime = self.field.prime
    
    def test_addition(self):
        """Test field addition"""
        a, b = 12345, 67890
        result = self.field.add(a, b)
        expected = (a + b) % self.prime
        self.assertEqual(result, expected)
    
    def test_addition_overflow(self):
        """Test addition with values near prime"""
        a = self.prime - 1
        b = 5
        result = self.field.add(a, b)
        expected = 4  # Wraps around
        self.assertEqual(result, expected)
    
    def test_subtraction(self):
        """Test field subtraction"""
        a, b = 67890, 12345
        result = self.field.sub(a, b)
        expected = (a - b) % self.prime
        self.assertEqual(result, expected)
    
    def test_subtraction_underflow(self):
        """Test subtraction with underflow"""
        a, b = 5, 10
        result = self.field.sub(a, b)
        expected = (a - b) % self.prime
        self.assertEqual(result, expected)
        self.assertEqual(result, self.prime - 5)
    
    def test_multiplication(self):
        """Test field multiplication"""
        a, b = 12345, 67890
        result = self.field.mul(a, b)
        expected = (a * b) % self.prime
        self.assertEqual(result, expected)
    
    def test_inverse(self):
        """Test multiplicative inverse"""
        a = 12345
        inv_a = self.field.inv(a)
        # a * inv(a) = 1 mod p
        product = self.field.mul(a, inv_a)
        self.assertEqual(product, 1)
    
    def test_inverse_zero_raises(self):
        """Test that inverse of zero raises error"""
        with self.assertRaises(ValueError):
            self.field.inv(0)
    
    def test_division(self):
        """Test field division"""
        a, b = 67890, 12345
        result = self.field.div(a, b)
        # result * b = a mod p
        check = self.field.mul(result, b)
        self.assertEqual(check, a)
    
    def test_exponentiation(self):
        """Test field exponentiation"""
        base, exp = 2, 10
        result = self.field.pow(base, exp)
        expected = pow(base, exp, self.prime)
        self.assertEqual(result, expected)
    
    def test_fermat_little_theorem(self):
        """Test a^(p-1) = 1 mod p (Fermat's little theorem)"""
        a = 12345
        result = self.field.pow(a, self.prime - 1)
        self.assertEqual(result, 1)
    
    def test_primitive_root(self):
        """Test primitive root generation and evaluation domain"""
        order = 1024
        root = self.field.get_primitive_root(order)
        # Root should be valid (non-zero, within field)
        self.assertGreater(root, 0)
        self.assertLess(root, self.field.prime)
    
    def test_evaluation_domain(self):
        """Test evaluation domain generation"""
        size = 16
        domain = self.field.get_evaluation_domain(size)
        self.assertEqual(len(domain), size)
        # All elements should be distinct
        self.assertEqual(len(set(domain)), size)
        # All elements should be positive
        self.assertTrue(all(x > 0 for x in domain))
    
    def test_batch_operations(self):
        """Test batch field operations"""
        a_list = [100, 200, 300, 400, 500]
        b_list = [10, 20, 30, 40, 50]
        
        # Test batch multiply
        results = self.field.batch_multiply(a_list, b_list)
        expected = [self.field.mul(a, b) for a, b in zip(a_list, b_list)]
        self.assertEqual(results, expected)
        
        # Test batch add
        results = self.field.batch_add(a_list, b_list)
        expected = [self.field.add(a, b) for a, b in zip(a_list, b_list)]
        self.assertEqual(results, expected)


class TestPolynomial(unittest.TestCase):
    """Test polynomial operations"""
    
    def setUp(self):
        self.field = CUDAFiniteField()
    
    def test_evaluation(self):
        """Test polynomial evaluation"""
        # p(x) = 1 + 2x + 3x^2
        coeffs = [1, 2, 3]
        poly = Polynomial(coeffs, self.field)
        
        # p(0) = 1
        self.assertEqual(poly.evaluate(0), 1)
        
        # p(1) = 1 + 2 + 3 = 6
        self.assertEqual(poly.evaluate(1), 6)
        
        # p(2) = 1 + 4 + 12 = 17
        self.assertEqual(poly.evaluate(2), 17)
    
    def test_degree(self):
        """Test polynomial degree"""
        poly = Polynomial([1, 2, 3, 0, 0], self.field)
        self.assertEqual(poly.degree(), 2)
        
        poly = Polynomial([0], self.field)
        self.assertEqual(poly.degree(), 0)
    
    def test_addition(self):
        """Test polynomial addition"""
        p1 = Polynomial([1, 2, 3], self.field)
        p2 = Polynomial([4, 5], self.field)
        
        result = p1 + p2
        expected = [5, 7, 3]
        self.assertEqual(result.coefficients, expected)
    
    def test_multiplication(self):
        """Test polynomial multiplication"""
        # (1 + x) * (1 + x) = 1 + 2x + x^2
        p1 = Polynomial([1, 1], self.field)
        p2 = Polynomial([1, 1], self.field)
        
        result = p1 * p2
        expected = [1, 2, 1]
        self.assertEqual(result.coefficients, expected)
    
    def test_interpolation(self):
        """Test Lagrange interpolation"""
        # Points: (0, 1), (1, 3), (2, 7)
        # Should give: 1 + x + x^2
        points = [(0, 1), (1, 3), (2, 7)]
        poly = Polynomial.interpolate(points, self.field)
        
        # Verify polynomial passes through all points
        for x, y in points:
            self.assertEqual(poly.evaluate(x), y)
    
    def test_scale(self):
        """Test polynomial scaling"""
        poly = Polynomial([1, 2, 3], self.field)
        scaled = poly.scale(2)
        expected = [2, 4, 6]
        self.assertEqual(scaled.coefficients, expected)


class TestMerkleTree(unittest.TestCase):
    """Test Merkle tree operations"""
    
    def test_single_leaf(self):
        """Test tree with single leaf"""
        leaves = [b'hello']
        tree = MerkleTree(leaves)
        
        root = tree.root()
        self.assertIsNotNone(root)
        self.assertEqual(len(root), 32)  # SHA-256 output
    
    def test_multiple_leaves(self):
        """Test tree with multiple leaves"""
        leaves = [f'leaf_{i}'.encode() for i in range(8)]
        tree = MerkleTree(leaves)
        
        root = tree.root()
        self.assertEqual(len(root), 32)
    
    def test_proof_verification(self):
        """Test Merkle proof generation and verification"""
        leaves = [f'data_{i}'.encode() for i in range(16)]
        tree = MerkleTree(leaves)
        root = tree.root()
        
        # Verify each leaf
        for i in range(len(leaves)):
            proof = tree.prove(i)
            valid = MerkleTree.verify(leaves[i], i, proof, root)
            self.assertTrue(valid, f"Proof verification failed for leaf {i}")
    
    def test_invalid_proof_rejected(self):
        """Test that invalid proofs are rejected"""
        leaves = [f'data_{i}'.encode() for i in range(8)]
        tree = MerkleTree(leaves)
        root = tree.root()
        
        # Get proof for leaf 0
        proof = tree.prove(0)
        
        # Try to verify with wrong leaf
        valid = MerkleTree.verify(b'wrong_data', 0, proof, root)
        self.assertFalse(valid)
    
    def test_deterministic_root(self):
        """Test that same leaves produce same root"""
        leaves = [b'a', b'b', b'c', b'd']
        
        tree1 = MerkleTree(leaves)
        tree2 = MerkleTree(leaves)
        
        self.assertEqual(tree1.root(), tree2.root())


class TestAIR(unittest.TestCase):
    """Test Algebraic Intermediate Representation"""
    
    def setUp(self):
        self.field = CUDAFiniteField()
        self.air = AIR(self.field)
    
    def test_boundary_constraints(self):
        """Test boundary constraint extraction"""
        trace = [10, 11, 12, 13, 14]
        constraints = self.air.boundary_constraints(trace)
        
        # Should have input and output constraints
        self.assertEqual(len(constraints), 2)
        self.assertEqual(constraints[0], (0, 10))  # First element
        self.assertEqual(constraints[1], (4, 14))  # Last element
    
    def test_transition_constraint_valid(self):
        """Test transition constraint with valid transition"""
        # trace[i+1] = trace[i] + 1
        current = 10
        next_val = 11
        
        result = self.air.transition_constraint(current, next_val, 0)
        self.assertEqual(result, 0)  # Constraint satisfied
    
    def test_transition_constraint_invalid(self):
        """Test transition constraint with invalid transition"""
        current = 10
        next_val = 15  # Should be 11
        
        result = self.air.transition_constraint(current, next_val, 0)
        self.assertNotEqual(result, 0)  # Constraint NOT satisfied
    
    def test_evaluate_all_constraints_valid(self):
        """Test evaluation of all constraints on valid trace"""
        # Valid trace: each element is previous + 1
        trace = [100 + i for i in range(10)]
        
        valid = self.air.evaluate_all_constraints(trace)
        self.assertTrue(valid)
    
    def test_evaluate_all_constraints_invalid(self):
        """Test evaluation of all constraints on invalid trace"""
        # Invalid trace: jump from 102 to 200
        trace = [100, 101, 102, 200, 201]
        
        valid = self.air.evaluate_all_constraints(trace)
        self.assertFalse(valid)


class TestFRI(unittest.TestCase):
    """Test Fast Reed-Solomon IOP"""
    
    def setUp(self):
        self.field = CUDAFiniteField()
        self.config = STARKConfig(trace_length=64, blowup_factor=4, num_queries=10)
        self.fri = FRI(self.field, self.config)
    
    def test_commit_phase(self):
        """Test FRI commit phase"""
        # Create simple polynomial
        coeffs = [i + 1 for i in range(32)]
        poly = Polynomial(coeffs, self.field)
        
        # Create domain
        domain = [self.field.pow(2, i) for i in range(128)]
        
        # Commit
        trees, challenges, polys = self.fri.commit(poly, domain)
        
        # Should have produced layers
        self.assertGreater(len(trees), 0)
        self.assertEqual(len(trees), len(challenges))
        self.assertEqual(len(polys), len(trees) + 1)
    
    def test_query_phase(self):
        """Test FRI query phase"""
        coeffs = [i + 1 for i in range(32)]
        poly = Polynomial(coeffs, self.field)
        domain = [self.field.pow(2, i) for i in range(128)]
        
        trees, challenges, polys = self.fri.commit(poly, domain)
        
        # Generate queries
        query_indices = [5, 10, 15, 20, 25]
        queries = self.fri.query(trees, challenges, polys, query_indices)
        
        self.assertEqual(len(queries), len(query_indices))
        for query in queries:
            self.assertIn('index', query)
            self.assertIn('layers', query)


class TestCUDATrueSTARK(unittest.TestCase):
    """Test full STARK system"""
    
    def setUp(self):
        self.stark = CUDATrueSTARK()
    
    def test_initialization(self):
        """Test STARK system initialization"""
        status = self.stark.get_status()
        
        self.assertEqual(status['protocol'], 'ZK-STARK (AIR + FRI)')
        self.assertEqual(status['field_prime_bits'], 521)
        self.assertIn('cuda_available', status)
    
    def test_trace_generation(self):
        """Test execution trace generation"""
        statement = {'claim': 'test'}
        witness = {'secret_value': 42}
        
        trace = self.stark.generate_execution_trace(statement, witness)
        
        # Trace should have correct length
        self.assertEqual(len(trace), self.stark.config.trace_length)
        
        # Trace should satisfy AIR constraints
        valid = self.stark.air.evaluate_all_constraints(trace)
        self.assertTrue(valid)
    
    def test_proof_generation(self):
        """Test proof generation"""
        statement = {'claim': 'age >= 21', 'threshold': 21}
        witness = {'age': 25, 'secret_value': 12345}
        
        proof = self.stark.generate_proof(statement, witness)
        
        # Check proof structure
        self.assertIn('proof', proof)
        self.assertIn('trace_merkle_root', proof['proof'])
        self.assertIn('fri_roots', proof['proof'])
        self.assertIn('query_responses', proof['proof'])
        self.assertEqual(proof['proof']['protocol'], 'ZK-STARK (AIR + FRI)')
        self.assertTrue(proof['proof']['air_satisfied'])
    
    def test_proof_verification_valid(self):
        """Test verification of valid proof"""
        statement = {'claim': 'score >= 50', 'threshold': 50}
        witness = {'score': 75, 'secret_value': 99999}
        
        proof = self.stark.generate_proof(statement, witness)
        valid = self.stark.verify_proof(proof, statement)
        
        self.assertTrue(valid)
    
    def test_proof_verification_wrong_statement(self):
        """Test that proof fails verification with wrong statement"""
        statement1 = {'claim': 'test1'}
        statement2 = {'claim': 'test2'}  # Different statement
        witness = {'secret_value': 123}
        
        proof = self.stark.generate_proof(statement1, witness)
        valid = self.stark.verify_proof(proof, statement2)
        
        self.assertFalse(valid)
    
    def test_proof_verification_tampered_merkle_root(self):
        """Test that tampered proof is rejected"""
        statement = {'claim': 'test'}
        witness = {'secret_value': 456}
        
        proof = self.stark.generate_proof(statement, witness)
        
        # Tamper with Merkle root
        proof['proof']['trace_merkle_root'] = 'a' * 64
        
        valid = self.stark.verify_proof(proof, statement)
        self.assertFalse(valid)
    
    def test_proof_verification_tampered_statement_hash(self):
        """Test that tampered statement hash is rejected"""
        statement = {'claim': 'test'}
        witness = {'secret_value': 789}
        
        proof = self.stark.generate_proof(statement, witness)
        
        # Tamper with statement hash
        proof['proof']['statement_hash'] = '12345'
        
        valid = self.stark.verify_proof(proof, statement)
        self.assertFalse(valid)
    
    def test_proof_determinism(self):
        """Test that proofs are deterministic for same inputs"""
        statement = {'claim': 'determinism_test'}
        witness = {'secret_value': 111}
        
        proof1 = self.stark.generate_proof(statement, witness)
        proof2 = self.stark.generate_proof(statement, witness)
        
        # Statement hashes should be identical
        self.assertEqual(
            proof1['proof']['statement_hash'],
            proof2['proof']['statement_hash']
        )
    
    def test_different_witnesses_different_proofs(self):
        """Test that different witnesses produce different proofs"""
        statement = {'claim': 'witness_test'}
        witness1 = {'secret_value': 100}
        witness2 = {'secret_value': 200}
        
        proof1 = self.stark.generate_proof(statement, witness1)
        proof2 = self.stark.generate_proof(statement, witness2)
        
        # Merkle roots should be different
        self.assertNotEqual(
            proof1['proof']['trace_merkle_root'],
            proof2['proof']['trace_merkle_root']
        )


class TestSecurityProperties(unittest.TestCase):
    """Test security properties of the STARK system"""
    
    def setUp(self):
        self.stark = CUDATrueSTARK()
    
    def test_zero_knowledge(self):
        """Test zero-knowledge property - witness not in proof"""
        statement = {'claim': 'secret_test'}
        witness = {'secret_value': 42424242, 'password': 'supersecret123'}
        
        proof = self.stark.generate_proof(statement, witness)
        proof_str = json.dumps(proof)
        
        # Witness values should not appear in proof
        self.assertNotIn('42424242', proof_str)
        self.assertNotIn('supersecret123', proof_str)
    
    def test_soundness_random_proof_rejected(self):
        """Test soundness - random/fake proofs are rejected"""
        statement = {'claim': 'soundness_test'}
        
        # Create fake proof
        fake_proof = {
            'proof': {
                'version': 'STARK-2.0',
                'trace_merkle_root': 'deadbeef' * 8,
                'fri_roots': ['cafebabe' * 8],
                'statement_hash': '12345',
                'field_prime': str(self.stark.prime),
                'query_responses': [],
                'air_satisfied': True
            }
        }
        
        valid = self.stark.verify_proof(fake_proof, statement)
        self.assertFalse(valid)
    
    def test_completeness(self):
        """Test completeness - valid proofs always verify"""
        # Generate multiple proofs with different inputs
        test_cases = [
            ({'claim': 'test1'}, {'value': 1}),
            ({'claim': 'test2', 'threshold': 100}, {'value': 50}),
            ({'claim': 'test3', 'data': [1,2,3]}, {'secret': 999}),
        ]
        
        for statement, witness in test_cases:
            proof = self.stark.generate_proof(statement, witness)
            valid = self.stark.verify_proof(proof, statement)
            self.assertTrue(valid, f"Failed for statement: {statement}")
    
    def test_binding(self):
        """Test binding - proof is bound to specific statement"""
        statement1 = {'claim': 'binding_test_1'}
        statement2 = {'claim': 'binding_test_2'}
        witness = {'secret': 123}
        
        proof = self.stark.generate_proof(statement1, witness)
        
        # Should verify with original statement
        self.assertTrue(self.stark.verify_proof(proof, statement1))
        
        # Should fail with different statement
        self.assertFalse(self.stark.verify_proof(proof, statement2))


class TestPerformance(unittest.TestCase):
    """Test performance characteristics"""
    
    def setUp(self):
        self.stark = CUDATrueSTARK()
    
    def test_proof_generation_time(self):
        """Test that proof generation completes in reasonable time"""
        statement = {'claim': 'performance_test'}
        witness = {'secret_value': 12345}
        
        start = time.time()
        proof = self.stark.generate_proof(statement, witness)
        elapsed = time.time() - start
        
        # Should complete within 30 seconds (even without CUDA)
        self.assertLess(elapsed, 30.0)
        
        # Generation time should be recorded in proof
        self.assertIn('generation_time', proof['proof'])
    
    def test_verification_time(self):
        """Test that verification is fast"""
        statement = {'claim': 'verification_time_test'}
        witness = {'secret_value': 54321}
        
        proof = self.stark.generate_proof(statement, witness)
        
        start = time.time()
        valid = self.stark.verify_proof(proof, statement)
        elapsed = time.time() - start
        
        # Verification should be much faster than generation
        self.assertLess(elapsed, 5.0)
        self.assertTrue(valid)
    
    def test_batch_performance(self):
        """Test performance with multiple proofs"""
        statement = {'claim': 'batch_test'}
        
        proofs = []
        start = time.time()
        
        for i in range(5):
            witness = {'secret_value': i * 1000}
            proof = self.stark.generate_proof(statement, witness)
            proofs.append(proof)
        
        elapsed = time.time() - start
        avg_time = elapsed / 5
        
        # Average should be reasonable
        self.assertLess(avg_time, 10.0)
        
        # All proofs should be valid
        for proof in proofs:
            self.assertTrue(self.stark.verify_proof(proof, statement))


def run_all_tests():
    """Run all test suites"""
    print("\n" + "=" * 70)
    print("[TEST] CUDA TRUE STARK COMPREHENSIVE TEST SUITE")
    print("=" * 70)
    print(f"\n[INFO] CUDA Available: {CUDA_AVAILABLE}")
    print("[INFO] Running tests...\n")
    
    # Create test suite
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # Add all test classes
    test_classes = [
        TestFieldOperations,
        TestPolynomial,
        TestMerkleTree,
        TestAIR,
        TestFRI,
        TestCUDATrueSTARK,
        TestSecurityProperties,
        TestPerformance,
    ]
    
    for test_class in test_classes:
        tests = loader.loadTestsFromTestCase(test_class)
        suite.addTests(tests)
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Summary
    print("\n" + "=" * 70)
    print("[SUMMARY] TEST RESULTS")
    print("=" * 70)
    print(f"Tests Run: {result.testsRun}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print(f"Skipped: {len(result.skipped)}")
    
    success = len(result.failures) == 0 and len(result.errors) == 0
    print(f"\n{'[PASS] ALL TESTS PASSED!' if success else '[FAIL] SOME TESTS FAILED'}")
    print("=" * 70)
    
    return success


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)
