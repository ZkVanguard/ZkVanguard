import requests
import time

# Generate proof
print("=== Generating Proof ===")
gen_resp = requests.post("http://localhost:8000/api/zk/generate", json={
    "proof_type": "settlement",
    "data": {
        "public_inputs": [100],
        "claim": "settlement_proof"
    }
})
job_id = gen_resp.json()["job_id"]
print(f"Job ID: {job_id}\n")

# Get proof
time.sleep(0.5)
proof_resp = requests.get(f"http://localhost:8000/api/zk/proof/{job_id}")
proof_data = proof_resp.json()["proof"]

print("=== Query Responses Types ===")
query_responses = proof_data.get('query_responses', [])
print(f"Number of query responses: {len(query_responses)}")
if len(query_responses) > 0:
    first_qr = query_responses[0]
    print(f"First query response:")
    print(f"  index type: {type(first_qr['index'])} = {first_qr['index']}")
    print(f"  value type: {type(first_qr['value'])} = {str(first_qr['value'])[:50]}...")
    print(f"  proof type: {type(first_qr['proof'])}")

print("\n=== Manual Conversion Test ===")
def parse_string_ints_to_int(obj):
    """Recursively convert string integers back to int"""
    if isinstance(obj, str):
        if obj.isdigit() or (obj.startswith('-') and obj[1:].isdigit()):
            try:
                return int(obj)
            except (ValueError, OverflowError):
                return obj
        return obj
    elif isinstance(obj, dict):
        return {k: parse_string_ints_to_int(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [parse_string_ints_to_int(item) for item in obj]
    return obj

converted_proof = parse_string_ints_to_int(proof_data)
converted_qr = converted_proof['query_responses'][0]
print(f"After conversion:")
print(f"  index type: {type(converted_qr['index'])}")
print(f"  value type: {type(converted_qr['value'])}")

# Try verification with original
print("\n=== Test 1: With original (strings) ===")
verify_resp1 = requests.post("http://localhost:8000/api/zk/verify", json={
    "proof": proof_data,
    "public_inputs": [100],
    "claim": "settlement_proof"
})
print(f"Valid: {verify_resp1.json()['valid']}")

# Try with converted
print("\n=== Test 2: With converted (ints) ===")
verify_resp2 = requests.post("http://localhost:8000/api/zk/verify", json={
    "proof": converted_proof,
    "public_inputs": [100],
    "claim": "settlement_proof"
})
print(f"Valid: {verify_resp2.json()['valid']}")
