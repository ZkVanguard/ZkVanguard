import requests
import json

# Generate a proof first
print("=== Generating Proof ===")
gen_resp = requests.post("http://localhost:8000/api/zk/generate", json={
    "proof_type": "settlement",
    "data": {
        "public_inputs": [100],
        "claim": "settlement_proof"
    }
})
gen_data = gen_resp.json()
print(f"Generate response: {gen_data}")
job_id = gen_data["job_id"]
print(f"Job ID: {job_id}")

# Get the proof
import time
time.sleep(0.5)
proof_resp = requests.get(f"http://localhost:8000/api/zk/proof/{job_id}")
proof_data = proof_resp.json()["proof"]

print(f"\n=== Proof Data Types ===")
print(f"statement_hash: {type(proof_data['statement_hash'])} = {proof_data['statement_hash']}")
print(f"challenge: {type(proof_data['challenge'])} = {str(proof_data['challenge'])[:50]}...")
print(f"response: {type(proof_data['response'])} = {str(proof_data['response'])[:50]}...")

# Try verification
print(f"\n=== Calling Verify Endpoint ===")
verify_resp = requests.post("http://localhost:8000/api/zk/verify", json={
    "proof": proof_data,
    "public_inputs": [100],
    "claim": "settlement_proof"
})

result = verify_resp.json()
print(f"Valid: {result['valid']}")

# Now manually parse and show types
print(f"\n=== Manual Type Conversion ===")
def parse_int(v):
    if isinstance(v, str) and v.isdigit():
        return int(v)
    return v

proof_converted = {
    k: parse_int(v) for k, v in proof_data.items()
}

print(f"After conversion:")
print(f"statement_hash: {type(proof_converted['statement_hash'])}")
print(f"challenge: {type(proof_converted['challenge'])}")
print(f"response: {type(proof_converted['response'])}")
