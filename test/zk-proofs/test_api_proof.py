#!/usr/bin/env python3
"""Test proof generation for API"""
import json
import sys

try:
    from zkp.core.zk_system import AuthenticZKStark
    
    # Sample data (portfolio risk scenario)
    statement = {
        "claim": "portfolio_risk_assessment",
        "threshold": 100,
        "portfolio_id": "DEMO_001"
    }
    
    witness = {
        "actual_risk_score": 75,
        "portfolio_value": 2500000,
        "leverage": 2.5,
        "volatility": 0.35,
        "field_prime": 6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151
    }
    
    print("Initializing ZK system...", file=sys.stderr)
    zk = AuthenticZKStark()
    
    print("Generating proof...", file=sys.stderr)
    result = zk.generate_proof(statement, witness)
    
    print("Proof generated successfully", file=sys.stderr)
    
    # Output JSON result
    output = {
        "success": True,
        "proof": result["proof"],
        "statement": statement,
        "scenario": "portfolio_risk"
    }
    
    print(json.dumps(output))
    
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc(file=sys.stderr)
    print(json.dumps({"success": False, "error": str(e)}))
    sys.exit(1)
