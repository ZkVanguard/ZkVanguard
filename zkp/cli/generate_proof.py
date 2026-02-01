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
import io

# Force UTF-8 encoding for stdout/stderr to handle Unicode characters on Windows
if sys.platform == 'win32':
    # Use raw binary mode to avoid encoding issues
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Create a null device to suppress all print statements during import/init
class NullWriter:
    def write(self, s): pass
    def flush(self): pass

# Suppress stdout during imports to prevent module print statements from corrupting JSON output
_original_stdout = sys.stdout
_null_writer = NullWriter()
sys.stdout = _null_writer

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import from the unified CUDA True STARK implementation
from core.cuda_true_stark import CUDATrueSTARK, CUDA_AVAILABLE

# Restore stdout after imports
sys.stdout = _original_stdout


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
            print(f"CUDA Available: {CUDA_AVAILABLE}", file=sys.stderr)
            print(f"Proof Type: {args.proof_type}", file=sys.stderr)
        
        # Suppress print during ZK system initialization
        sys.stdout = _null_writer
        zk_system = CUDATrueSTARK()
        sys.stdout = _original_stdout
        
        # Suppress print during proof generation and verification  
        sys.stdout = _null_writer
        result = zk_system.generate_proof(statement, witness)
        verified = zk_system.verify_proof(result['proof'], statement)
        sys.stdout = _original_stdout
        
        if args.verbose:
            print(f"Proof Generated in {result['proof'].get('generation_time', 0):.3f}s", file=sys.stderr)
            print(f"Verification: {'PASSED' if verified else 'FAILED'}", file=sys.stderr)
        
        # Output result as JSON (only valid JSON goes to stdout)
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
        # Ensure stdout is restored before error output
        sys.stdout = _original_stdout
        error_output = {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }
        # Error goes to stdout as JSON so Node can parse it
        print(json.dumps(error_output))
        sys.exit(1)


if __name__ == '__main__':
    generate_proof_cli()
