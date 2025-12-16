import requests
import json

# Generate proof
print("=== Generating Proof ===")
gen_response = requests.post("http://localhost:8000/api/zk/generate", json={
    "proof_type": "settlement",
    "data": {"payments": [{"amount": 100}]},
    "portfolio_id": 1
})
job_id = gen_response.json()["job_id"]
print(f"Job ID: {job_id}")

# Wait for completion
import time
time.sleep(3)

# Get proof
proof_response = requests.get(f"http://localhost:8000/api/zk/proof/{job_id}")
proof_data = proof_response.json()
print(f"Status: {proof_data['status']}")
print(f"Duration: {proof_data.get('duration_ms')}ms\n")

if proof_data["status"] == "completed":
    # Check types before sending
    print("=== Proof Data Types ===")
    print(f"statement_hash type: {type(proof_data['proof']['statement_hash'])}")
    print(f"statement_hash value: {str(proof_data['proof']['statement_hash'])[:60]}...")
    print(f"challenge type: {type(proof_data['proof']['challenge'])}")
    print(f"response type: {type(proof_data['proof']['response'])}")
    
    # Verify proof
    print("\n=== Verifying Proof ===")
    verify_response = requests.post("http://localhost:8000/api/zk/verify", json={
        "proof": proof_data["proof"],
        "public_inputs": [100],
        "claim": "settlement_proof"
    })
    verify_data = verify_response.json()
    print(f"\n{'='*50}")
    print(f"✅ VALID: {verify_data['valid']}")
    print(f"✅ DURATION: {verify_data['duration_ms']}ms")
    print(f"✅ CUDA: {verify_data['cuda_accelerated']}")
    print(f"{'='*50}")
