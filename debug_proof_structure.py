#!/usr/bin/env python3
"""Debug script to check proof structure"""
import requests
import json
import time

# Generate proof
r = requests.post('http://localhost:8000/api/zk/generate', json={
    'proof_type': 'settlement', 
    'data': {'statement': {'claim': 'test'}, 'witness': {'secret': 1}}
})
job = r.json()
job_id = job['job_id']
print(f"Job ID: {job_id}")

# Wait for completion
time.sleep(3)
status = requests.get(f'http://localhost:8000/api/zk/proof/{job_id}').json()

proof = status.get('proof', {})
print(f"\nProof top-level keys: {list(proof.keys())}")
print(f"Has nested 'proof' key: {'proof' in proof}")
print(f"Has query_responses: {'query_responses' in proof}")
print(f"Query_responses length: {len(proof.get('query_responses', []))}")

# Save full proof structure
with open('debug_proof.json', 'w') as f:
    json.dump(proof, f, indent=2, default=str)
print("\nFull proof saved to debug_proof.json")
