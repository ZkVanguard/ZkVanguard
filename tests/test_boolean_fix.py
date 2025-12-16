import requests
import json
import time

# Generate proof
resp = requests.post('http://localhost:8000/api/zk/generate', json={
    'proof_type': 'settlement',
    'data': {
        'batch_id': 'test_batch_123',
        'total_amount': 1000,
        'transaction_count': 5
    }
})

print('Status:', resp.status_code)
data = resp.json()
job_id = data.get('job_id')
print('Job ID:', job_id)

# Wait for generation
time.sleep(3)

# Check proof
status_resp = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
status_data = status_resp.json()

print('\n=== Privacy Enhancements ===')
proof = status_data.get('proof', {})
pe = proof.get('privacy_enhancements', {})
print(f'witness_blinding: {pe.get("witness_blinding")} | Type: {type(pe.get("witness_blinding")).__name__}')
print(f'multi_polynomial: {pe.get("multi_polynomial")} | Type: {type(pe.get("multi_polynomial")).__name__}')
print(f'double_commitment: {pe.get("double_commitment")} | Type: {type(pe.get("double_commitment")).__name__}')
print(f'constant_time: {pe.get("constant_time")} | Type: {type(pe.get("constant_time")).__name__}')

# Test verification
print('\n=== Verification ===')
if proof:
    verify_resp = requests.post('http://localhost:8000/api/zk/verify', json={
        'proof': proof,
        'proof_type': 'settlement',
        'data': {
            'batch_id': 'test_batch_123',
            'total_amount': 1000,
            'transaction_count': 5
        }
    })
    print(f'Verify Status: {verify_resp.status_code}')
    verify_data = verify_resp.json()
    print(f'Valid: {verify_data.get("valid")}')
    print(f'Message: {verify_data.get("message")}')
else:
    print('No proof available for verification')
