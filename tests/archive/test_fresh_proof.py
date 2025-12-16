import requests
import time

# Generate a FRESH proof
print("=== Generating NEW Proof ===")
gen_resp = requests.post("http://localhost:8000/api/zk/generate", json={
    "proof_type": "settlement",
    "data": {
        "public_inputs": [100],
        "claim": "settlement_proof"
    }
})
job_id = gen_resp.json()["job_id"]
print(f"Job ID: {job_id}")

# Wait for generation
print("\nWaiting for proof generation...")
time.sleep(1)

# Get the proof
proof_resp = requests.get(f"http://localhost:8000/api/zk/proof/{job_id}")
proof_data = proof_resp.json()["proof"]

# Check the raw HTTP response
print("\n=== Checking HTTP Response ===")
print(f"HTTP Status: {proof_resp.status_code}")
print(f"Content-Type: {proof_resp.headers.get('content-type')}")

# Check specific field
privacy = proof_data.get('privacy_enhancements', {})
print(f"\nprivacy_enhancements.witness_blinding:")
print(f"  Value: {privacy.get('witness_blinding')}")
print(f"  Type: {type(privacy.get('witness_blinding'))}")
print(f"  Repr: {repr(privacy.get('witness_blinding'))}")

# Also check if it might be stored in proof_metadata
metadata = proof_data.get('proof_metadata', {})
print(f"\nproof_metadata keys: {list(metadata.keys()) if metadata else 'None'}")
