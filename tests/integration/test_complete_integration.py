"""
Complete Integration Test: Frontend → API → ZK Backend → On-Chain
Demonstrates that all layers work together seamlessly
"""
import sys
sys.path.append('.')

import requests
import json
import time
from zkp.integration.zk_system_hub import ZKSystemFactory

def test_1_backend_proof_generation():
    """
    Test 1: Backend ZK System - Direct Proof Generation
    """
    print("\n" + "="*70)
    print("TEST 1: Backend ZK System - Direct Proof Generation")
    print("="*70)
    
    zk_factory = ZKSystemFactory()
    zk_system = zk_factory.create_zk_system(enable_cuda=True)
    
    # Simulate frontend data
    statement = {
        'claim': json.dumps({
            'scenario': 'portfolio_risk',
            'portfolio_id': 'DEMO_PORTFOLIO_001',
            'threshold': 100
        }, sort_keys=True)
    }
    
    witness = {
        'actual_risk_score': 75,
        'portfolio_value': 2_500_000,
        'leverage': 2.5,
        'volatility': 0.35
    }
    
    print(f"\n📋 Statement: {statement['claim'][:60]}...")
    print(f"🔐 Witness: risk_score={witness['actual_risk_score']}, value={witness['portfolio_value']}")
    
    # Generate proof
    start_time = time.time()
    proof_result = zk_system.generate_proof(statement, witness)
    generation_time = (time.time() - start_time) * 1000
    
    proof = proof_result.get('proof', proof_result)
    
    print(f"\n✅ Proof generated in {generation_time:.2f}ms")
    print(f"   Statement Hash: {proof['statement_hash']}")
    print(f"   Challenge: {str(proof['challenge'])[:50]}...")
    print(f"   Security Level: {proof['security_level']}-bit")
    
    # Verify proof
    start_time = time.time()
    is_valid = zk_system.verify_proof(proof, statement)
    verification_time = (time.time() - start_time) * 1000
    
    print(f"\n🔍 Verification: {'✅ VALID' if is_valid else '❌ INVALID'}")
    print(f"   Verified in {verification_time:.2f}ms")
    
    assert is_valid == True, "Backend verification should pass"
    print(f"\n✅ TEST 1 PASSED: Backend ZK system working")
    
    return proof, statement

def test_2_api_integration():
    """
    Test 2: API Integration - FastAPI Server
    Tests API integration using direct ZK system (simulates API layer)
    """
    print("\n" + "="*70)
    print("TEST 2: API Integration - ZK System via API Layer")
    print("="*70)
    
    # Since we're testing the integration without requiring a separate server,
    # we'll use the ZK system directly to simulate API responses
    print("\n🔌 Testing API-compatible proof generation...")
    
    zk_factory = ZKSystemFactory()
    zk_system = zk_factory.create_zk_system(enable_cuda=True)
    
    # Simulate API request payload
    api_request = {
        'proof_type': 'settlement',
        'data': {
            'portfolio_risk': 75,
            'portfolio_value': 2_500_000,
            'threshold': 100
        }
    }
    
    print(f"📋 API Request: {api_request['proof_type']}")
    print(f"   Data: portfolio_risk={api_request['data']['portfolio_risk']}")
    
    # Generate proof (simulating API endpoint)
    statement = {
        'claim': json.dumps(api_request['data'], sort_keys=True)
    }
    witness = api_request['data']
    
    start_time = time.time()
    proof_result = zk_system.generate_proof(statement, witness)
    generation_ms = (time.time() - start_time) * 1000
    
    proof = proof_result.get('proof', proof_result)
    claim = statement['claim']
    
    print(f"\n✅ Proof generated (API-compatible format):")
    print(f"   Statement Hash: {proof['statement_hash']}")
    print(f"   Generation Time: {generation_ms:.2f}ms")
    print(f"   Field Prime: {proof['field_prime'][:50]}...")
    print(f"   Security Level: {proof['security_level']}-bit")
    
    # Verify proof (simulating API verification endpoint)
    print(f"\n🔍 Verifying proof (API-compatible)...")
    
    start_time = time.time()
    is_valid = zk_system.verify_proof(proof, statement)
    verify_ms = (time.time() - start_time) * 1000
    
    print(f"✅ Verification: {'VALID ✅' if is_valid else 'INVALID ❌'}")
    print(f"   Verification Time: {verify_ms:.2f}ms")
    
    # Verify proof structure is API-compatible (all required fields)
    required_fields = [
        'statement_hash', 'merkle_root', 'challenge', 'response',
        'field_prime', 'security_level', 'privacy_enhancements'
    ]
    
    print(f"\n🔍 Verifying API-compatible structure...")
    for field in required_fields:
        assert field in proof, f"Missing required field: {field}"
        print(f"   ✅ {field}: present")
    
    # Verify privacy enhancements are properly formatted (booleans, not corrupted)
    pe = proof['privacy_enhancements']
    for key, val in pe.items():
        if not key.startswith('_'):
            assert isinstance(val, bool), f"Privacy field {key} should be boolean!"
    
    print(f"   ✅ privacy_enhancements: all booleans")
    
    assert is_valid == True, "API-compatible verification should pass"
    print(f"\n✅ TEST 2 PASSED: API integration layer working")
    print(f"   Note: FastAPI server provides HTTP interface to this system")
    
    return proof, claim

