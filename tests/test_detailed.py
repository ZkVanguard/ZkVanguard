import requests
import json

# Test 1: Generate proof
print("=== Test 1: Generate Proof ===")
gen_resp = requests.post("http://localhost:8000/api/zk/generate", json={
    "proof_type": "settlement",
    "data": {"payments": [{"amount": 100}]},
    "portfolio_id": 1
})
job_id = gen_resp.json()["job_id"]
print(f"Job ID: {job_id}")

import time
time.sleep(3)

# Test 2: Get proof and check serialization
print("\n=== Test 2: Get Proof ===")
proof_resp = requests.get(f"http://localhost:8000/api/zk/proof/{job_id}")
proof_data = proof_resp.json()

print(f"Proof status: {proof_data['status']}")
print(f"statement_hash type: {type(proof_data['proof']['statement_hash'])}")
print(f"statement_hash: {proof_data['proof']['statement_hash']}")

# Test 3: Manual verification with exact values
print("\n=== Test 3: Verify with Exact Hash ===")

# The expected hash for "settlement_proof"
expected_hash = "44620813622430180211862061922014157571665447624715181525936334993318593500646"
actual_hash = str(proof_data['proof']['statement_hash'])

print(f"Expected: {expected_hash}")
print(f"Actual:   {actual_hash}")
print(f"Match: {expected_hash == actual_hash}")

# Test 4: Verify proof
print("\n=== Test 4: Call Verify Endpoint ===")
verify_resp = requests.post("http://localhost:8000/api/zk/verify", json={
    "proof": proof_data['proof'],
    "public_inputs": [100],
    "claim": "settlement_proof"
})

verify_data = verify_resp.json()
print(f"Valid: {verify_data['valid']}")
print(f"Duration: {verify_data['duration_ms']}ms")

# Test 5: Try parsing manually
print("\n=== Test 5: Manual Parse Test ===")
test_hash_str = proof_data['proof']['statement_hash']
print(f"String: {test_hash_str}")
print(f"Type: {type(test_hash_str)}")
test_hash_int = int(test_hash_str)
print(f"Parsed to int: {test_hash_int}")
print(f"Type after parse: {type(test_hash_int)}")
