import requests
import time
from zkp.integration.zk_system_hub import ZKSystemFactory

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
print(f"Job ID: {job_id}")

# Get proof from API
time.sleep(0.5)
proof_resp = requests.get(f"http://localhost:8000/api/zk/proof/{job_id}")
proof_from_api = proof_resp.json()["proof"]

print(f"\n=== Proof from API ===")
print(f"Type of statement_hash: {type(proof_from_api['statement_hash'])}")
print(f"Type of challenge: {type(proof_from_api['challenge'])}")
print(f"Type of response: {type(proof_from_api['response'])}")
print(f"Type of first query_response value: {type(proof_from_api['query_responses'][0]['value'])}")

# Convert strings to ints
def parse_string_ints_to_int(obj):
    if isinstance(obj, str) and (obj.isdigit() or (obj.startswith('-') and obj[1:].isdigit())):
        try:
            return int(obj)
        except (ValueError, OverflowError):
            return obj
    elif isinstance(obj, dict):
        return {k: parse_string_ints_to_int(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [parse_string_ints_to_int(item) for item in obj]
    return obj

proof_with_ints = parse_string_ints_to_int(proof_from_api)

print(f"\n=== After Conversion ===")
print(f"Type of statement_hash: {type(proof_with_ints['statement_hash'])}")
print(f"Type of challenge: {type(proof_with_ints['challenge'])}")
print(f"Type of response: {type(proof_with_ints['response'])}")
print(f"Type of first query_response value: {type(proof_with_ints['query_responses'][0]['value'])}")

# Verify directly in Python
print(f"\n=== Direct Python Verification ===")
factory = ZKSystemFactory()
zk_system = factory.create_zk_system(enable_cuda=True)

statement = {
    "claim": "settlement_proof",
    "public_inputs": [100]
}

try:
    is_valid = zk_system.verify_proof(proof_with_ints, statement)
    print(f"Result: {is_valid}")
except Exception as e:
    print(f"Exception: {type(e).__name__}: {str(e)}")
    import traceback
    traceback.print_exc()

# Also try via API
print(f"\n=== API Verification ===")
verify_resp = requests.post("http://localhost:8000/api/zk/verify", json={
    "proof": proof_from_api,
    "public_inputs": [100],
    "claim": "settlement_proof"
})
print(f"Result: {verify_resp.json()['valid']}")
