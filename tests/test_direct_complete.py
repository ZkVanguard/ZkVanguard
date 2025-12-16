"""Direct verification test - bypass API to see actual ZK logic"""
import sys
sys.path.append('.')

from zkp.integration.zk_system_hub import ZKSystemFactory
import json
import time

print("=" * 60)
print("DIRECT ZK VERIFICATION TEST")
print("=" * 60)

# Create ZK system
print("\n[1/3] Creating ZK system...")
zk_factory = ZKSystemFactory()
zk_system = zk_factory.create_zk_system(enable_cuda=True)
print("✅ ZK system created")

# Generate proof
print("\n[2/3] Generating proof...")
statement = {
    'claim': json.dumps({
        'batch_id': 'direct_test',
        'amount': 1000
    }, sort_keys=True)
}

witness = {
    'secret_key': 'test_secret_123',
    'nonce': 42
}

start_time = time.time()
proof_result = zk_system.generate_proof(statement, witness)
gen_time = time.time() - start_time

proof = proof_result.get('proof', proof_result)
print(f"✅ Proof generated in {gen_time:.2f}s")

# Check proof data types
print("\n[3/3] Checking proof structure...")
print(f"\nStatement Hash:")
print(f"  Value: {proof.get('statement_hash')}")
print(f"  Type: {type(proof.get('statement_hash')).__name__}")

print(f"\nPrivacy Enhancements:")
pe = proof.get('privacy_enhancements', {})
for field in ['witness_blinding', 'multi_polynomial', 'double_commitment', 'constant_time']:
    value = pe.get(field)
    print(f"  {field}: {value} (type: {type(value).__name__})")

print(f"\nResponse: {type(proof.get('response')).__name__}")
print(f"Challenge: {type(proof.get('challenge')).__name__}")

# Verify proof directly
print("\n" + "=" * 60)
print("DIRECT VERIFICATION")
print("=" * 60)

start_time = time.time()
is_valid = zk_system.verify_proof(proof, statement)
verify_time = time.time() - start_time

print(f"\nVerification Result: {is_valid}")
print(f"Verification Time: {verify_time:.3f}s")

if is_valid:
    print("\n✅ DIRECT VERIFICATION PASSED")
    print("   ZK system logic is correct")
else:
    print("\n❌ DIRECT VERIFICATION FAILED")
    print("   Issue in ZK verification logic")
    
    # Debug type checking
    print("\nDEBUG: Type Analysis")
    print(f"  statement_hash is int: {isinstance(proof.get('statement_hash'), int)}")
    print(f"  challenge is int: {isinstance(proof.get('challenge'), int)}")
    print(f"  response is int: {isinstance(proof.get('response'), int)}")
    
    qrs = proof.get('query_responses', [])
    if qrs:
        print(f"  query_responses[0]['index'] is int: {isinstance(qrs[0].get('index'), int)}")
        print(f"  query_responses[0]['value'] is int: {isinstance(qrs[0].get('value'), int)}")
