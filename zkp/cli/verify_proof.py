#!/usr/bin/env python3
"""
CLI tool to verify ZK-STARK proofs from command line
Uses CUDA-accelerated True STARK implementation following StarkWare protocol.
"""

import sys
import json
import argparse
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.cuda_true_stark import CUDATrueSTARK, CUDA_AVAILABLE


def verify_proof_cli():
    """Verify ZK-STARK proof from command line arguments"""
    parser = argparse.ArgumentParser(description='Verify ZK-STARK proof (CUDA-accelerated)')
    parser.add_argument('--proof', required=True, help='Proof JSON')
    parser.add_argument('--statement', required=True, help='Statement JSON')
    parser.add_argument('--verbose', '-v', action='store_true', help='Enable verbose output')
    
    args = parser.parse_args()
    
    try:
        # Parse inputs
        proof = json.loads(args.proof)
        statement = json.loads(args.statement)
        
        if args.verbose:
            print(f"🚀 CUDA Available: {CUDA_AVAILABLE}", file=sys.stderr)
        
        # Use CUDA-accelerated True STARK
        zk_system = CUDATrueSTARK()
        
        # Verify proof
        verified = zk_system.verify_proof(proof, statement)
        
        if args.verbose:
            print(f"🔍 Verification: {'✅ PASSED' if verified else '❌ FAILED'}", file=sys.stderr)
        
        # Output result
        output = {
            'success': True,
            'verified': verified,
            'protocol': proof.get('protocol', 'ZK-STARK (AIR + FRI)'),
            'cuda_accelerated': CUDA_AVAILABLE
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