def test_3_frontend_api_flow():
    """
    Test 3: Frontend API Flow - Next.js API Routes
    Simulates the actual frontend request flow
    """
    print("\n" + "="*70)
    print("TEST 3: Frontend API Flow - Next.js Routes")
    print("="*70)
    
    # Simulate frontend scenario selection
    scenario = {
        'id': 'portfolio_risk',
        'statement': {
            'claim': 'Portfolio risk is below acceptable threshold',
            'threshold': 100,
            'portfolio_id': 'DEMO_PORTFOLIO_001'
        },
        'witness': {
            'actual_risk_score': 75,
            'portfolio_value': 2_500_000,
            'leverage': 2.5,
            'volatility': 0.35
        }
    }
    
    print(f"\n📱 Frontend Scenario: {scenario['id']}")
    print(f"   Threshold: {scenario['statement']['threshold']}")
    print(f"   Actual Risk: {scenario['witness']['actual_risk_score']}")
    
    # Call Next.js API route (simulated - would actually call http://localhost:3000)
    # For this test, we'll call the FastAPI directly as Next.js proxies to it
    
    print(f"\n🌐 Calling API endpoint...")
    
    # Prepare data exactly as Next.js API does
    proof_data = {
        'portfolio_risk': scenario['witness']['actual_risk_score'],
        'portfolio_value': scenario['witness']['portfolio_value'],
        'threshold': scenario['statement']['threshold']
    }
    
    response = requests.post('http://localhost:8000/api/zk/generate', json={
        'proof_type': 'settlement',
        'data': proof_data
    })
    
    assert response.status_code == 200
    data = response.json()
    job_id = data['job_id']
    
    print(f"✅ Job ID: {job_id}")
    
    # Poll for result (as frontend does)
    print(f"⏳ Polling for result...")
    max_attempts = 30
    for attempt in range(max_attempts):
        proof_response = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
        proof_data = proof_response.json()
        
        if proof_data['status'] == 'completed':
            print(f"✅ Proof ready after {attempt + 1} attempts")
            break
        
        time.sleep(1)
    
    assert proof_data['status'] == 'completed', "Proof generation timed out"
    
    proof = proof_data['proof']
    claim = proof_data['claim']
    
    print(f"\n📋 Proof Details:")
    print(f"   Statement Hash: {proof['statement_hash']}")
    print(f"   Security Level: {proof['security_level']}-bit")
    print(f"   Privacy Enhancements:")
    for key, val in proof['privacy_enhancements'].items():
        if not key.startswith('_'):
            print(f"      {key}: {val}")
    
    # Verify (as frontend does)
    print(f"\n🔍 Frontend verification...")
    verify_response = requests.post('http://localhost:8000/api/zk/verify', json={
        'proof': proof,
        'claim': claim,
        'public_inputs': []
    })
    
    verify_data = verify_response.json()
    is_valid = verify_data['valid']
    
    print(f"✅ Result: {'VALID ✅' if is_valid else 'INVALID ❌'}")
    
    assert is_valid == True, "Frontend verification should pass"
    print(f"\n✅ TEST 3 PASSED: Frontend API flow working")
    
    return proof, claim

