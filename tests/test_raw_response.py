import requests
import time

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

time.sleep(1)

# Get raw response
proof_resp = requests.get(f"http://localhost:8000/api/zk/proof/{job_id}")

print("\n=== Raw Response Text ===")
# Find the privacy_enhancements part in raw JSON
import re
match = re.search(r'"privacy_enhancements":\s*\{[^}]+\}', proof_resp.text)
if match:
    print(match.group(0))

# Also check the content directly
print("\n=== Parsed Value ===")
data = proof_resp.json()
pe = data['proof']['privacy_enhancements']
print(f"privacy_enhancements: {pe}")

# Check if it might be related to timestamp or something
print(f"\n=== Job Timestamp ===")
print(f"timestamp: {data.get('timestamp')}")
