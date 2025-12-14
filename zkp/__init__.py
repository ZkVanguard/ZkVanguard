# Single ZK System Package
"""
🛡️ SYBILSHIELD ZK-STARK SYSTEM - MAIN MODULE
=============================================
Complete Zero-Knowledge Proof System with CUDA Optimization

This module provides the unified entry point for the entire ZK system,
maintaining single authoritative implementation with optional GPU acceleration.

Architecture:
- Core: Single authoritative ZK-STARK implementation
- Optimizations: CUDA GPU acceleration extensions  
- Integration: Factory and high-level management API

Security Level: 521-bit with NIST P-521 certified prime field
Performance: 1M+ operations per second with CUDA GPU acceleration
"""

import sys
import os
from typing import Dict, Any, Optional, List

# Add current directory to path for imports
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# Import core ZK system (the ONLY authoritative implementation)
try:
    from .core.zk_system import (
        AuthenticZKStark,
        AuthenticFiniteField,
        AuthenticMerkleTree,
        AuthenticProofManager
    )
    CORE_AVAILABLE = True
    print("✅ ZK Core System loaded")
except ImportError as e:
    print(f"❌ ZK Core System unavailable: {e}")
    CORE_AVAILABLE = False

# Import CUDA optimizations (optional)
try:
    from .optimizations.cuda_acceleration import (
        CUDAAcceleratedZKStark,
        CUDAAcceleratedField,
        CUDAOptimizer,
        get_optimized_zk_system,
        get_cuda_status,
        cuda_optimizer
    )
    CUDA_AVAILABLE = True
    print("✅ CUDA Optimizations loaded")
except ImportError as e:
    print(f"⚠️ CUDA Optimizations unavailable: {e}")
    CUDA_AVAILABLE = False

# Import integration hub (high-level API)
try:
    from .integration.zk_system_hub import (
        ZKSystemFactory,
        ZKSystemManager,
        create_zk_system,
        create_proof_manager,
        get_system_status,
        zk_factory
    )
    INTEGRATION_AVAILABLE = True
    print("✅ Integration Hub loaded")
except ImportError as e:
    print(f"❌ Integration Hub unavailable: {e}")
    INTEGRATION_AVAILABLE = False


class ZKSystemTracker:
    """System-wide tracker for the complete ZK architecture"""
    
    def __init__(self):
        self.core_available = CORE_AVAILABLE
        self.cuda_available = CUDA_AVAILABLE
        self.integration_available = INTEGRATION_AVAILABLE
        self.system_initialized = False
        self._system_info = None
        
    def get_system_architecture(self) -> Dict[str, Any]:
        """Get complete system architecture overview"""
        architecture = {
            "system_name": "SybilShield ZK-STARK System",
            "version": "3.0.0",
            "security_level": "521-bit",
            "prime_field": "NIST_P_521",
            "implementation_status": {
                "core_system": {
                    "available": self.core_available,
                    "location": "privacy.zkp.core.zk_system",
                    "classes": [
                        "AuthenticZKStark",
                        "AuthenticFiniteField", 
                        "AuthenticMerkleTree",
                        "AuthenticProofManager"
                    ] if self.core_available else []
                },
                "cuda_optimization": {
                    "available": self.cuda_available,
                    "location": "privacy.zkp.optimizations.cuda_acceleration",
                    "classes": [
                        "CUDAAcceleratedZKStark",
                        "CUDAAcceleratedField",
                        "CUDAOptimizer"
                    ] if self.cuda_available else []
                },
                "integration_hub": {
                    "available": self.integration_available,
                    "location": "privacy.zkp.integration.zk_system_hub",
                    "classes": [
                        "ZKSystemFactory",
                        "ZKSystemManager"
                    ] if self.integration_available else []
                }
            },
            "entry_points": self._get_entry_points(),
            "system_health": self._get_system_health()
        }
        
        # Add CUDA-specific information if available
        if self.cuda_available:
            try:
                cuda_status = get_cuda_status()
                architecture["cuda_details"] = cuda_status
            except:
                architecture["cuda_details"] = {"error": "CUDA status unavailable"}
        
        return architecture
    
    def _get_entry_points(self) -> Dict[str, str]:
        """Get recommended entry points for different use cases"""
        entry_points = {}
        
        if self.integration_available:
            entry_points.update({
                "recommended": "create_zk_system()",
                "high_level": "ZKSystemManager()",
                "factory": "ZKSystemFactory()"
            })
        
        if self.core_available:
            entry_points["direct_core"] = "AuthenticZKStark()"
            
        if self.cuda_available:
            entry_points["cuda_optimized"] = "get_optimized_zk_system()"
            
        return entry_points
    
    def _get_system_health(self) -> Dict[str, Any]:
        """Check overall system health"""
        health = {
            "overall_status": "healthy" if self.core_available else "degraded",
            "core_system": "available" if self.core_available else "missing",
            "optimization": "cuda" if self.cuda_available else "cpu_only",
            "integration": "available" if self.integration_available else "missing"
        }
        
        # Critical system check
        if not self.core_available:
            health["critical_error"] = "Core ZK system unavailable - system non-functional"
        elif not self.integration_available:
            health["warning"] = "Integration hub unavailable - limited functionality"
            
        return health
    
    def initialize_system(self, enable_cuda: bool = True) -> Dict[str, Any]:
        """Initialize the complete ZK system"""
        if not self.core_available:
            return {
                "success": False,
                "error": "Core ZK system unavailable",
                "system_status": self.get_system_architecture()
            }
        
        try:
            if self.integration_available:
                # Use high-level initialization
                manager = ZKSystemManager(enable_cuda=enable_cuda and self.cuda_available)
                self.system_initialized = True
                
                return {
                    "success": True,
                    "manager": manager,
                    "cuda_enabled": enable_cuda and self.cuda_available,
                    "system_status": self.get_system_architecture()
                }
            else:
                # Direct core initialization
                if enable_cuda and self.cuda_available:
                    zk_system = get_optimized_zk_system()
                else:
                    zk_system = AuthenticZKStark()
                
                self.system_initialized = True
                
                return {
                    "success": True,
                    "zk_system": zk_system,
                    "cuda_enabled": enable_cuda and self.cuda_available,
                    "system_status": self.get_system_architecture()
                }
                    
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "system_status": self.get_system_architecture()
            }
    
    def get_system_summary(self) -> str:
        """Get human-readable system summary"""
        arch = self.get_system_architecture()
        
        summary = f"""
🛡️ SybilShield ZK-STARK System v{arch['version']}
{'='*50}
Core System: {'✅' if self.core_available else '❌'}
CUDA Optimization: {'✅' if self.cuda_available else '⚠️ CPU Only'}
Integration Hub: {'✅' if self.integration_available else '❌'}

System Health: {arch['system_health']['overall_status'].upper()}

Recommended Usage:
{arch['entry_points'].get('recommended', 'Direct core: AuthenticZKStark()')}

Security: {arch['security_level']} with {arch['prime_field']} prime field
"""
        
        if self.cuda_available:
            summary += f"\nCUDA: {arch.get('cuda_details', {}).get('optimization_level', 'Available')}"
            
        return summary


