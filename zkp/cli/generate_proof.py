#!/usr/bin/env python3
"""
CLI tool to generate ZK-STARK proofs from command line
Used by TypeScript integration layer

Uses CUDA-accelerated True STARK implementation following StarkWare protocol.
"""

import sys
import json
import argparse
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import from the unified CUDA True STARK implementation
from core.cuda_true_stark import CUDATrueSTARK, CUDA_AVAILABLE


def generate_proof_cli():
    """Generate ZK-STARK proof from command line arguments"""
    parser = argparse.ArgumentParser(description='Generate ZK-STARK proof (CUDA-accelerated)')
    parser.add_argument('--proof-type', required=True, help='Type of proof to generate')
    parser.add_argument('--statement', required=True, help='Statement JSON')
    parser.add_argument('--witness', required=True, help='Witness JSON')
    parser.add_argument('--verbose', '-v', action='store_true', help='Enable verbose output')
    
    args = parser.parse_args()
    
    try:
        # Parse inputs
        statement = json.loads(args.statement)
        witness = json.loads(args.witness)
        
        if args.verbose:
            print(f"🚀 CUDA Available: {CUDA_AVAILABLE}", file=sys.stderr)
            print(f"📝 Proof Type: {args.proof_type}", file=sys.stderr)
        
        # Use CUDA-accelerated True STARK
        zk_system = CUDATrueSTARK()
        
        # Generate proof
        result = zk_system.generate_proof(statement, witness)
        
        # Verify proof
        verified = zk_system.verify_proof(result['proof'], statement)
        
        if args.verbose:
            print(f"✅ Proof Generated in {result['proof'].get('generation_time', 0):.3f}s", file=sys.stderr)
            print(f"🔍 Verification: {'PASSED' if verified else 'FAILED'}", file=sys.stderr)
        
        # Output result as JSON
        output = {
            'success': True,
            'proof': result['proof'],
            'verified': verified,
            'proof_type': args.proof_type,
            'protocol': result['proof'].get('protocol', 'ZK-STARK (AIR + FRI)'),
            'cuda_accelerated': CUDA_AVAILABLE
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
