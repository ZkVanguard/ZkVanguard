import requests
import hashlib
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
print(f"Job ID: {job_id}\n")

# Wait and get proof
time.sleep(0.5)
proof_resp = requests.get(f"http://localhost:8000/api/zk/proof/{job_id}")
proof_data = proof_resp.json()["proof"]

print("=== Proof Data ===")
print(f"statement_hash: {proof_data['statement_hash']}")
print(f"merkle_root: {proof_data['merkle_root']}")
print(f"challenge: {proof_data['challenge']}")
print(f"field_prime: {proof_data['field_prime']}\n")

# Manually compute what the statement hash SHOULD be
print("=== Manual Computation ===")
claim = "settlement_proof"
prime_str = "6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151"
prime = int(prime_str)

# Hash the claim
hash_bytes = hashlib.sha3_256(claim.encode()).hexdigest()
expected_statement_hash = int(hash_bytes, 16) % prime
print(f"Expected statement_hash: {expected_statement_hash}")
print(f"Actual statement_hash:   {proof_data['statement_hash']}")
print(f"Match: {str(expected_statement_hash) == str(proof_data['statement_hash'])}\n")

# Manually compute expected challenge
challenge_input = str(expected_statement_hash) + proof_data['merkle_root']
print(f"Challenge input: {challenge_input[:100]}...")
expected_challenge = int(hashlib.sha3_256(challenge_input.encode()).hexdigest(), 16) % prime
print(f"Expected challenge: {expected_challenge}")
print(f"Actual challenge:   {proof_data['challenge']}")
print(f"Match: {str(expected_challenge) == str(proof_data['challenge'])}\n")

# Now try verification
print("=== Verification Test ===")
verify_resp = requests.post("http://localhost:8000/api/zk/verify", json={
    "proof": proof_data,
    "public_inputs": [100],
    "claim": "settlement_proof"
})
result = verify_resp.json()
print(f"Valid: {result['valid']}")
print(f"Duration: {result.get('duration_ms', 'N/A')}ms")
