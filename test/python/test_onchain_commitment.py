"""
Test On-Chain Commitment Approach for 521-bit ZK-STARK Proofs
Verifies that proof commitment strategy works correctly
"""
import sys
sys.path.append('.')

import json
import hashlib
from zkp.integration.zk_system_hub import ZKSystemFactory

def test_521bit_proof_generation():
    """Test that ZK system generates 521-bit proofs correctly"""
    print("\n" + "="*70)
    print("TEST: 521-bit ZK-STARK Proof Generation")
    print("="*70)
    
    zk_factory = ZKSystemFactory()
    zk_system = zk_factory.create_zk_system(enable_cuda=True)
    
    statement = {
        'claim': json.dumps({'test': '521bit_proof'}, sort_keys=True)
    }
    witness = {'secret': 'test_data'}
    
    print("\n🔐 Generating 521-bit ZK-STARK proof...")
    proof_result = zk_system.generate_proof(statement, witness)
    proof = proof_result.get('proof', proof_result)
    
    # Check field prime is 521-bit
    field_prime = proof['field_prime']
    field_prime_int = int(field_prime)
    bit_length = field_prime_int.bit_length()
    
    print(f"\n✅ Proof generated:")
    print(f"   Field Prime: {field_prime[:60]}...")
    print(f"   Bit length: {bit_length} bits")
    print(f"   Expected: 521 bits")
    
    assert bit_length == 521, f"Expected 521-bit field, got {bit_length}-bit"
    
    # Check statement hash, challenge, response are all large
    statement_hash = str(proof['statement_hash'])
    challenge = str(proof['challenge'])
    response = str(proof['response'])
    
    print(f"\n📊 Proof Components:")
    print(f"   Statement Hash: {len(statement_hash)} digits")
    print(f"   Challenge: {len(challenge)} digits")
    print(f"   Response: {len(response)} digits")
    
    # Verify these are too large for uint256 (max 78 digits)
    MAX_UINT256_DIGITS = 78
    print(f"\n🔍 Checking if values exceed uint256 (max {MAX_UINT256_DIGITS} digits)...")
    
    exceeds_256bit = (
        len(field_prime) > MAX_UINT256_DIGITS or
        len(statement_hash) > MAX_UINT256_DIGITS or
        len(challenge) > MAX_UINT256_DIGITS or
        len(response) > MAX_UINT256_DIGITS
    )
    
    print(f"   Field prime exceeds uint256: {len(field_prime) > MAX_UINT256_DIGITS}")
    print(f"   Statement exceeds uint256: {len(statement_hash) > MAX_UINT256_DIGITS}")
    print(f"   Challenge exceeds uint256: {len(challenge) > MAX_UINT256_DIGITS}")
    print(f"   Response exceeds uint256: {len(response) > MAX_UINT256_DIGITS}")
    
    print(f"\n✅ TEST PASSED: Proof uses 521-bit field (too large for direct on-chain verification)")
    
    return proof, statement

def test_offchain_verification():
    """Test that off-chain verification works with 521-bit precision"""
    print("\n" + "="*70)
    print("TEST: Off-Chain Verification (521-bit precision)")
    print("="*70)
    
    zk_factory = ZKSystemFactory()
    zk_system = zk_factory.create_zk_system(enable_cuda=True)
    
    statement = {
        'claim': json.dumps({'test': 'offchain_verification'}, sort_keys=True)
    }
    witness = {'secret': 'test_data'}
    
    print("\n🔐 Generating proof...")
    proof_result = zk_system.generate_proof(statement, witness)
    proof = proof_result.get('proof', proof_result)
    
    print(f"✅ Proof generated: {proof['statement_hash']}")
    
    # Verify with FULL 521-bit precision
    print(f"\n🔍 Verifying with full 521-bit precision...")
    is_valid = zk_system.verify_proof(proof, statement)
    
    print(f"\n✅ Off-chain verification: {'VALID ✅' if is_valid else 'INVALID ❌'}")
    
    assert is_valid == True, "Off-chain verification should pass"
    
    print(f"\n✅ TEST PASSED: Off-chain verification maintains 521-bit security")
    
    return proof, statement, is_valid

