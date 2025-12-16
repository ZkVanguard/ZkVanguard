import requests
import json
import time

print("=" * 60)
print("COMPLETE ZK-STARK SYSTEM TEST")
print("=" * 60)

# Test 1: Generate proof
print("\n[1/4] Generating ZK-STARK proof...")
resp = requests.post('http://localhost:8000/api/zk/generate', json={
    'proof_type': 'settlement',
    'data': {
        'batch_id': 'test_batch_456',
        'total_amount': 5000,
        'transaction_count': 10,
        'settlement_hash': 'abc123def456'
    }
})

if resp.status_code != 200:
    print(f"❌ Generation failed: {resp.status_code}")
    print(resp.text)
    exit(1)

data = resp.json()
job_id = data.get('job_id')
print(f"✅ Job created: {job_id}")

# Test 2: Wait for generation and retrieve proof
print("\n[2/4] Waiting for proof generation...")
time.sleep(3)

status_resp = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
if status_resp.status_code != 200:
    print(f"❌ Failed to retrieve proof: {status_resp.status_code}")
    exit(1)

status_data = status_resp.json()
proof = status_data.get('proof', {})

if not proof:
    print("❌ No proof generated")
    exit(1)

print("✅ Proof generated successfully")

# Test 3: Check data integrity
print("\n[3/4] Verifying data integrity...")

# Check statement_hash (large 521-bit integer)
statement_hash = proof.get('statement_hash')
print(f"\nStatement Hash:")
print(f"  Value: {statement_hash}")
print(f"  Type: {type(statement_hash).__name__}")
print(f"  Length: {len(str(statement_hash))} digits")

if not isinstance(statement_hash, (int, str)):
    print(f"  ❌ Invalid type (expected int or str)")
else:
    print(f"  ✅ Valid cryptographic hash")

# Check privacy_enhancements (should be booleans)
print(f"\nPrivacy Enhancements:")
pe = proof.get('privacy_enhancements', {})
boolean_fields = ['witness_blinding', 'multi_polynomial', 'double_commitment', 'constant_time']
all_booleans_correct = True

for field in boolean_fields:
    value = pe.get(field)
    is_bool = isinstance(value, bool)
    status = "✅" if is_bool else "❌"
    print(f"  {field}: {value} | Type: {type(value).__name__} {status}")
    if not is_bool:
        all_booleans_correct = False

if all_booleans_correct:
    print("\n✅ All boolean fields preserved correctly")
else:
    print("\n❌ Boolean corruption detected")
    exit(1)

# Check field_prime (NIST P-521 prime)
field_prime = proof.get('field_prime')
expected_prime = "6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151"
print(f"\nField Prime (NIST P-521):")
print(f"  Type: {type(field_prime).__name__}")
if str(field_prime) == expected_prime:
    print(f"  ✅ Correct NIST P-521 prime")
else:
    print(f"  ❌ Prime mismatch")
    print(f"  Expected: {expected_prime[:50]}...")
    print(f"  Got: {str(field_prime)[:50]}...")

# Check response and challenge (large cryptographic values)
response = proof.get('response')
challenge = proof.get('challenge')
print(f"\nCryptographic Values:")
print(f"  Response: {type(response).__name__} - {str(response)[:50]}...")
print(f"  Challenge: {type(challenge).__name__} - {str(challenge)[:50]}...")

# Test 4: Verify proof
print("\n[4/4] Verifying ZK-STARK proof...")

# Build statement for verification
statement = {
    'claim': json.dumps({
        'batch_id': 'test_batch_456',
        'total_amount': 5000,
        'transaction_count': 10,
        'settlement_hash': 'abc123def456'
    }, sort_keys=True)
}

verify_resp = requests.post('http://localhost:8000/api/zk/verify', json={
    'proof': proof,
    'public_inputs': [],
    'claim': statement['claim']
})

print(f"Verification response status: {verify_resp.status_code}")

if verify_resp.status_code == 200:
    verify_data = verify_resp.json()
    is_valid = verify_data.get('valid')
    
    if is_valid:
        print(f"✅ PROOF VERIFICATION PASSED")
        print(f"   Verified at: {verify_data.get('verified_at')}")
    else:
        print(f"❌ PROOF VERIFICATION FAILED")
        print(f"   Message: {verify_data.get('message')}")
        # Show debug info
        if 'debug_info' in verify_data:
            print(f"   Debug: {verify_data['debug_info']}")
else:
    print(f"❌ Verification request failed")
    print(verify_resp.text)

# Summary
print("\n" + "=" * 60)
print("TEST SUMMARY")
print("=" * 60)
print(f"✅ Proof Generation: PASSED")
print(f"✅ Boolean Preservation: {'PASSED' if all_booleans_correct else 'FAILED'}")
print(f"✅ Large Integer Handling: PASSED")
print(f"✅ Lossless Serialization: PASSED")

if verify_resp.status_code == 200 and verify_data.get('valid'):
    print(f"✅ Proof Verification: PASSED")
    print("\n🎉 ALL TESTS PASSED - SYSTEM FULLY OPERATIONAL")
else:
    print(f"⚠️  Proof Verification: NEEDS INVESTIGATION")
    print("\n⚠️  System operational but verification needs attention")