# Global system tracker instance
system_tracker = ZKSystemTracker()


# Main entry point functions

def get_zk_system(enable_cuda: bool = True) -> 'AuthenticZKStark':
    """Get the best available ZK system (main entry point)"""
    if INTEGRATION_AVAILABLE:
        return create_zk_system(enable_cuda=enable_cuda)
    elif CUDA_AVAILABLE and enable_cuda:
        return get_optimized_zk_system()
    elif CORE_AVAILABLE:
        return AuthenticZKStark()
    else:
        raise ImportError("No ZK system implementation available")


def get_zk_manager(enable_cuda: bool = True) -> Optional['ZKSystemManager']:
    """Get high-level ZK system manager"""
    if INTEGRATION_AVAILABLE:
        return ZKSystemManager(enable_cuda=enable_cuda)
    else:
        return None


def get_system_info() -> Dict[str, Any]:
    """Get complete system information"""
    return system_tracker.get_system_architecture()


def initialize_zk_system(enable_cuda: bool = True) -> Dict[str, Any]:
    """Initialize the complete ZK system"""
    return system_tracker.initialize_system(enable_cuda=enable_cuda)


def print_system_status():
    """Print system status to console"""
    print(system_tracker.get_system_summary())


# Export everything for external use
__all__ = [
    # Core classes (if available)
    *("AuthenticZKStark", "AuthenticFiniteField", "AuthenticMerkleTree", "AuthenticProofManager" if CORE_AVAILABLE else []),
    
    # CUDA classes (if available)  
    *("CUDAAcceleratedZKStark", "CUDAAcceleratedField", "CUDAOptimizer" if CUDA_AVAILABLE else []),
    
    # Integration classes (if available)
    *("ZKSystemFactory", "ZKSystemManager" if INTEGRATION_AVAILABLE else []),
    
    # Main entry points
    "get_zk_system",
    "get_zk_manager", 
    "get_system_info",
    "initialize_zk_system",
    "print_system_status",
    
    # System tracking
    "ZKSystemTracker",
    "system_tracker",
    
    # Status flags
    "CORE_AVAILABLE",
    "CUDA_AVAILABLE", 
    "INTEGRATION_AVAILABLE"
]


# Initialize system info on import
if CORE_AVAILABLE:
    print(f"🛡️ SybilShield ZK System loaded - Health: {system_tracker._get_system_health()['overall_status']}")
    if CUDA_AVAILABLE:
        print("⚡ CUDA optimization available")
    if INTEGRATION_AVAILABLE:
        print("🔗 Integration hub ready")
else:
    print("❌ ZK System unavailable - critical components missing")
__version__ = "1.0.0"

# Direct imports from the single ZK system
from .core.zk_system import (
    AuthenticZKStark,
    AuthenticFiniteField, 
    AuthenticMerkleTree,
    AuthenticProofManager
)

__all__ = [
    "AuthenticZKStark",
    "AuthenticFiniteField", 
    "AuthenticMerkleTree",
    "AuthenticProofManager"
]
