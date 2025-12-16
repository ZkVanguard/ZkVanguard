"""Test API round-trip serialization"""
import requests
import json
import time

print("=" * 60)
print("API SERIALIZATION ROUND-TRIP TEST")
print("=" * 60)

# Generate proof via API
print("\n[1/2] Generating proof via API...")
resp = requests.post('http://localhost:8000/api/zk/generate', json={
    'proof_type': 'settlement',
    'data': {
        'batch_id': 'roundtrip_test',
        'amount': 2000
    }
})

job_id = resp.json().get('job_id')
print(f"✅ Job ID: {job_id}")

time.sleep(3)

# Get proof
status_resp = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}')
proof = status_resp.json().get('proof', {})

print("\n[2/2] Analyzing proof data types...")
print(f"\nStatement Hash:")
print(f"  Value: {proof.get('statement_hash')}")
print(f"  Type: {type(proof.get('statement_hash')).__name__}")
print(f"  Is string: {isinstance(proof.get('statement_hash'), str)}")
print(f"  Is int: {isinstance(proof.get('statement_hash'), int)}")

print(f"\nChallenge:")
print(f"  Value: {str(proof.get('challenge'))[:50]}...")
print(f"  Type: {type(proof.get('challenge')).__name__}")

print(f"\nResponse:")
print(f"  Value: {str(proof.get('response'))[:50]}...")
print(f"  Type: {type(proof.get('response')).__name__}")

print(f"\nQuery Responses:")
qrs = proof.get('query_responses', [])
if qrs:
    print(f"  Count: {len(qrs)}")
    print(f"  First index type: {type(qrs[0].get('index')).__name__}")
    print(f"  First value type: {type(qrs[0].get('value')).__name__}")

print(f"\nPrivacy Enhancements:")
pe = proof.get('privacy_enhancements', {})
for field in ['witness_blinding', 'multi_polynomial']:
    value = pe.get(field)
    print(f"  {field}: {value} (type: {type(value).__name__})")

# The issue: API returns strings, verification expects ints
# The parse_string_ints_to_int function should convert them back
print("\n" + "=" * 60)
print("CONCLUSION:")
print("=" * 60)
print("API returns cryptographic values as STRINGS (for lossless transport)")
print("Verification endpoint must parse them back to INT")
print("Boolean fields must remain BOOLEAN")
