"""
API COMPATIBILITY WRAPPER
Maintains backward compatibility with existing API while using True STARK
"""

from .true_stark import TrueZKStark
from typing import Dict, Any


class STARKCompatibilityWrapper:
    """
    Wraps True STARK to maintain compatibility with existing Sigma-protocol API
    Converts between old API format and new STARK format
    """
    
    def __init__(self, enhanced_privacy: bool = False):
        self.stark = TrueZKStark()
        self.enhanced_privacy = enhanced_privacy
        self.prime = self.stark.prime
        self.field = self.stark.field
        self.cuda_enabled = False
    
    def generate_proof(self, statement: Dict[str, Any], witness: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate proof using True STARK but return in old API format
        """
        # Generate real STARK proof
        stark_proof = self.stark.generate_proof(statement, witness)
        
        # Convert to old API format for compatibility
        proof_data = stark_proof['proof']
        
        # Add compatibility fields that old API expects
        proof_data['response'] = proof_data.get('public_output', 0)
        proof_data['witness_commitment'] = None  # STARK doesn't use this
        proof_data['merkle_root'] = proof_data['trace_merkle_root']
        proof_data['challenge'] = int(proof_data['trace_merkle_root'][:16], 16) % self.prime
        
        # Keep STARK-specific fields
        proof_data['stark_protocol'] = True
        proof_data['uses_air'] = True
        proof_data['uses_fri'] = True
        
        return {'proof': proof_data, **proof_data}
    
    async def generate_proof_async(self, statement: Dict[str, Any], witness: Dict[str, Any]) -> Dict[str, Any]:
        """Async version"""
        return self.generate_proof(statement, witness)
    
    def verify_proof(self, proof: Dict[str, Any], statement: Dict[str, Any]) -> bool:
        """Verify using True STARK"""
        # Extract proof dict if wrapped
        if 'proof' in proof and isinstance(proof['proof'], dict):
            proof_data = proof['proof']
        else:
            proof_data = proof
        
        return self.stark.verify_proof(proof_data, statement)
    
    def commit(self, value: int, randomness: int) -> int:
        """Legacy API - not used in true STARK"""
        # For compatibility, return deterministic value
        return (value + randomness) % self.prime


# Create default instance that replaces old zk_system
AuthenticZKStark = STARKCompatibilityWrapper
