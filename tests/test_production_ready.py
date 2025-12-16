"""
Production Readiness Test Suite
Tests all critical aspects of the ZK-STARK system
"""
import requests
import json
import time
import sys
sys.path.append('.')
from zkp.integration.zk_system_hub import ZKSystemFactory

def test_api_health():
    """Test 1: API Health Check"""
    print("\n[Test 1/6] API Health Check...")
    resp = requests.get('http://localhost:8000/health')
    assert resp.status_code == 200, "Health check failed"
    data = resp.json()
    assert data['status'] == 'healthy', "System not healthy"
    assert data['cuda_available'] == True, "CUDA not available"
    print("✅ API healthy with CUDA enabled")

def test_boolean_preservation():
    """Test 2: Boolean Field Preservation"""
    print("\n[Test 2/6] Boolean Preservation Test...")
    resp = requests.post('http://localhost:8000/api/zk/generate', json={
        'proof_type': 'settlement',
        'data': {'test': 'boolean_check'}
    })
    job_id = resp.json()['job_id']
    time.sleep(3)
    
    proof_resp = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
    proof = proof_resp.json()['proof']
    pe = proof['privacy_enhancements']
    
    for field in ['witness_blinding', 'multi_polynomial', 'double_commitment', 'constant_time']:
        assert isinstance(pe[field], bool), f"{field} is not bool"
        assert pe[field] == False, f"{field} should be False"
    
    print("✅ All boolean fields preserved correctly")

def test_large_integer_serialization():
    """Test 3: Lossless Large Integer Handling"""
    print("\n[Test 3/6] Large Integer Serialization Test...")
    resp = requests.post('http://localhost:8000/api/zk/generate', json={
        'proof_type': 'settlement',
        'data': {'test': 'integer_check'}
    })
    job_id = resp.json()['job_id']
    time.sleep(3)
    
    proof_resp = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
    proof = proof_resp.json()['proof']
    
    # Check that large integers are strings for transmission
    assert isinstance(proof['statement_hash'], str), "statement_hash should be string"
    assert len(proof['statement_hash']) > 70, "statement_hash should be large"
    assert isinstance(proof['challenge'], str), "challenge should be string"
    assert isinstance(proof['response'], str), "response should be string"
    
    # Check NIST P-521 prime is preserved
    expected_prime = "6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151"
    assert str(proof['field_prime']) == expected_prime, "NIST P-521 prime mismatch"
    
    print("✅ Large integers serialized losslessly")

def test_end_to_end_verification():
    """Test 4: Complete Verification Flow"""
    print("\n[Test 4/6] End-to-End Verification Test...")
    
    # Generate
    gen_resp = requests.post('http://localhost:8000/api/zk/generate', json={
        'proof_type': 'settlement',
        'data': {'batch': 'production_test', 'amount': 5000}
    })
    job_id = gen_resp.json()['job_id']
    time.sleep(3)
    
    # Retrieve
    proof_resp = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
    proof_data = proof_resp.json()
    proof = proof_data['proof']
    claim = proof_data['claim']
    
    # Verify
    verify_resp = requests.post('http://localhost:8000/api/zk/verify', json={
        'proof': proof,
        'public_inputs': [],
        'claim': claim
    })
    
    assert verify_resp.status_code == 200, "Verification request failed"
    result = verify_resp.json()
    assert result['valid'] == True, "Verification failed"
    
    print(f"✅ End-to-end verification passed (duration: {result.get('duration_ms')}ms)")

def test_direct_zk_logic():
    """Test 5: Direct ZK Logic Verification"""
    print("\n[Test 5/6] Direct ZK Logic Test...")
    
    zk_factory = ZKSystemFactory()
    zk_system = zk_factory.create_zk_system(enable_cuda=True)
    
    statement = {'claim': json.dumps({'test': 'direct_logic'}, sort_keys=True)}
    witness = {'secret': 'test_witness'}
    
    # Generate and verify directly
    proof_result = zk_system.generate_proof(statement, witness)
    proof = proof_result.get('proof', proof_result)
    
    is_valid = zk_system.verify_proof(proof, statement)
    assert is_valid == True, "Direct verification failed"
    
    print("✅ Direct ZK logic verification passed")

def test_performance():
    """Test 6: Performance Check"""
    print("\n[Test 6/6] Performance Test...")
    
    start = time.time()
    resp = requests.post('http://localhost:8000/api/zk/generate', json={
        'proof_type': 'settlement',
        'data': {'performance': 'test'}
    })
    job_id = resp.json()['job_id']
    
    time.sleep(3)
    
    proof_resp = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
    proof_data = proof_resp.json()
    
    gen_time = proof_data.get('duration_ms', 0)
    
    # Verify
    verify_start = time.time()
    verify_resp = requests.post('http://localhost:8000/api/zk/verify', json={
        'proof': proof_data['proof'],
        'public_inputs': [],
        'claim': proof_data['claim']
    })
    verify_time = (time.time() - verify_start) * 1000
    
    print(f"✅ Performance: Generation {gen_time}ms, Verification {verify_time:.0f}ms")
    
    # Performance assertions (includes CUDA system initialization overhead)
    assert gen_time < 100, f"Generation too slow: {gen_time}ms"
    # Verification includes ZK system initialization (~2s), actual verification is ~5ms
    assert verify_time < 3000, f"Verification too slow: {verify_time}ms"

def main():
    print("=" * 60)
    print("PRODUCTION READINESS TEST SUITE")
    print("=" * 60)
    
    tests = [
        test_api_health,
        test_boolean_preservation,
        test_large_integer_serialization,
        test_end_to_end_verification,
        test_direct_zk_logic,
        test_performance
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            failed += 1
            print(f"❌ {test.__name__} FAILED: {str(e)}")
    
    print("\n" + "=" * 60)
    print("PRODUCTION READINESS RESULTS")
    print("=" * 60)
    print(f"Passed: {passed}/{len(tests)}")
    print(f"Failed: {failed}/{len(tests)}")
    
    if failed == 0:
        print("\n🎉 SYSTEM IS PRODUCTION READY!")
        print("✅ All critical tests passed")
        print("✅ Boolean preservation working")
        print("✅ Lossless serialization working")
        print("✅ Verification working correctly")
        print("✅ Performance within acceptable limits")
        return 0
    else:
        print("\n❌ SYSTEM NOT READY FOR PRODUCTION")
        return 1

if __name__ == "__main__":
    exit(main())
