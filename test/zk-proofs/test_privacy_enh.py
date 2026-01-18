import requests
import time
import json

# Generate proof via API
print("=== Generating Proof via API ===")
gen_resp = requests.post("http://localhost:8000/api/zk/generate", json={
    "proof_type": "settlement",
    "data": {
        "public_inputs": [100],
        "claim": "settlement_proof"
    }
})
job_id = gen_resp.json()["job_id"]
print(f"Job ID: {job_id}\n")

# Get proof from API
time.sleep(0.5)
proof_resp = requests.get(f"http://localhost:8000/api/zk/proof/{job_id}")
proof_from_api = proof_resp.json()["proof"]

print("=== Raw Privacy Enhancements from API ===")
privacy_enh = proof_from_api.get('privacy_enhancements', {})
print(f"privacy_enhancements: {privacy_enh}")
print(f"Type: {type(privacy_enh)}")
for key, value in privacy_enh.items():
    print(f"  {key}: {value} (type: {type(value)})")

print("\n=== Raw JSON Response ===")
print(json.dumps(proof_from_api.get('privacy_enhancements'), indent=2))