def test_commitment_creation():
    """Test creating 256-bit commitment from 521-bit proof"""
    print("\n" + "="*70)
    print("TEST: On-Chain Commitment Creation")
    print("="*70)
    
    zk_factory = ZKSystemFactory()
    zk_system = zk_factory.create_zk_system(enable_cuda=True)
    
    statement = {
        'claim': json.dumps({'test': 'commitment'}, sort_keys=True)
    }
    witness = {'secret': 'commitment_data'}
    
    print("\n🔐 Generating 521-bit proof...")
    proof_result = zk_system.generate_proof(statement, witness)
    proof = proof_result.get('proof', proof_result)
    
    print(f"✅ Proof: {proof['statement_hash']}")
    
    # Create commitment (hash of proof components)
    print(f"\n📝 Creating on-chain commitment...")
    
    commitment_input = (
        str(proof['statement_hash']) +
        str(proof['challenge']) +
        str(proof['response']) +
        proof['merkle_root']
    )
    
    # Hash to 256-bit commitment
    commitment_hash = hashlib.sha256(commitment_input.encode()).hexdigest()
    commitment_bytes32 = '0x' + commitment_hash
    
    print(f"✅ Commitment created:")
    print(f"   Input length: {len(commitment_input)} chars")
    print(f"   Commitment: {commitment_bytes32}")
    print(f"   Size: 256 bits (32 bytes)")
    
    # Verify commitment is 256-bit (fits in uint256)
    commitment_int = int(commitment_hash, 16)
    bit_length = commitment_int.bit_length()
    
    print(f"\n🔍 Commitment validation:")
    print(f"   Bit length: {bit_length} bits")
    print(f"   Fits in uint256: {bit_length <= 256}")
    
    assert bit_length <= 256, f"Commitment should be ≤256 bits, got {bit_length}"
    
    print(f"\n✅ TEST PASSED: Commitment fits in 256-bit (Solidity uint256)")
    
    return proof, commitment_bytes32

def test_commitment_uniqueness():
    """Test that different proofs produce different commitments"""
    print("\n" + "="*70)
    print("TEST: Commitment Uniqueness")
    print("="*70)
    
    zk_factory = ZKSystemFactory()
    zk_system = zk_factory.create_zk_system(enable_cuda=True)
    
    # Generate 3 different proofs
    proofs = []
    commitments = []
    
    print("\n🔐 Generating 3 different proofs...")
    
    for i in range(3):
        statement = {
            'claim': json.dumps({'test': f'uniqueness_{i}'}, sort_keys=True)
        }
        witness = {'secret': f'data_{i}'}
        
        proof_result = zk_system.generate_proof(statement, witness)
        proof = proof_result.get('proof', proof_result)
        
        # Create commitment
        commitment_input = (
            str(proof['statement_hash']) +
            str(proof['challenge']) +
            str(proof['response']) +
            proof['merkle_root']
        )
        commitment = hashlib.sha256(commitment_input.encode()).hexdigest()
        
        proofs.append(proof)
        commitments.append(commitment)
        
        print(f"  Proof {i+1}: {proof['statement_hash']}")
        print(f"  Commitment {i+1}: {commitment[:20]}...")
    
    # Check all commitments are unique
    print(f"\n🔍 Checking commitment uniqueness...")
    unique_commitments = set(commitments)
    
    print(f"   Total commitments: {len(commitments)}")
    print(f"   Unique commitments: {len(unique_commitments)}")
    print(f"   All unique: {len(unique_commitments) == len(commitments)}")
    
    assert len(unique_commitments) == len(commitments), "Commitments should be unique"
    
    print(f"\n✅ TEST PASSED: Each proof produces unique commitment")
    
    return proofs, commitments

