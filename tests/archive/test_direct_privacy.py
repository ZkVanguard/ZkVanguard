import sys
sys.path.insert(0, 'zkp')

from zkp.integration.zk_system_hub import ZKSystemFactory

# Create ZK system and generate proof directly
factory = ZKSystemFactory()
zk_system = factory.create_zk_system(enable_cuda=True)

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

print("=== Generating Proof Directly (No API) ===")
proof_result = zk_system.generate_proof(statement, witness)
proof = proof_result.get('proof', proof_result)

print(f"\n=== Privacy Enhancements (Direct) ===")
privacy_enh = proof.get('privacy_enhancements', {})
print(f"privacy_enhancements: {privacy_enh}")
for key, value in privacy_enh.items():
    print(f"  {key}: {value} (type: {type(value)}, repr: {repr(value)})")
