"""Full API test with proper verification call"""
import requests
import json
import time

print("FULL END-TO-END API TEST\n" + "=" * 60)

# Step 1: Generate proof
print("\n[1/3] Generating proof...")
claim_data = {
    'batch_id': 'e2e_test',
    'amount': 3000,
    'count': 5
}

gen_resp = requests.post('http://localhost:8000/api/zk/generate', json={
    'proof_type': 'settlement',
    'data': claim_data
})

if gen_resp.status_code != 200:
    print(f"❌ Generation failed: {gen_resp.status_code}")
    print(gen_resp.text)
    exit(1)

job_id = gen_resp.json().get('job_id')
print(f"✅ Job ID: {job_id}")

# Step 2: Wait and retrieve proof
print("\n[2/3] Retrieving proof...")
time.sleep(3)

proof_resp = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
if proof_resp.status_code != 200:
    print(f"❌ Failed to get proof: {proof_resp.status_code}")
    exit(1)

proof_data = proof_resp.json()
proof = proof_data.get('proof', {})
claim_from_proof = proof_data.get('claim')  # Get the actual claim used during generation

# Check types
print(f"Proof statement_hash type: {type(proof.get('statement_hash')).__name__}")
print(f"Proof challenge type: {type(proof.get('challenge')).__name__}")
print(f"Proof response type: {type(proof.get('response')).__name__}")

pe = proof.get('privacy_enhancements', {})
print(f"witness_blinding: {pe.get('witness_blinding')} (type: {type(pe.get('witness_blinding')).__name__})")

# Step 3: Verify proof
print("\n[3/3] Verifying proof...")

# Use the EXACT claim from proof generation
claim_str = claim_from_proof if claim_from_proof else json.dumps(claim_data, sort_keys=True)

verify_payload = {
    'proof': proof,
    'public_inputs': [],
    'claim': claim_str
}

print(f"Sending verification request...")
print(f"  Claim: {claim_str}")

verify_resp = requests.post('http://localhost:8000/api/zk/verify', json=verify_payload)

print(f"Verification response status: {verify_resp.status_code}")

if verify_resp.status_code != 200:
    print(f"❌ Verification request failed")
    print(f"Response: {verify_resp.text}")
    exit(1)

verify_result = verify_resp.json()
is_valid = verify_result.get('valid')

print(f"\n{'='*60}")
print(f"VERIFICATION RESULT: {is_valid}")
print(f"{'='*60}")

if is_valid:
    print("✅ PROOF VERIFIED SUCCESSFULLY!")
    print(f"   Verified at: {verify_result.get('verified_at')}")
    print(f"   Duration: {verify_result.get('duration_ms')}ms")
else:
    print("❌ VERIFICATION FAILED")
    print(f"   Message: {verify_result.get('message', 'No message')}")

print(f"\nCheck server terminal for DEBUG output...")