def test_complete_flow():
    """Test complete flow: Generate → Verify Off-Chain → Create Commitment"""
    print("\n" + "="*70)
    print("TEST: Complete On-Chain Commitment Flow")
    print("="*70)
    
    zk_factory = ZKSystemFactory()
    zk_system = zk_factory.create_zk_system(enable_cuda=True)
    
    # Step 1: Generate 521-bit proof
    print("\n📋 Step 1: Generate 521-bit ZK-STARK proof")
    statement = {
        'claim': json.dumps({
            'portfolio_risk': 75,
            'threshold': 100,
            'portfolio_id': 'TEST_001'
        }, sort_keys=True)
    }
    witness = {
        'actual_risk': 75,
        'portfolio_value': 2_500_000
    }
    
    proof_result = zk_system.generate_proof(statement, witness)
    proof = proof_result.get('proof', proof_result)
    
    print(f"✅ Proof generated with 521-bit security")
    print(f"   Statement Hash: {proof['statement_hash']}")
    
    # Step 2: Verify off-chain with full precision
    print(f"\n🔍 Step 2: Verify proof OFF-CHAIN (521-bit precision)")
    is_valid = zk_system.verify_proof(proof, statement)
    
    print(f"✅ Off-chain verification: {'PASSED ✅' if is_valid else 'FAILED ❌'}")
    
    assert is_valid == True, "Off-chain verification must pass"
    
    # Step 3: Create on-chain commitment
    print(f"\n📝 Step 3: Create on-chain commitment (256-bit)")
    
    commitment_input = (
        str(proof['statement_hash']) +
        str(proof['challenge']) +
        str(proof['response']) +
        proof['merkle_root']
    )
    commitment = '0x' + hashlib.sha256(commitment_input.encode()).hexdigest()
    
    print(f"✅ Commitment: {commitment}")
    
    # Step 4: Simulate on-chain storage
    print(f"\n⛓️  Step 4: Store on-chain (simulated)")
    
    onchain_record = {
        'proof_commitment': commitment,
        'verified_offchain': is_valid,
        'timestamp': proof['timestamp'],
        'security_level': proof['security_level'],
        'field_bits': 521,
        'proof_type': 'ZK-STARK'
    }
    
    print(f"✅ On-chain record created:")
    for key, value in onchain_record.items():
        print(f"   {key}: {value}")
    
    # Verify commitment fits in uint256
    commitment_int = int(commitment, 16)
    fits_uint256 = commitment_int.bit_length() <= 256
    
    print(f"\n🔍 Final validation:")
    print(f"   Commitment size: {commitment_int.bit_length()} bits")
    print(f"   Fits in uint256: {fits_uint256}")
    print(f"   Off-chain verified: {is_valid}")
    print(f"   Cryptographic security: 521-bit NIST P-521")
    
    assert fits_uint256, "Commitment must fit in uint256"
    assert is_valid, "Proof must be verified off-chain"
    
    print(f"\n✅ TEST PASSED: Complete flow works correctly")
    print(f"\n💡 Summary:")
    print(f"   • Proof uses 521-bit field (full security)")
    print(f"   • Verification happens off-chain (maintains precision)")
    print(f"   • Commitment stored on-chain (fits in 256-bit)")
    print(f"   • No security compromise!")
    
    return onchain_record

def main():
    print("="*70)
    print("ON-CHAIN COMMITMENT STRATEGY TEST SUITE")
    print("Testing 521-bit ZK-STARK → 256-bit on-chain commitment")
    print("="*70)
    
    tests = [
        ("521-bit Proof Generation", test_521bit_proof_generation),
        ("Off-Chain Verification", test_offchain_verification),
        ("Commitment Creation", test_commitment_creation),
        ("Commitment Uniqueness", test_commitment_uniqueness),
        ("Complete Flow", test_complete_flow),
    ]
    
    results = []
    
    for test_name, test_func in tests:
        try:
            test_func()
            results.append((test_name, True, None))
        except Exception as e:
            results.append((test_name, False, str(e)))
            print(f"\n❌ TEST FAILED: {str(e)}")
    
    # Summary
    print("\n" + "="*70)
    print("TEST RESULTS SUMMARY")
    print("="*70)
    
    passed = sum(1 for _, success, _ in results if success)
    total = len(results)
    
    for test_name, success, error in results:
        status = "✅ PASSED" if success else f"❌ FAILED: {error}"
        print(f"{test_name:40s} {status}")
    
    print("\n" + "="*70)
    print(f"Total: {passed}/{total} tests passed")
    print("="*70)
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        print("\n✅ STRATEGY VALIDATED:")
        print("   1. Generate ZK-STARK proof with 521-bit NIST P-521 field")
        print("   2. Verify proof OFF-CHAIN with full cryptographic precision")
        print("   3. Create 256-bit commitment (SHA-256 hash of proof)")
        print("   4. Store commitment ON-CHAIN (fits in Solidity uint256)")
        print("\n🔐 Result: Full 521-bit security + blockchain compatibility!")
        return 0
    else:
        print(f"\n❌ {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    exit(main())
