#!/usr/bin/env python3
"""
CLI tool to verify ZK-STARK proofs from command line
"""

import sys
import json
import argparse
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.true_stark import TrueZKStark
from core.zk_system import AuthenticZKStark


def verify_proof_cli():
    """Verify ZK-STARK proof from command line arguments"""
    parser = argparse.ArgumentParser(description='Verify ZK-STARK proof')
    parser.add_argument('--proof', required=True, help='Proof JSON')
    parser.add_argument('--statement', required=True, help='Statement JSON')
    parser.add_argument('--use-authentic', action='store_true', help='Use AuthenticZKStark')
    
    args = parser.parse_args()
    
    try:
        # Parse inputs
        proof = json.loads(args.proof)
        statement = json.loads(args.statement)
        
        # Choose ZK system
        if args.use_authentic:
            zk_system = AuthenticZKStark(enhanced_privacy=False)
        else:
            zk_system = TrueZKStark()
        
        # Verify proof
        verified = zk_system.verify_proof(proof, statement)
        
        # Output result
        output = {
            'success': True,
            'verified': verified,
            'protocol': proof.get('protocol', 'ZK-STARK')
        }
        
        print(json.dumps(output))
        sys.exit(0)
        
    except Exception as e:
        error_output = {
            'success': False,
            'error': str(e),
            'verified': False
        }
        print(json.dumps(error_output), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    verify_proof_cli()
