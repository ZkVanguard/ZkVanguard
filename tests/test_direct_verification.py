from zkp.integration.zk_system_hub import ZKSystemFactory
import time

# Create ZK system
print("=== Creating ZK System ===")
factory = ZKSystemFactory()
zk_system = factory.create_zk_system(enable_cuda=True)

# Generate a proof
print("\n=== Generating Proof ===")
statement = {
    "claim": "settlement_proof",
    "type": "settlement",
    "portfolio_id": None,
    "public_inputs": [100]
}
witness = {
    "settlement_data": "test",
    "amount": 1000
}

proof_result = zk_system.generate_proof(statement, witness)
print(f"Proof generated successfully")

# Extract proof
proof = proof_result.get('proof', proof_result)
print(f"Proof keys: {list(proof.keys())}")
print(f"statement_hash: {proof['statement_hash']}")
print(f"challenge: {proof['challenge']}")

# Try verification with just the claim (like API does)
print("\n=== Verifying Proof (with claim only) ===")
verify_statement = {
    "claim": "settlement_proof",
    "public_inputs": [100]
}

try:
    is_valid = zk_system.verify_proof(proof, verify_statement)
    print(f"Verification result: {is_valid}")
except Exception as e:
    print(f"Verification failed with exception: {type(e).__name__}: {str(e)}")
    import traceback
    traceback.print_exc()

# Try verification with full statement
print("\n=== Verifying Proof (with full statement) ===")
try:
    is_valid2 = zk_system.verify_proof(proof, statement)
    print(f"Verification result: {is_valid2}")
except Exception as e:
    print(f"Verification failed with exception: {type(e).__name__}: {str(e)}")
    import traceback
    traceback.print_exc()