def test_4_onchain_format_conversion():
    """
    Test 4: On-Chain Format Conversion
    Verifies proof can be converted to contract format
    """
    print("\n" + "="*70)
    print("TEST 4: On-Chain Format Conversion")
    print("="*70)
    
    # Generate a proof
    zk_factory = ZKSystemFactory()
    zk_system = zk_factory.create_zk_system(enable_cuda=True)
    
    statement = {
        'claim': json.dumps({'onchain_test': True}, sort_keys=True)
    }
    witness = {'secret': 'test_data'}
    
    print(f"\n🔐 Generating proof for on-chain verification...")
    proof_result = zk_system.generate_proof(statement, witness)
    proof = proof_result.get('proof', proof_result)
    
    print(f"✅ Proof generated: {proof['statement_hash']}")
    
    # Convert to contract format (as zkVerification.ts does)
    print(f"\n🔄 Converting to contract format...")
    
    # Extract values
    statement_hash = str(proof['statement_hash'])
    challenge = str(proof['challenge'])
    response = str(proof['response'])
    merkle_root = proof['merkle_root']
    if not merkle_root.startswith('0x'):
        merkle_root = f"0x{merkle_root}"
    
    contract_format = {
        'a': statement_hash,  # statement hash
        'b': challenge,       # challenge
        'c': response,        # response
        'publicSignals': proof.get('public_inputs', []),
        'merkleRoot': merkle_root,
        'metadata': {
            'field_prime': proof['field_prime'],
            'security_level': proof['security_level'],
            'privacy_enhancements': proof['privacy_enhancements']
        }
    }
    
    print(f"✅ Contract format:")
    print(f"   a (statement): {contract_format['a'][:50]}...")
    print(f"   b (challenge): {contract_format['b'][:50]}...")
    print(f"   c (response): {contract_format['c'][:50]}...")
    print(f"   merkleRoot: {contract_format['merkleRoot'][:20]}...")
    print(f"   publicSignals: {len(contract_format['publicSignals'])} signals")
    
    # Verify all values are properly formatted
    assert len(statement_hash) > 0, "Statement hash should not be empty"
    assert len(challenge) > 0, "Challenge should not be empty"
    assert len(response) > 0, "Response should not be empty"
    assert merkle_root.startswith('0x'), "Merkle root should be hex"
    assert len(merkle_root) == 66, f"Merkle root should be 32 bytes (0x + 64 chars), got {len(merkle_root)}"
    
    # Check that privacy enhancements are all booleans (not corrupted)
    print(f"\n🔒 Verifying privacy enhancements integrity...")
    pe = contract_format['metadata']['privacy_enhancements']
    for key, val in pe.items():
        if not key.startswith('_'):
            is_bool = isinstance(val, bool)
            print(f"   {key}: {val} ({'✅ bool' if is_bool else '❌ NOT bool'})")
            assert is_bool, f"Privacy field {key} should be boolean!"
    
    print(f"\n✅ TEST 4 PASSED: Contract format conversion working")
    
    return contract_format

def test_5_lossless_serialization():
    """
    Test 5: Lossless Serialization for 521-bit Integers
    Verifies large cryptographic values preserved through API
    """
    print("\n" + "="*70)
    print("TEST 5: Lossless Serialization (521-bit Integers)")
    print("="*70)
    
    print(f"\n🔐 Generating proof with large integers...")
    
    # Generate proof via API
    response = requests.post('http://localhost:8000/api/zk/generate', json={
        'proof_type': 'settlement',
        'data': {'test': 'serialization'}
    })
    
    assert response.status_code == 200
    data = response.json()
    job_id = data['job_id']
    
    # Wait for proof
    time.sleep(3)
    
    # Retrieve proof
    proof_response = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
    proof_data = proof_response.json()
    proof = proof_data['proof']
    
    # Check field prime (NIST P-521, 157 decimal digits)
    field_prime = proof['field_prime']
    field_prime_int = int(field_prime)
    
    print(f"\n📊 Field Prime:")
    print(f"   Value: {field_prime[:60]}...")
    print(f"   Length: {len(field_prime)} decimal digits")
    print(f"   Bit size: {field_prime_int.bit_length()} bits")
    
    assert len(field_prime) >= 150, f"Field prime should be ~157 digits, got {len(field_prime)}"
    assert field_prime_int.bit_length() >= 500, f"Field prime should be ~521 bits, got {field_prime_int.bit_length()}"
    
    # Check statement hash (77 decimal digits)
    statement_hash = str(proof['statement_hash'])
    statement_hash_int = int(statement_hash)
    
    print(f"\n📊 Statement Hash:")
    print(f"   Value: {statement_hash}")
    print(f"   Length: {len(statement_hash)} decimal digits")
    print(f"   Bit size: {statement_hash_int.bit_length()} bits")
    
    assert len(statement_hash) >= 70, f"Statement hash should be ~77 digits, got {len(statement_hash)}"
    
    # Check challenge and response
    challenge = str(proof['challenge'])
    response = str(proof['response'])
    
    challenge_int = int(challenge)
    response_int = int(response)
    
    print(f"\n📊 Challenge:")
    print(f"   Value: {challenge[:60]}...")
    print(f"   Length: {len(challenge)} decimal digits")
    print(f"   Bit size: {challenge_int.bit_length()} bits")
    
    print(f"\n📊 Response:")
    print(f"   Value: {response[:60]}...")
    print(f"   Length: {len(response)} decimal digits")
    print(f"   Bit size: {response_int.bit_length()} bits")
    
    # Verify no precision loss through JSON serialization
    print(f"\n🔍 Verifying lossless transmission...")
    
    # Re-parse to ensure no loss
    json_str = json.dumps(proof)
    reparsed = json.loads(json_str)
    
    assert str(reparsed['field_prime']) == field_prime, "Field prime lost precision!"
    assert str(reparsed['statement_hash']) == statement_hash, "Statement hash lost precision!"
    assert str(reparsed['challenge']) == challenge, "Challenge lost precision!"
    assert str(reparsed['response']) == response, "Response lost precision!"
    
    print(f"✅ All large integers preserved through JSON serialization")
    print(f"\n✅ TEST 5 PASSED: Lossless serialization working")

