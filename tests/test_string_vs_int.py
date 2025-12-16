import requests
import json
import time

# Generate a proof
print("=== Generating Proof ===")
gen_resp = requests.post("http://localhost:8000/api/zk/generate", json={
    "proof_type": "settlement",
    "data": {
        "public_inputs": [100],
        "claim": "settlement_proof"
    }
})
job_id = gen_resp.json()["job_id"]
print(f"Job ID: {job_id}")

# Wait and get proof
time.sleep(0.5)
proof_resp = requests.get(f"http://localhost:8000/api/zk/proof/{job_id}")
proof_data = proof_resp.json()["proof"]

print(f"\n=== Original Proof (strings) ===")
print(f"statement_hash type: {type(proof_data['statement_hash'])}")
print(f"challenge type: {type(proof_data['challenge'])}")
print(f"response type: {type(proof_data['response'])}")

# Test 1: Verify with strings (current behavior)
print(f"\n=== Test 1: Verify with strings ===")
verify_resp = requests.post("http://localhost:8000/api/zk/verify", json={
    "proof": proof_data,
    "public_inputs": [100],
    "claim": "settlement_proof"
})
print(f"Result: {verify_resp.json()['valid']}")

# Test 2: Manually convert to integers before sending
print(f"\n=== Test 2: Verify with manual int conversion ===")
def convert_to_int(obj):
    """Convert string integers to int"""
    if isinstance(obj, str) and (obj.isdigit() or (obj.startswith('-') and obj[1:].isdigit())):
        return int(obj)
    elif isinstance(obj, dict):
        return {k: convert_to_int(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_int(item) for item in obj]
    return obj

proof_with_ints = convert_to_int(proof_data)
print(f"After conversion:")
print(f"statement_hash type: {type(proof_with_ints['statement_hash'])}")
print(f"challenge type: {type(proof_with_ints['challenge'])}")
print(f"response type: {type(proof_with_ints['response'])}")

verify_resp2 = requests.post("http://localhost:8000/api/zk/verify", json={
    "proof": proof_with_ints,
    "public_inputs": [100],
    "claim": "settlement_proof"
})
print(f"Result: {verify_resp2.json()['valid']}")

# Check if both have same result
print(f"\n=== Comparison ===")
print(f"String version valid: {verify_resp.json()['valid']}")
print(f"Int version valid: {verify_resp2.json()['valid']}")
