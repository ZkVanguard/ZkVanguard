#!/usr/bin/env python3
"""
CLI tool to generate ZK-STARK proofs from command line
Used by TypeScript integration layer
"""

import sys
import json
import argparse
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.true_stark import TrueZKStark
from core.zk_system import AuthenticZKStark


def generate_proof_cli():
    """Generate ZK-STARK proof from command line arguments"""
    parser = argparse.ArgumentParser(description='Generate ZK-STARK proof')
    parser.add_argument('--proof-type', required=True, help='Type of proof to generate')
    parser.add_argument('--statement', required=True, help='Statement JSON')
    parser.add_argument('--witness', required=True, help='Witness JSON')
    parser.add_argument('--use-authentic', action='store_true', help='Use AuthenticZKStark instead of TrueZKStark')
    
    args = parser.parse_args()
    
    try:
        # Parse inputs
        statement = json.loads(args.statement)
        witness = json.loads(args.witness)
        
        # Choose ZK system
        if args.use_authentic:
            zk_system = AuthenticZKStark(enhanced_privacy=False)
        else:
            zk_system = TrueZKStark()
        
        # Generate proof
        result = zk_system.generate_proof(statement, witness)
        
        # Verify proof
        verified = zk_system.verify_proof(result['proof'], statement)
        
        # Output result as JSON
        output = {
            'success': True,
            'proof': result['proof'],
            'verified': verified,
            'proof_type': args.proof_type,
            'protocol': result['proof'].get('protocol', 'ZK-STARK')
        }
        
        print(json.dumps(output))
        sys.exit(0)
        
    except Exception as e:
        error_output = {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }
        print(json.dumps(error_output), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    generate_proof_cli()