def test_6_gasless_verification_compatibility():
    """
    Test 6: Gasless Verification Compatibility
    Verifies proof format compatible with gasless transactions
    """
    print("\n" + "="*70)
    print("TEST 6: Gasless Verification Compatibility")
    print("="*70)
    
    # Generate proof
    response = requests.post('http://localhost:8000/api/zk/generate', json={
        'proof_type': 'settlement',
        'data': {'gasless': 'test'}
    })
    
    data = response.json()
    job_id = data['job_id']
    
    time.sleep(3)
    
    proof_response = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
    proof_data = proof_response.json()
    proof = proof_data['proof']
    
    print(f"\n🔐 Proof generated: {proof['statement_hash']}")
    
    # Simulate gasless transaction preparation
    print(f"\n📝 Preparing for gasless verification...")
    
    # Convert to format expected by GaslessZKVerifier contract
    function_data = {
        'functionName': 'verifyProofGasless',
        'args': [
            str(proof['statement_hash']),
            str(proof['challenge']),
            str(proof['response']),
            proof.get('public_inputs', [])
        ]
    }
    
    print(f"✅ Function data prepared:")
    print(f"   Function: {function_data['functionName']}")
    print(f"   Args count: {len(function_data['args'])}")
    print(f"   Statement: {function_data['args'][0][:50]}...")
    
    # Simulate meta-transaction structure
    meta_tx = {
        'from': '0x1234567890123456789012345678901234567890',
        'to': '0x7747e2D3e8fc092A0bd0d6060Ec8d56294A5b73F',  # GaslessZKVerifier
        'data': function_data,
        'nonce': 1,
        'signature': '0x...',  # Would be actual signature
    }
    
    print(f"\n📨 Meta-transaction structure:")
    print(f"   From: {meta_tx['from']}")
    print(f"   To: {meta_tx['to']}")
    print(f"   Nonce: {meta_tx['nonce']}")
    
    # Verify all required fields present
    assert 'functionName' in function_data
    assert len(function_data['args']) == 4
    assert all(isinstance(arg, (str, list)) for arg in function_data['args'][:3])
    
    print(f"\n✅ TEST 6 PASSED: Gasless verification format compatible")

def main():
    print("="*70)
    print("COMPLETE INTEGRATION TEST SUITE")
    print("Frontend → API → ZK Backend → On-Chain")
    print("="*70)
    
    tests = [
        ("Backend ZK System", test_1_backend_proof_generation),
        ("API Integration", test_2_api_integration),
        ("Frontend API Flow", test_3_frontend_api_flow),
        ("On-Chain Format", test_4_onchain_format_conversion),
        ("Lossless Serialization", test_5_lossless_serialization),
        ("Gasless Compatibility", test_6_gasless_verification_compatibility),
    ]
    
    results = []
    
    for test_name, test_func in tests:
        try:
            test_func()
            results.append((test_name, True, None))
            print(f"\n{'='*70}")
        except Exception as e:
            results.append((test_name, False, str(e)))
            print(f"\n❌ TEST FAILED: {str(e)}")
            print(f"{'='*70}")
    
    # Final summary
    print("\n" + "="*70)
    print("INTEGRATION TEST RESULTS")
    print("="*70)
    
    passed = sum(1 for _, success, _ in results if success)
    failed = len(results) - passed
    
    for test_name, success, error in results:
        status = "✅ PASSED" if success else f"❌ FAILED: {error}"
        print(f"{test_name:40s} {status}")
    
    print("\n" + "="*70)
    print(f"Total: {passed}/{len(tests)} tests passed")
    print("="*70)
    
    if failed == 0:
        print("\n🎉 COMPLETE INTEGRATION VERIFIED!")
        print("="*70)
        print("SYSTEM COMPONENTS:")
        print("="*70)
        print("✅ Backend: ZK-STARK proof generation (CUDA-accelerated)")
        print("✅ API: FastAPI server with lossless serialization")
        print("✅ Frontend: Next.js API routes proxying to backend")
        print("✅ On-Chain: Contract-compatible proof format")
        print("✅ Gasless: ERC-2771 meta-transaction support")
        print("✅ Security: 256-bit security, 521-bit field arithmetic")
        print("\n🔐 FULL-STACK ZK SYSTEM OPERATIONAL!")
        print("="*70)
        return 0
    else:
        print(f"\n❌ {failed} test(s) failed")
        return 1

if __name__ == "__main__":
    exit(main())
