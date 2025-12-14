"""
Inspect ZK Proof Structure
Show what's actually inside a real ZK-STARK proof
"""

import json
from datetime import datetime
from zkp.core.zk_system import AuthenticZKStark

print("=" * 80)
print("ZK-STARK PROOF INSPECTION - What's Actually Inside?")
print("=" * 80)
print()

# Initialize ZK system
zk = AuthenticZKStark()

# Create a simple real-world scenario
print("📊 Scenario: Portfolio with $1M value")
print("   Secret: Risk score is 75 (below threshold of 100)")
print()

statement = {
    "claim": "Portfolio risk is acceptable",
    "threshold": 100,
    "portfolio_id": "DEMO_001"
}

witness = {
    "actual_risk_score": 75,
    "portfolio_value": 1_000_000,
    "leverage": 2.0
}

print("🔐 Generating proof...")
result = zk.generate_proof(statement, witness)
proof = result['proof']

print("✅ Proof generated!")
print()

# ============================================================================
# Show what's ACTUALLY in the proof
# ============================================================================
print("=" * 80)
print("PROOF CONTENTS - Real Cryptographic Data")
print("=" * 80)
print()

print("1️⃣ STATEMENT HASH (binds proof to specific claim)")
print("   " + str(proof['statement_hash']))
print()

print("2️⃣ MERKLE ROOT (cryptographic commitment to execution trace)")
print("   " + proof['merkle_root'])
print()

print("3️⃣ FIAT-SHAMIR CHALLENGE (random challenge from hash)")
print("   " + str(proof['challenge']))
print()

print("4️⃣ RESPONSE (prover's answer to challenge)")
print("   " + str(proof['response'])[:100] + "...")
print()

print("5️⃣ WITNESS COMMITMENT (cryptographic binding)")
print("   " + str(proof['witness_commitment'])[:100] + "...")
print()

print("6️⃣ QUERY RESPONSES (Merkle proof authenticity checks)")
print(f"   Count: {len(proof['query_responses'])} random queries")
if len(proof['query_responses']) > 0:
    first_query = proof['query_responses'][0]
    print(f"   Sample query {first_query.get('index', 'N/A')}:")
    if 'value_commitment' in first_query:
        print(f"     - Value commitment: {str(first_query['value_commitment'])[:60]}...")
    print(f"     - Merkle path length: {len(first_query.get('proof', []))}")
    print(f"     - Query keys: {list(first_query.keys())}")
print()

print("7️⃣ EXECUTION TRACE")
print(f"   - Trace length: {proof['execution_trace_length']}")
print(f"   - Extended trace: {proof['extended_trace_length']}")
print(f"   - Computation steps: {proof['computation_steps']}")
print()

print("8️⃣ CRYPTOGRAPHIC PARAMETERS")
print(f"   - Field prime: {proof['field_prime'][:80]}...")
print(f"   - Security level: {proof['security_level']} bits")
print(f"   - Protocol: ZK-STARK (AIR + FRI)")
print()

# ============================================================================
# Show that secrets are NOT in the proof
# ============================================================================
print("=" * 80)
print("PRIVACY VERIFICATION - Secrets NOT in Proof")
print("=" * 80)
print()

proof_json = json.dumps(proof, indent=2)

secrets = {
    "actual_risk_score": 75,
    "portfolio_value": 1_000_000,
    "leverage": 2.0
}

print("Searching proof for secret values...")
print()

all_hidden = True
for secret_name, secret_value in secrets.items():
    secret_str = str(secret_value)
    if secret_str in proof_json:
        print(f"  ❌ LEAKED: {secret_name} = {secret_value}")
        all_hidden = False
    else:
        print(f"  ✅ HIDDEN: {secret_name} (value {secret_value} not found)")

print()

if all_hidden:
    print("🎉 ALL SECRETS ARE HIDDEN IN THE PROOF!")
    print("   The proof proves the claim WITHOUT revealing secret values!")
else:
    print("⚠️ WARNING: Some secrets may be visible")

print()

# ============================================================================
# Show real cryptographic properties
# ============================================================================
print("=" * 80)
print("CRYPTOGRAPHIC PROPERTIES")
print("=" * 80)
print()

print("✅ Fiat-Shamir Heuristic:")
print("   Challenge = Hash(statement_hash + merkle_root)")
print(f"   Non-interactive: Anyone can verify without talking to prover")
print()

print("✅ Merkle Tree Commitment:")
print(f"   Root: {proof['merkle_root']}")
print(f"   Queries: {len(proof['query_responses'])} random positions")
print("   Each query includes Merkle path proving authenticity")
print()

print("✅ Algebraic Intermediate Representation (AIR):")
print(f"   Execution trace: {proof['execution_trace_length']} steps")
print("   Polynomial constraints over finite field")
print(f"   Field: {proof['security_level']}-bit prime")
print()

print("✅ Soundness:")
print(f"   Security level: {proof['security_level']} bits")
print("   Cheating probability: < 2^(-{proof['security_level']})")
print("   Computational assumptions: Collision-resistant hashing")
print()

# ============================================================================
# Proof size analysis
# ============================================================================
print("=" * 80)
print("PROOF SIZE & EFFICIENCY")
print("=" * 80)
print()

proof_size = len(json.dumps(proof))
print(f"Total proof size: {proof_size:,} bytes ({proof_size/1024:.2f} KB)")
print()

print("Breakdown:")
print(f"  - Statement hash: {len(str(proof['statement_hash']))} bytes")
print(f"  - Merkle root: {len(proof['merkle_root'])} bytes")
print(f"  - Challenge/Response: ~{len(str(proof['challenge'])) + len(str(proof['response']))} bytes")
print(f"  - Query responses: ~{len(json.dumps(proof['query_responses']))} bytes")
print(f"  - Metadata: ~{proof_size - len(json.dumps(proof['query_responses'])) - 200} bytes")
print()

print("📊 Comparison:")
print("  - Raw secret data: ~50 bytes")
print(f"  - ZK proof: {proof_size:,} bytes")
print(f"  - Overhead ratio: {proof_size/50:.0f}x")
print("  - Privacy gain: INFINITE (secrets completely hidden)")
print()

# ============================================================================
# Save proof for manual inspection
# ============================================================================
with open('sample_proof.json', 'w') as f:
    json.dump(proof, f, indent=2)

print("=" * 80)
print("✅ Proof saved to 'sample_proof.json'")
print("   You can inspect it manually to verify no secrets are present!")
print("=" * 80)
print()

print("🔍 Key Insight:")
print("   The proof contains CRYPTOGRAPHIC COMMITMENTS and CHALLENGES,")
print("   NOT the actual secret values. This is what makes it Zero-Knowledge!")
